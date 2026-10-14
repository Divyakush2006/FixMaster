const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { resetDatabase, startApp, SEED, SEED_PASSWORD } = require('./helpers');
const mailer = require('../src/services/mailer');

// Self-service password reset by emailed link (no token table: the link is a
// signed token bound to the current password hash).

describe('password reset by email', () => {
    let t;
    let sent;
    const post = (path, body) => t.api(path, { method: 'POST', body });
    const tokenFrom = (mail) => /#token=([\w.-]+)/.exec(mail.text)[1];
    const flush = () => new Promise((r) => setImmediate(r)); // the mail is sent after the reply
    const recorder = { sendMail: async (m) => sent.push(m) };

    before(async () => {
        await resetDatabase();
        t = await startApp();
        mailer.setTransportForTests(recorder);
    });
    beforeEach(() => {
        sent = [];
    });
    after(async () => {
        mailer.setTransportForTests(null);
        if (t) await t.close();
    });

    it('reports availability, and gives the same answer for real and unknown accounts', async () => {
        assert.equal((await t.api('/auth/capabilities')).data.password_reset, true);

        const real = await post('/auth/forgot-password', { reg_or_emp_id: SEED.student });
        const unknown = await post('/auth/forgot-password', { reg_or_emp_id: 'NOSUCH999' });
        await flush();
        assert.equal(real.status, 202);
        assert.equal(unknown.status, 202);
        assert.deepEqual(real.data, unknown.data);
        assert.equal(sent.length, 1, 'only the real account is emailed');
        assert.match(sent[0].to, /@/);
        assert.match(sent[0].text, /\/reset-password#token=/);
        assert.ok(!sent[0].text.includes('?token='), 'the token stays in the URL fragment, out of server logs');
    });

    it('the link sets a new password once, ends old sessions and unlocks the account', async () => {
        const old = await t.login(SEED.student2, SEED_PASSWORD, { fresh: true });
        await t.sql("UPDATE users SET failed_login_count = 10, locked_until = NOW() + INTERVAL '10 minutes' WHERE reg_or_emp_id = $1", [SEED.student2]);

        await post('/auth/forgot-password', { reg_or_emp_id: SEED.student2.toLowerCase() });
        await flush();
        const token = tokenFrom(sent[0]);

        assert.equal((await post('/auth/reset-password', { token, new_password: 'short' })).status, 400, 'weak passwords are refused');
        const ok = await post('/auth/reset-password', { token, new_password: 'Fresh#Pass2026' });
        assert.equal(ok.status, 200);

        assert.equal((await t.api('/me', { token: old })).status, 401, 'older sessions are signed out');
        const login = await post('/auth/student/login', { reg_or_emp_id: SEED.student2, password: 'Fresh#Pass2026' });
        assert.equal(login.status, 200, 'the new password works and the lockout is gone');
        assert.equal((await post('/auth/student/login', { reg_or_emp_id: SEED.student2, password: SEED_PASSWORD })).status, 401);

        const again = await post('/auth/reset-password', { token, new_password: 'Another#Pass2026' });
        assert.equal(again.status, 400, 'a link cannot be reused');

        const audit = await t.sql("SELECT action FROM audit_log WHERE action LIKE 'auth.password_reset%' ORDER BY audit_id");
        assert.deepEqual(audit.rows.map((r) => r.action).slice(-2), ['auth.password_reset_requested', 'auth.password_reset_completed']);
    });

    it('rejects forged, tampered and wrong-purpose tokens', async () => {
        const jwt = require('jsonwebtoken');
        await post('/auth/forgot-password', { reg_or_emp_id: SEED.student3 });
        await flush();
        const token = tokenFrom(sent[0]);
        const good = { new_password: 'Fresh#Pass2026' };

        assert.equal((await post('/auth/reset-password', { ...good, token: token.slice(0, -2) + 'xx' })).status, 400, 'tampered');
        assert.equal((await post('/auth/reset-password', { ...good, token: 'not-a-token-at-all-really' })).status, 400, 'garbage');

        // A session token is not a reset token...
        const session = await t.login(SEED.student3);
        assert.equal((await post('/auth/reset-password', { ...good, token: session })).status, 400);
        // ...and a reset token is not a session.
        assert.equal((await t.api('/me', { token })).status, 401);

        // Signed with the session key instead of the derived one.
        const id = (await t.sql('SELECT user_id FROM users WHERE reg_or_emp_id = $1', [SEED.student3])).rows[0].user_id;
        const forged = jwt.sign({ sub: id, fp: 'x' }, process.env.JWT_SECRET, { audience: 'fixmaster:password-reset' });
        assert.equal((await post('/auth/reset-password', { ...good, token: forged })).status, 400);

        const claims = jwt.decode(token);
        assert.ok(claims.exp - claims.iat <= 30 * 60, 'links live 30 minutes at most');
    });

    it('a later password change by anyone invalidates links already sent', async () => {
        await post('/auth/forgot-password', { reg_or_emp_id: SEED.student4 });
        await flush();
        const token = tokenFrom(sent[0]);
        const admin = await t.login(SEED.admin);
        const id = (await t.sql('SELECT user_id FROM users WHERE reg_or_emp_id = $1', [SEED.student4])).rows[0].user_id;
        const r = await t.api(`/admin/users/${id}/reset-password`, { method: 'POST', token: admin, body: { new_password: 'AdminSet#2026x' } });
        assert.equal(r.status, 200);
        assert.equal((await post('/auth/reset-password', { token, new_password: 'Fresh#Pass2026' })).status, 400);
    });

    it('administrator and deactivated accounts get no link, and requests are rate limited per account', async () => {
        await post('/auth/forgot-password', { reg_or_emp_id: SEED.admin });
        await t.sql('UPDATE users SET is_active = FALSE WHERE reg_or_emp_id = $1', [SEED.roommate2]);
        await post('/auth/forgot-password', { reg_or_emp_id: SEED.roommate2 });
        await flush();
        assert.equal(sent.length, 0);

        const statuses = [];
        for (let i = 0; i < 5; i++) statuses.push((await post('/auth/forgot-password', { reg_or_emp_id: SEED.cleaner2 })).status);
        assert.deepEqual(statuses, [202, 202, 202, 429, 429]);
    });

    it('validates input and reports itself unavailable when mail is not configured', async () => {
        assert.equal((await post('/auth/forgot-password', {})).status, 400);
        assert.equal((await post('/auth/reset-password', { token: 'x' })).status, 400);

        mailer.setTransportForTests(null); // NODE_ENV=test with no SMTP_URL: nothing could be sent
        try {
            assert.equal((await t.api('/auth/capabilities')).data.password_reset, false);
            assert.equal((await post('/auth/forgot-password', { reg_or_emp_id: SEED.student })).status, 503);
        } finally {
            mailer.setTransportForTests(recorder);
        }
    });
});
