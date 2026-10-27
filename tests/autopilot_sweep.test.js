const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { resetDatabase, startApp, SEED } = require('./helpers');

// Automatic means nobody has to look: tickets that could not be assigned when
// they were raised are tried again, and a supervisor can see what is waiting.
describe('autopilot: waiting tickets are retried', () => {
    const sweeper = require('../src/services/autopilot/sweeper');
    let t;
    let sup;
    let rahul;
    const setting = (body) => t.api('/autopilot/settings', { method: 'PUT', token: sup, body });
    const raise = (sub) => t.api('/complaints', { method: 'POST', token: rahul, body: { ticket_scope: 'ROOM', block_id: 'L_BLOCK', room_id: 'L-810', subcategory_id: sub } });

    before(async () => {
        await resetDatabase();
        t = await startApp();
        sup = await t.login(SEED.supervisor);
        rahul = await t.login(SEED.student2);
    });
    beforeEach(async () => {
        await t.sql("UPDATE users SET home_block_id = NULL, shift = NULL, is_available = TRUE WHERE role = 'STAFF'");
        await t.sql('DELETE FROM autopilot_settings');
    });
    after(async () => t && t.close());

    it('assigns a ticket that had nobody eligible once someone is, and reports why it waited', async () => {
        await t.sql("UPDATE users SET is_available = FALSE WHERE role = 'STAFF'");
        await setting({ block_id: 'L_BLOCK', specialization: 'CLEANING', mode: 'AUTO' });
        const raised = await raise(SEED.sub.dusting);
        assert.equal(raised.status, 201);
        assert.equal(raised.data.complaint.status, 'OPEN', 'nobody was on duty');
        assert.equal(raised.data.autopilot.assigned, false);
        const id = raised.data.complaint.complaint_id;

        const waiting = (await t.api('/autopilot/status', { token: sup })).data;
        const mine = waiting.waiting.find((w) => w.complaint_id === id);
        assert.ok(mine, 'the ticket is listed as waiting');
        assert.equal(mine.eligible, 0);
        assert.ok(mine.reasons.OFF_DUTY > 0, 'and the reason is that nobody is on duty');
        assert.ok(waiting.waiting_total >= 1);

        const still = await t.api('/autopilot/sweep', { method: 'POST', token: sup });
        assert.equal(still.status, 200);
        assert.equal(still.data.assigned, 0);
        assert.equal((await t.sql('SELECT status FROM complaints WHERE complaint_id = $1', [id])).rows[0].status, 'OPEN');

        await t.sql("UPDATE users SET is_available = TRUE WHERE role = 'STAFF'");
        const done = await t.api('/autopilot/sweep', { method: 'POST', token: sup });
        assert.ok(done.data.assigned >= 1, JSON.stringify(done.data));
        const row = (await t.sql('SELECT c.status, a.dispatch_source FROM complaints c JOIN complaint_assignments a USING (complaint_id) WHERE c.complaint_id = $1', [id])).rows[0];
        assert.deepEqual(row, { status: 'ASSIGNED', dispatch_source: 'AUTOPILOT' });
        const after = (await t.api('/autopilot/status', { token: sup })).data;
        assert.ok(after.assigned_last_24h >= 1);
        assert.ok(!after.waiting.some((w) => w.complaint_id === id));
    });

    it('picks up a ticket raised before its block was switched to Automatic, and leaves Suggest and Off alone', async () => {
        const earlier = (await raise(SEED.sub.roomCleaning)).data.complaint.complaint_id; // SUGGEST: stays open
        const other = (await raise(SEED.sub.tubeLight)).data.complaint.complaint_id; // electrician, stays on SUGGEST
        assert.equal((await t.sql('SELECT status FROM complaints WHERE complaint_id = $1', [earlier])).rows[0].status, 'OPEN');
        await setting({ block_id: 'L_BLOCK', specialization: 'CLEANING', mode: 'AUTO' });
        await setting({ block_id: 'L_BLOCK', specialization: 'ELECTRICIAN', mode: 'OFF' });

        const r = await sweeper.sweepOnce();
        assert.ok(r.assigned >= 1);
        const state = async (id) => (await t.sql('SELECT status FROM complaints WHERE complaint_id = $1', [id])).rows[0].status;
        assert.equal(await state(earlier), 'ASSIGNED');
        assert.equal(await state(other), 'OPEN', 'a trade that is not on Automatic is never assigned by the autopilot');
    });

    it('only looks at the blocks of whoever asked', async () => {
        await t.sql("UPDATE users SET is_available = FALSE WHERE role = 'STAFF'");
        await setting({ block_id: 'L_BLOCK', specialization: 'CLEANING', mode: 'AUTO' });
        const id = (await raise(SEED.sub.trash)).data.complaint.complaint_id;
        await t.sql("UPDATE users SET is_available = TRUE WHERE role = 'STAFF'");
        const elsewhere = await sweeper.sweepOnce({ blocks: ['A_BLOCK'] });
        assert.equal(elsewhere.checked, 0, 'an L-Block ticket is not in A-Block\'s scope');
        assert.equal((await t.sql('SELECT status FROM complaints WHERE complaint_id = $1', [id])).rows[0].status, 'OPEN');
        const own = await sweeper.sweepOnce({ blocks: ['L_BLOCK'] });
        assert.equal(own.assigned, 1);
    });

    it('does not let students see or run it', async () => {
        assert.equal((await t.api('/autopilot/status', { token: rahul })).status, 403);
        assert.equal((await t.api('/autopilot/sweep', { method: 'POST', token: rahul })).status, 403);
    });
});
