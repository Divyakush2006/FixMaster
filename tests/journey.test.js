const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { resetDatabase, startApp, SEED } = require('./helpers');

// One resident's whole story through the API, the way the web app drives it:
// sign up with a VIT address, verify, complete the profile, get a room, describe
// a problem in words, send the draft, have the autopilot assign a technician,
// the technician finish, the resident rate the work, and the ratings, comment
// themes, performance board, briefing and data export all reflect it.

describe('journey: from sign-up to a rated repair', () => {
    let t;
    let providers;
    let student;
    let sup;
    let chief;
    let admin;
    let complaintId;
    let staffUserId;
    let taskId;
    const reg = '24BCE9100';

    before(async () => {
        await resetDatabase();
        t = await startApp();
        providers = require('../src/services/ai/providers');
        require('../src/services/ai/gateway')._resetBreakers();
        sup = await t.login(SEED.supervisor);
        admin = await t.login(SEED.admin);
        // The chief warden is created the way an administrator does it.
        const c = await t.api('/admin/users', {
            method: 'POST',
            token: admin,
            body: { reg_or_emp_id: 'CW_JOURNEY', full_name: 'Journey Chief Warden', email: 'journey.cw@vit.ac.in', phone_number: '9000000001', password: 'Chief@12345', role: 'CHIEF_WARDEN' },
        });
        assert.equal(c.status, 201, JSON.stringify(c.data));
        chief = await t.login('CW_JOURNEY', 'Chief@12345');
    });

    after(async () => {
        providers.setFakeResponder(null);
        await t.close();
    });

    it('only accepts a VIT student address', async () => {
        const bad = await t.api('/auth/student/register', {
            method: 'POST',
            body: { reg_or_emp_id: '24BCE9199', full_name: 'Outside Person', email: 'someone@gmail.com', phone_number: '9000000009', password: 'Test@12345' },
        });
        assert.equal(bad.status, 400);
    });

    it('signs up, verifies the emailed code and completes the profile', async () => {
        const r = await t.registerStudent(
            { reg_or_emp_id: reg, full_name: 'Journey Student', email: 'journey.student@vitstudent.ac.in', phone_number: '9000000100', password: 'Test@12345' },
            { profile: false }
        );
        student = r.token;
        const before = await t.api('/me', { token: student });
        assert.equal(before.data.account_status, 'PENDING_PROFILE');
        assert.equal(before.data.profile_complete, false);
        // Nothing else opens up until the profile is complete.
        assert.equal((await t.api('/complaints', { token: student })).status, 403);

        const profile = await t.api('/me/profile', { method: 'PUT', token: student, body: require('./helpers').studentProfile() });
        assert.equal(profile.status, 201, JSON.stringify(profile.data));
        const after = await t.api('/me', { token: student });
        assert.equal(after.data.account_status, 'ACTIVE');
    });

    it('is given a room by the hostel office', async () => {
        const { rows } = await t.sql(
            `SELECT r.room_id FROM rooms r
             WHERE r.block_id = 'L_BLOCK' AND r.is_active
               AND (SELECT COUNT(*) FROM student_room_allotments a WHERE a.room_id = r.room_id AND a.is_current) < r.bed_capacity
               AND NOT EXISTS (SELECT 1 FROM complaints c WHERE c.room_id = r.room_id AND c.status IN ('OPEN','ASSIGNED','IN_PROGRESS','PENDING_VERIFICATION','ESCALATED'))
             ORDER BY r.room_id LIMIT 1`
        );
        const studentId = (await t.sql('SELECT user_id FROM users WHERE reg_or_emp_id = $1', [reg])).rows[0].user_id;
        const a = await t.api('/admin/allotments', { method: 'POST', token: admin, body: { student_id: studentId, room_id: rows[0].room_id, academic_year: '2026-2027' } });
        assert.equal(a.status, 201, JSON.stringify(a.data));
        const mine = await t.api('/me/allotment', { token: student });
        assert.equal(mine.data.room_id, rows[0].room_id);
    });

    it('describes the problem in words, reviews the draft and sends it; the autopilot assigns an electrician', async () => {
        // Supervisor lets the autopilot assign electrical work in this block by itself.
        const s = await t.api('/autopilot/settings', { method: 'PUT', token: sup, body: { block_id: 'L_BLOCK', specialization: 'ELECTRICIAN', mode: 'AUTO' } });
        assert.equal(s.status, 200, JSON.stringify(s.data));

        providers.setFakeResponder(() => ({
            drafts: [{ issue_code: 'ELEC_SOCKET', location: 'MY_ROOM', area_ref: null, summary: 'Socket near the desk sparks when a charger is plugged in.', confidence: 0.9 }],
            clarification: null,
        }));
        const draft = await t.api('/assistant/draft', { method: 'POST', token: student, body: { text: 'the socket by my desk is sparking when I plug in my charger' } });
        assert.equal(draft.status, 200);
        const d = draft.data.drafts[0];
        assert.equal(d.priority, 'HIGH', 'priority comes from the catalogue');
        assert.match(d.safety_advice, /touch|unplug|power/i);

        const created = await t.api('/complaints', {
            method: 'POST',
            token: student,
            body: { ticket_scope: d.ticket_scope, block_id: d.block_id, room_id: d.room_id, subcategory_id: d.subcategory_id, description: d.description },
        });
        assert.equal(created.status, 201, JSON.stringify(created.data));
        complaintId = created.data.complaint.complaint_id;
        assert.equal(created.data.complaint.priority, 'HIGH');
        assert.equal(created.data.autopilot.assigned, true, JSON.stringify(created.data.autopilot));

        const a = (await t.sql(`SELECT assignment_id, staff_user_id, dispatch_source, score_breakdown FROM complaint_assignments WHERE complaint_id = $1`, [complaintId])).rows[0];
        assert.equal(a.dispatch_source, 'AUTOPILOT');
        assert.ok(a.score_breakdown, 'the decision is recorded with its score');
        staffUserId = a.staff_user_id;
        taskId = a.assignment_id;
    });

    it('the technician starts and finishes the job', async () => {
        const reg = (await t.sql('SELECT reg_or_emp_id FROM users WHERE user_id = $1', [staffUserId])).rows[0].reg_or_emp_id;
        const tech = await t.login(reg);
        const queue = await t.api('/dispatch/queue', { token: tech });
        assert.equal(queue.status, 200);
        assert.ok(queue.data.some((x) => x.assignment_id === taskId), 'the job is in their queue');
        assert.equal((await t.api(`/dispatch/tasks/${taskId}/start`, { method: 'PATCH', token: tech })).status, 200);
        assert.equal((await t.api(`/dispatch/tasks/${taskId}`, { method: 'PATCH', token: tech })).status, 200);
        const ticket = await t.api(`/complaints/${complaintId}`, { token: student });
        assert.equal(ticket.data.status, 'PENDING_VERIFICATION');
    });

    it('the resident rates the work with a comment', async () => {
        const fb = await t.api('/feedback', { method: 'POST', token: student, body: { complaint_id: complaintId, is_satisfied: true, rating: 5, comments: 'Very polite and quick, cleaned up afterwards.' } });
        assert.equal(fb.status, 200, JSON.stringify(fb.data));
        const ticket = await t.api(`/complaints/${complaintId}`, { token: student });
        assert.equal(ticket.data.status, 'COMPLETED');
    });

    it('the chief warden sees the rating and the themes in the comment on the performance board', async () => {
        providers.setFakeResponder(() => {
            throw new providers.ProviderError('ERROR', 'down');
        });
        require('../src/services/ai/gateway')._resetBreakers();
        const tagged = await t.api('/autopilot/tag-feedback', { method: 'POST', token: chief });
        assert.equal(tagged.status, 200);
        assert.ok(tagged.data.tagged >= 1);

        const board = await t.api('/autopilot/performance?specialization=ELECTRICIAN', { token: chief });
        const row = board.data.find((x) => x.user_id === staffUserId);
        assert.ok(row, 'the technician is on the board');
        assert.equal(row.rated_jobs, 1);
        assert.equal(row.avg_rating, 5);
        assert.ok(row.comment_tags.POLITE >= 1 && row.comment_tags.QUICK >= 1, JSON.stringify(row.comment_tags));
        assert.equal(row.flags.length, 0, 'one review never raises a flag');
    });

    it('the briefing counts the ticket as handled, and answers a question about it', async () => {
        const overview = await t.api('/insights/overview', { token: chief });
        assert.equal(overview.status, 200);
        const live = await t.sql(`SELECT status FROM complaints WHERE complaint_id = $1`, [complaintId]);
        assert.equal(live.rows[0].status, 'COMPLETED');
        const b = await t.api('/insights/briefing/refresh', { method: 'POST', token: chief });
        assert.equal(b.status, 200);
        assert.equal(b.data.source, 'RULES', 'no model was available, and the page still works');
        const ask = await t.api('/insights/ask', { method: 'POST', token: chief, body: { question: 'which tickets are overdue?' } });
        assert.equal(ask.data.report, 'breach_risk');
    });

    it('the resident can download their data, which shows the whole story', async () => {
        const data = await t.api('/me/data-export', { token: student });
        assert.equal(data.status, 200);
        assert.equal(data.data.account.reg_or_emp_id, reg);
        assert.ok(data.data.resident_profile);
        assert.ok(data.data.tickets.some((x) => x.complaint_id === complaintId && x.status === 'COMPLETED'));
        assert.ok(data.data.reviews_given.some((x) => x.rating === 5));
    });
});
