const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { Client } = require('pg');
const { resetDatabase, startApp, SEED, TEST_DB_URL } = require('./helpers');

/**
 * Room-centric tickets and concurrency (migrations 007-008).
 *
 * The room (or common area) is the unit of a ticket: one live ticket per
 * location and issue, shared by everyone who reports it. The concurrency
 * tests fire genuinely simultaneous requests and assert on outcomes that
 * must hold whatever the interleaving.
 */
describe('room-centric tickets', () => {
    let t;
    let ids;

    before(async () => {
        await resetDatabase();
        t = await startApp();
        const { rows } = await t.sql('SELECT reg_or_emp_id, user_id FROM users');
        ids = Object.fromEntries(rows.map((r) => [r.reg_or_emp_id, r.user_id]));
    });
    after(async () => t && t.close());

    const room = (room_id, subcategory_id, extra = {}) => ({ ticket_scope: 'ROOM', block_id: 'L_BLOCK', room_id, subcategory_id, ...extra });
    const area = (common_area_id, subcategory_id) => ({ ticket_scope: 'COMMON_AREA', block_id: 'L_BLOCK', common_area_id, subcategory_id });
    const file = async (who, body) => t.api('/complaints', { method: 'POST', token: await t.login(who), body });
    const reporters = async (complaintId) =>
        (await t.sql('SELECT user_id FROM complaint_reporters WHERE complaint_id = $1 ORDER BY user_id', [complaintId])).rows.map((r) => r.user_id);
    const ticket = async (complaintId) => (await t.sql('SELECT * FROM complaints WHERE complaint_id = $1', [complaintId])).rows[0];
    const liveCount = async (roomId, sub) =>
        (
            await t.sql(
                `SELECT COUNT(*)::int AS n FROM complaints WHERE room_id = $1 AND subcategory_id = $2
                 AND status IN ('OPEN','ASSIGNED','IN_PROGRESS','PENDING_VERIFICATION','ESCALATED')`,
                [roomId, sub]
            )
        ).rows[0].n;

    /** Dispatch -> start -> done, leaving the ticket PENDING_VERIFICATION. */
    async function workDone(complaintId, techId, staffUserId) {
        const sup = await t.login(SEED.supervisor);
        const a = await t.api('/dispatch/assign', { method: 'POST', token: sup, body: { complaint_id: complaintId, staff_user_id: staffUserId } });
        assert.equal(a.status, 200, JSON.stringify(a.data));
        const tech = await t.login(techId);
        const task = (await t.api('/dispatch/queue', { token: tech })).data.find((x) => x.complaint_id === complaintId);
        assert.equal((await t.api(`/dispatch/tasks/${task.assignment_id}`, { method: 'PATCH', token: tech })).status, 200);
    }

    describe('one live ticket per room and issue', () => {
        it('two roommates asking at the same instant produce exactly one ticket they share', async () => {
            const [a, b] = await Promise.all([
                file(SEED.student, room('L-843', SEED.sub.dusting)),
                file(SEED.roommate1, room('L-843', SEED.sub.dusting)),
            ]);
            assert.deepEqual([a.status, b.status].sort(), [200, 201], JSON.stringify([a.data, b.data]));
            const joined = a.status === 200 ? a : b;
            const created = a.status === 201 ? a : b;
            assert.equal(joined.data.joined, true);
            assert.equal(joined.data.complaint.complaint_id, created.data.complaint.complaint_id);
            assert.equal(await liveCount('L-843', SEED.sub.dusting), 1);
            assert.deepEqual(await reporters(created.data.complaint.complaint_id), [ids[SEED.student], ids[SEED.roommate1]].sort());

            const logs = await t.api(`/complaints/${created.data.complaint.complaint_id}/logs`, { token: await t.login(SEED.student) });
            const joinEntry = logs.data.find((l) => /^Also reported/.test(l.action_note || ''));
            assert.ok(joinEntry, 'the join is in the ticket history');
            assert.ok(['Vihaan Sharma', 'Karan Mehta'].includes(joinEntry.changed_by_name), 'attributed to the roommate who joined');
        });

        it('a storm of simultaneous requests from three roommates still yields one ticket, three reporters and no errors', async () => {
            const who = [SEED.student, SEED.roommate1, SEED.roommate2];
            const results = await Promise.all(
                Array.from({ length: 15 }, (_, i) => file(who[i % 3], room('L-843', SEED.sub.fan, { description: `attempt ${i}` })))
            );
            const statuses = results.map((r) => r.status);
            assert.ok(statuses.every((s) => [200, 201, 409].includes(s)), `no server errors: ${statuses}`);
            assert.equal(statuses.filter((s) => s === 201).length, 1);
            assert.equal(statuses.filter((s) => s === 200).length, 2);
            assert.ok(results.filter((r) => r.status === 409).every((r) => r.data.code === 'ALREADY_REPORTED'));
            assert.equal(await liveCount('L-843', SEED.sub.fan), 1);
            const id = results.find((r) => r.status === 201).data.complaint.complaint_id;
            assert.equal((await reporters(id)).length, 3);
        });

        it('a roommate asking for a service already in progress joins that ticket', async () => {
            // Seed: Vihaan's room cleaning in L-843 is IN_PROGRESS.
            const r = await file(SEED.roommate2, room('L-843', SEED.sub.roomCleaning));
            assert.equal(r.status, 200);
            assert.equal(r.data.complaint.complaint_id, 'cmp-843-0001-uuid-000000000001');
            assert.equal(r.data.complaint.status, 'IN_PROGRESS');
        });

        it('reporting the same thing twice is refused with the ticket reference', async () => {
            const r = await file(SEED.student, room('L-843', SEED.sub.roomCleaning));
            assert.equal(r.status, 409);
            assert.equal(r.data.code, 'ALREADY_REPORTED');
            assert.match(r.data.error, /TKT-000001/);
        });

        it('different issues in the same room stay separate tickets', async () => {
            const r = await file(SEED.roommate1, room('L-843', SEED.sub.tubeLight));
            assert.equal(r.status, 201);
            assert.equal(r.data.joined, false);
        });

        it('the database itself refuses a second live ticket for the same room and issue', async () => {
            await assert.rejects(
                t.sql(
                    `INSERT INTO complaints (ticket_scope, room_id, block_id, raised_by_user_id, subcategory_id)
                     VALUES ('ROOM', 'L-843', 'L_BLOCK', $1, $2)`,
                    [ids[SEED.student], SEED.sub.tubeLight]
                ),
                (err) => err.code === '23505' && err.constraint === 'uq_live_room_issue'
            );
        });
    });

    describe('roommates share visibility and verification', () => {
        let shared;

        before(async () => {
            const r = await file(SEED.student, room('L-843', SEED.sub.switchBoard));
            assert.equal(r.status, 201);
            shared = r.data.complaint.complaint_id;
        });

        it('a roommate who did not report it still sees the room ticket; other students do not', async () => {
            const mate = await t.login(SEED.roommate2);
            const list = await t.api('/complaints', { token: mate });
            assert.ok(list.data.some((c) => c.complaint_id === shared));
            const detail = await t.api(`/complaints/${shared}`, { token: mate });
            assert.equal(detail.status, 200);
            assert.equal(detail.data.is_reporter, false);
            assert.equal(detail.data.is_room_resident, true);
            assert.deepEqual(detail.data.reporters.map((r) => r.name), ['Vihaan Sharma']);

            const outsider = await t.login(SEED.student2);
            assert.equal((await t.api(`/complaints/${shared}`, { token: outsider })).status, 403);
            assert.ok(!(await t.api('/complaints', { token: outsider })).data.some((c) => c.complaint_id === shared));
        });

        it('any resident can confirm the work; when two answer at once the second is told who answered', async () => {
            await workDone(shared, SEED.electrician, ids[SEED.electrician]);
            const mate = await t.login(SEED.roommate2);
            const detail = await t.api(`/complaints/${shared}`, { token: mate });
            assert.equal(detail.data.can_verify, true);

            const [x, y] = await Promise.all([
                t.api('/feedback', { method: 'POST', token: mate, body: { complaint_id: shared, is_satisfied: true, rating: 5 } }),
                t.api('/feedback', { method: 'POST', token: await t.login(SEED.roommate1), body: { complaint_id: shared, is_satisfied: true, rating: 4 } }),
            ]);
            assert.deepEqual([x.status, y.status].sort(), [200, 409]);
            const loser = x.status === 409 ? x : y;
            assert.match(loser.data.error, /already confirmed by (Rohan Das|Karan Mehta)/);
            const done = await ticket(shared);
            assert.equal(done.status, 'COMPLETED');
            assert.equal(done.closure_reason, 'CONFIRMED');
        });

        it('someone who moved out keeps read access but can no longer confirm', async () => {
            const r = await file(SEED.roommate1, room('L-843', SEED.sub.mcb));
            const id = r.data.complaint.complaint_id;
            await workDone(id, SEED.electrician, ids[SEED.electrician]);

            const admin = await t.login(SEED.admin);
            const move = await t.api('/admin/allotments', {
                method: 'POST',
                token: admin,
                body: { student_id: ids[SEED.roommate1], room_id: 'L-810', academic_year: '2026-2027' },
            });
            assert.equal(move.status, 201, JSON.stringify(move.data));

            const mover = await t.login(SEED.roommate1);
            const view = await t.api(`/complaints/${id}`, { token: mover });
            assert.equal(view.status, 200);
            assert.equal(view.data.can_verify, false);
            const fb = await t.api('/feedback', { method: 'POST', token: mover, body: { complaint_id: id, is_satisfied: true, rating: 5 } });
            assert.equal(fb.status, 403);
            assert.match(fb.data.error, /no longer live in this room/);

            // A current resident can.
            const ok = await t.api('/feedback', {
                method: 'POST',
                token: await t.login(SEED.student),
                body: { complaint_id: id, is_satisfied: true, rating: 5 },
            });
            assert.equal(ok.status, 200);
        });

        it("a new resident does not see the previous occupants' closed tickets", async () => {
            await t.sql(
                `INSERT INTO complaints (complaint_id, ticket_scope, room_id, block_id, raised_by_user_id, subcategory_id, status, created_at, closed_at)
                 VALUES ('old-l843-history-0000000000000001', 'ROOM', 'L-843', 'L_BLOCK', $1, $2, 'COMPLETED',
                         CURRENT_TIMESTAMP - INTERVAL '200 days', CURRENT_TIMESTAMP - INTERVAL '199 days')`,
                [ids[SEED.student], SEED.sub.tap]
            );
            const mate = await t.login(SEED.roommate2);
            assert.equal((await t.api('/complaints/old-l843-history-0000000000000001', { token: mate })).status, 403);
            // The person who reported it still has it in their history.
            assert.equal((await t.api('/complaints/old-l843-history-0000000000000001', { token: await t.login(SEED.student) })).status, 200);
        });
    });

    describe('common areas', () => {
        it('many reporters share one ticket; at five its priority goes up one level; only reporters confirm', async () => {
            const who = [SEED.student, SEED.roommate2, SEED.student2, SEED.student3, SEED.roommate1];
            const first = await file(who[0], area('L-F08-WASHROOM-01', SEED.sub.corridorLight));
            assert.equal(first.status, 201);
            const id = first.data.complaint.complaint_id;
            assert.equal(first.data.complaint.priority, 'MEDIUM');
            for (const w of who.slice(1)) {
                const r = await file(w, area('L-F08-WASHROOM-01', SEED.sub.corridorLight));
                assert.equal(r.status, 200);
                assert.equal(r.data.complaint.complaint_id, id);
            }
            const after5 = await ticket(id);
            assert.equal(after5.priority, 'HIGH');
            assert.equal((await reporters(id)).length, 5);

            const studentView = await t.api(`/complaints/${id}`, { token: await t.login(SEED.student2) });
            assert.equal(studentView.data.reporter_count, 5);
            assert.equal(studentView.data.reporters, undefined, 'students see a count, not names, for common areas');

            await workDone(id, SEED.electrician, ids[SEED.electrician]);
            const outsider = await t.api('/feedback', {
                method: 'POST',
                token: await t.login(SEED.student4),
                body: { complaint_id: id, is_satisfied: true, rating: 5 },
            });
            assert.equal(outsider.status, 403);
            const ok = await t.api('/feedback', {
                method: 'POST',
                token: await t.login(SEED.student2),
                body: { complaint_id: id, is_satisfied: true, rating: 4 },
            });
            assert.equal(ok.status, 200);
        });
    });

    describe('withdraw, reject and merge', () => {
        it('the last reporter withdrawing cancels the ticket; with others on it, only they are removed', async () => {
            const a = await file(SEED.student2, room('L-810', SEED.sub.trash));
            const id = a.data.complaint.complaint_id;
            const w = await t.api(`/complaints/${id}/withdraw`, { method: 'POST', token: await t.login(SEED.student2) });
            assert.equal(w.status, 200);
            assert.equal(w.data.cancelled, true);
            const c = await ticket(id);
            assert.equal(c.status, 'CANCELLED');
            assert.equal(c.closure_reason, 'WITHDRAWN');
            assert.ok(c.closed_at);

            // A cancelled ticket no longer blocks a new request for the same thing.
            assert.equal((await file(SEED.student2, room('L-810', SEED.sub.trash))).status, 201);

            const shared = await file(SEED.student, room('L-843', SEED.sub.tap));
            const sid = shared.data.complaint.complaint_id;
            assert.equal((await file(SEED.roommate2, room('L-843', SEED.sub.tap))).status, 200);
            const w2 = await t.api(`/complaints/${sid}/withdraw`, { method: 'POST', token: await t.login(SEED.student) });
            assert.equal(w2.data.cancelled, false);
            assert.equal((await ticket(sid)).status, 'OPEN');
            assert.deepEqual(await reporters(sid), [ids[SEED.roommate2]]);
        });

        it('cannot be withdrawn once a technician is assigned, or by someone who did not report it', async () => {
            const r = await file(SEED.student, room('L-843', SEED.sub.trash));
            const id = r.data.complaint.complaint_id;
            assert.equal((await t.api(`/complaints/${id}/withdraw`, { method: 'POST', token: await t.login(SEED.roommate2) })).status, 403);
            const sup = await t.login(SEED.supervisor);
            await t.api('/dispatch/auto-dispatch', { method: 'POST', token: sup, body: { complaint_id: id } });
            const w = await t.api(`/complaints/${id}/withdraw`, { method: 'POST', token: await t.login(SEED.student) });
            assert.equal(w.status, 409);
        });

        it('a supervisor can reject an invalid ticket with a reason; it leaves the technician queue', async () => {
            const r = await file(SEED.student3, room('L-825', SEED.sub.socket));
            const id = r.data.complaint.complaint_id;
            const sup = await t.login(SEED.supervisor);
            await t.api('/dispatch/assign', { method: 'POST', token: sup, body: { complaint_id: id, staff_user_id: ids[SEED.electrician2] } });
            const tech = await t.login(SEED.electrician2);
            const task = (await t.api('/dispatch/queue', { token: tech })).data.find((x) => x.complaint_id === id);

            assert.equal((await t.api(`/complaints/${id}/reject`, { method: 'POST', token: sup, body: { reason: 'no' } })).status, 400);
            assert.equal(
                (await t.api(`/complaints/${id}/reject`, { method: 'POST', token: await t.login(SEED.student3), body: { reason: 'Changed my mind' } })).status,
                403
            );
            const rej = await t.api(`/complaints/${id}/reject`, { method: 'POST', token: sup, body: { reason: 'Socket is outside the hostel scope' } });
            assert.equal(rej.status, 200);
            const c = await ticket(id);
            assert.equal(c.status, 'REJECTED');
            assert.equal(c.closure_reason, 'INVALID');
            assert.equal(c.closure_note, 'Socket is outside the hostel scope');
            assert.ok(!(await t.api('/dispatch/queue', { token: tech })).data.some((x) => x.complaint_id === id));
            const late = await t.api(`/dispatch/tasks/${task.assignment_id}`, { method: 'PATCH', token: tech });
            assert.equal(late.status, 409);
            assert.equal(late.data.code, 'TASK_REASSIGNED');
            const audit = await t.sql("SELECT 1 FROM audit_log WHERE action = 'ticket.reject' AND target_id = $1", [id]);
            assert.equal(audit.rows.length, 1);
        });

        it('a supervisor can merge a duplicate at the same location; reporters move over', async () => {
            const a = await file(SEED.student3, room('L-825', SEED.sub.tubeLight));
            const b = await file(SEED.student3, room('L-825', SEED.sub.switchBoard));
            const other = await file(SEED.student2, room('L-810', SEED.sub.tubeLight));
            const sup = await t.login(SEED.supervisor);
            const [aid, bid] = [a.data.complaint.complaint_id, b.data.complaint.complaint_id];

            const related = await t.api(`/complaints/${aid}/related`, { token: sup });
            assert.deepEqual(related.data.map((c) => c.complaint_id), [bid]);

            assert.equal((await t.api(`/complaints/${aid}/merge`, { method: 'POST', token: sup, body: { target_id: aid } })).status, 400);
            assert.equal(
                (await t.api(`/complaints/${aid}/merge`, { method: 'POST', token: sup, body: { target_id: other.data.complaint.complaint_id } })).status,
                400
            );
            const m = await t.api(`/complaints/${bid}/merge`, { method: 'POST', token: sup, body: { target_id: aid } });
            assert.equal(m.status, 200, JSON.stringify(m.data));
            const merged = await ticket(bid);
            assert.equal(merged.status, 'REJECTED');
            assert.equal(merged.closure_reason, 'DUPLICATE');
            assert.equal(merged.merged_into_id, aid);
            const detail = await t.api(`/complaints/${bid}`, { token: await t.login(SEED.student3) });
            assert.match(detail.data.merged_into_ref, /^TKT-/);
            // Merging into a closed ticket is refused.
            assert.equal((await t.api(`/complaints/${aid}/merge`, { method: 'POST', token: sup, body: { target_id: bid } })).status, 409);
        });

        it('withdrawn and merged tickets do not inflate block totals', async () => {
            const view = await t.sql(
                `SELECT total_complaints FROM view_block_supervisor_summary WHERE block_id = 'L_BLOCK'`
            );
            const real = await t.sql(
                `SELECT COUNT(*)::int AS n FROM complaints
                 WHERE block_id = 'L_BLOCK' AND status <> 'CANCELLED' AND closure_reason IS DISTINCT FROM 'DUPLICATE'`
            );
            assert.equal(Number(view.rows[0].total_complaints), real.rows[0].n);
        });
    });

    describe('tickets nobody verifies', () => {
        it('auto-close after the configured hours, with a clear history entry and no rating', async () => {
            const { sweepOnce } = require('../src/services/verificationSweeper');
            const r = await file(SEED.student3, room('L-825', SEED.sub.fan));
            const stale = r.data.complaint.complaint_id;
            await workDone(stale, SEED.electrician3, ids[SEED.electrician3]);
            await t.sql("UPDATE complaints SET resolved_at = CURRENT_TIMESTAMP - INTERVAL '73 hours' WHERE complaint_id = $1", [stale]);

            const closed = await sweepOnce();
            assert.ok(closed >= 1);
            const c = await ticket(stale);
            assert.equal(c.status, 'COMPLETED');
            assert.equal(c.closure_reason, 'AUTO_CONFIRMED');
            const logs = await t.sql('SELECT action_note FROM complaint_logs WHERE complaint_id = $1 ORDER BY log_id DESC LIMIT 1', [stale]);
            assert.match(logs.rows[0].action_note, /Closed automatically/);
            // Seed: L-810's repair was marked done 30 minutes ago - untouched.
            assert.equal((await ticket('cmp-810-0001-uuid-000000000003')).status, 'PENDING_VERIFICATION');

            const late = await t.api('/feedback', { method: 'POST', token: await t.login(SEED.student3), body: { complaint_id: stale, is_satisfied: true, rating: 5 } });
            assert.equal(late.status, 409);
            assert.match(late.data.error, /already closed/);
        });
    });

    describe('dispatch under concurrency', () => {
        it('two supervisors assigning the same ticket at once: one wins, the other is told who did', async () => {
            const r = await file(SEED.student2, room('L-810', SEED.sub.socket));
            const id = r.data.complaint.complaint_id;
            const sup = await t.login(SEED.supervisor);
            const admin = await t.login(SEED.admin);
            const [x, y] = await Promise.all([
                t.api('/dispatch/assign', { method: 'POST', token: sup, body: { complaint_id: id, staff_user_id: ids[SEED.electrician], expected_assignee_id: null } }),
                t.api('/dispatch/assign', { method: 'POST', token: admin, body: { complaint_id: id, staff_user_id: ids[SEED.electrician2], expected_assignee_id: null } }),
            ]);
            assert.deepEqual([x.status, y.status].sort(), [200, 409]);
            const loser = x.status === 409 ? x : y;
            assert.equal(loser.data.code, 'STALE_ASSIGNMENT');
            assert.match(loser.data.error, /was just assigned to (Suresh Kumar|Manikandan R)/);
            const live = await t.sql(
                "SELECT COUNT(*)::int AS n FROM complaint_assignments WHERE complaint_id = $1 AND current_state = 'ASSIGNED'",
                [id]
            );
            assert.equal(live.rows[0].n, 1);
        });

        it('a deliberate reassignment from an up-to-date screen still works', async () => {
            const r = await file(SEED.student2, room('L-810', SEED.sub.switchBoard));
            const id = r.data.complaint.complaint_id;
            const sup = await t.login(SEED.supervisor);
            await t.api('/dispatch/assign', { method: 'POST', token: sup, body: { complaint_id: id, staff_user_id: ids[SEED.electrician], expected_assignee_id: null } });
            const re = await t.api('/dispatch/assign', {
                method: 'POST',
                token: sup,
                body: { complaint_id: id, staff_user_id: ids[SEED.electrician3], expected_assignee_id: ids[SEED.electrician] },
            });
            assert.equal(re.status, 200, JSON.stringify(re.data));
        });

        it('assigning an off-duty technician needs explicit confirmation', async () => {
            const r = await file(SEED.student2, room('L-810', SEED.sub.tap));
            const id = r.data.complaint.complaint_id;
            await t.sql('UPDATE users SET is_available = FALSE WHERE user_id = $1', [ids[SEED.plumber2]]);
            try {
                const sup = await t.login(SEED.supervisor);
                const refused = await t.api('/dispatch/assign', { method: 'POST', token: sup, body: { complaint_id: id, staff_user_id: ids[SEED.plumber2] } });
                assert.equal(refused.status, 409);
                assert.equal(refused.data.code, 'STAFF_OFF_DUTY');
                const ok = await t.api('/dispatch/assign', {
                    method: 'POST',
                    token: sup,
                    body: { complaint_id: id, staff_user_id: ids[SEED.plumber2], allow_off_duty: true },
                });
                assert.equal(ok.status, 200);
            } finally {
                await t.sql('UPDATE users SET is_available = TRUE WHERE user_id = $1', [ids[SEED.plumber2]]);
            }
        });

        it('cleaning tickets auto-dispatched at the same instant go to different cleaners', async () => {
            const a = await file(SEED.student2, room('L-810', SEED.sub.roomCleaning));
            const b = await file(SEED.student3, room('L-825', SEED.sub.roomCleaning));
            const sup = await t.login(SEED.supervisor);
            const [x, y] = await Promise.all([
                t.api('/dispatch/auto-dispatch', { method: 'POST', token: sup, body: { complaint_id: a.data.complaint.complaint_id } }),
                t.api('/dispatch/auto-dispatch', { method: 'POST', token: sup, body: { complaint_id: b.data.complaint.complaint_id } }),
            ]);
            assert.equal(x.data.assigned, true);
            assert.equal(y.data.assigned, true);
            assert.notEqual(x.data.staff_user_id, y.data.staff_user_id);
        });

        it('no deadlock: a technician finishing a job while a supervisor reassigns it', async () => {
            // Deterministic reproduction of the old lock-order inversion. A
            // separate connection plays the supervisor: it locks the ticket,
            // then updates the assignment. The technician's request arrives in
            // between. Before the fix the technician held the assignment lock
            // and waited for the ticket -> PostgreSQL killed one side
            // (deadlock_detected, a 500 for the user). Now the technician waits
            // for the ticket first, holding nothing, so the supervisor
            // finishes and the technician gets a clear 409.
            const r = await file(SEED.student2, room('L-810', SEED.sub.mcb));
            const id = r.data.complaint.complaint_id;
            const sup = await t.login(SEED.supervisor);
            await t.api('/dispatch/assign', { method: 'POST', token: sup, body: { complaint_id: id, staff_user_id: ids[SEED.electrician] } });
            const tech = await t.login(SEED.electrician);
            const task = (await t.api('/dispatch/queue', { token: tech })).data.find((x) => x.complaint_id === id);

            const other = new Client({ connectionString: TEST_DB_URL });
            await other.connect();
            try {
                await other.query('BEGIN');
                await other.query("SET LOCAL lock_timeout = '3s'");
                await other.query('SELECT 1 FROM complaints WHERE complaint_id = $1 FOR UPDATE', [id]);
                const techRequest = t.api(`/dispatch/tasks/${task.assignment_id}`, { method: 'PATCH', token: tech });
                await new Promise((resolve) => setTimeout(resolve, 300));
                const started = Date.now();
                await other.query("UPDATE complaint_assignments SET current_state = 'DECLINED' WHERE assignment_id = $1", [task.assignment_id]);
                // Not blocked at all. With the old lock order this waited ~1 s
                // for PostgreSQL's deadlock detector to kill the technician's
                // transaction (which withTransaction then retried).
                assert.ok(Date.now() - started < 250, `the supervisor side was blocked for ${Date.now() - started} ms`);
                await other.query("UPDATE complaints SET status = 'OPEN' WHERE complaint_id = $1", [id]);
                await other.query('COMMIT');
                const res = await techRequest;
                assert.equal(res.status, 409, JSON.stringify(res.data));
                assert.equal(res.data.code, 'TASK_REASSIGNED');
            } finally {
                await other.query('ROLLBACK').catch(() => {});
                await other.end();
            }
        });

        it('reassignments racing technician actions never surface a server error', async () => {
            const sup = await t.login(SEED.supervisor);
            const techs = [SEED.electrician, SEED.electrician2];
            const r = await file(SEED.student3, room('L-825', SEED.sub.mcb));
            const id = r.data.complaint.complaint_id;
            await t.api('/dispatch/assign', { method: 'POST', token: sup, body: { complaint_id: id, staff_user_id: ids[techs[0]] } });
            for (let round = 0; round < 8; round++) {
                const holder = techs[round % 2];
                const next = techs[(round + 1) % 2];
                const token = await t.login(holder);
                const task = (await t.api('/dispatch/queue', { token })).data.find((x) => x.complaint_id === id);
                const [a, b] = await Promise.all([
                    t.api(`/dispatch/tasks/${task.assignment_id}/start`, { method: 'PATCH', token }),
                    t.api('/dispatch/assign', { method: 'POST', token: sup, body: { complaint_id: id, staff_user_id: ids[next] } }),
                ]);
                assert.ok(a.status < 500 && b.status < 500, `round ${round}: ${a.status}/${b.status}`);
                const live = await t.sql(
                    "SELECT staff_user_id FROM complaint_assignments WHERE complaint_id = $1 AND current_state IN ('ASSIGNED','IN_PROGRESS')",
                    [id]
                );
                assert.equal(live.rows.length, 1, 'exactly one live assignment');
                if (live.rows[0].staff_user_id !== ids[next]) {
                    // The start won and the ticket moved on; hand it over explicitly for the next round.
                    await t.api('/dispatch/assign', { method: 'POST', token: sup, body: { complaint_id: id, staff_user_id: ids[next] } });
                }
            }
        });
    });

    describe('going off duty with open jobs', () => {
        it('asks first, then keeps the jobs or hands them back for reassignment', async () => {
            const r = await file(SEED.student2, room('L-810', SEED.sub.fan));
            const id = r.data.complaint.complaint_id;
            const sup = await t.login(SEED.supervisor);
            await t.api('/dispatch/assign', { method: 'POST', token: sup, body: { complaint_id: id, staff_user_id: ids[SEED.electrician3] } });
            const tech = await t.login(SEED.electrician3);
            const open = (await t.api('/dispatch/queue', { token: tech })).data.length;

            const ask = await t.api('/me/availability', { method: 'PATCH', token: tech, body: { is_available: false } });
            assert.equal(ask.status, 409);
            assert.equal(ask.data.code, 'OPEN_JOBS');
            assert.equal(ask.data.details.open_jobs, open);

            const keep = await t.api('/me/availability', { method: 'PATCH', token: tech, body: { is_available: false, release_open_jobs: false } });
            assert.equal(keep.status, 200);
            assert.equal(keep.data.open_jobs, open);
            await t.api('/me/availability', { method: 'PATCH', token: tech, body: { is_available: true } });

            const handBack = await t.api('/me/availability', { method: 'PATCH', token: tech, body: { is_available: false, release_open_jobs: true } });
            assert.equal(handBack.status, 200);
            assert.equal(handBack.data.released_jobs, open);
            assert.equal((await t.api('/dispatch/queue', { token: tech })).data.length, 0);
            assert.equal((await ticket(id)).status, 'OPEN');
            const note = await t.sql("SELECT action_note FROM complaint_logs WHERE complaint_id = $1 AND new_status = 'OPEN' ORDER BY log_id DESC LIMIT 1", [id]);
            assert.match(note.rows[0].action_note, /went off duty/);
            await t.api('/me/availability', { method: 'PATCH', token: tech, body: { is_available: true } });
        });
    });

    describe('transaction safety net', () => {
        it('withTransaction retries a deadlock victim and succeeds', async () => {
            const db = require('../src/config/db');
            let attempts = 0;
            const result = await db.withTransaction(async () => {
                attempts++;
                if (attempts === 1) {
                    const err = new Error('deadlock detected');
                    err.code = '40P01';
                    throw err;
                }
                return 'ok';
            });
            assert.equal(result, 'ok');
            assert.equal(attempts, 2);
        });

        it('a deadlock that persists is reported as a 409 the user can retry, not a 500', () => {
            const { errorHandler } = require('../src/middleware/errorHandler');
            let sent;
            const res = {
                status(code) {
                    sent = { code };
                    return this;
                },
                json(body) {
                    sent.body = body;
                },
            };
            const err = new Error('deadlock detected');
            err.code = '40P01';
            const quiet = console.error;
            console.error = () => {};
            try {
                errorHandler(err, { method: 'PATCH', originalUrl: '/x' }, res, () => {});
            } finally {
                console.error = quiet;
            }
            assert.equal(sent.code, 409);
            assert.equal(sent.body.code, 'CONCURRENT_UPDATE');
        });
    });
});
