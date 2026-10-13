const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { resetDatabase, startApp, SEED } = require('./helpers');

// SLA tracking (migrations 010 + 011): every ticket is due its category's
// SLA hours after it was raised, and has a status against that deadline.

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
        return r.data.complaint;
    };
    const slaOf = async (id) => (await t.api(`/complaints/${id}`, { token: sup })).data;

    it('every ticket is due its category’s SLA hours after it was raised', async () => {
        const ticket = await raise(SEED.sub.tubeLight); // Electrical: 12 h
        const hours = (new Date(ticket.sla_due_at) - new Date(ticket.created_at)) / 3600000;
        assert.equal(hours, 12);
        const detail = await slaOf(ticket.complaint_id);
        assert.equal(detail.sla_status, 'ON_TRACK');
        assert.equal(detail.default_sla_hours, 12);
    });

    it('seeded tickets have deadlines too', async () => {
        const { rows } = await t.sql('SELECT COUNT(*)::int AS n FROM complaints WHERE sla_due_at IS NULL');
        assert.equal(rows[0].n, 0);
    });

    it('a ticket in the last quarter of its window is at risk, past it overdue', async () => {
        const ticket = await raise(SEED.sub.socket, 'L-825');
        // 12 h window, 2 h left -> at risk.
        await t.sql(
            `UPDATE complaints SET created_at = NOW() - INTERVAL '10 hours', sla_due_at = NOW() + INTERVAL '2 hours' WHERE complaint_id = $1`,
            [ticket.complaint_id]
        );
        assert.equal((await slaOf(ticket.complaint_id)).sla_status, 'AT_RISK');

        await t.sql(`UPDATE complaints SET sla_due_at = NOW() - INTERVAL '1 hour' WHERE complaint_id = $1`, [ticket.complaint_id]);
        assert.equal((await slaOf(ticket.complaint_id)).sla_status, 'OVERDUE');

        const overdue = await t.api('/complaints?sla=OVERDUE', { token: sup });
        assert.ok(overdue.data.some((c) => c.complaint_id === ticket.complaint_id));
        assert.ok(overdue.data.every((c) => c.sla_status === 'OVERDUE'));

        const kpi = await t.api('/analytics/kpi', { token: sup });
        assert.ok(Number(kpi.data[0].overdue_count) >= 1);

        assert.equal((await t.api('/complaints?sla=LATE', { token: sup })).status, 400);
    });

    it('finished work is MET or BREACHED by when it was done, and rework restarts the clock', async () => {
        const ticket = await raise(SEED.sub.fan, 'L-305');
        const id = ticket.complaint_id;
        await t.sql(
            `UPDATE complaints SET status = 'PENDING_VERIFICATION', resolved_at = sla_due_at - INTERVAL '1 hour' WHERE complaint_id = $1`,
            [id]
        );
        assert.equal((await slaOf(id)).sla_status, 'MET');

        await t.sql(`UPDATE complaints SET resolved_at = sla_due_at + INTERVAL '1 hour' WHERE complaint_id = $1`, [id]);
        assert.equal((await slaOf(id)).sla_status, 'BREACHED');

        // A rejected fix (ESCALATED) clears resolved_at: the ticket is live again
        // against the same deadline.
        await t.sql(`UPDATE complaints SET status = 'ESCALATED' WHERE complaint_id = $1`, [id]);
        const after = await slaOf(id);
        assert.equal(after.resolved_at, null);
        assert.equal(after.sla_status, 'ON_TRACK');

        const kpi = (await t.api('/analytics/kpi', { token: admin })).data.find((b) => b.block_id === 'L_BLOCK');
        assert.ok('sla_compliance_pct' in kpi);
    });

    it('withdrawn and rejected tickets are not measured', async () => {
        const ticket = await raise(SEED.sub.mcb, 'L-843');
        await t.api(`/complaints/${ticket.complaint_id}/reject`, { method: 'POST', token: sup, body: { reason: 'Duplicate of a phone report' } });
        assert.equal((await slaOf(ticket.complaint_id)).sla_status, 'NOT_APPLICABLE');
    });
});
