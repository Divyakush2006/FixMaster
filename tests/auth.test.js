const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { resetDatabase, startApp, SEED } = require('./helpers');

describe('authentication & account security', () => {
    let t;
    before(async () => {
        await resetDatabase();
        t = await startApp();
    });
    after(async () => t && t.close());

    const newStudent = (n, extra = {}) => ({
        reg_or_emp_id: `TSTU${n}`,
        full_name: `Test Student ${n}`,
        email: `test.student${n}@example.com`,
        phone_number: '9000000000',
        password: 'Test@12345',
        ...extra,
    });

    it('seed accounts log in with the documented demo password', async () => {
        for (const id of Object.values(SEED).filter((v) => typeof v === 'string')) {
            const r = await t.api('/auth/login', { method: 'POST', body: { reg_or_emp_id: id, password: 'Password@123' } });
            assert.equal(r.status, 200, `${id} should log in`);
        }
    });

    it('public registration always creates a STUDENT, whatever role is requested', async () => {
        const r = await t.api('/auth/register', {
            method: 'POST',
            body: newStudent(1, { role: 'ADMIN', specialization: 'PLUMBER' }),
        });
        assert.equal(r.status, 201);
        assert.equal(r.data.user.role, 'STUDENT');
        assert.equal(r.data.user.specialization, null);
        assert.equal(r.data.user.password_hash, undefined, 'password hash must never be returned');
    });

    it('login IDs are case-insensitive and stored upper-case', async () => {
        await t.api('/auth/register', { method: 'POST', body: newStudent(2, { reg_or_emp_id: 'tstu2' }) });
        const r = await t.api('/auth/login', { method: 'POST', body: { reg_or_emp_id: 'TsTu2', password: 'Test@12345' } });
        assert.equal(r.status, 200);
        assert.equal(r.data.user.reg_or_emp_id, 'TSTU2');
    });

    it('rejects duplicate IDs and emails regardless of case', async () => {
        const id = await t.api('/auth/register', { method: 'POST', body: newStudent(3, { reg_or_emp_id: '21bce0843' }) });
        assert.equal(id.status, 409);
        const mail = await t.api('/auth/register', {
            method: 'POST',
            body: newStudent(4, { email: 'VIHAAN.SHARMA2021@VITSTUDENT.AC.IN' }),
        });
        assert.equal(mail.status, 409);
    });

    it('stores the email exactly as typed (lower-cased), without rewriting it', async () => {
        const r = await t.api('/auth/register', { method: 'POST', body: newStudent(5, { email: 'First.Last+hostel@Gmail.com' }) });
        assert.equal(r.status, 201);
        assert.equal(r.data.user.email, 'first.last+hostel@gmail.com');
    });

    it('rejects passwords longer than 72 bytes instead of silently truncating them', async () => {
        const r = await t.api('/auth/register', { method: 'POST', body: newStudent(6, { password: 'A'.repeat(73) }) });
        assert.equal(r.status, 400);
        assert.match(r.data.error, /72 bytes/);
    });

    it('gives the same answer for an unknown ID and a wrong password', async () => {
        const unknown = await t.api('/auth/login', { method: 'POST', body: { reg_or_emp_id: 'NOBODY_HERE', password: 'whatever1' } });
        const wrong = await t.api('/auth/login', { method: 'POST', body: { reg_or_emp_id: SEED.student, password: 'wrong-pass' } });
        assert.equal(unknown.status, 401);
        assert.equal(wrong.status, 401);
        assert.deepEqual(unknown.data, wrong.data);
    });

    it('returns 400 (not 500) for a malformed JSON body', async () => {
        const r = await t.api('/auth/login', { method: 'POST', raw: '{"reg_or_emp_id": "x", broken' });
        assert.equal(r.status, 400);
        assert.equal(r.data.error, 'Request body is not valid JSON.');
    });

    it('returns JSON 404 for unknown routes', async () => {
        const r = await t.api('/no/such/route');
        assert.equal(r.status, 404);
        assert.ok(r.data.error);
    });

    it('distinguishes 401 (re-authenticate) from 403 (not allowed)', async () => {
        assert.equal((await t.api('/complaints')).status, 401);
        assert.equal((await t.api('/complaints', { token: 'garbage' })).status, 401);
        const student = await t.login(SEED.student);
        assert.equal((await t.api('/dispatch/queue', { token: student })).status, 403);
        assert.equal((await t.api('/admin/users', { token: student })).status, 403);
    });

    it('rejects tokens signed with alg "none" or a different secret', async () => {
        const me = jwt.decode(await t.login(SEED.admin));
        const unsigned = jwt.sign({ userId: me.userId, role: 'ADMIN' }, null, { algorithm: 'none' });
        assert.equal((await t.api('/me', { token: unsigned })).status, 401);
        const forged = jwt.sign({ userId: me.userId, role: 'ADMIN' }, 'some-other-secret');
        assert.equal((await t.api('/me', { token: forged })).status, 401);
    });

    it('uses the current role from the database, not the role inside the token', async () => {
        const token = await t.login(SEED.student);
        const payload = jwt.decode(token);
        // A token claiming ADMIN for a student's id, signed with the real secret.
        const claimsAdmin = jwt.sign({ ...payload, role: 'ADMIN' }, process.env.JWT_SECRET);
        assert.equal((await t.api('/admin/users', { token: claimsAdmin })).status, 403);
    });

    it('password change revokes every other session and returns a working new token', async () => {
        await t.api('/auth/register', { method: 'POST', body: newStudent(7) });
        const oldToken = await t.login('TSTU7', 'Test@12345');
        // tokens carry one-second resolution; make sure the change lands in a later second
        await new Promise((r) => setTimeout(r, 1100));

        const wrongCurrent = await t.api('/me/password', {
            method: 'PATCH',
            token: oldToken,
            body: { current_password: 'not-it-123', new_password: 'Changed@123' },
        });
        assert.equal(wrongCurrent.status, 400);

        const r = await t.api('/me/password', {
            method: 'PATCH',
            token: oldToken,
            body: { current_password: 'Test@12345', new_password: 'Changed@123' },
        });
        assert.equal(r.status, 200);
        assert.equal((await t.api('/me', { token: oldToken })).status, 401, 'old token must be revoked');
        assert.equal((await t.api('/me', { token: r.data.token })).status, 200, 'returned token must work');
        assert.equal((await t.api('/auth/login', { method: 'POST', body: { reg_or_emp_id: 'TSTU7', password: 'Changed@123' } })).status, 200);
    });

    it('a deactivated account cannot log in and its existing tokens stop working', async () => {
        const admin = await t.login(SEED.admin);
        await t.api('/auth/register', { method: 'POST', body: newStudent(8) });
        const token = await t.login('TSTU8', 'Test@12345');
        const { rows } = await t.sql("SELECT user_id FROM users WHERE reg_or_emp_id = 'TSTU8'");

        const r = await t.api(`/admin/users/${rows[0].user_id}`, { method: 'PATCH', token: admin, body: { is_active: false } });
        assert.equal(r.status, 200);
        assert.equal((await t.api('/me', { token })).status, 401);
        const relogin = await t.api('/auth/login', { method: 'POST', body: { reg_or_emp_id: 'TSTU8', password: 'Test@12345' } });
        assert.equal(relogin.status, 403);
    });

    it('sets security headers and a request id', async () => {
        const r = await t.api('/health');
        assert.equal(r.status, 200);
        assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
        assert.ok(r.headers.get('x-request-id'));
        assert.equal(r.headers.get('x-powered-by'), null);
    });
});
