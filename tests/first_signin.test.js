const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { resetDatabase, startApp, SEED } = require('./helpers');

// An account whose password somebody else chose (migration 019) may only change
// that password until it has. Existing flows are unchanged: the flag is off unless asked for.

describe('first sign-in: a password somebody else chose must be replaced', () => {
    let t;
    let admin;
    const PW = 'Granite4Owl';
    const create = (body) => t.api('/admin/users', { method: 'POST', token: admin, body: { phone_number: '9000000411', password: PW, ...body } });

    before(async () => {
        await resetDatabase();
        t = await startApp();
        admin = await t.login(SEED.admin);
    });
    after(async () => t && t.close());

    it('lets an account with the flag do nothing but change its password and sign out', async () => {
        const made = await create({ reg_or_emp_id: 'SUP_FIRST_01', full_name: 'First Sign In', email: 'first@vit.ac.in', role: 'SUPERVISOR', must_change_password: true });
        assert.equal(made.status, 201);
        assert.equal(made.data.user.must_change_password, true);

        const login = await t.api('/auth/staff/login', { method: 'POST', body: { reg_or_emp_id: 'SUP_FIRST_01', password: PW } });
        assert.equal(login.status, 200);
        assert.equal(login.data.user.must_change_password, true, 'the sign-in answer says so, so the page can ask');
        const token = login.data.token;

        const me = await t.api('/me', { token });
        assert.equal(me.status, 200);
        assert.equal(me.data.must_change_password, true);
        for (const path of ['/complaints', '/meta/staff', '/analytics/kpi', '/infrastructure/blocks', '/autopilot/status']) {
            const r = await t.api(path, { token });
            assert.equal(r.status, 403, path);
            assert.equal(r.data.code, 'PASSWORD_CHANGE_REQUIRED', path);
        }

        const wrong = await t.api('/me/password', { method: 'PATCH', token, body: { current_password: 'Nope12345', new_password: 'Orchard9Maple' } });
        assert.equal(wrong.status, 400);

        const changed = await t.api('/me/password', { method: 'PATCH', token, body: { current_password: PW, new_password: 'Orchard9Maple' } });
        assert.equal(changed.status, 200);
        const fresh = changed.data.token;
        assert.equal((await t.api('/me', { token: fresh })).data.must_change_password, false);
        assert.equal((await t.api('/complaints', { token: fresh })).status, 200, 'everything works once the password is their own');
        assert.equal((await t.api('/auth/staff/login', { method: 'POST', body: { reg_or_emp_id: 'SUP_FIRST_01', password: 'Orchard9Maple' } })).data.user.must_change_password, false);
    });

    it('is off unless asked for, so existing accounts and tests are unaffected', async () => {
        const made = await create({ reg_or_emp_id: 'SUP_FIRST_02', full_name: 'Plain Account', email: 'plain@vit.ac.in', role: 'SUPERVISOR' });
        assert.equal(made.data.user.must_change_password, false);
        const token = await t.login('SUP_FIRST_02', PW);
        assert.equal((await t.api('/complaints', { token })).status, 200);
    });

    it('can be required again when an administrator resets a password', async () => {
        const token = await t.login('SUP_FIRST_02', PW);
        const id = (await t.api('/me', { token })).data.user_id;
        assert.equal((await t.api(`/admin/users/${id}/reset-password`, { method: 'POST', token: admin, body: { new_password: 'Cobalt7Fern', must_change_password: true } })).status, 200);
        const again = await t.login('SUP_FIRST_02', 'Cobalt7Fern', { fresh: true });
        assert.equal((await t.api('/complaints', { token: again })).status, 403);
        assert.equal((await t.api(`/admin/users/${id}/reset-password`, { method: 'POST', token: admin, body: { new_password: 'Cobalt7Fern', must_change_password: 'yes' } })).status, 400);
    });

    it('can still sign out while the change is pending', async () => {
        const made = await create({ reg_or_emp_id: 'SUP_FIRST_03', full_name: 'Signs Out', email: 'out@vit.ac.in', role: 'SUPERVISOR', must_change_password: true });
        assert.equal(made.status, 201);
        const token = await t.login('SUP_FIRST_03', PW);
        assert.equal((await t.api('/auth/logout', { method: 'POST', token })).status, 204);
    });
});
