const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { resetDatabase, startApp, SEED } = require('./helpers');

// Block scoping (migrations 009 + 011): supervisors only see and act on
// tickets in the blocks they look after; technicians have a home block that
// auto-dispatch prefers.

const SUPERVISOR_ID = 'u002-supv-0001-uuid-000000000002';
const CLEANER1_ID = 'u003-staf-clean-uuid-000000000003'; // EMP_CLN_01, busy with L-843 cleaning in the seed

describe('block scoping', () => {
    let t;
    let admin;
    let sup;
    let outsideTicket; // a ticket in A_BLOCK, outside the supervisor's L_BLOCK

    before(async () => {
        await resetDatabase();
        t = await startApp();
        admin = await t.login(SEED.admin);
        sup = await t.login(SEED.supervisor);
        const rooms = await t.api('/admin/blocks/A_BLOCK/rooms', {
            method: 'POST',
            token: admin,
            body: { floor_number: 1, from: 1, to: 1, room_type: 'NON_AC', bed_capacity: 3 },
        });
        assert.equal(rooms.status, 201);
        const created = await t.api('/complaints', {
            method: 'POST',
            token: admin,
            body: { ticket_scope: 'ROOM', block_id: 'A_BLOCK', room_id: 'A-101', subcategory_id: SEED.sub.tubeLight },
        });
        assert.equal(created.status, 201);
        outsideTicket = created.data.complaint.complaint_id;
    });
    after(async () => t && t.close());

    it('the demo supervisor looks after L-Block only, and /me says so', async () => {
        const me = await t.api('/me', { token: sup });
        assert.deepEqual(me.data.managed_blocks, ['L_BLOCK']);
    });

    it('a supervisor lists only tickets in their blocks; an admin lists all', async () => {
        const mine = await t.api('/complaints', { token: sup });
        assert.equal(mine.status, 200);
        assert.ok(mine.data.length > 0);
        assert.ok(mine.data.every((c) => c.block_id === 'L_BLOCK'));
        assert.ok(!mine.data.some((c) => c.complaint_id === outsideTicket));

        const all = await t.api('/complaints', { token: admin });
        assert.ok(all.data.some((c) => c.complaint_id === outsideTicket));
    });

    it('a supervisor cannot open, dispatch, reject or file tickets outside their blocks', async () => {
        const detail = await t.api(`/complaints/${outsideTicket}`, { token: sup });
        assert.equal(detail.status, 403);
        assert.equal(detail.data.code, 'OUT_OF_SCOPE');
        assert.equal((await t.api(`/complaints/${outsideTicket}/logs`, { token: sup })).status, 403);
        assert.equal((await t.api(`/complaints/${outsideTicket}/related`, { token: sup })).status, 403);

        const electrician = (await t.sql("SELECT user_id FROM users WHERE reg_or_emp_id = 'EMP_ELEC_02'")).rows[0].user_id;
        const assign = await t.api('/dispatch/assign', {
            method: 'POST',
            token: sup,
            body: { complaint_id: outsideTicket, staff_user_id: electrician },
        });
        assert.equal(assign.status, 403);
        assert.equal(assign.data.code, 'OUT_OF_SCOPE');

        const reject = await t.api(`/complaints/${outsideTicket}/reject`, {
            method: 'POST',
            token: sup,
            body: { reason: 'Not my block to judge' },
        });
        assert.equal(reject.status, 403);

        const file = await t.api('/complaints', {
            method: 'POST',
            token: sup,
            body: { ticket_scope: 'ROOM', block_id: 'A_BLOCK', room_id: 'A-101', subcategory_id: SEED.sub.socket },
        });
        assert.equal(file.status, 403);
        assert.equal(file.data.code, 'OUT_OF_SCOPE');

        // Nothing changed.
        const row = await t.sql('SELECT status FROM complaints WHERE complaint_id = $1', [outsideTicket]);
        assert.equal(row.rows[0].status, 'OPEN');
    });

    it('dashboards and hotspots are limited to the supervisor’s blocks', async () => {
        const kpi = await t.api('/analytics/kpi', { token: sup });
        assert.deepEqual(kpi.data.map((b) => b.block_id), ['L_BLOCK']);
        const all = await t.api('/analytics/kpi', { token: admin });
        assert.ok(all.data.length > 1);
        const hot = await t.api('/analytics/hotspots', { token: sup });
        assert.equal(hot.status, 200);
        assert.ok(hot.data.every((h) => h.block_id === 'L_BLOCK'));
    });

    it('an admin sets a supervisor’s blocks; the change takes effect at once and is audited', async () => {
        const unknown = await t.api(`/admin/users/${SUPERVISOR_ID}/blocks`, { method: 'PUT', token: admin, body: { block_ids: ['NOPE'] } });
        assert.equal(unknown.status, 404);
        const notSup = await t.api(`/admin/users/${CLEANER1_ID}/blocks`, { method: 'PUT', token: admin, body: { block_ids: ['L_BLOCK'] } });
        assert.equal(notSup.status, 400);
        assert.equal((await t.api(`/admin/users/${SUPERVISOR_ID}/blocks`, { method: 'PUT', token: sup, body: { block_ids: [] } })).status, 403);

        const set = await t.api(`/admin/users/${SUPERVISOR_ID}/blocks`, {
            method: 'PUT',
            token: admin,
            body: { block_ids: ['L_BLOCK', 'A_BLOCK', 'A_BLOCK'] },
        });
        assert.equal(set.status, 200);
        assert.deepEqual(set.data.managed_blocks, ['A_BLOCK', 'L_BLOCK']);
        assert.equal((await t.api(`/complaints/${outsideTicket}`, { token: sup })).status, 200);

        const audit = await t.sql("SELECT details FROM audit_log WHERE action = 'user.set_blocks' ORDER BY audit_id DESC LIMIT 1");
        assert.deepEqual(audit.rows[0].details.block_ids, ['A_BLOCK', 'L_BLOCK']);
        assert.deepEqual(audit.rows[0].details.previous, ['L_BLOCK']);

        const users = await t.api('/admin/users?role=SUPERVISOR', { token: admin });
        assert.deepEqual(users.data.find((u) => u.user_id === SUPERVISOR_ID).managed_blocks, ['A_BLOCK', 'L_BLOCK']);

        // With no blocks a supervisor sees nothing (least privilege).
        await t.api(`/admin/users/${SUPERVISOR_ID}/blocks`, { method: 'PUT', token: admin, body: { block_ids: [] } });
        assert.equal((await t.api('/complaints', { token: sup })).data.length, 0);

        // Back to L-Block for the rest of the suite.
        await t.api(`/admin/users/${SUPERVISOR_ID}/blocks`, { method: 'PUT', token: admin, body: { block_ids: ['L_BLOCK'] } });
    });

    it('the database refuses blocks for non-supervisors whatever the caller', async () => {
        await assert.rejects(
            t.sql("INSERT INTO supervisor_blocks (supervisor_id, block_id) VALUES ($1, 'L_BLOCK')", [CLEANER1_ID]),
            /only be assigned to supervisor/
        );
    });

    it('technicians get a home block, shown first in the picker and preferred by auto-dispatch', async () => {
        const student = await t.api(`/admin/users/${(await t.sql("SELECT user_id FROM users WHERE reg_or_emp_id = '21BCE1042'")).rows[0].user_id}`, {
            method: 'PATCH',
            token: admin,
            body: { home_block_id: 'L_BLOCK' },
        });
        assert.equal(student.status, 400, 'only technicians have a home block');
        assert.equal(
            (await t.api(`/admin/users/${CLEANER1_ID}`, { method: 'PATCH', token: admin, body: { home_block_id: 'NOPE' } })).status,
            404
        );

        const set = await t.api(`/admin/users/${CLEANER1_ID}`, { method: 'PATCH', token: admin, body: { home_block_id: 'L_BLOCK' } });
        assert.equal(set.status, 200);
        assert.equal(set.data.home_block_id, 'L_BLOCK');

        const picker = await t.api('/meta/staff?specialization=CLEANING&block_id=L_BLOCK', { token: sup });
        assert.equal(picker.data[0].user_id, CLEANER1_ID);

        // EMP_CLN_01 already has a live job while the other cleaners are idle,
        // but is based in L-Block: auto-dispatch picks them for an L-Block ticket.
        const rahul = await t.login(SEED.student2);
        const ticket = await t.api('/complaints', {
            method: 'POST',
            token: rahul,
            body: { ticket_scope: 'ROOM', block_id: 'L_BLOCK', room_id: 'L-810', subcategory_id: SEED.sub.roomCleaning },
        });
        assert.equal(ticket.status, 201);
        const auto = await t.api('/dispatch/auto-dispatch', {
            method: 'POST',
            token: sup,
            body: { complaint_id: ticket.data.complaint.complaint_id },
        });
        assert.equal(auto.status, 200);
        assert.equal(auto.data.staff_user_id, CLEANER1_ID);

        const clear = await t.api(`/admin/users/${CLEANER1_ID}`, { method: 'PATCH', token: admin, body: { home_block_id: null } });
        assert.equal(clear.data.home_block_id, null);
        const audit = await t.sql("SELECT COUNT(*)::int AS n FROM audit_log WHERE action = 'user.set_home_block'");
        assert.equal(audit.rows[0].n, 2);
    });

    it('auto-dispatch outside the supervisor’s blocks is refused', async () => {
        const cleaning = await t.api('/complaints', {
            method: 'POST',
            token: admin,
            body: { ticket_scope: 'ROOM', block_id: 'A_BLOCK', room_id: 'A-101', subcategory_id: SEED.sub.roomCleaning },
        });
        const auto = await t.api('/dispatch/auto-dispatch', {
            method: 'POST',
            token: sup,
            body: { complaint_id: cleaning.data.complaint.complaint_id },
        });
        assert.equal(auto.status, 403);
        assert.equal(auto.data.code, 'OUT_OF_SCOPE');
    });
});
