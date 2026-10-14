const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { resetDatabase, startApp, SEED } = require('./helpers');

// SLA tracking, computed from category SLA hours and ticket timestamps (no
// stored SLA data): a ticket is due default_sla_hours after it was raised.

describe('SLA tracking', () => {
    let t;
    let admin;
    let sup;

    before(async () => {
        await resetDatabase();
        t = await startApp();
        admin = await t.login(SEED.admin);
        sup = await t.login(SEED.supervisor);
    });
    after(async () => t && t.close());

    const raise = async (subcategory_id, room_id = 'L-810') => {
        const r = await t.api('/complaints', {
            method: 'POST',
            token: admin,
            body: { ticket_scope: 'ROOM', block_id: 'L_BLOCK', room_id, subcategory_id },
        });
        assert.equal(r.status, 201);
        return r.data.complaint.complaint_id;
    };
    const detail = async (id) => (await t.api(`/complaints/${id}`, { token: sup })).data;
    const hoursAgo = (id, hours) =>
        t.sql("UPDATE complaints SET created_at = NOW() - make_interval(hours => $2) WHERE complaint_id = $1", [id, hours]);

    it('a new ticket is due its category SLA hours after it was raised', async () => {
        const id = await raise(SEED.sub.tubeLight); // Electrical: 12 h
        const d = await detail(id);
        assert.equal(d.default_sla_hours, 12);
        assert.equal(Math.round((new Date(d.sla_due_at) - new Date(d.created_at)) / 3600000), 12);
        assert.equal(d.sla_status, 'ON_TRACK');
    });

    it('a ticket in the last quarter of its window is at risk, past it overdue', async () => {
        const id = await raise(SEED.sub.socket, 'L-825'); // 12 h
        await hoursAgo(id, 10); // 2 h left of 12
        assert.equal((await detail(id)).sla_status, 'AT_RISK');
        await hoursAgo(id, 13);
        assert.equal((await detail(id)).sla_status, 'OVERDUE');

        const overdue = await t.api('/complaints?sla=OVERDUE', { token: sup });
        assert.ok(overdue.data.some((c) => c.complaint_id === id));
        assert.ok(overdue.data.every((c) => c.sla_status === 'OVERDUE'));
        assert.equal((await t.api('/complaints?sla=LATE', { token: sup })).status, 400);

        const kpi = (await t.api('/analytics/kpi', { token: sup })).data.find((b) => b.block_id === 'L_BLOCK');
        assert.ok(kpi.overdue_count >= 1);
    });

    it('finished work is MET or BREACHED by when it was done, and a rejected fix runs the clock again', async () => {
        const id = await raise(SEED.sub.fan, 'L-305'); // 12 h
        await hoursAgo(id, 20); // raised 20 h ago
        await t.sql("UPDATE complaints SET status = 'PENDING_VERIFICATION' WHERE complaint_id = $1", [id]); // the trigger stamps resolved_at
        await t.sql("UPDATE complaints SET resolved_at = created_at + INTERVAL '5 hours' WHERE complaint_id = $1", [id]);
        assert.equal((await detail(id)).sla_status, 'MET');

        await t.sql("UPDATE complaints SET resolved_at = created_at + INTERVAL '15 hours' WHERE complaint_id = $1", [id]);
        assert.equal((await detail(id)).sla_status, 'BREACHED');

        await t.sql("UPDATE complaints SET status = 'ESCALATED' WHERE complaint_id = $1", [id]);
        const back = await detail(id);
        assert.equal(back.resolved_at, null);
        assert.equal(back.sla_status, 'OVERDUE', 'live again, and past the original deadline');

        const kpi = (await t.api('/analytics/kpi', { token: admin })).data.find((b) => b.block_id === 'L_BLOCK');
        assert.ok('sla_compliance_pct' in kpi);
    });

    it('withdrawn and rejected tickets are not measured', async () => {
        const id = await raise(SEED.sub.mcb, 'L-843');
        await t.api(`/complaints/${id}/reject`, { method: 'POST', token: sup, body: { reason: 'Duplicate of a phone report' } });
        assert.equal((await detail(id)).sla_status, 'NOT_APPLICABLE');
    });

    it('the technician queue carries each job’s deadline and keeps its floor/priority order', async () => {
        const tech = await t.login(SEED.cleaner1);
        const queue = await t.api('/dispatch/queue', { token: tech });
        assert.equal(queue.status, 200);
        assert.ok(queue.data.length > 0);
        assert.ok(queue.data.every((j) => j.sla_due_at && j.sla_status));
        const floors = queue.data.map((j) => j.floor_number);
        assert.deepEqual(floors, [...floors].sort((a, b) => a - b));
    });
});
