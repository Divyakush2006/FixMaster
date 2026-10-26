const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { resetDatabase, startApp, SEED } = require('./helpers');

// First-time student registration: the room a student names is a REQUEST.
// It grants nothing until the hostel office allots the room.

const profile = (n, extra = {}) => ({
    reg_or_emp_id: `25BCE7${String(n).padStart(3, '0')}`,
    full_name: `New Student ${n}`,
    email: `new${n}@vitstudent.ac.in`,
    phone_number: '9000000001',
    password: 'Welcome@2026x',
    ...extra,
});

describe('student registration and room requests', () => {
    let t;
    let admin;
    before(async () => {
        await resetDatabase();
        t = await startApp();
        admin = await t.login(SEED.admin);
        // A second, freshly configured block: nothing in the code knows about it.
        assert.equal(
            (await t.api('/admin/blocks/B_BLOCK/rooms', { method: 'POST', token: admin, body: { floor_number: 2, from: 1, to: 2, room_type: 'AC', bed_capacity: 1 } })).status,
            201
        );
    });
    after(async () => t && t.close());

    const register = (n, extra) => t.registerStudent(profile(n, extra));

    it('creates the account and a pending request, but no allotment and no room access', async () => {
        const r = await register(1, { block_id: 'B_BLOCK', floor_number: 2, room_id: 'B-201' });
        assert.equal(r.status, 201);
        assert.equal(r.data.user.role, 'STUDENT');
        assert.equal(r.data.room_request.status, 'PENDING');

        const allot = await t.sql('SELECT COUNT(*)::int AS n FROM student_room_allotments WHERE student_id = $1', [r.data.user.user_id]);
        assert.equal(allot.rows[0].n, 0, 'a self-declared room is not an allotment');

        const token = await t.login('25BCE7001', 'Welcome@2026x');
        const ticket = await t.api('/complaints', {
            method: 'POST',
            token,
            body: { ticket_scope: 'ROOM', block_id: 'B_BLOCK', room_id: 'B-201', subcategory_id: SEED.sub.tubeLight },
        });
        assert.equal(ticket.status, 403, 'no room access until approved');

        const mine = await t.api('/me/room-request', { token });
        assert.equal(mine.data.request.status, 'PENDING');
        assert.equal(mine.data.request.room_id, 'B-201');
    });

    it('rejects fabricated or inconsistent locations and leaves nothing behind', async () => {
        const cases = [
            [{ block_id: 'B_BLOCK', floor_number: 2, room_id: 'B-299' }, 404], // no such room
            [{ block_id: 'B_BLOCK', floor_number: 3, room_id: 'B-201' }, 400], // wrong floor
            [{ block_id: 'A_BLOCK', floor_number: 2, room_id: 'B-201' }, 400], // wrong block
            [{ block_id: 'B_BLOCK', room_id: 'B-201' }, 400], // incomplete
        ];
        for (const [extra, status] of cases) {
            const r = await register(20, extra);
            assert.equal(r.status, status, JSON.stringify(extra));
        }
        const left = await t.sql("SELECT COUNT(*)::int AS n FROM users WHERE reg_or_emp_id = '25BCE7020'");
        assert.equal(left.rows[0].n, 0, 'a failed registration creates no account');

        await t.sql('UPDATE rooms SET is_active = FALSE WHERE room_id = $1', ['B-202']);
        assert.equal((await register(21, { block_id: 'B_BLOCK', floor_number: 2, room_id: 'B-202' })).status, 404, 'closed room');
        await t.sql('UPDATE rooms SET is_active = TRUE WHERE room_id = $1', ['B-202']);
    });

    it('can register without a room, and cannot register twice or as staff', async () => {
        assert.equal((await register(2)).status, 201);
        const dupe = await register(2);
        assert.equal(dupe.status, 409);
        assert.equal((await register(3, { email: 'new2@vitstudent.ac.in' })).status, 409, 'email already used');
        const sneaky = await register(4, { role: 'ADMIN' });
        assert.equal(sneaky.status, 201);
        assert.equal(sneaky.data.user.role, 'STUDENT', 'public registration only ever creates students');
    });

    it('the office sees the request and approving it through the allotment flow grants access', async () => {
        const list = await t.api('/admin/allotment-requests', { token: admin });
        assert.equal(list.status, 200);
        const request = list.data.find((r) => r.reg_or_emp_id === '25BCE7001');
        assert.ok(request);
        assert.equal(request.room_id, 'B-201');
        assert.equal(request.occupied_beds, 0);
        assert.equal(request.bed_capacity, 1);
        assert.equal((await t.api('/admin/allotment-requests', { token: await t.login(SEED.supervisor) })).status, 403);

        const approve = await t.api('/admin/allotments', {
            method: 'POST',
            token: admin,
            body: { student_id: request.student_id, room_id: 'B-201', academic_year: '2026-2027' },
        });
        assert.equal(approve.status, 201);
        assert.ok(!(await t.api('/admin/allotment-requests', { token: admin })).data.some((r) => r.reg_or_emp_id === '25BCE7001'));

        const token = await t.login('25BCE7001', 'Welcome@2026x');
        assert.equal((await t.api('/me/room-request', { token })).data.request, null);
        const ticket = await t.api('/complaints', {
            method: 'POST',
            token,
            body: { ticket_scope: 'ROOM', block_id: 'B_BLOCK', room_id: 'B-201', subcategory_id: SEED.sub.tubeLight },
        });
        assert.equal(ticket.status, 201, 'a new block works without any code change');
    });

    it('a student can send, change and repeat requests; declined ones can be re-sent', async () => {
        const token = await t.login('25BCE7002', 'Welcome@2026x');
        assert.equal((await t.api('/me/room-request', { token })).data.request, null);

        const first = await t.api('/me/room-request', { method: 'POST', token, body: { block_id: 'B_BLOCK', floor_number: 2, room_id: 'B-202' } });
        assert.equal(first.status, 201);
        assert.equal(first.data.request.status, 'PENDING');
        const again = await t.api('/me/room-request', { method: 'POST', token, body: { block_id: 'B_BLOCK', floor_number: 2, room_id: 'B-202' } });
        assert.equal(again.status, 409, 'the same request twice');
        assert.equal(
            (await t.api('/me/room-request', { method: 'POST', token, body: { block_id: 'B_BLOCK', floor_number: 9, room_id: 'B-202' } })).status,
            400
        );

        const id = (await t.sql("SELECT user_id FROM users WHERE reg_or_emp_id = '25BCE7002'")).rows[0].user_id;
        assert.equal((await t.api(`/admin/allotment-requests/${id}/decline`, { method: 'POST', token: admin, body: { reason: 'no' } })).status, 400);
        const decline = await t.api(`/admin/allotment-requests/${id}/decline`, {
            method: 'POST',
            token: admin,
            body: { reason: 'Room reserved for final-year students' },
        });
        assert.equal(decline.status, 200);
        const status = (await t.api('/me/room-request', { token })).data.request;
        assert.equal(status.status, 'DECLINED');
        assert.match(status.decline_reason, /final-year/);
        assert.equal((await t.api(`/admin/allotment-requests/${id}/decline`, { method: 'POST', token: admin, body: { reason: 'Already handled' } })).status, 404);

        const resend = await t.api('/me/room-request', { method: 'POST', token, body: { block_id: 'B_BLOCK', floor_number: 2, room_id: 'B-202' } });
        assert.equal(resend.status, 201);
        assert.equal(resend.data.request.status, 'PENDING');
    });

    it('requests are audited, and only students can use the student endpoints', async () => {
        const audit = await t.sql("SELECT COUNT(*)::int AS n FROM audit_log WHERE action IN ('allotment.request', 'allotment.decline')");
        assert.ok(audit.rows[0].n >= 4);
        assert.equal((await t.api('/me/room-request', { token: await t.login(SEED.supervisor) })).status, 403);
        assert.equal((await t.api('/me/room-request')).status, 401);
    });

    it('a student can withdraw a waiting request; it then disappears from the office queue', async () => {
        const token = await t.login('25BCE7002', 'Welcome@2026x');
        const id = (await t.sql("SELECT user_id FROM users WHERE reg_or_emp_id = '25BCE7002'")).rows[0].user_id;
        const queue = async () => (await t.api('/admin/allotment-requests', { token: admin })).data.map((r) => r.student_id);
        assert.ok((await queue()).includes(id));

        assert.equal((await t.api('/me/room-request', { method: 'DELETE' })).status, 401);
        assert.equal((await t.api('/me/room-request', { method: 'DELETE', token: await t.login(SEED.supervisor) })).status, 403);

        assert.equal((await t.api('/me/room-request', { method: 'DELETE', token })).status, 204);
        assert.equal((await t.api('/me/room-request', { token })).data.request, null);
        assert.ok(!(await queue()).includes(id));
        assert.equal((await t.api('/me/room-request', { method: 'DELETE', token })).status, 404, 'nothing left to withdraw');
        const audited = await t.sql("SELECT COUNT(*)::int AS n FROM audit_log WHERE action = 'allotment.withdraw' AND target_id = $1", [id]);
        assert.equal(audited.rows[0].n, 1);

        // Asking again after a withdrawal is allowed.
        const again = await t.api('/me/room-request', { method: 'POST', token, body: { block_id: 'B_BLOCK', floor_number: 2, room_id: 'B-202' } });
        assert.equal(again.status, 201);
    });

    it('a student with a room cannot request another one', async () => {
        const token = await t.login(SEED.student);
        const r = await t.api('/me/room-request', { method: 'POST', token, body: { block_id: 'B_BLOCK', floor_number: 2, room_id: 'B-202' } });
        assert.equal(r.status, 409);
    });
});
