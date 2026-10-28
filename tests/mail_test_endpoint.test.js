const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { resetDatabase, startApp, SEED } = require('./helpers');
const mailer = require('../src/services/mailer');

// POST /api/admin/mail-test: an administrator can see what the outgoing mail service really does.
describe('admin mail test', () => {
    let t;
    let admin;
    before(async () => {
        await resetDatabase();
        t = await startApp();
        admin = await t.login(SEED.admin);
    });
    after(async () => t && t.close());

    const run = (token, body = {}) => t.api('/admin/mail-test', { method: 'POST', token, body });

    it('sends a test message and reports it', async () => {
        t.outbox.length = 0;
        const r = await run(admin, { to: 'someone@vitstudent.ac.in' });
        assert.equal(r.status, 200, JSON.stringify(r.data));
        assert.equal(r.data.sent, true);
        assert.equal(r.data.error, null);
        assert.equal(r.data.to, 's***@vitstudent.ac.in', 'the address is masked in the answer');
        assert.equal(t.outbox.length, 1);
        assert.equal(t.outbox[0].to, 'someone@vitstudent.ac.in');
    });

    it('defaults to the administrator\'s own address', async () => {
        t.outbox.length = 0;
        const r = await run(admin);
        assert.equal(r.status, 200);
        assert.equal(t.outbox.length, 1);
    });

    it('shows the mail service\'s own error instead of hiding it', async () => {
        mailer.setTransportForTests({
            sendMail: async () => {
                throw Object.assign(new Error('Connection timeout'), { code: 'ETIMEDOUT' });
            },
        });
        try {
            const r = await run(admin, { to: 'a@example.org' });
            assert.equal(r.status, 200);
            assert.equal(r.data.sent, false);
            assert.equal(r.data.error, 'ETIMEDOUT Connection timeout');
        } finally {
            mailer.setTransportForTests({ sendMail: async (msg) => t.outbox.push(msg) });
        }
    });

    it('is for administrators only, and refuses a malformed address', async () => {
        const student = await t.login(SEED.student);
        assert.equal((await run(student)).status, 403);
        assert.equal((await run(admin, { to: 'not-an-address' })).status, 400);
        assert.equal((await t.api('/admin/mail-test', { method: 'POST', body: {} })).status, 401);
    });
});
