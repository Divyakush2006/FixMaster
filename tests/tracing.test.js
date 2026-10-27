const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { resetDatabase, startApp, SEED } = require('./helpers');

// Tracing: a trace id on every request, W3C Trace Context in, and spans exported as
// OTLP/HTTP JSON to a collector - here a stand-in that records what it is sent.

const TRACE = '4bf92f3577b34da6a3ce929d0e0e4736';
const PARENT = '00f067aa0ba902b7';
const traceparent = (flags = '01') => `00-${TRACE}-${PARENT}-${flags}`;
const settle = () => new Promise((resolve) => setTimeout(resolve, 60));

async function startCollector() {
    const received = [];
    const state = { status: 200 };
    const server = http.createServer(async (req, res) => {
        let raw = '';
        for await (const chunk of req) raw += chunk;
        received.push({ url: req.url, headers: req.headers, raw, body: JSON.parse(raw) });
        res.writeHead(state.status, { 'Content-Type': 'application/json' }).end('{}');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    return {
        url: `http://127.0.0.1:${server.address().port}`,
        received,
        state,
        spans: () => received.flatMap((r) => r.body.resourceSpans.flatMap((rs) => rs.scopeSpans.flatMap((ss) => ss.spans))),
        close: () => new Promise((resolve) => {
            server.closeAllConnections();
            server.close(resolve);
        }),
    };
}

const attr = (span, key) => {
    const found = (span.attributes || []).find((a) => a.key === key);
    return found ? Object.values(found.value)[0] : undefined;
};

describe('tracing', () => {
    let t;
    let collector;
    let tracing;
    let providers;
    let gateway;
    let admin;
    let student;

    before(async () => {
        await resetDatabase();
        t = await startApp();
        tracing = require('../src/services/tracing');
        providers = require('../src/services/ai/providers');
        gateway = require('../src/services/ai/gateway');
        collector = await startCollector();
        admin = await t.login(SEED.admin);
        student = await t.login(SEED.student);
    });
    after(async () => {
        delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
        await t.close();
        await collector.close();
    });
    beforeEach(() => {
        Object.assign(process.env, { OTEL_EXPORTER_OTLP_ENDPOINT: collector.url });
        delete process.env.OTEL_TRACES_SAMPLER_ARG;
        delete process.env.OTEL_EXPORTER_OTLP_HEADERS;
        collector.received.length = 0;
        collector.state.status = 200;
        tracing._reset();
    });

    const get = (path, { token, headers = {} } = {}) => t.api(path, { token, headers });
    const exported = async () => {
        await settle();
        await tracing.flush();
        return collector.spans();
    };

    it('gives every request a trace id, and continues the caller\'s trace when it sends one', async () => {
        delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
        const plain = await get('/meta/privacy-notice');
        assert.match(plain.headers.get('x-trace-id'), /^[0-9a-f]{32}$/);
        const other = await get('/meta/privacy-notice');
        assert.notEqual(other.headers.get('x-trace-id'), plain.headers.get('x-trace-id'));
        const joined = await get('/meta/privacy-notice', { headers: { traceparent: traceparent() } });
        assert.equal(joined.headers.get('x-trace-id'), TRACE);
        assert.equal(collector.received.length, 0, 'nothing is exported until a collector is configured');
        assert.equal(tracing.isEnabled(), false);
    });

    it('ignores a traceparent that is not valid and starts a trace of its own', async () => {
        for (const bad of [`00-${'0'.repeat(32)}-${PARENT}-01`, `00-${TRACE}-${'0'.repeat(16)}-01`, `01-${TRACE}-${PARENT}-01`, `00-${TRACE.toUpperCase()}-${PARENT}-01`, 'garbage', `00-${TRACE}-${PARENT}`]) {
            const r = await get('/meta/privacy-notice', { headers: { traceparent: bad } });
            assert.match(r.headers.get('x-trace-id'), /^[0-9a-f]{32}$/, bad);
            assert.notEqual(r.headers.get('x-trace-id'), TRACE, bad);
        }
    });

    it('exports the request as a server span in the caller\'s trace, as OTLP JSON', async () => {
        process.env.OTEL_EXPORTER_OTLP_HEADERS = 'authorization=Bearer%20collector-key,x-team=hostels';
        const r = await get('/meta/privacy-notice', { headers: { traceparent: traceparent() } });
        assert.equal(r.status, 200);
        const spans = await exported();
        const request = spans.find((s) => s.kind === 2);
        assert.ok(request, JSON.stringify(spans));
        assert.equal(request.traceId, TRACE);
        assert.equal(request.parentSpanId, PARENT);
        assert.match(request.spanId, /^[0-9a-f]{16}$/);
        assert.equal(request.name, 'GET /api/meta/privacy-notice');
        assert.equal(attr(request, 'http.response.status_code'), '200');
        assert.equal(attr(request, 'http.route'), '/api/meta/privacy-notice');
        assert.ok(BigInt(request.endTimeUnixNano) >= BigInt(request.startTimeUnixNano));
        assert.equal(request.status.code, 1);

        const post = collector.received[0];
        assert.equal(post.url, '/v1/traces');
        assert.equal(post.headers['content-type'], 'application/json');
        assert.equal(post.headers.authorization, 'Bearer collector-key');
        assert.equal(post.headers['x-team'], 'hostels');
        const resource = post.body.resourceSpans[0].resource.attributes;
        assert.equal(Object.values(resource.find((a) => a.key === 'service.name').value)[0], 'fixmaster-api');
    });

    it('names spans by route pattern, so ticket ids never reach the collector', async () => {
        const id = '0b1c2d3e-aaaa-bbbb-cccc-0123456789ab';
        await get(`/complaints/${id}/photo?secret=1`, { token: student });
        const spans = await exported();
        const request = spans.find((s) => s.kind === 2);
        assert.equal(request.name, 'GET /api/complaints/:id/photo');
        assert.ok(!JSON.stringify(spans).includes(id) && !JSON.stringify(spans).includes('secret=1'));
    });

    it('records database work as child spans without any SQL or values', async () => {
        const email = (await t.sql('SELECT email FROM users WHERE reg_or_emp_id = $1', [SEED.student])).rows[0].email;
        const login = await t.api('/auth/student/login', { method: 'POST', body: { reg_or_emp_id: SEED.student, password: 'Password@123' } });
        assert.equal(login.status, 200);
        const overview = await get('/insights/overview', { token: admin });
        assert.equal(overview.status, 200);
        const spans = await exported();
        const request = spans.find((s) => s.kind === 2 && s.name === 'GET /api/insights/overview');
        const queries = spans.filter((s) => s.name === 'db.query' && s.traceId === request.traceId);
        assert.ok(queries.length >= 1, 'the dashboard reads the database');
        assert.ok(queries.every((q) => attr(q, 'db.system.name') === 'postgresql' && /^[A-Z]+$/.test(attr(q, 'db.operation.name'))));
        assert.ok(spans.some((s) => s.name === 'db.transaction' || s.name === 'db.query'), 'children exist');
        const everything = JSON.stringify(spans);
        for (const secret of ['Password@123', email, SEED.student, 'FROM complaints', 'WHERE']) {
            assert.ok(!everything.includes(secret), `leaked ${secret}`);
        }
        // Every child hangs off a span in the same trace.
        const ids = new Set(spans.map((s) => s.spanId));
        for (const q of queries) assert.ok(ids.has(q.parentSpanId) || q.parentSpanId === request.spanId);
    });

    it('records an AI call as a child span - task, provider, model, outcome - never the prompt', async () => {
        gateway._resetBreakers();
        providers.setFakeResponder(() => ({ headline: 'Quiet week.', highlights: [], actions: ['Keep going.'] }));
        const r = await t.api('/insights/briefing/refresh', { method: 'POST', token: admin, headers: { traceparent: traceparent() } });
        assert.equal(r.status, 200);
        const spans = await exported();
        const call = spans.find((s) => s.name === 'ai.call');
        assert.ok(call, 'an ai.call span');
        assert.equal(call.traceId, TRACE);
        assert.equal(call.kind, 3);
        assert.equal(attr(call, 'fixmaster.ai.task'), 'BRIEFING');
        assert.ok(attr(call, 'fixmaster.ai.provider') && attr(call, 'fixmaster.ai.model'));
        assert.equal(call.status.code, 1);
        assert.ok(!JSON.stringify(spans).includes('Quiet week'), 'no model output in a span');

        collector.received.length = 0;
        gateway._resetBreakers();
        providers.setFakeResponder(() => {
            throw new providers.ProviderError('ERROR', 'down');
        });
        await t.api('/insights/briefing/refresh', { method: 'POST', token: admin });
        const failed = (await exported()).find((s) => s.name === 'ai.call');
        assert.equal(failed.status.code, 2, 'a failed call is marked as an error');
    });

    it('records nothing for a trace the caller chose not to sample, or when sampling is off', async () => {
        await get('/meta/privacy-notice', { headers: { traceparent: traceparent('00') } });
        assert.deepEqual(await exported(), []);

        process.env.OTEL_TRACES_SAMPLER_ARG = '0';
        const r = await get('/meta/privacy-notice');
        assert.match(r.headers.get('x-trace-id'), /^[0-9a-f]{32}$/, 'still has an id for the logs');
        assert.deepEqual(await exported(), []);

        await get('/meta/privacy-notice', { headers: { traceparent: traceparent('01') } });
        assert.equal((await exported()).filter((s) => s.kind === 2).length, 1, 'a sampled caller is followed even when the local ratio is zero');
    });

    it('a collector that is down or unhappy never affects a request', async () => {
        collector.state.status = 503;
        const r = await get('/meta/privacy-notice');
        assert.equal(r.status, 200);
        await settle();
        await tracing.flush();
        assert.ok(tracing.stats.failed >= 1);

        process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://127.0.0.1:1';
        tracing._reset();
        const again = await get('/meta/privacy-notice');
        assert.equal(again.status, 200);
        await settle();
        await assert.doesNotReject(tracing.flush());
        assert.ok(tracing.stats.failed >= 1);
    });

    it('puts the trace id in error alerts, so an alert leads to the exact request', async () => {
        const alerts = require('../src/services/alerts');
        const sent = [];
        const hook = http.createServer(async (req, res) => {
            let raw = '';
            for await (const chunk of req) raw += chunk;
            sent.push(JSON.parse(raw));
            res.writeHead(200).end('ok');
        });
        await new Promise((resolve) => hook.listen(0, '127.0.0.1', resolve));
        process.env.ERROR_WEBHOOK_URL = `http://127.0.0.1:${hook.address().port}`;
        alerts._reset();
        try {
            alerts.notifyError({ method: 'GET', baseUrl: '/api/x', route: { path: '/y' }, id: 'req-1', traceId: TRACE }, new Error('boom'));
            await settle();
            await settle();
            assert.match(sent[0].text, new RegExp(`trace ${TRACE}`));
        } finally {
            delete process.env.ERROR_WEBHOOK_URL;
            hook.closeAllConnections();
            hook.close();
        }
    });
});
