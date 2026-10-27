const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const http = require('http');
const { resetDatabase, startApp, SEED_PASSWORD } = require('./helpers');

// University single sign-on, tested against a stand-in identity provider that
// speaks OpenID Connect the way Google and Microsoft do: discovery, an
// authorization endpoint, a token endpoint that checks the PKCE verifier and
// the client secret, and a key set. It signs real RS256 ID tokens, so the API's
// verification is exercised for real - including the ways it must refuse.

const b64u = (v) => Buffer.from(v).toString('base64url');

async function startIdp() {
    const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const rotated = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const idp = { codes: new Map(), keys: [], requests: [], tokenCalls: 0, clientId: 'fixmaster-test', clientSecret: 'shh-its-a-secret', other, rotated };
    const publicJwk = (key, kid) => ({ ...key.publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' });
    idp.signingKey = pair;
    idp.kid = 'k1';
    idp.keys = [publicJwk(pair, 'k1')];
    idp.publicJwk = publicJwk;

    const sign = (claims, { key = idp.signingKey, kid = idp.kid, alg = 'RS256' } = {}) => {
        const head = b64u(JSON.stringify({ alg, typ: 'JWT', kid }));
        const body = b64u(JSON.stringify(claims));
        if (alg === 'none') return `${head}.${body}.`;
        if (alg === 'HS256') return `${head}.${body}.${crypto.createHmac('sha256', JSON.stringify(idp.keys[0])).update(`${head}.${body}`).digest('base64url')}`;
        return `${head}.${body}.${crypto.sign('sha256', Buffer.from(`${head}.${body}`), key.privateKey).toString('base64url')}`;
    };

    // What the next ID token says and how it is signed; reset before each test.
    idp.reset = () => {
        idp.email = 'someone@vitstudent.ac.in';
        idp.tweak = (c) => c;
        idp.signing = {};
        idp.kid = 'k1';
        idp.signingKey = pair;
        idp.keys = [publicJwk(pair, 'k1')];
        idp.codes.clear();
        idp.requests = [];
        idp.tokenCalls = 0;
    };
    idp.reset();

    const server = http.createServer(async (req, res) => {
        const url = new URL(req.url, idp.url);
        const json = (status, body) => res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
        if (url.pathname === '/.well-known/openid-configuration') {
            return json(200, { issuer: idp.url, authorization_endpoint: `${idp.url}/authorize`, token_endpoint: `${idp.url}/token`, jwks_uri: `${idp.url}/jwks` });
        }
        if (url.pathname === '/jwks') return json(200, { keys: idp.keys });
        if (url.pathname === '/authorize') {
            const q = Object.fromEntries(url.searchParams);
            idp.requests.push(q);
            const code = b64u(crypto.randomBytes(16));
            idp.codes.set(code, { nonce: q.nonce, challenge: q.code_challenge, redirectUri: q.redirect_uri, used: false });
            const back = new URL(q.redirect_uri);
            back.searchParams.set('code', code);
            back.searchParams.set('state', q.state);
            return res.writeHead(302, { Location: back.toString() }).end();
        }
        if (url.pathname === '/token' && req.method === 'POST') {
            idp.tokenCalls += 1;
            let raw = '';
            for await (const chunk of req) raw += chunk;
            const f = Object.fromEntries(new URLSearchParams(raw));
            const entry = idp.codes.get(f.code);
            const challenge = f.code_verifier ? crypto.createHash('sha256').update(f.code_verifier).digest('base64url') : null;
            if (!entry || entry.used || f.client_id !== idp.clientId || f.client_secret !== idp.clientSecret || f.redirect_uri !== entry.redirectUri || challenge !== entry.challenge) {
                return json(400, { error: 'invalid_grant' });
            }
            entry.used = true;
            const now = Math.floor(Date.now() / 1000);
            const claims = idp.tweak({ iss: idp.url, aud: idp.clientId, sub: 'u-1', email: idp.email, email_verified: true, nonce: entry.nonce, iat: now, exp: now + 300 });
            return json(200, { access_token: 'unused', token_type: 'Bearer', id_token: idp.rawToken ? idp.rawToken(claims) : sign(claims, idp.signing) });
        }
        return json(404, {});
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    idp.url = `http://127.0.0.1:${server.address().port}`;
    idp.close = () => new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
    });
    return idp;
}

describe('university single sign-on', () => {
    let t;
    let idp;
    const oidc = () => require('../src/services/oidc');
    const nav = (url, headers = {}) => fetch(url, { redirect: 'manual', headers });
    const cookiesOf = (res) => res.headers.getSetCookie().map((c) => c.split(';')[0]);
    const setCookieNames = (res) => cookiesOf(res).map((c) => c.split('=')[0]);

    /** The whole browser trip: the app, the provider, back to the app. Returns the callback's response. */
    async function signIn({ tamper } = {}) {
        const start = await nav(`${t.base}/auth/sso/start`);
        assert.equal(start.status, 302);
        const memo = cookiesOf(start).find((c) => c.startsWith('fm_sso='));
        const toProvider = await nav(start.headers.get('location'));
        let back = toProvider.headers.get('location');
        if (tamper) back = tamper(back);
        return nav(back, memo ? { cookie: memo } : {});
    }
    const landedOn = (res) => res.headers.get('location');
    const refusedWith = (res, reason) => {
        assert.equal(res.status, 302);
        assert.equal(landedOn(res), `http://app.test/login?sso=${reason}`);
        assert.ok(!setCookieNames(res).includes('fm_session'), 'no session may be opened');
    };

    before(async () => {
        await resetDatabase();
        t = await startApp();
        idp = await startIdp();
        Object.assign(process.env, {
            OIDC_ISSUER: idp.url,
            OIDC_CLIENT_ID: idp.clientId,
            OIDC_CLIENT_SECRET: idp.clientSecret,
            OIDC_REDIRECT_URI: `${t.base}/auth/sso/callback`,
            APP_URL: 'http://app.test',
        });
        oidc()._reset();
    });
    after(async () => {
        for (const k of ['OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'OIDC_REDIRECT_URI', 'APP_URL']) delete process.env[k];
        await idp.close();
        await t.close();
    });
    beforeEach(() => {
        idp.reset();
        oidc()._reset();
    });

    const student = (n, extra = {}) => ({
        reg_or_emp_id: `24SSO${String(n).padStart(4, '0')}`,
        full_name: `Sso Student ${n}`,
        email: `sso.student${n}@vitstudent.ac.in`,
        phone_number: '9876543210',
        password: SEED_PASSWORD,
        ...extra,
    });

    it('is advertised only when configured, and refuses to start when it is not', async () => {
        assert.deepEqual((await t.api('/auth/capabilities')).data.sso, { label: 'your university account' });
        const keep = process.env.OIDC_CLIENT_SECRET;
        delete process.env.OIDC_CLIENT_SECRET;
        try {
            assert.equal((await t.api('/auth/capabilities')).data.sso, null);
            assert.equal((await nav(`${t.base}/auth/sso/start`)).status, 404);
        } finally {
            process.env.OIDC_CLIENT_SECRET = keep;
        }
    });

    it('sends the browser to the provider with state, nonce and a PKCE challenge, and never the secret', async () => {
        const start = await nav(`${t.base}/auth/sso/start`);
        assert.equal(start.status, 302);
        const to = new URL(start.headers.get('location'));
        assert.equal(`${to.origin}${to.pathname}`, `${idp.url}/authorize`);
        const q = Object.fromEntries(to.searchParams);
        assert.equal(q.response_type, 'code');
        assert.equal(q.client_id, idp.clientId);
        assert.equal(q.code_challenge_method, 'S256');
        assert.ok(q.state.length >= 24 && q.nonce.length >= 24 && q.code_challenge.length >= 40);
        assert.ok(!start.headers.get('location').includes(idp.clientSecret));
        const cookie = start.headers.getSetCookie().find((c) => c.startsWith('fm_sso='));
        assert.match(cookie, /HttpOnly/i);
        assert.match(cookie, /SameSite=Lax/i);
        assert.match(cookie, /Path=\/api\/auth\/sso/);
        assert.ok(!cookie.includes(q.code_challenge), 'the verifier is kept, not the challenge');
    });

    it('signs an existing student in and starts a cookie session the web app can read', async () => {
        const body = student(1);
        await t.registerStudent(body);
        idp.email = body.email.toUpperCase(); // mail addresses are matched without regard to case
        const res = await signIn();
        assert.equal(res.status, 302);
        assert.equal(landedOn(res), 'http://app.test/auth/sso/done');
        const cookies = cookiesOf(res);
        const session = cookies.find((c) => c.startsWith('fm_session='));
        assert.ok(session && cookies.some((c) => c.startsWith('fm_csrf=')));
        assert.ok(res.headers.getSetCookie().find((c) => c.startsWith('fm_sso=')).match(/Max-Age=0|Expires=Thu, 01 Jan 1970/i), 'the sign-in memo is cleared');

        const me = await fetch(`${t.base}/auth/session`, { headers: { cookie: session } });
        assert.equal(me.status, 200);
        const data = await me.json();
        assert.equal(data.user.reg_or_emp_id, body.reg_or_emp_id);
        assert.equal(data.user.account_status, 'ACTIVE');
        assert.ok(Date.parse(data.expires_at) > Date.now());
        const audit = await t.sql(`SELECT 1 FROM audit_log WHERE action = 'auth.sso_sign_in' AND target_id = (SELECT user_id FROM users WHERE reg_or_emp_id = $1)`, [body.reg_or_emp_id]);
        assert.equal(audit.rows.length, 1);
        // The session is a real one: ordinary routes accept it.
        assert.equal((await fetch(`${t.base}/me`, { headers: { cookie: session } })).status, 200);
    });

    it('the university vouching for the mailbox stands in for the emailed code', async () => {
        const body = student(2);
        await t.registerStudent(body, { verify: false });
        assert.equal((await t.sql('SELECT account_status FROM users WHERE reg_or_emp_id = $1', [body.reg_or_emp_id])).rows[0].account_status, 'PENDING_VERIFICATION');
        idp.email = body.email;
        const res = await signIn();
        assert.equal(landedOn(res), 'http://app.test/auth/sso/done');
        const row = (await t.sql('SELECT account_status, email_verified_at FROM users WHERE reg_or_emp_id = $1', [body.reg_or_emp_id])).rows[0];
        assert.equal(row.account_status, 'PENDING_PROFILE', 'confirmed, and still has a profile to complete');
        assert.ok(row.email_verified_at);
        const session = cookiesOf(res).find((c) => c.startsWith('fm_session='));
        assert.equal((await fetch(`${t.base}/auth/session`, { headers: { cookie: session } })).status, 200);
        assert.equal((await fetch(`${t.base}/complaints`, { headers: { cookie: session } })).status, 403, 'still limited to onboarding');
    });

    it('retires the password of an account signed up before its mailbox was proven, so a pre-registration cannot be hijacked', async () => {
        // An attacker types a victim's university address into the sign-up form with a password of their own.
        const body = student(8, { password: 'Attacker-Chosen-1' });
        await t.registerStudent(body, { verify: false });
        const early = await t.api('/auth/student/login', { method: 'POST', body: { reg_or_emp_id: body.reg_or_emp_id, password: 'Attacker-Chosen-1' } });
        assert.equal(early.status, 403, 'unconfirmed accounts cannot sign in');

        // The real owner signs in with the university, which confirms the mailbox.
        idp.email = body.email;
        const res = await signIn();
        assert.equal(landedOn(res), 'http://app.test/auth/sso/done');
        const session = cookiesOf(res).find((c) => c.startsWith('fm_session='));
        assert.equal((await fetch(`${t.base}/auth/session`, { headers: { cookie: session } })).status, 200, 'the owner is in');

        // The attacker's password no longer works anywhere.
        const after = await t.api('/auth/student/login', { method: 'POST', body: { reg_or_emp_id: body.reg_or_emp_id, password: 'Attacker-Chosen-1' } });
        assert.equal(after.status, 401);
        const audit = await t.sql(`SELECT details FROM audit_log WHERE action = 'auth.sso_sign_in' AND target_id = (SELECT user_id FROM users WHERE reg_or_emp_id = $1)`, [body.reg_or_emp_id]);
        assert.equal(audit.rows[0].details.password_retired, true);

        // The owner can still set their own through the normal email link.
        const forgot = await t.api('/auth/forgot-password', { method: 'POST', body: { reg_or_emp_id: body.reg_or_emp_id } });
        assert.equal(forgot.status, 202);
    });

    it('leaves the password of an already confirmed account alone', async () => {
        const body = student(9);
        await t.registerStudent(body);
        idp.email = body.email;
        assert.equal(landedOn(await signIn()), 'http://app.test/auth/sso/done');
        const still = await t.api('/auth/student/login', { method: 'POST', body: { reg_or_emp_id: body.reg_or_emp_id, password: SEED_PASSWORD } });
        assert.equal(still.status, 200);
    });

    it('never creates an account and says nothing about which ones exist', async () => {
        idp.email = 'nobody.here@vitstudent.ac.in';
        refusedWith(await signIn(), 'no_account');
        await t.sql(`UPDATE users SET email = 'sso.staff@vitstudent.ac.in' WHERE reg_or_emp_id = 'EMP_ELEC_01'`);
        idp.email = 'sso.staff@vitstudent.ac.in';
        refusedWith(await signIn(), 'no_account'); // staff sign in with their ID and password
        assert.equal((await t.sql(`SELECT 1 FROM users WHERE LOWER(email) = 'nobody.here@vitstudent.ac.in'`)).rows.length, 0);
    });

    it('refuses a deactivated account', async () => {
        const body = student(3);
        await t.registerStudent(body);
        await t.sql('UPDATE users SET is_active = FALSE WHERE reg_or_emp_id = $1', [body.reg_or_emp_id]);
        idp.email = body.email;
        refusedWith(await signIn(), 'disabled');
    });

    it('accepts only university addresses the provider calls verified', async () => {
        for (const email of ['person@gmail.com', 'person@evil-vitstudent.ac.in', 'person@vitstudent.ac.in.example.com']) {
            idp.email = email;
            refusedWith(await signIn(), 'domain');
        }
        const body = student(4);
        await t.registerStudent(body);
        idp.email = body.email;
        idp.tweak = (c) => ({ ...c, email_verified: false });
        refusedWith(await signIn(), 'domain');
    });

    it('trusts nothing in an ID token that does not check out', async () => {
        const body = student(5);
        await t.registerStudent(body);
        idp.email = body.email;
        const now = () => Math.floor(Date.now() / 1000);
        const bad = {
            'a different sign-in (nonce)': { tweak: (c) => ({ ...c, nonce: 'someone-elses' }) },
            'no nonce at all': { tweak: ({ nonce, ...c }) => c },
            'another application (audience)': { tweak: (c) => ({ ...c, aud: 'another-app' }) },
            'another issuer': { tweak: (c) => ({ ...c, iss: 'https://evil.example.com' }) },
            'an expired token': { tweak: (c) => ({ ...c, exp: now() - 3600 }) },
            'a token from the future': { tweak: (c) => ({ ...c, iat: now() + 3600, exp: now() + 7200 }) },
            'a signature from another key': { signing: { key: idp.other } },
            'a key id the provider never published': { signing: { kid: 'unknown' } },
            'algorithm "none"': { signing: { alg: 'none' } },
            'HS256 keyed with the public key (algorithm confusion)': { signing: { alg: 'HS256' } },
        };
        for (const [what, spec] of Object.entries(bad)) {
            idp.reset();
            oidc()._reset();
            idp.email = body.email;
            if (spec.tweak) idp.tweak = spec.tweak;
            if (spec.signing) idp.signing = spec.signing;
            refusedWith(await signIn(), 'failed');
            assert.ok(idp.tokenCalls > 0, `${what}: the token was actually requested`);
        }
        idp.reset();
        oidc()._reset();
        idp.email = body.email;
        assert.equal(landedOn(await signIn()), 'http://app.test/auth/sso/done', 'and the same student gets in when nothing is wrong');
    });

    it('rejects a callback that does not belong to this browser', async () => {
        const body = student(6);
        await t.registerStudent(body);
        idp.email = body.email;
        refusedWith(await signIn({ tamper: (u) => u.replace(/state=[^&]+/, 'state=forged') }), 'failed');
        refusedWith(await nav(`${t.base}/auth/sso/callback?code=abc&state=abc`), 'expired'); // no sign-in in progress
        refusedWith(await nav(`${t.base}/auth/sso/callback?code=abc&state=abc`, { cookie: 'fm_sso=not.a.token' }), 'expired');

        // A code can be used once: replaying a callback fails at the provider.
        const start = await nav(`${t.base}/auth/sso/start`);
        const memo = cookiesOf(start).find((c) => c.startsWith('fm_sso='));
        const callback = (await nav(start.headers.get('location'))).headers.get('location');
        assert.equal(landedOn(await nav(callback, { cookie: memo })), 'http://app.test/auth/sso/done');
        refusedWith(await nav(callback, { cookie: memo }), 'failed');
    });

    it('handles a student who cancels at the provider', async () => {
        const start = await nav(`${t.base}/auth/sso/start`);
        const memo = cookiesOf(start).find((c) => c.startsWith('fm_sso='));
        refusedWith(await nav(`${t.base}/auth/sso/callback?error=access_denied&state=x`, { cookie: memo }), 'denied');
    });

    it('follows the provider rotating its signing keys', async () => {
        const body = student(7);
        await t.registerStudent(body);
        idp.email = body.email;
        assert.equal(landedOn(await signIn()), 'http://app.test/auth/sso/done'); // keys are now cached
        idp.keys = [idp.publicJwk(idp.rotated, 'k2')];
        idp.kid = 'k2';
        idp.signingKey = idp.rotated;
        assert.equal(landedOn(await signIn()), 'http://app.test/auth/sso/done');
    });

    it('sends the student back to sign in when the provider is unreachable or misconfigured', async () => {
        const keep = process.env.OIDC_ISSUER;
        process.env.OIDC_ISSUER = 'http://127.0.0.1:1'; // nothing listens here
        oidc()._reset();
        try {
            const res = await nav(`${t.base}/auth/sso/start`);
            assert.equal(landedOn(res), 'http://app.test/login?sso=unavailable');
            assert.ok(!res.headers.getSetCookie().some((c) => c.startsWith('fm_sso=')));
        } finally {
            process.env.OIDC_ISSUER = keep;
            oidc()._reset();
        }
    });

    it('insists on https for a provider that is not on this machine', async () => {
        const keep = process.env.OIDC_ISSUER;
        process.env.OIDC_ISSUER = 'http://idp.example.com';
        oidc()._reset();
        try {
            assert.equal(landedOn(await nav(`${t.base}/auth/sso/start`)), 'http://app.test/login?sso=unavailable');
        } finally {
            process.env.OIDC_ISSUER = keep;
            oidc()._reset();
        }
    });

    it('the session endpoint needs a session', async () => {
        assert.equal((await t.api('/auth/session')).status, 401);
    });
});
