const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { resetDatabase, startApp, SEED, studentProfile } = require('./helpers');

// Campus organisation (migration 011): chief wardens, supervisors scoped to
// blocks, staff home blocks, shifts and leave.

describe('campus organisation: chief wardens, block scoping, staff placement', () => {
    let t;
    let admin;
    const ids = {};
    const tokens = {};

    const create = (body) => t.api('/admin/users', { method: 'POST', token: admin, body: { phone_number: '9000000300', password: 'Granite4Owl', ...body } });

    before(async () => {
        await resetDatabase();
        t = await startApp();
        admin = await t.login(SEED.admin);

        for (const [key, body] of [
            ['chief', { reg_or_emp_id: 'CW_CAMPUS_01', full_name: 'Chief Warden', email: 'chief.warden@vit.ac.in', role: 'CHIEF_WARDEN' }],
            ['supA', { reg_or_emp_id: 'SUP_ABLOCK_01', full_name: 'A Block Supervisor', email: 'sup.a@vit.ac.in', role: 'SUPERVISOR' }],
            ['supL', { reg_or_emp_id: 'SUP_LBLOCK_02', full_name: 'L Block Supervisor', email: 'sup.l2@vit.ac.in', role: 'SUPERVISOR' }],
        ]) {
            const r = await create(body);
            assert.equal(r.status, 201, JSON.stringify(r.data));
            ids[key] = r.data.user.user_id;
        }
        assert.equal((await t.api(`/admin/users/${ids.supA}/blocks`, { method: 'PUT', token: admin, body: { block_ids: ['A_BLOCK'] } })).status, 200);
        assert.equal((await t.api(`/admin/users/${ids.supL}/blocks`, { method: 'PUT', token: admin, body: { block_ids: ['L_BLOCK'] } })).status, 200);
        tokens.chief = await t.login('CW_CAMPUS_01', 'Granite4Owl');
        tokens.supA = await t.login('SUP_ABLOCK_01', 'Granite4Owl');
        tokens.supL = await t.login('SUP_LBLOCK_02', 'Granite4Owl');
        tokens.legacy = await t.login(SEED.supervisor); // no blocks assigned: campus-wide
    });
    after(async () => t && t.close());

    const anyLTicket = async () => (await t.sql("SELECT complaint_id FROM complaints WHERE block_id = 'L_BLOCK' ORDER BY created_at LIMIT 1")).rows[0];

    it('signs a chief warden in through the staff portal, campus-wide but not as an administrator', async () => {
        const list = await t.api('/complaints', { token: tokens.chief });
        assert.equal(list.status, 200);
        assert.ok(list.data.length > 0);
        assert.equal((await t.api('/analytics/kpi', { token: tokens.chief })).status, 200);
        assert.equal((await t.api('/admin/users', { token: tokens.chief })).status, 403);
        const wrongPortal = await t.api('/auth/admin/login', { method: 'POST', body: { reg_or_emp_id: 'CW_CAMPUS_01', password: 'Granite4Owl' } });
        assert.equal(wrongPortal.status, 401);
        assert.equal((await t.api('/admin/users/summary', { token: admin })).data.chief_warden, 1);
    });

    it("limits a supervisor's register, tickets, actions and figures to their blocks", async () => {
        const ticket = await anyLTicket();
        assert.ok(ticket, 'the seed has L-block tickets');

        const listA = await t.api('/complaints', { token: tokens.supA });
        assert.equal(listA.status, 200);
        assert.ok(listA.data.every((c) => c.block_id === 'A_BLOCK'));
        const listL = await t.api('/complaints', { token: tokens.supL });
        assert.ok(listL.data.length > 0 && listL.data.every((c) => c.block_id === 'L_BLOCK'));
        assert.ok((await t.api('/complaints', { token: tokens.legacy })).data.length >= listL.data.length, 'an unassigned supervisor stays campus-wide');

        for (const [path, opts] of [
            [`/complaints/${ticket.complaint_id}`, {}],
            [`/complaints/${ticket.complaint_id}/logs`, {}],
            [`/complaints/${ticket.complaint_id}/related`, {}],
            [`/complaints/${ticket.complaint_id}/reject`, { method: 'POST', body: { reason: 'Not ours to judge' } }],
            ['/dispatch/assign', { method: 'POST', body: { complaint_id: ticket.complaint_id, staff_user_id: ids.chief } }],
        ]) {
            const r = await t.api(path, { token: tokens.supA, ...opts });
            assert.equal(r.status, 403, path);
            assert.equal(r.data.code, 'OUT_OF_SCOPE', path);
        }
        assert.equal((await t.api(`/complaints/${ticket.complaint_id}`, { token: tokens.supL })).status, 200);

        const kpiA = await t.api('/analytics/kpi', { token: tokens.supA });
        assert.ok(kpiA.data.every((row) => row.block_id === 'A_BLOCK'));
        const notesA = await t.api('/notifications', { token: tokens.supA });
        assert.equal(notesA.status, 200);
        for (const n of notesA.data) {
            const b = await t.sql('SELECT block_id FROM complaints WHERE complaint_id = $1', [n.complaint_id]);
            assert.equal(b.rows[0].block_id, 'A_BLOCK');
        }
    });

    it('only lets a supervisor raise tickets in their own blocks', async () => {
        const outside = await t.api('/complaints', {
            method: 'POST',
            token: tokens.supA,
            body: { ticket_scope: 'ROOM', block_id: 'L_BLOCK', room_id: 'L-810', subcategory_id: SEED.sub.tubeLight },
        });
        assert.equal(outside.status, 403);
        assert.equal(outside.data.code, 'OUT_OF_SCOPE');
    });

    it('assigns blocks only to supervisors, and an empty list makes them campus-wide again', async () => {
        assert.equal((await t.api(`/admin/users/${ids.chief}/blocks`, { method: 'PUT', token: admin, body: { block_ids: ['A_BLOCK'] } })).status, 400);
        assert.equal((await t.api(`/admin/users/${ids.supA}/blocks`, { method: 'PUT', token: admin, body: { block_ids: ['NOPE_BLOCK'] } })).status, 404);
        const raw = await t.sql("SELECT user_id FROM users WHERE reg_or_emp_id = $1", [SEED.electrician]);
        await assert.rejects(
            t.sql('INSERT INTO supervisor_blocks (supervisor_user_id, block_id) VALUES ($1, $2)', [raw.rows[0].user_id, 'A_BLOCK']),
            /Only supervisors/
        );
        const wide = await t.api(`/admin/users/${ids.supA}/blocks`, { method: 'PUT', token: admin, body: { block_ids: [] } });
        assert.equal(wide.data.campus_wide, true);
        assert.ok((await t.api('/complaints', { token: tokens.supA })).data.some((c) => c.block_id === 'L_BLOCK'));
        await t.api(`/admin/users/${ids.supA}/blocks`, { method: 'PUT', token: admin, body: { block_ids: ['A_BLOCK'] } });
        const listed = await t.api('/admin/users?role=SUPERVISOR', { token: admin });
        assert.deepEqual(listed.data.find((u) => u.user_id === ids.supA).managed_blocks, ['A_BLOCK']);
    });

    it("places staff in a home block and shift, and scopes a supervisor's staff picker to them plus the campus pool", async () => {
        const elec = (await t.sql('SELECT user_id FROM users WHERE reg_or_emp_id = $1', [SEED.electrician])).rows[0].user_id;
        const elec2 = (await t.sql('SELECT user_id FROM users WHERE reg_or_emp_id = $1', [SEED.electrician2])).rows[0].user_id;
        const placed = await t.api(`/admin/users/${elec}/placement`, { method: 'PATCH', token: admin, body: { home_block_id: 'L_BLOCK', shift: 'MORNING' } });
        assert.equal(placed.status, 200);
        assert.equal(placed.data.shift, 'MORNING');
        await t.api(`/admin/users/${elec2}/placement`, { method: 'PATCH', token: admin, body: { home_block_id: 'L_BLOCK' } });
        assert.equal((await t.api(`/admin/users/${ids.supA}/placement`, { method: 'PATCH', token: admin, body: { shift: 'NIGHT' } })).status, 400);
        assert.equal((await t.api(`/admin/users/${elec}/placement`, { method: 'PATCH', token: admin, body: { shift: 'LUNCH' } })).status, 400);

        const forA = await t.api('/meta/staff?specialization=ELECTRICIAN', { token: tokens.supA });
        const namesA = forA.data.map((s) => s.user_id);
        assert.ok(!namesA.includes(elec) && !namesA.includes(elec2), 'L-block staff are not offered to an A-block supervisor');
        assert.ok(forA.data.length > 0 && forA.data.every((s) => s.home_block_id === null), 'the campus pool is');
        const forL = await t.api('/meta/staff?specialization=ELECTRICIAN', { token: tokens.supL });
        assert.ok(forL.data.some((s) => s.user_id === elec));
    });

    it('records staff leave without overlaps', async () => {
        const plumber = (await t.sql('SELECT user_id FROM users WHERE reg_or_emp_id = $1', [SEED.plumber])).rows[0].user_id;
        const add = (body) => t.api(`/admin/users/${plumber}/leave`, { method: 'POST', token: admin, body });
        const first = await add({ starts_on: '2026-12-01', ends_on: '2026-12-05', reason: 'Family function' });
        assert.equal(first.status, 201);
        assert.equal((await add({ starts_on: '2026-12-04', ends_on: '2026-12-06' })).status, 409);
        assert.equal((await add({ starts_on: '2026-12-10', ends_on: '2026-12-09' })).status, 400);
        assert.equal((await t.api(`/admin/users/${ids.chief}/leave`, { method: 'POST', token: admin, body: { starts_on: '2026-12-10', ends_on: '2026-12-11' } })).status, 400);
        assert.equal((await t.api(`/admin/users/${plumber}/leave`, { token: admin })).data.length, 1);
        assert.equal((await t.api(`/admin/leave/${first.data.leave_id}`, { method: 'DELETE', token: admin })).status, 204);
    });

    it("shows a resident's record to the wardens who look after them, health details only with consent, and audits each read", async () => {
        const reg = await t.registerStudent(
            { reg_or_emp_id: '25ORG0001', full_name: 'Meera Pillai', email: 'meera.p@vitstudent.ac.in', phone_number: '9000000310', password: 'Harbour5Glass' },
            { profile: false }
        );
        await t.api('/me/profile', { method: 'PUT', token: reg.token, body: studentProfile({ health_consent: true, blood_group: 'O-' }) });
        const studentId = reg.data.user.user_id;
        assert.equal((await t.api(`/residents/${studentId}/profile`, { token: tokens.supL })).status, 403, 'no room yet, so no block');
        await t.api('/admin/allotments', { method: 'POST', token: admin, body: { student_id: studentId, room_id: 'L-305', academic_year: '2026-2027' } });

        const seenByL = await t.api(`/residents/${studentId}/profile`, { token: tokens.supL });
        assert.equal(seenByL.status, 200);
        assert.equal(seenByL.data.profile.guardian_phone, '9876500011');
        assert.equal(seenByL.data.profile.blood_group, 'O-');
        assert.equal((await t.api(`/residents/${studentId}/profile`, { token: tokens.supA })).status, 403);
        assert.equal((await t.api(`/residents/${studentId}/profile`, { token: tokens.chief })).status, 200);
        assert.equal((await t.api(`/residents/${studentId}/profile`, { token: await t.login(SEED.electrician) })).status, 403);
        const reads = await t.sql("SELECT COUNT(*)::int AS n FROM audit_log WHERE action = 'profile.viewed' AND target_id = $1", [studentId]);
        assert.equal(reads.rows[0].n, 2);
    });

    it("records whether a block is a men's or ladies' hostel", async () => {
        const r = await t.api('/admin/blocks/A_BLOCK', { method: 'PATCH', token: admin, body: { block_name: 'A-Block', hostel_type: 'LADIES' } });
        assert.equal(r.status, 200);
        assert.equal(r.data.hostel_type, 'LADIES');
        const pub = await t.api('/meta/blocks');
        assert.equal(pub.data.find((b) => b.block_id === 'A_BLOCK').hostel_type, 'LADIES');
        assert.equal((await t.api('/admin/blocks/A_BLOCK', { method: 'PATCH', token: admin, body: { block_name: 'A-Block', hostel_type: 'MIXED' } })).status, 400);
    });
});
