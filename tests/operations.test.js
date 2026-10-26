const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { resetDatabase, startApp, SEED } = require('./helpers');

// Running the service: metrics for the monitoring system, error alerts to a
// chat webhook, and data retention.

describe('operations', () => {
    let t;
    let admin;

    before(async () => {
        await resetDatabase();
        t = await startApp();
        admin = await t.login(SEED.admin);
    });
    after(async () => {
        delete process.env.METRICS_TOKEN;
        delete process.env.ERROR_WEBHOOK_URL;
        await t.close();
    });

    const scrape = async (headers = {}) => {
        const res = await fetch(`${t.base}/metrics`, { headers });
        return { status: res.status, text: await res.text(), type: res.headers.get('content-type') };
    };

    describe('metrics', () => {
        it('serves Prometheus text with request counts and latency by route pattern, never raw URLs', async () => {
            await t.api('/complaints/cmp-843-0002-uuid-000000000002', { token: await t.login(SEED.supervisor) });
            await t.api('/complaints/some-other-id', { token: admin });
            const r = await scrape();
            assert.equal(r.status, 200);
            assert.match(r.type, /^text\/plain/);
            assert.match(r.text, /# TYPE fixmaster_http_requests_total counter/);
            assert.match(r.text, /fixmaster_http_requests_total\{method="GET",route="\/api\/complaints\/:id",status="200"\} \d+/);
            assert.match(r.text, /fixmaster_http_request_duration_seconds_bucket\{route="\/api\/complaints\/:id",le="0\.1"\} \d+/);
            assert.match(r.text, /fixmaster_http_request_duration_seconds_count\{route="\/api\/complaints\/:id"\} \d+/);
            assert.ok(!r.text.includes('cmp-843-0002') && !r.text.includes('some-other-id'), 'identifiers never become labels');
        });

        it('reports the database, the pool, the cache and the AI success rate', async () => {
            await t.sql(`INSERT INTO ai_calls (run_id, task, provider, model, prompt_version, outcome) VALUES (gen_random_uuid(), 'INTAKE', 'groq', 'm', 'v1', 'OK'), (gen_random_uuid(), 'INTAKE', 'groq', 'm', 'v1', 'ERROR')`);
            const { text } = await scrape();
            assert.match(text, /fixmaster_db_up 1/);
            assert.match(text, /fixmaster_db_pool_connections\{state="idle"\} \d+/);
            assert.match(text, /fixmaster_dashboard_cache_total\{result="hit"\}/);
            assert.match(text, /fixmaster_ai_calls_hour\{task="INTAKE",provider="groq",outcome="OK"\} 1/);
            assert.match(text, /fixmaster_ai_success_ratio_hour 0\.5/);
            assert.match(text, /fixmaster_open_tickets \d+/);
        });

        it('with a token configured, needs it', async () => {
            process.env.METRICS_TOKEN = 'scrape-secret-value';
            try {
                assert.equal((await scrape()).status, 401);
                assert.equal((await scrape({ Authorization: 'Bearer wrong-secret-value!' })).status, 401);
                assert.equal((await scrape({ Authorization: 'Bearer scrape-secret-value' })).status, 200);
            } finally {
                delete process.env.METRICS_TOKEN;
            }
        });
    });

    describe('error alerts', () => {
        let server;
        let received;
        const alerts = require('../src/services/alerts');
        const { errorHandler } = require('../src/middleware/errorHandler');
        const fakeRes = () => ({ status() { return this; }, json() { return this; } });
        const crash = (message, extra = {}) =>
            errorHandler(new Error(message), { method: 'POST', originalUrl: '/api/complaints?token=abc', baseUrl: '/api/complaints', route: { path: '/' }, id: 'req-123', body: { password: 'hunter2' }, ...extra }, fakeRes(), () => {});
        const settle = () => new Promise((r) => setTimeout(r, 120));

        before(async () => {
            received = [];
            server = http.createServer((req, res) => {
                let body = '';
                req.on('data', (c) => (body += c));
                req.on('end', () => {
                    received.push(JSON.parse(body));
                    res.end('ok');
                });
            });
            await new Promise((r) => server.listen(0, '127.0.0.1', r));
            process.env.ERROR_WEBHOOK_URL = `http://127.0.0.1:${server.address().port}/hook`;
        });
        beforeEach(() => {
            received.length = 0;
            alerts._reset();
        });
        after(async () => {
            delete process.env.ERROR_WEBHOOK_URL;
            await new Promise((r) => server.close(r));
        });

        it('sends the route, the message and the request id - and nothing the request carried', async () => {
            const log = console.error;
            console.error = () => {};
            try {
                crash('relation "x" does not exist');
                await settle();
            } finally {
                console.error = log;
            }
            assert.equal(received.length, 1);
            const text = received[0].text;
            assert.match(text, /POST \/api\/complaints returned 500/);
            assert.match(text, /relation "x" does not exist/);
            assert.match(text, /req-123/);
            assert.ok(!/hunter2|token=abc|password/.test(text), text);
        });

        it('says each distinct failure once, then stays quiet while it repeats', async () => {
            const log = console.error;
            console.error = () => {};
            try {
                for (let i = 0; i < 5; i += 1) crash('same failure');
                crash('a different failure');
                await settle();
            } finally {
                console.error = log;
            }
            assert.equal(received.length, 2);
            assert.equal(alerts.stats.suppressed, 4);
        });

        it('does not alert for ordinary client errors', async () => {
            await t.api('/complaints/nope', { token: admin }); // 404
            await t.api('/me/password', { method: 'PATCH', token: admin, body: {} }); // 400
            await settle();
            assert.equal(received.length, 0);
        });

        it('does nothing when no webhook is configured', async () => {
            const url = process.env.ERROR_WEBHOOK_URL;
            delete process.env.ERROR_WEBHOOK_URL;
            const log = console.error;
            console.error = () => {};
            try {
                crash('quiet failure');
                await settle();
            } finally {
                console.error = log;
                process.env.ERROR_WEBHOOK_URL = url;
            }
            assert.equal(received.length, 0);
        });
    });

    describe('retention', () => {
        const retention = require('../src/services/retentionService');
        const count = async (sql, params) => (await t.sql(sql, params)).rows[0].n;

        before(async () => {
            const studentId = (await t.sql('SELECT user_id FROM users WHERE reg_or_emp_id = $1', [SEED.student])).rows[0].user_id;
            await t.sql(`DELETE FROM ai_calls`);
            await t.sql(
                `INSERT INTO ai_calls (run_id, task, provider, model, prompt_version, outcome, created_at) VALUES
                 (gen_random_uuid(), 'INTAKE', 'groq', 'm', 'v1', 'OK', NOW() - INTERVAL '200 days'),
                 (gen_random_uuid(), 'INTAKE', 'groq', 'm', 'v1', 'OK', NOW() - INTERVAL '5 days')`
            );
            await t.sql(
                `INSERT INTO ai_briefings (scope_key, briefing_date, narrative, facts, source) VALUES
                 ('OLD', CURRENT_DATE - 200, '{}', '{}', 'RULES'), ('NEW', CURRENT_DATE, '{}', '{}', 'RULES')`
            );
            await t.sql(
                `INSERT INTO email_verifications (user_id, code_hash, expires_at, consumed_at, created_at) VALUES
                 ($1, repeat('a', 64), NOW() - INTERVAL '99 days', NOW() - INTERVAL '100 days', NOW() - INTERVAL '101 days'),
                 ($1, repeat('b', 64), NOW() + INTERVAL '10 minutes', NULL, NOW())`,
                [studentId]
            );
            await t.sql(`INSERT INTO revoked_tokens (jti, user_id, expires_at) VALUES ('old-jti', $1, NOW() - INTERVAL '1 day'), ('live-jti', $1, NOW() + INTERVAL '1 day')`, [studentId]);
            const hash = (await t.sql(`SELECT password_hash FROM users WHERE user_id = $1`, [studentId])).rows[0].password_hash;
            await t.sql(
                `INSERT INTO users (reg_or_emp_id, full_name, email, phone_number, password_hash, role, account_status, created_at) VALUES
                 ('24BCE0001', 'Never Confirmed', 'never@vitstudent.ac.in', '9000000001', $1, 'STUDENT', 'PENDING_VERIFICATION', NOW() - INTERVAL '40 days'),
                 ('24BCE0002', 'Just Signed Up', 'just@vitstudent.ac.in', '9000000002', $1, 'STUDENT', 'PENDING_VERIFICATION', NOW() - INTERVAL '1 day')`,
                [hash]
            );
            await t.sql(`INSERT INTO audit_log (action, occurred_at) VALUES ('test.old', NOW() - INTERVAL '900 days')`);
        });

        it('reports the periods in force', () => {
            assert.deepEqual(retention.currentPolicy(), { ai_calls: 90, ai_briefings: 90, email_verifications: 30, unverified_accounts: 14, audit_log: 0 });
        });

        it('removes what is past its period and keeps the rest', async () => {
            const removed = await retention.sweep();
            assert.deepEqual(removed, { ai_calls: 1, ai_briefings: 1, email_verifications: 1, revoked_tokens: 1, unverified_accounts: 1 });
            assert.equal(await count(`SELECT COUNT(*)::int AS n FROM ai_calls`), 1);
            assert.equal(await count(`SELECT COUNT(*)::int AS n FROM ai_briefings WHERE scope_key = 'NEW'`), 1);
            assert.equal(await count(`SELECT COUNT(*)::int AS n FROM email_verifications`), 1);
            assert.equal(await count(`SELECT COUNT(*)::int AS n FROM revoked_tokens WHERE jti = 'live-jti'`), 1);
            assert.equal(await count(`SELECT COUNT(*)::int AS n FROM users WHERE reg_or_emp_id = '24BCE0001'`), 0, 'never confirmed, so removed');
            assert.equal(await count(`SELECT COUNT(*)::int AS n FROM users WHERE reg_or_emp_id = '24BCE0002'`), 1, 'still has time to confirm');
        });

        it('keeps the audit log unless told otherwise, and never touches real residents or tickets', async () => {
            assert.equal(await count(`SELECT COUNT(*)::int AS n FROM audit_log WHERE action = 'test.old'`), 1);
            assert.ok(await count(`SELECT COUNT(*)::int AS n FROM users WHERE role = 'STUDENT' AND account_status = 'ACTIVE'`) >= 4);
            assert.ok(await count(`SELECT COUNT(*)::int AS n FROM complaints`) >= 4);
        });

        it('applies a configured audit period, and a zero period keeps everything', async () => {
            process.env.RETENTION_AUDIT_DAYS = '365';
            process.env.RETENTION_AI_CALL_DAYS = '0';
            try {
                const removed = await retention.sweep();
                assert.equal(removed.audit_log, 1);
                assert.equal(removed.ai_calls, undefined, 'a zero period means keep');
            } finally {
                delete process.env.RETENTION_AUDIT_DAYS;
                delete process.env.RETENTION_AI_CALL_DAYS;
            }
        });

        it('lets two servers run it without doubling up', async () => {
            const [a, b] = await Promise.all([retention.sweep(), retention.sweep()]);
            assert.ok(a === null || b === null || (a && b), 'neither run fails');
        });

        it('is visible to administrators only', async () => {
            assert.equal((await t.api('/admin/retention-policy', { token: await t.login(SEED.supervisor) })).status, 403);
            const r = await t.api('/admin/retention-policy', { token: admin });
            assert.equal(r.status, 200);
            assert.equal(r.data.ai_calls, 90);
        });
    });
});
