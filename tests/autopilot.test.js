const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { resetDatabase, startApp, SEED } = require('./helpers');

// The staff autopilot (migration 013): scoring, the hard rules, recovery
// after a bad experience, AUTO and SUGGEST modes, re-dispatch of rejected
// work, concurrency, scoping, the performance board, comment tags and the
// cleaning round planner.

describe('autopilot: scoring', () => {
    const { rank, normaliseWeights } = require('../src/services/autopilot/scoring');
    const now = new Date('2026-10-27T10:00:00Z');
    const base = { homeBlock: 'L_BLOCK', currentBlock: null, currentFloor: null, liveJobs: 0, lastAssignedAt: '2026-10-27T09:00:00Z', rated: 20, ratingSum: 80, rework: 0, completed: 20, onTime: 18, roomAvgRating: null };
    const ctx = { ticket: { blockId: 'L_BLOCK', floor: 8 }, now, cap: 6, campusMean: 4, recovery: false };

    it('normalises weights to 100', () => {
        const w = normaliseWeights({ quality: 60 });
        assert.equal(Math.round(Object.values(w).reduce((a, b) => a + b, 0)), 100);
        assert.ok(w.quality > normaliseWeights(null).quality);
    });

    it('prefers better ratings, lighter queues, longer idle and nearby staff, and breaks ties by id', () => {
        const ranked = rank(
            [
                { ...base, userId: 'b-good', ratingSum: 96 },
                { ...base, userId: 'a-busy', liveJobs: 5 },
                { ...base, userId: 'c-near', currentBlock: 'L_BLOCK', currentFloor: 8 },
                { ...base, userId: 'd-same' },
                { ...base, userId: 'e-same' },
            ],
            ctx
        );
        assert.equal(ranked[ranked.length - 1].userId, 'a-busy');
        assert.ok(ranked.findIndex((r) => r.userId === 'b-good') < ranked.findIndex((r) => r.userId === 'd-same'));
        assert.ok(ranked.findIndex((r) => r.userId === 'c-near') < ranked.findIndex((r) => r.userId === 'd-same'));
        const tie = ranked.filter((r) => ['d-same', 'e-same'].includes(r.userId)).map((r) => r.userId);
        assert.deepEqual(tie, ['d-same', 'e-same'], 'identical candidates are ordered by id, every time');
        for (const r of ranked) {
            assert.ok(r.score >= 0 && r.score <= 100);
            assert.deepEqual(Object.keys(r.components).sort(), ['idle', 'load', 'proximity', 'quality', 'reliability', 'roomHistory']);
        }
    });

    it('does not let one review make or break a newcomer', () => {
        const [newcomer] = rank([{ ...base, userId: 'n', rated: 1, ratingSum: 1 }], ctx);
        assert.ok(newcomer.components.quality > 0.55, 'one 1-star review barely moves a smoothed 4.0 average');
    });

    it('in recovery mode weighs quality at 50 and keeps only the best-rated quarter', () => {
        const people = [5, 4.8, 4.5, 4.2, 3.9, 3.5, 3.0, 2.5].map((r, i) => ({ ...base, userId: `p${i}`, ratingSum: r * 20 }));
        const ranked = rank(people, { ...ctx, recovery: true });
        assert.equal(ranked[0].weights.quality, 50);
        assert.deepEqual(ranked.map((r) => r.userId), ['p0', 'p1']);
    });
});

describe('autopilot: rules, modes and oversight', () => {
    let t;
    let admin;
    let sup;
    let rahul;
    const ids = {};
    const userId = async (reg) => (await t.sql('SELECT user_id FROM users WHERE reg_or_emp_id = $1', [reg])).rows[0].user_id;
    const cleaners = ['EMP_CLN_01', 'EMP_CLN_02', 'EMP_CLN_03', 'EMP_CLN_04', 'EMP_CLN_05', 'EMP_CLN_06'];
    const setting = (body, token = sup) => t.api('/autopilot/settings', { method: 'PUT', token, body });
    const raiseCleaning = (token, room, sub = SEED.sub.dusting) =>
        t.api('/complaints', { method: 'POST', token, body: { ticket_scope: 'ROOM', block_id: 'L_BLOCK', room_id: room, subcategory_id: sub } });

    /** A finished, verified job, inserted directly so history can be arranged. */
    async function finishedJob({ room, sub, staff, rating, daysAgo = 2, comment = null }) {
        const student = await userId(SEED.student2);
        const c = await t.sql(
            `INSERT INTO complaints (ticket_scope, room_id, block_id, raised_by_user_id, subcategory_id, status, priority, closure_reason,
                                     created_at, resolved_at, closed_at)
             VALUES ('ROOM', $1, 'L_BLOCK', $2, $3, 'COMPLETED', 'LOW', 'CONFIRMED',
                     NOW() - make_interval(days => $4) - INTERVAL '3 hours', NOW() - make_interval(days => $4) - INTERVAL '1 hour', NOW() - make_interval(days => $4))
             RETURNING complaint_id`,
            [room, student, sub, daysAgo]
        );
        const id = c.rows[0].complaint_id;
        await t.sql(
            `INSERT INTO complaint_assignments (complaint_id, staff_user_id, current_state, assigned_at, started_at, work_completed_at)
             VALUES ($1, $2, 'DONE', NOW() - make_interval(days => $3) - INTERVAL '3 hours', NOW() - make_interval(days => $3) - INTERVAL '2 hours',
                     NOW() - make_interval(days => $3) - INTERVAL '1 hour')`,
            [id, staff, daysAgo]
        );
        await t.sql(
            `INSERT INTO complaint_feedback (complaint_id, student_id, is_satisfactorily_resolved, rating, student_comments, verified_at)
             VALUES ($1, $2, TRUE, $3, $4, NOW() - make_interval(days => $5))`,
            [id, student, rating, comment, daysAgo]
        );
        return id;
    }

    before(async () => {
        await resetDatabase();
        t = await startApp();
        admin = await t.login(SEED.admin);
        sup = await t.login(SEED.supervisor);
        rahul = await t.login(SEED.student2);
        for (const c of cleaners) ids[c] = await userId(c);
        // Shifts and blocks are set per test; start everyone in the pool, any hour, on duty.
    });
    beforeEach(async () => {
        await t.sql("UPDATE users SET home_block_id = NULL, shift = NULL, is_available = TRUE WHERE role = 'STAFF'");
        await t.sql('DELETE FROM staff_leave');
        await t.sql('DELETE FROM autopilot_settings');
    });
    after(async () => t && t.close());

    it('ranks every eligible cleaner and explains everyone it leaves out', async () => {
        const r = await raiseCleaning(rahul, 'L-810');
        assert.equal(r.status, 201);
        assert.equal(r.data.complaint.status, 'OPEN', 'SUGGEST is the default: nothing is assigned automatically');
        const ticket = r.data.complaint.complaint_id;

        const { currentShift } = require('../src/services/autopilot');
        const otherShift = currentShift() === 'MORNING' ? 'NIGHT' : 'MORNING';
        await t.sql('UPDATE users SET is_available = FALSE WHERE user_id = $1', [ids.EMP_CLN_02]);
        await t.sql("INSERT INTO staff_leave (staff_user_id, starts_on, ends_on) VALUES ($1, CURRENT_DATE, CURRENT_DATE + 2)", [ids.EMP_CLN_03]);
        await t.sql('UPDATE users SET shift = $2 WHERE user_id = $1', [ids.EMP_CLN_04, otherShift]);

        const s = await t.api(`/autopilot/suggestions/${ticket}`, { token: sup });
        assert.equal(s.status, 200);
        assert.equal(s.data.settings.mode, 'SUGGEST');
        const why = Object.fromEntries(s.data.excluded.map((e) => [e.user_id, e.reason]));
        assert.equal(why[ids.EMP_CLN_02], 'OFF_DUTY');
        assert.equal(why[ids.EMP_CLN_03], 'ON_LEAVE');
        assert.equal(why[ids.EMP_CLN_04], 'OFF_SHIFT');
        const ranked = s.data.candidates.map((c) => c.user_id);
        assert.ok(ranked.length >= 2);
        assert.ok(!ranked.includes(ids.EMP_CLN_02) && !ranked.includes(ids.EMP_CLN_03) && !ranked.includes(ids.EMP_CLN_04));
        assert.ok(s.data.candidates.every((c, i, a) => i === 0 || a[i - 1].score >= c.score));
        await t.api(`/complaints/${ticket}/withdraw`, { method: 'POST', token: rahul });
    });

    it("prefers the block's own staff over the campus pool, and respects the live-job cap", async () => {
        await t.sql("UPDATE users SET home_block_id = 'L_BLOCK' WHERE user_id = ANY($1)", [[ids.EMP_CLN_05, ids.EMP_CLN_06]]);
        const ticket = (await raiseCleaning(rahul, 'L-810', SEED.sub.trash)).data.complaint.complaint_id;
        const s = await t.api(`/autopilot/suggestions/${ticket}`, { token: sup });
        assert.deepEqual(s.data.candidates.map((c) => c.user_id).sort(), [ids.EMP_CLN_05, ids.EMP_CLN_06].sort());
        assert.ok(s.data.excluded.some((e) => e.reason === 'BLOCK_STAFF_AVAILABLE'));

        assert.equal((await setting({ block_id: 'L_BLOCK', specialization: 'CLEANING', mode: 'SUGGEST', live_job_cap: 1 })).status, 200);
        const busy = await t.sql(
            `SELECT a.staff_user_id FROM complaint_assignments a WHERE a.current_state IN ('ASSIGNED','IN_PROGRESS') AND a.staff_user_id = ANY($1)`,
            [cleaners.map((c) => ids[c])]
        );
        const capped = await t.api(`/autopilot/suggestions/${ticket}`, { token: sup });
        for (const row of busy.rows) {
            assert.ok(capped.data.excluded.some((e) => e.user_id === row.staff_user_id && ['AT_CAPACITY', 'BLOCK_STAFF_AVAILABLE'].includes(e.reason)));
        }
        await t.api(`/complaints/${ticket}/withdraw`, { method: 'POST', token: rahul });
    });

    it('keeps a technician away from a room that rated them badly, and switches to recovery mode', async () => {
        await finishedJob({ room: 'L-825', sub: SEED.sub.roomCleaning, staff: ids.EMP_CLN_01, rating: 1, comment: 'came very late and left it dirty' });
        const aditya = await t.login(SEED.student3); // L-825
        const ticket = (await raiseCleaning(aditya, 'L-825', SEED.sub.dusting)).data.complaint.complaint_id;
        const s = await t.api(`/autopilot/suggestions/${ticket}`, { token: sup });
        assert.equal(s.data.recovery, true);
        assert.ok(s.data.excluded.some((e) => e.user_id === ids.EMP_CLN_01 && e.reason === 'BAD_EXPERIENCE_HERE'));
        assert.ok(!s.data.candidates.some((c) => c.user_id === ids.EMP_CLN_01));
        assert.equal(s.data.candidates[0].weights.quality, 50);
        await t.api(`/complaints/${ticket}/withdraw`, { method: 'POST', token: aditya });
    });

    it('assigns automatically on AUTO, records the score, and explains it in the history', async () => {
        assert.equal((await setting({ block_id: 'L_BLOCK', specialization: 'CLEANING', mode: 'AUTO' })).status, 200);
        const r = await raiseCleaning(rahul, 'L-810', SEED.sub.trash);
        assert.equal(r.status, 201);
        assert.equal(r.data.autopilot.assigned, true);
        assert.equal(r.data.complaint.status, 'ASSIGNED');
        const ticket = r.data.complaint.complaint_id;
        const asg = (await t.sql('SELECT staff_user_id, dispatch_source, score_breakdown, assigned_by_user_id FROM complaint_assignments WHERE complaint_id = $1', [ticket])).rows[0];
        assert.equal(asg.dispatch_source, 'AUTOPILOT');
        assert.equal(asg.assigned_by_user_id, null);
        assert.ok(asg.score_breakdown.score > 0 && asg.score_breakdown.components.quality !== undefined);
        const log = await t.api(`/complaints/${ticket}/logs`, { token: sup });
        assert.ok(log.data.some((l) => /Autopilot assigned/.test(l.action_note || '')));
        const audit = await t.sql("SELECT COUNT(*)::int AS n FROM audit_log WHERE action = 'autopilot.set'");
        assert.ok(audit.rows[0].n >= 1);
        return ticket;
    });

    it('re-dispatches rejected work on AUTO to someone else', async () => {
        await setting({ block_id: 'L_BLOCK', specialization: 'CLEANING', mode: 'AUTO' });
        const r = await raiseCleaning(rahul, 'L-810', SEED.sub.roomCleaning);
        const ticket = r.data.complaint.complaint_id;
        const first = (await t.sql("SELECT staff_user_id, assignment_id FROM complaint_assignments WHERE complaint_id = $1 AND current_state = 'ASSIGNED'", [ticket])).rows[0];
        await t.sql("UPDATE complaint_assignments SET current_state = 'DONE', work_completed_at = NOW() WHERE assignment_id = $1", [first.assignment_id]);
        await t.sql("UPDATE complaints SET status = 'PENDING_VERIFICATION' WHERE complaint_id = $1", [ticket]);
        const no = await t.api('/feedback', { method: 'POST', token: rahul, body: { complaint_id: ticket, is_satisfied: false, comments: 'not cleaned at all' } });
        assert.equal(no.status, 200);
        assert.equal(no.data.autopilot.assigned, true);
        assert.notEqual(no.data.autopilot.staff_user_id, first.staff_user_id, 'the person whose work was sent back is not sent again');
    });

    it('lets a supervisor accept the suggestion on SUGGEST, recorded as such', async () => {
        const r = await raiseCleaning(rahul, 'L-810', SEED.sub.dusting);
        assert.equal(r.data.complaint.status, 'OPEN');
        const go = await t.api('/autopilot/dispatch', { method: 'POST', token: sup, body: { complaint_id: r.data.complaint.complaint_id } });
        assert.equal(go.status, 200);
        assert.equal(go.data.assigned, true);
        const asg = (await t.sql('SELECT dispatch_source, assigned_by_user_id FROM complaint_assignments WHERE complaint_id = $1', [r.data.complaint.complaint_id])).rows[0];
        assert.equal(asg.dispatch_source, 'SUGGESTION');
        assert.equal(asg.assigned_by_user_id, await userId(SEED.supervisor));
        const again = await t.api('/autopilot/dispatch', { method: 'POST', token: sup, body: { complaint_id: r.data.complaint.complaint_id } });
        assert.equal(again.status, 409, 'an assigned ticket is not dispatched twice');
    });

    it('never gives the last free slot to two tickets at once', async () => {
        await t.sql("UPDATE users SET is_available = FALSE WHERE role = 'STAFF' AND specialization = 'CLEANING' AND user_id <> $1", [ids.EMP_CLN_06]);
        await t.sql("UPDATE complaint_assignments SET current_state = 'DONE', work_completed_at = NOW() WHERE staff_user_id = $1 AND current_state IN ('ASSIGNED','IN_PROGRESS')", [ids.EMP_CLN_06]);
        await setting({ block_id: 'L_BLOCK', specialization: 'CLEANING', mode: 'SUGGEST', live_job_cap: 1 });
        const vihaan = await t.login(SEED.student);
        const a = (await raiseCleaning(vihaan, 'L-843', SEED.sub.trash)).data.complaint.complaint_id;
        const b = (await raiseCleaning(await t.login(SEED.student4), 'L-305', SEED.sub.trash)).data.complaint.complaint_id;
        const [ra, rb] = await Promise.all([
            t.api('/autopilot/dispatch', { method: 'POST', token: sup, body: { complaint_id: a } }),
            t.api('/autopilot/dispatch', { method: 'POST', token: sup, body: { complaint_id: b } }),
        ]);
        const outcomes = [ra.data.assigned, rb.data.assigned].sort();
        assert.deepEqual(outcomes, [false, true]);
        assert.equal([ra.data, rb.data].find((d) => !d.assigned).reason, 'NO_ELIGIBLE_STAFF');
    });

    it('scopes suggestions and settings to the blocks a supervisor runs', async () => {
        const created = await t.api('/admin/users', {
            method: 'POST',
            token: admin,
            body: { reg_or_emp_id: 'SUP_ABLOCK_09', full_name: 'A Sup', email: 'a.sup9@vit.ac.in', phone_number: '9000000400', password: 'Granite4Owl', role: 'SUPERVISOR' },
        });
        await t.api(`/admin/users/${created.data.user.user_id}/blocks`, { method: 'PUT', token: admin, body: { block_ids: ['A_BLOCK'] } });
        const supA = await t.login('SUP_ABLOCK_09', 'Granite4Owl');
        const lTicket = (await t.sql("SELECT complaint_id FROM complaints WHERE block_id = 'L_BLOCK' LIMIT 1")).rows[0].complaint_id;
        assert.equal((await t.api(`/autopilot/suggestions/${lTicket}`, { token: supA })).status, 403);
        assert.equal((await setting({ block_id: 'L_BLOCK', specialization: 'CLEANING', mode: 'AUTO' }, supA)).status, 403);
        assert.equal((await setting({ block_id: null, specialization: 'CLEANING', mode: 'AUTO' }, supA)).status, 403, 'the campus default is not a supervisor’s');
        assert.equal((await setting({ block_id: null, specialization: 'PLUMBER', mode: 'OFF' }, admin)).status, 200);
        assert.equal((await setting({ block_id: 'A_BLOCK', specialization: 'CLEANING', mode: 'AUTO', weights: { quality: 70, load: 30, idle: 0, proximity: 0, reliability: 0, roomHistory: 0 } }, supA)).status, 200);
        assert.equal((await setting({ block_id: 'A_BLOCK', specialization: 'CLEANING', mode: 'AUTO', weights: { speed: 5 } }, supA)).status, 400);
        const list = await t.api('/autopilot/settings', { token: supA });
        assert.ok(list.data.settings.every((s) => s.block_id === null || s.block_id === 'A_BLOCK'));
        assert.equal(list.data.settings.find((s) => s.block_id === 'A_BLOCK').weights.quality, 70);
    });

    it('flags weak performance with evidence only after enough rated jobs, and tags comments', async () => {
        for (let i = 0; i < 9; i++) await finishedJob({ room: 'L-305', sub: SEED.sub.trash, staff: ids.EMP_CLN_04, rating: 2, daysAgo: 3 + i, comment: i % 2 ? 'came late again' : 'rude and left a mess' });
        await finishedJob({ room: 'L-305', sub: SEED.sub.trash, staff: ids.EMP_CLN_05, rating: 1, daysAgo: 5 });
        const providers = require('../src/services/ai/providers');
        providers.setFakeResponder(({ user }) => ({
            items: JSON.parse(user).map((it) => ({ id: it.id, tags: /late/.test(it.text) ? ['LATE'] : ['RUDE', 'MESSY'], sentiment: -1, invented: true })),
        }));
        try {
            const tagged = await t.api('/autopilot/tag-feedback', { method: 'POST', token: admin });
            assert.equal(tagged.status, 200);
            assert.ok(tagged.data.tagged >= 9);
            assert.equal(tagged.data.source, 'AI');
        } finally {
            providers.setFakeResponder(null);
        }
        const board = await t.api('/autopilot/performance?specialization=CLEANING', { token: sup });
        assert.equal(board.status, 200);
        const weak = board.data.find((s) => s.user_id === ids.EMP_CLN_04);
        assert.ok(weak.flags.some((f) => f.code === 'LOW_RATING' && /over \d+ rated jobs/.test(f.evidence)));
        assert.ok(weak.comment_tags.LATE >= 4 && weak.comment_tags.RUDE >= 4);
        const one = board.data.find((s) => s.user_id === ids.EMP_CLN_05);
        assert.ok(!one.flags.some((f) => f.code === 'LOW_RATING'), 'one bad job does not label anyone');
        assert.equal((await t.api('/autopilot/tag-feedback', { method: 'POST', token: sup })).status, 403);
    });

    it('falls back to keyword tags when no model answers', () => {
        const { ruleTags } = require('../src/services/autopilot/feedbackTagger');
        assert.deepEqual(ruleTags('Came very late and left the room dirty', 2), { tags: ['LATE', 'MESSY'], sentiment: -1 });
        assert.deepEqual(ruleTags('bahut badhiya, jaldi kaam kiya', 5), { tags: ['QUICK', 'THOROUGH'], sentiment: 1 });
    });

    it('plans the cleaning round as contiguous floors with even room counts', async () => {
        await t.sql("UPDATE users SET home_block_id = 'L_BLOCK', shift = NULL, is_available = TRUE WHERE user_id = ANY($1)", [[ids.EMP_CLN_01, ids.EMP_CLN_02, ids.EMP_CLN_03]]);
        const plan = await t.api('/autopilot/cleaning-plan?block_id=L_BLOCK', { token: sup });
        assert.equal(plan.status, 200);
        assert.equal(plan.data.cleaners.length, 3);
        const rooms = (await t.sql("SELECT COUNT(*)::int AS n FROM rooms WHERE block_id = 'L_BLOCK' AND is_active")).rows[0].n;
        assert.equal(plan.data.cleaners.reduce((s, c) => s + c.rooms, 0), rooms);
        const floors = plan.data.cleaners.flatMap((c) => c.floors);
        assert.deepEqual(floors, [...floors].sort((a, b) => a - b), 'each cleaner gets a contiguous run of floors');
        assert.equal(new Set(floors).size, floors.length);
    });

    it('keeps the original one-click cleaning dispatch working', async () => {
        await t.sql("UPDATE users SET is_available = TRUE WHERE role = 'STAFF'");
        const r = await raiseCleaning(await t.login(SEED.student4), 'L-305', SEED.sub.dusting);
        const legacy = await t.api('/dispatch/auto-dispatch', { method: 'POST', token: sup, body: { complaint_id: r.data.complaint.complaint_id } });
        assert.equal(legacy.status, 200);
        assert.equal(legacy.data.assigned, true);
    });
});
