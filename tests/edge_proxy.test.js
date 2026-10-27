const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const edgeClientIp = require('../src/middleware/edgeClientIp');

const FUNCTION_FILE = path.join(__dirname, '..', 'client', 'functions', 'api', '[[path]].js');
const loadFunction = () => import(pathToFileURL(FUNCTION_FILE).href);

// The Cloudflare Pages function that forwards /api to Render, and the API
// middleware that learns the visitor's address from it.
describe('Cloudflare Pages /api proxy', () => {
    const realFetch = global.fetch;
    afterEach(() => {
        global.fetch = realFetch;
    });

    const env = { API_ORIGIN: 'https://fixmaster-api.onrender.com/', EDGE_PROXY_SECRET: 's3cret' };
    const ask = (url, init = {}) => new Request(url, init);

    it('forwards the path, query, method and body to the API', async () => {
        const { onRequest } = await loadFunction();
        let seen;
        global.fetch = async (url, init) => {
            seen = { url, init };
            return new Response('{"ok":true}', { status: 201, headers: { 'content-type': 'application/json' } });
        };
        const res = await onRequest({ request: ask('https://divyakush.info/api/complaints?x=1', { method: 'POST', body: '{"a":1}', headers: { 'content-type': 'application/json', cookie: 'fm_session=abc', origin: 'https://divyakush.info' } }), env });
        assert.equal(res.status, 201);
        assert.equal(seen.url, 'https://fixmaster-api.onrender.com/api/complaints?x=1');
        assert.equal(seen.init.method, 'POST');
        assert.equal(seen.init.headers.get('cookie'), 'fm_session=abc');
        assert.equal(seen.init.headers.get('origin'), 'https://divyakush.info');
        assert.equal(seen.init.redirect, 'manual');
    });

    it('sends the visitor address with the secret, and drops anything a visitor tried to set', async () => {
        const { onRequest } = await loadFunction();
        let sent;
        global.fetch = async (url, init) => {
            sent = init.headers;
            return new Response(null, { status: 204 });
        };
        await onRequest({
            request: ask('https://divyakush.info/api/me', { headers: { 'cf-connecting-ip': '203.0.113.9', 'x-edge-client-ip': '6.6.6.6', 'x-edge-secret': 'guess', 'x-forwarded-for': '7.7.7.7' } }),
            env,
        });
        assert.equal(sent.get('x-edge-client-ip'), '203.0.113.9');
        assert.equal(sent.get('x-edge-secret'), 's3cret');
        assert.equal(sent.get('x-forwarded-for'), null);
        assert.equal(sent.get('cf-connecting-ip'), null);
    });

    it('keeps every Set-Cookie of the response', async () => {
        const { onRequest } = await loadFunction();
        global.fetch = async () => {
            const h = new Headers();
            h.append('set-cookie', 'fm_session=a; Path=/api; HttpOnly');
            h.append('set-cookie', 'fm_csrf=b; Path=/');
            return new Response('{}', { status: 200, headers: h });
        };
        const res = await onRequest({ request: ask('https://divyakush.info/api/auth/login', { method: 'POST', body: '{}' }), env });
        assert.equal(res.headers.getSetCookie().length, 2);
    });

    it('answers 503 when the API address is missing and 502 when the API cannot be reached', async () => {
        const { onRequest } = await loadFunction();
        const none = await onRequest({ request: ask('https://divyakush.info/api/me'), env: {} });
        assert.equal(none.status, 503);
        global.fetch = async () => {
            throw new Error('connect ECONNREFUSED');
        };
        const down = await onRequest({ request: ask('https://divyakush.info/api/me'), env });
        assert.equal(down.status, 502);
        assert.equal((await down.json()).code, 'API_UNAVAILABLE');
    });
});

describe('edgeClientIp middleware', () => {
    const run = (headers, secret) => {
        const old = process.env.EDGE_PROXY_SECRET;
        if (secret === undefined) delete process.env.EDGE_PROXY_SECRET;
        else process.env.EDGE_PROXY_SECRET = secret;
        const req = { headers, ip: '10.0.0.1' };
        edgeClientIp(req, {}, () => {});
        if (old === undefined) delete process.env.EDGE_PROXY_SECRET;
        else process.env.EDGE_PROXY_SECRET = old;
        return req.ip;
    };

    it('uses the forwarded address when the secret matches', () => {
        assert.equal(run({ 'x-edge-secret': 'k', 'x-edge-client-ip': '203.0.113.9' }, 'k'), '203.0.113.9');
        assert.equal(run({ 'x-edge-secret': 'k', 'x-edge-client-ip': '2001:db8::1' }, 'k'), '2001:db8::1');
    });

    it('ignores it with the wrong secret, no secret, a bad address, or when switched off', () => {
        assert.equal(run({ 'x-edge-secret': 'nope', 'x-edge-client-ip': '203.0.113.9' }, 'k'), '10.0.0.1');
        assert.equal(run({ 'x-edge-client-ip': '203.0.113.9' }, 'k'), '10.0.0.1');
        assert.equal(run({ 'x-edge-secret': 'k', 'x-edge-client-ip': 'not-an-ip' }, 'k'), '10.0.0.1');
        assert.equal(run({ 'x-edge-secret': 'k', 'x-edge-client-ip': '203.0.113.9' }, undefined), '10.0.0.1');
    });
});
