const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { resetDatabase, startApp, SEED, SEED_PASSWORD } = require('./helpers');

// Browser sessions: an HttpOnly cookie plus a double-submit CSRF token.
// API clients keep using Bearer tokens and are unaffected.

describe('cookie sessions', () => {
    let t;
    const BROWSER = { 'X-Session-Transport': 'cookie' };

    before(async () => {
        await resetDatabase();
        t = await startApp();
    });
    after(async () => t && t.close());

    const cookiesOf = (res) => {
        const jar = {};
        const raw = {};
        for (const line of res.headers.getSetCookie()) {
            const [pair] = line.split(';');
            const i = pair.indexOf('=');
            jar[pair.slice(0, i)] = pair.slice(i + 1);
            raw[pair.slice(0, i)] = line;
        }
        return { jar, raw };
    };
    const asCookie = (jar) => `fm_session=${jar.fm_session}; fm_csrf=${jar.fm_csrf}`;
    const browserLogin = async (id = SEED.student, password = SEED_PASSWORD, portal = 'student') => {
        const res = await t.api(`/auth/${portal}/login`, { method: 'POST', body: { reg_or_emp_id: id, password }, headers: BROWSER });
        assert.equal(res.status, 200);
        return { res, ...cookiesOf(res) };
    };
    const browser = (jar, extra = {}) => ({ headers: { Cookie: asCookie(jar), 'X-CSRF-Token': jar.fm_csrf, ...extra } });

    it('sets an HttpOnly, SameSite=Strict session cookie and keeps the token out of the response body', async () => {
        const { res, raw, jar } = await browserLogin();
        assert.equal(res.data.token, undefined, 'page scripts never see the token');
        assert.ok(res.data.expires_at && new Date(res.data.expires_at) > new Date());
        assert.equal(res.data.user.reg_or_emp_id, SEED.student);

        assert.match(raw.fm_session, /HttpOnly/i);
        assert.match(raw.fm_session, /SameSite=Strict/i);
        assert.match(raw.fm_session, /Path=\/api/);
        assert.match(raw.fm_csrf, /SameSite=Strict/i);
        assert.doesNotMatch(raw.fm_csrf, /HttpOnly/i, 'the page must be able to read the CSRF value');
        assert.ok(jar.fm_csrf.length >= 24);
    });

    it('API clients that do not ask for cookies still get a Bearer token and no cookie', async () => {
        const res = await t.api('/auth/student/login', { method: 'POST', body: { reg_or_emp_id: SEED.student, password: SEED_PASSWORD } });
        assert.ok(res.data.token);
        assert.equal(res.headers.getSetCookie().length, 0);
    });

    it('a cookie alone authenticates reads, and tampered cookies do not', async () => {
        const { jar } = await browserLogin();
        const ok = await t.api('/me', { headers: { Cookie: asCookie(jar) } });
        assert.equal(ok.status, 200);
        assert.equal(ok.data.reg_or_emp_id, SEED.student);

        const bad = await t.api('/me', { headers: { Cookie: `fm_session=${jar.fm_session.slice(0, -3)}abc` } });
        assert.equal(bad.status, 401);
        assert.equal((await t.api('/me', { headers: { Cookie: 'fm_session=' } })).status, 401);
    });

    it('state-changing requests on a cookie session need the matching CSRF token', async () => {
        const { jar } = await browserLogin(SEED.supervisor, SEED_PASSWORD, 'staff');
        const call = (headers) => t.api('/complaints/00000000-0000-4000-8000-000000000000/reject', { method: 'POST', body: { reason: 'Duplicate of a phone report' }, headers });

        const missing = await call({ Cookie: asCookie(jar) });
        assert.equal(missing.status, 403);
        assert.equal(missing.data.code, 'CSRF');
        assert.equal((await call({ Cookie: asCookie(jar), 'X-CSRF-Token': 'guess' })).data.code, 'CSRF');
        assert.equal((await call({ Cookie: asCookie(jar), 'X-CSRF-Token': jar.fm_csrf.slice(0, -1) })).data.code, 'CSRF');

        // With the right token the request is authorised and reaches the route (404: no such ticket).
        assert.equal((await call({ Cookie: asCookie(jar), 'X-CSRF-Token': jar.fm_csrf })).status, 404);
    });

    it('Bearer requests are exempt from CSRF checks, and a stray cookie cannot override them', async () => {
        const { jar } = await browserLogin();
        const token = await t.login(SEED.supervisor);
        const r = await t.api('/complaints/00000000-0000-4000-8000-000000000000/reject', {
            method: 'POST',
            token,
            body: { reason: 'Duplicate of a phone report' },
            headers: { Cookie: asCookie(jar) },
        });
        assert.equal(r.status, 404, 'authorised as the supervisor from the header, not the student cookie');
    });

    it('sign-out revokes the session on the server and clears both cookies', async () => {
        const { jar } = await browserLogin();
        assert.equal((await t.api('/auth/logout', { method: 'POST', headers: { Cookie: asCookie(jar) } })).status, 403, 'logout also needs the CSRF token');

        const out = await t.api('/auth/logout', { method: 'POST', ...browser(jar) });
        assert.equal(out.status, 204);
        const cleared = out.headers.getSetCookie().join('\n');
        assert.match(cleared, /fm_session=;/);
        assert.match(cleared, /fm_csrf=;/);

        assert.equal((await t.api('/me', { headers: { Cookie: asCookie(jar) } })).status, 401, 'a copied cookie is dead too');
    });

    it('changing the password re-issues the cookie without exposing a token, and ends other sessions', async () => {
        const first = await browserLogin(SEED.student3);
        const other = await browserLogin(SEED.student3);
        const change = await t.api('/me/password', {
            method: 'PATCH',
            body: { current_password: SEED_PASSWORD, new_password: 'Cookie#Pass2026' },
            ...browser(first.jar),
        });
        assert.equal(change.status, 200);
        assert.equal(change.data.token, undefined);
        const fresh = cookiesOf(change);
        assert.ok(fresh.jar.fm_session && fresh.jar.fm_csrf);

        assert.equal((await t.api('/me', { headers: { Cookie: asCookie(other.jar) } })).status, 401, 'other session signed out');
        assert.equal((await t.api('/me', { headers: { Cookie: asCookie(first.jar) } })).status, 401, 'the old cookie is dead');
        assert.equal((await t.api('/me', { headers: { Cookie: asCookie(fresh.jar) } })).status, 200, 'the re-issued cookie works');
    });

    it('with web origins configured, cross-site state-changing requests are refused before any route runs', async () => {
        process.env.CORS_ORIGIN = 'https://app.example.com, https://alt.example.com/';
        try {
            const body = { reg_or_emp_id: SEED.student, password: SEED_PASSWORD };
            const post = (origin) => t.api('/auth/student/login', { method: 'POST', body, headers: origin ? { Origin: origin } : {} });

            const evil = await post('https://evil.example.net');
            assert.equal(evil.status, 403);
            assert.equal(evil.data.code, 'ORIGIN');
            assert.equal((await post('https://app.example.com')).status, 200);
            assert.equal((await post('https://alt.example.com')).status, 200, 'trailing slashes in the list are tolerated');
            assert.equal((await post(null)).status, 200, 'non-browser clients send no Origin');

            // Reads are not state-changing, so the guard leaves them to the browser's CORS rules.
            assert.equal((await t.api('/meta/categories', { headers: { Origin: 'https://evil.example.net' } })).status, 200);
        } finally {
            delete process.env.CORS_ORIGIN;
        }
    });
});
