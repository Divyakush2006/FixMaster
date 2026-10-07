const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { resetDatabase, startApp, SEED } = require('./helpers');

/**
 * The closed loop is the core product guarantee:
 *   raise -> dispatch -> (start) -> done -> verified by the raiser -> closed,
 *   or rejected -> escalated -> re-dispatched -> ... -> closed.
 */
describe('complaint lifecycle (closed loop)', () => {
    let t;
    let ids;

    before(async () => {
        await resetDatabase();
        t = await startApp();
        const { rows } = await t.sql(
            `SELECT reg_or_emp_id, user_id FROM users WHERE reg_or_emp_id IN ($1,$2,$3,$4,$5)`,
            [SEED.electrician, SEED.cleaner1, SEED.cleaner2, SEED.plumber, SEED.supervisor]
        );
        ids = Object.fromEntries(rows.map((r) => [r.reg_or_emp_id, r.user_id]));
    });
    after(async () => t && t.close());

    async function raise(token, subcategory_id, extra = {}) {
        const r = await t.api('/complaints', {
            method: 'POST',
            token,
            body: { ticket_scope: 'ROOM', block_id: 'L_BLOCK', room_id: 'L-843', subcategory_id, ...extra },
        });
        assert.equal(r.status, 201, JSON.stringify(r.data));
        return r.data.complaint.complaint_id;
    }
    const status = async (complaintId) =>
        (await t.sql('SELECT status FROM complaints WHERE complaint_id = $1', [complaintId])).rows[0].status;
    async function taskFor(token, complaintId) {
        const q = await t.api('/dispatch/queue', { token });
        return q.data.find((x) => x.complaint_id === complaintId);
    }

    it('runs the happy path end to end with a full, attributed audit trail', async () => {
        const student = await t.login(SEED.student);
        const sup = await t.login(SEED.supervisor);
        const elec = await t.login(SEED.electrician);

        const cid = await raise(student, SEED.sub.tubeLight);
        assert.equal((await t.api('/dispatch/assign', { method: 'POST', token: sup, body: { complaint_id: cid, staff_user_id: ids[SEED.electrician] } })).status, 200);

        const task = await taskFor(elec, cid);
        assert.ok(task, 'assigned task appears in the technician queue');
        assert.equal((await t.api(`/dispatch/tasks/${task.assignment_id}/start`, { method: 'PATCH', token: elec })).status, 200);
        assert.equal(await status(cid), 'IN_PROGRESS');
        assert.equal((await t.api(`/dispatch/tasks/${task.assignment_id}`, { method: 'PATCH', token: elec })).status, 200);
        assert.equal(await status(cid), 'PENDING_VERIFICATION');

        const fb = await t.api('/feedback', { method: 'POST', token: student, body: { complaint_id: cid, is_satisfied: true, rating: 5 } });
        assert.equal(fb.status, 200);
        assert.equal(await status(cid), 'COMPLETED');

        const logs = (await t.api(`/complaints/${cid}/logs`, { token: student })).data;
        assert.deepEqual(
            logs.map((l) => l.new_status),
            ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'PENDING_VERIFICATION', 'COMPLETED']
        );
        assert.ok(logs.every((l) => l.changed_by_name), 'every transition is attributed to a person');
    });

    it('cannot be closed by feedback before the work is done (closed-loop bypass)', async () => {
        const student = await t.login(SEED.student);
        const cid = await raise(student, SEED.sub.fan);
        const r = await t.api('/feedback', { method: 'POST', token: student, body: { complaint_id: cid, is_satisfied: true, rating: 5 } });
        assert.equal(r.status, 409);
        assert.equal(await status(cid), 'OPEN');
    });

    it('only the person who raised a ticket can verify it', async () => {
        const student = await t.login(SEED.student);
        const other = await t.login(SEED.student2);
        const sup = await t.login(SEED.supervisor);
        const plumber = await t.login(SEED.plumber);
        const cid = await raise(student, SEED.sub.tap);
        await t.api('/dispatch/assign', { method: 'POST', token: sup, body: { complaint_id: cid, staff_user_id: ids[SEED.plumber] } });
        const task = await taskFor(plumber, cid);
        await t.api(`/dispatch/tasks/${task.assignment_id}`, { method: 'PATCH', token: plumber });

        const r = await t.api('/feedback', { method: 'POST', token: other, body: { complaint_id: cid, is_satisfied: true } });
        assert.equal(r.status, 403);
        assert.equal(await status(cid), 'PENDING_VERIFICATION');
    });

    it('a rejected ticket can be reworked by another technician and then closed', async () => {
        const student = await t.login(SEED.student);
        const admin = await t.login(SEED.admin);
        const sup = await t.login(SEED.supervisor);
        const elec1 = await t.login(SEED.electrician);

        const created = await t.api('/admin/users', {
            method: 'POST',
            token: admin,
            body: { reg_or_emp_id: 'EMP_ELEC_99', full_name: 'Second Electrician', email: 'elec99@example.com', phone_number: '9000000099', password: 'Test@12345', role: 'STAFF', specialization: 'ELECTRICIAN' },
        });
        assert.equal(created.status, 201);
        const elec2 = await t.login('EMP_ELEC_99', 'Test@12345');

        const cid = await raise(student, SEED.sub.mcb);
        await t.api('/dispatch/assign', { method: 'POST', token: sup, body: { complaint_id: cid, staff_user_id: ids[SEED.electrician] } });
        const first = await taskFor(elec1, cid);
        await t.api(`/dispatch/tasks/${first.assignment_id}`, { method: 'PATCH', token: elec1 });

        const reject = await t.api('/feedback', { method: 'POST', token: student, body: { complaint_id: cid, is_satisfied: false, comments: 'still sparking' } });
        assert.equal(reject.status, 200);
        assert.equal(await status(cid), 'ESCALATED');
        const { rows: esc } = await t.sql('SELECT resolved_at FROM complaints WHERE complaint_id = $1', [cid]);
        assert.equal(esc[0].resolved_at, null, 'rejected work is not counted as resolved');

        const reassign = await t.api('/dispatch/assign', { method: 'POST', token: sup, body: { complaint_id: cid, staff_user_id: created.data.user.user_id } });
        assert.equal(reassign.status, 200);

        // The first technician must not still see the ticket as live work.
        assert.equal(await taskFor(elec1, cid), undefined);

        const second = await taskFor(elec2, cid);
        assert.ok(second);
        await t.api(`/dispatch/tasks/${second.assignment_id}`, { method: 'PATCH', token: elec2 });
        const accept = await t.api('/feedback', { method: 'POST', token: student, body: { complaint_id: cid, is_satisfied: true, rating: 4 } });
        assert.equal(accept.status, 200, JSON.stringify(accept.data));
        assert.equal(await status(cid), 'COMPLETED');

        const { rows: rounds } = await t.sql('SELECT is_satisfactorily_resolved FROM complaint_feedback WHERE complaint_id = $1 ORDER BY feedback_id', [cid]);
        assert.deepEqual(rounds.map((r) => r.is_satisfactorily_resolved), [false, true]);

        // KPI view must count this complaint once, not once per feedback round.
        const kpi = (await t.api('/analytics/kpi', { token: sup })).data.find((b) => b.block_id === 'L_BLOCK');
        const { rows: actual } = await t.sql("SELECT COUNT(*)::int AS n FROM complaints WHERE block_id = 'L_BLOCK'");
        assert.equal(Number(kpi.total_complaints), actual[0].n);
    });

    it('a ticket raised by a supervisor can be verified and closed by that supervisor', async () => {
        const sup = await t.login(SEED.supervisor);
        const elec = await t.login(SEED.electrician);
        const r = await t.api('/complaints', {
            method: 'POST',
            token: sup,
            body: { ticket_scope: 'COMMON_AREA', block_id: 'L_BLOCK', common_area_id: 'L-ELEVATOR-01', subcategory_id: 24 },
        });
        assert.equal(r.status, 201);
        const cid = r.data.complaint.complaint_id;
        await t.api('/dispatch/assign', { method: 'POST', token: sup, body: { complaint_id: cid, staff_user_id: ids[SEED.electrician] } });
        const task = await taskFor(elec, cid);
        await t.api(`/dispatch/tasks/${task.assignment_id}`, { method: 'PATCH', token: elec });
        const fb = await t.api('/feedback', { method: 'POST', token: sup, body: { complaint_id: cid, is_satisfied: true, rating: 5 } });
        assert.equal(fb.status, 200);
        assert.equal(await status(cid), 'COMPLETED');
    });

    it('a technician cannot act on another technician\'s task (IDOR)', async () => {
        const student = await t.login(SEED.student2);
        const sup = await t.login(SEED.supervisor);
        const cleaner = await t.login(SEED.cleaner1);
        const elec = await t.login(SEED.electrician);
        const r = await t.api('/complaints', { method: 'POST', token: student, body: { ticket_scope: 'ROOM', block_id: 'L_BLOCK', room_id: 'L-810', subcategory_id: SEED.sub.trash } });
        const cid = r.data.complaint.complaint_id;
        const d = await t.api('/dispatch/auto-dispatch', { method: 'POST', token: sup, body: { complaint_id: cid } });
        assert.equal(d.data.assigned, true);
        const { rows } = await t.sql('SELECT assignment_id, staff_user_id FROM complaint_assignments WHERE complaint_id = $1', [cid]);
        const ownerToken = rows[0].staff_user_id === ids[SEED.cleaner1] ? cleaner : await t.login(SEED.cleaner2);

        assert.equal((await t.api(`/dispatch/tasks/${rows[0].assignment_id}`, { method: 'PATCH', token: elec })).status, 403);
        assert.equal((await t.api(`/dispatch/tasks/${rows[0].assignment_id}/start`, { method: 'PATCH', token: elec })).status, 403);
        assert.equal((await t.api(`/dispatch/tasks/${rows[0].assignment_id}`, { method: 'PATCH', token: ownerToken })).status, 200);
        assert.equal((await t.api(`/dispatch/tasks/${rows[0].assignment_id}`, { method: 'PATCH', token: ownerToken })).status, 409, 'cannot complete twice');
    });

    it('rejects assigning a ticket to the wrong trade, a non-staff user, or a closed ticket', async () => {
        const student = await t.login(SEED.student);
        const sup = await t.login(SEED.supervisor);
        const cid = await raise(student, SEED.sub.switchBoard);
        const wrongTrade = await t.api('/dispatch/assign', { method: 'POST', token: sup, body: { complaint_id: cid, staff_user_id: ids[SEED.plumber] } });
        assert.equal(wrongTrade.status, 400);
        assert.match(wrongTrade.data.error, /ELECTRICIAN/);
        const notStaff = await t.api('/dispatch/assign', { method: 'POST', token: sup, body: { complaint_id: cid, staff_user_id: ids[SEED.supervisor] } });
        assert.equal(notStaff.status, 400);
        const missing = await t.api('/dispatch/assign', { method: 'POST', token: sup, body: { complaint_id: 'no-such-complaint', staff_user_id: ids[SEED.electrician] } });
        assert.equal(missing.status, 404);
    });

    it('two simultaneous dispatches of one ticket produce exactly one assignment', async () => {
        const student = await t.login(SEED.student2);
        const sup = await t.login(SEED.supervisor);
        const r = await t.api('/complaints', { method: 'POST', token: student, body: { ticket_scope: 'ROOM', block_id: 'L_BLOCK', room_id: 'L-810', subcategory_id: SEED.sub.fan } });
        const cid = r.data.complaint.complaint_id;
        const [a, b] = await Promise.all([
            t.api('/dispatch/assign', { method: 'POST', token: sup, body: { complaint_id: cid, staff_user_id: ids[SEED.electrician] } }),
            t.api('/dispatch/assign', { method: 'POST', token: sup, body: { complaint_id: cid, staff_user_id: ids[SEED.electrician] } }),
        ]);
        assert.deepEqual([a.status, b.status].sort(), [200, 409]);
        const { rows } = await t.sql('SELECT COUNT(*)::int AS n FROM complaint_assignments WHERE complaint_id = $1', [cid]);
        assert.equal(rows[0].n, 1);
    });

    it('auto-dispatch reports honestly when no cleaner is available, and only takes cleaning tickets', async () => {
        const student = await t.login(SEED.student);
        const sup = await t.login(SEED.supervisor);
        // Seed ticket cmp-843-0002 is an electrical (socket) ticket.
        const wrong = await t.api('/dispatch/auto-dispatch', { method: 'POST', token: sup, body: { complaint_id: 'cmp-843-0002-uuid-000000000002' } });
        assert.equal(wrong.status, 400);
        assert.match(wrong.data.error, /cleaning/i);

        await t.sql("UPDATE users SET is_available = FALSE WHERE specialization = 'CLEANING'");
        try {
            const cid = await raise(student, SEED.sub.dusting);
            const r = await t.api('/dispatch/auto-dispatch', { method: 'POST', token: sup, body: { complaint_id: cid } });
            assert.equal(r.status, 200);
            assert.equal(r.data.assigned, false);
            assert.equal(await status(cid), 'OPEN');
        } finally {
            await t.sql("UPDATE users SET is_available = TRUE WHERE specialization = 'CLEANING'");
        }
    });

    it('staff can go off duty, which takes them out of auto-dispatch', async () => {
        const c1 = await t.login(SEED.cleaner1);
        const c2 = await t.login(SEED.cleaner2);
        const sup = await t.login(SEED.supervisor);
        assert.equal((await t.api('/me/availability', { method: 'PATCH', token: c1, body: { is_available: false } })).status, 200);
        try {
            const student = await t.login(SEED.student2);
            const r = await t.api('/complaints', { method: 'POST', token: student, body: { ticket_scope: 'ROOM', block_id: 'L_BLOCK', room_id: 'L-810', subcategory_id: SEED.sub.dusting } });
            const d = await t.api('/dispatch/auto-dispatch', { method: 'POST', token: sup, body: { complaint_id: r.data.complaint.complaint_id } });
            assert.equal(d.data.staff_user_id, ids[SEED.cleaner2]);
            assert.ok(await taskFor(c2, r.data.complaint.complaint_id));
        } finally {
            await t.api('/me/availability', { method: 'PATCH', token: c1, body: { is_available: true } });
        }
        const student = await t.login(SEED.student);
        assert.equal((await t.api('/me/availability', { method: 'PATCH', token: student, body: { is_available: false } })).status, 403);
    });
});
