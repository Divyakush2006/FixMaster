const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { resetDatabase, startApp, SEED } = require('./helpers');

describe('administration: accounts & room allotments', () => {
    let t;
    let admin;
    before(async () => {
        await resetDatabase();
        t = await startApp();
        admin = await t.login(SEED.admin);
    });
    after(async () => t && t.close());

    const userId = async (regId) =>
        (await t.sql('SELECT user_id FROM users WHERE reg_or_emp_id = $1', [regId])).rows[0].user_id;

    async function registerStudent(n) {
        const r = await t.api('/auth/register', {
            method: 'POST',
            body: { reg_or_emp_id: `ASTU${n}`, full_name: `Admin Test ${n}`, email: `astu${n}@example.com`, phone_number: '9000000000', password: 'Test@12345' },
        });
        assert.equal(r.status, 201);
        return r.data.user.user_id;
    }

    it('only admins can manage users and allotments', async () => {
        const sup = await t.login(SEED.supervisor);
        assert.equal((await t.api('/admin/users', { token: sup })).status, 403);
        assert.equal((await t.api('/admin/allotments', { token: sup })).status, 403);
        assert.equal((await t.api('/admin/users', { token: admin })).status, 200);
    });

    it('creates staff only with a trade, and never returns password hashes', async () => {
        const base = { reg_or_emp_id: 'EMP_NEW_01', full_name: 'New Carpenter', email: 'new.carp@example.com', phone_number: '9000000001', password: 'Test@12345', role: 'STAFF' };
        assert.equal((await t.api('/admin/users', { method: 'POST', token: admin, body: base })).status, 400);
        const r = await t.api('/admin/users', { method: 'POST', token: admin, body: { ...base, specialization: 'CARPENTER' } });
        assert.equal(r.status, 201);
        assert.equal(r.data.user.role, 'STAFF');
        const list = (await t.api('/admin/users?role=STAFF', { token: admin })).data;
        assert.ok(list.some((u) => u.reg_or_emp_id === 'EMP_NEW_01'));
        assert.ok(list.every((u) => u.password_hash === undefined));
    });

    it('a newly registered student can file room tickets once a room is allotted', async () => {
        const studentId = await registerStudent(1);
        const token = await t.login('ASTU1', 'Test@12345');
        const ticket = { ticket_scope: 'ROOM', block_id: 'L_BLOCK', room_id: 'L-801', subcategory_id: SEED.sub.roomCleaning };

        assert.equal((await t.api('/me/allotment', { token })).status, 404);
        assert.equal((await t.api('/complaints', { method: 'POST', token, body: ticket })).status, 403);

        const allot = await t.api('/admin/allotments', { method: 'POST', token: admin, body: { student_id: studentId, room_id: 'L-801', academic_year: '2026-2027' } });
        assert.equal(allot.status, 201);
        assert.equal((await t.api('/me/allotment', { token })).data.room_id, 'L-801');
        assert.equal((await t.api('/complaints', { method: 'POST', token, body: ticket })).status, 201);
    });

    it('moving a student keeps their history and they can only use the new room', async () => {
        const studentId = await userId('ASTU1');
        const r = await t.api('/admin/allotments', { method: 'POST', token: admin, body: { student_id: studentId, room_id: 'L-802', academic_year: '2026-2027' } });
        assert.equal(r.status, 201);
        const { rows } = await t.sql('SELECT room_id, is_current FROM student_room_allotments WHERE student_id = $1 ORDER BY allotment_id', [studentId]);
        assert.deepEqual(rows, [
            { room_id: 'L-801', is_current: false },
            { room_id: 'L-802', is_current: true },
        ]);
    });

    it('enforces room bed capacity', async () => {
        // L-825 has 2 beds and one current occupant (seed: Aditya).
        const a = await registerStudent(2);
        const b = await registerStudent(3);
        assert.equal((await t.api('/admin/allotments', { method: 'POST', token: admin, body: { student_id: a, room_id: 'L-825', academic_year: '2026-2027' } })).status, 201);
        const full = await t.api('/admin/allotments', { method: 'POST', token: admin, body: { student_id: b, room_id: 'L-825', academic_year: '2026-2027' } });
        assert.equal(full.status, 409);
    });

    it('refuses to allot rooms to non-students and ends allotments on request', async () => {
        const staffId = await userId(SEED.plumber);
        assert.equal((await t.api('/admin/allotments', { method: 'POST', token: admin, body: { student_id: staffId, room_id: 'L-840', academic_year: '2026-2027' } })).status, 400);
        const studentId = await userId('ASTU2');
        assert.equal((await t.api(`/admin/allotments/${studentId}`, { method: 'DELETE', token: admin })).status, 200);
        assert.equal((await t.api(`/admin/allotments/${studentId}`, { method: 'DELETE', token: admin })).status, 404);
    });

    it('deactivating a technician releases their live tasks back to OPEN', async () => {
        const sup = await t.login(SEED.supervisor);
        const student = await t.login(SEED.student);
        const plumberId = await userId(SEED.plumber);
        const c = await t.api('/complaints', { method: 'POST', token: student, body: { ticket_scope: 'ROOM', block_id: 'L_BLOCK', room_id: 'L-843', subcategory_id: 18 } });
        const cid = c.data.complaint.complaint_id;
        await t.api('/dispatch/assign', { method: 'POST', token: sup, body: { complaint_id: cid, staff_user_id: plumberId } });

        const r = await t.api(`/admin/users/${plumberId}`, { method: 'PATCH', token: admin, body: { is_active: false } });
        assert.equal(r.status, 200);
        assert.equal(r.data.released_tickets, 1);
        const { rows } = await t.sql('SELECT status FROM complaints WHERE complaint_id = $1', [cid]);
        assert.equal(rows[0].status, 'OPEN');
        // ...and they no longer appear as assignable.
        const roster = (await t.api('/meta/staff?specialization=PLUMBER', { token: sup })).data;
        assert.ok(roster.every((s) => s.user_id !== plumberId));
        const assign = await t.api('/dispatch/assign', { method: 'POST', token: sup, body: { complaint_id: cid, staff_user_id: plumberId } });
        assert.equal(assign.status, 400);

        await t.api(`/admin/users/${plumberId}`, { method: 'PATCH', token: admin, body: { is_active: true } });
    });

    it('an admin cannot deactivate themselves', async () => {
        const self = await userId(SEED.admin);
        const r = await t.api(`/admin/users/${self}`, { method: 'PATCH', token: admin, body: { is_active: false } });
        assert.equal(r.status, 400);
    });

    it('password reset by an admin revokes the user\'s sessions', async () => {
        const token = await t.login('ASTU3', 'Test@12345');
        await new Promise((r) => setTimeout(r, 1100));
        const r = await t.api(`/admin/users/${await userId('ASTU3')}/reset-password`, { method: 'POST', token: admin, body: { new_password: 'Reset@12345' } });
        assert.equal(r.status, 200);
        assert.equal((await t.api('/me', { token })).status, 401);
        assert.equal((await t.api('/auth/login', { method: 'POST', body: { reg_or_emp_id: 'ASTU3', password: 'Reset@12345' } })).status, 200);
    });
});
