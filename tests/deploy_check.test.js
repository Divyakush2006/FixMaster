const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { runChecks, PASS, WARN, FAIL } = require('../scripts/deploy-check');

const SITE = 'https://site.example';
const html = '<!doctype html><div id="root"></div>';
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const page = () =>
    new Response(html, { status: 200, headers: { 'content-type': 'text/html', 'content-security-policy': "default-src 'self'", 'x-frame-options': 'DENY', 'x-content-type-options': 'nosniff', 'strict-transport-security': 'max-age=1' } });

// A well-set-up deployment, which each test then breaks in one place.
const healthy = (overrides = {}) => async (url, init = {}) => {
    const u = new URL(url);
    const key = `${init.method || 'GET'} ${u.pathname}`;
    if (overrides[key]) return overrides[key](init);
    if (u.host === 'api.example') return json({ status: 'ok' });
    if (key === 'GET /api/health/live') return json({ status: 'ok' });
    if (key === 'GET /api/health') return json({ status: 'ok' });
    if (key === 'GET /api/auth/capabilities') return json({ password_reset: true, student_signup: true });
    if (key === 'POST /api/auth/student/login') return init.headers.origin === SITE ? json({ error: 'Invalid credentials' }, 401) : json({ code: 'ORIGIN' }, 403);
    if (key === 'GET /api/metrics') return json({ error: 'Unauthorized.' }, 401);
    if (u.pathname.startsWith('/api/')) return json({ error: 'not found' }, 404);
    return page();
};
const byName = (results) => Object.fromEntries(results.map((r) => [r.name, r]));
const statuses = (results) => results.map((r) => r.status);

describe('deploy:check', () => {
    it('passes a healthy deployment', async () => {
        const results = await runChecks({ site: SITE, api: 'https://api.example', fetchImpl: healthy() });
        assert.deepEqual([...new Set(statuses(results))], [PASS]);
        assert.ok(results.length >= 9);
    });

    it('fails when the site cannot reach the API and names the Pages setting', async () => {
        const down = () => json({ error: 'The API address is not configured.', code: 'API_UNAVAILABLE' }, 503);
        const results = await runChecks({ site: SITE, fetchImpl: healthy({ 'GET /api/health/live': down, 'GET /api/health': down }) });
        const r = byName(results)['/api reaches the API through the site'];
        assert.equal(r.status, FAIL);
        assert.match(r.detail, /API_ORIGIN/);
    });

    it('fails when CORS_ORIGIN is not set (any origin accepted)', async () => {
        const open = () => json({ error: 'Invalid credentials' }, 401);
        const results = await runChecks({ site: SITE, fetchImpl: healthy({ 'POST /api/auth/student/login': open }) });
        assert.equal(byName(results)['Other websites cannot act for a visitor'].status, FAIL);
    });

    it('fails when the site origin is refused by the API', async () => {
        const refuse = () => json({ code: 'ORIGIN' }, 403);
        const results = await runChecks({ site: SITE, fetchImpl: healthy({ 'POST /api/auth/student/login': refuse }) });
        const r = byName(results)['Sign-in is accepted from the site'];
        assert.equal(r.status, FAIL);
        assert.match(r.detail, /CORS_ORIGIN/);
    });

    it('warns, not fails, when email is switched off', async () => {
        const results = await runChecks({ site: SITE, fetchImpl: healthy({ 'GET /api/auth/capabilities': () => json({ password_reset: false, student_signup: false }) }) });
        assert.equal(byName(results)['Sign-up and password reset are enabled'].status, WARN);
        assert.ok(!statuses(results).includes(FAIL));
    });

    it('fails when metrics can be read by anyone', async () => {
        const results = await runChecks({ site: SITE, fetchImpl: healthy({ 'GET /api/metrics': () => new Response('# metrics', { status: 200, headers: { 'content-type': 'text/plain' } }) }) });
        assert.equal(byName(results)['Metrics are private'].status, FAIL);
    });

    it('reports a network error as a failure instead of crashing', async () => {
        const results = await runChecks({
            site: SITE,
            fetchImpl: async () => {
                throw new Error('getaddrinfo ENOTFOUND site.example');
            },
        });
        assert.ok(results.length > 0 && statuses(results).every((s) => s === FAIL));
    });
});
