const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { resetDatabase, startApp, SEED, SEED_PASSWORD, studentProfile } = require('./helpers');

// Data-subject rights (migration 015): downloading one's data, asking for
// erasure, and the administrator carrying it out.

describe('privacy rights', () => {
    let t;
    let student;
    let other;
    let admin;
    let sup;
    let userId;
    let ticketId;

    before(async () => {
        await resetDatabase();
        t = await startApp();
        student = await t.login(SEED.student4);
        other = await t.login(SEED.student);
        admin = await t.login(SEED.admin);
        sup = await t.login(SEED.supervisor);
        userId = (await t.sql('SELECT user_id FROM users WHERE reg_or_emp_id = $1', [SEED.student4])).rows[0].user_id;

        const p = await t.api('/me/profile', { method: 'PUT', token: student, body: studentProfile({ guardian_name: 'Lakshmi Menon' }) });
        assert.ok([200, 201].includes(p.status), JSON.stringify(p.data));
        const c = await t.api('/complaints', {
            method: 'POST',
            token: student,
            body: { ticket_scope: 'ROOM', block_id: 'L_BLOCK', room_id: 'L-305', subcategory_id: SEED.sub.dusting, description: 'My name is Priya, please call 9876500099' },
        });
        assert.equal(c.status, 201, JSON.stringify(c.data));
        ticketId = c.data.complaint.complaint_id;
    });

    after(async () => {
        await t.close();
    });

    describe('download my data', () => {
        it('needs a signed-in account', async () => {
            assert.equal((await t.api('/me/data-export')).status, 401);
        });

        it('returns the caller\'s own data as an attachment, without credentials or other people', async () => {
            const r = await t.api('/me/data-export', { token: student });
            assert.equal(r.status, 200);
            assert.match(r.headers.get('content-disposition'), /attachment; filename="fixmaster-my-data-\d{4}-\d{2}-\d{2}\.json"/);
            assert.equal(r.data.account.reg_or_emp_id, SEED.student4);
            assert.equal(r.data.resident_profile.guardian_name, 'Lakshmi Menon');
            assert.ok(r.data.room_allotments.some((a) => a.room_id === 'L-305' && a.is_current));
            assert.ok(r.data.tickets.some((x) => x.complaint_id === ticketId && x.raised_by_me));
            const text = JSON.stringify(r.data);
            assert.ok(!/password|\$2[aby]\$/.test(text), 'no credentials');
            assert.ok(!text.includes('Vihaan') && !text.includes(SEED.student), 'nothing about other residents');
        });

        it('works for staff too, with their jobs, and is recorded in the audit log', async () => {
            const tech = await t.login(SEED.electrician);
            const r = await t.api('/me/data-export', { token: tech });
            assert.equal(r.status, 200);
            assert.equal(r.data.account.role, 'STAFF');
            assert.ok(Array.isArray(r.data.jobs_assigned_to_me));
            const { rows } = await t.sql(`SELECT COUNT(*)::int AS n FROM audit_log WHERE action = 'privacy.exported'`);
            assert.ok(rows[0].n >= 2);
        });
    });

    describe('ask for erasure', () => {
        it('is for residents, and asks for the password again', async () => {
            assert.equal((await t.api('/me/erasure-request', { method: 'POST', token: sup, body: { password: SEED_PASSWORD } })).status, 403);
            assert.equal((await t.api('/me/erasure-request', { method: 'POST', token: student, body: {} })).status, 400);
            const wrong = await t.api('/me/erasure-request', { method: 'POST', token: student, body: { password: 'Wrong@1234' } });
            assert.equal(wrong.status, 400);
            assert.match(wrong.data.error, /incorrect/i);
            assert.equal((await t.sql('SELECT erasure_requested_at FROM users WHERE user_id = $1', [userId])).rows[0].erasure_requested_at, null);
        });

        it('records the request and says what is still in the way', async () => {
            const r = await t.api('/me/erasure-request', { method: 'POST', token: student, body: { password: SEED_PASSWORD } });
            assert.equal(r.status, 202, JSON.stringify(r.data));
            assert.ok(r.data.blockers.some((b) => /L-305/.test(b)));
            assert.ok(r.data.blockers.some((b) => /ticket/.test(b)));
            const again = await t.api('/me/erasure-request', { method: 'POST', token: student, body: { password: SEED_PASSWORD } });
            assert.equal(again.status, 202, 'repeating is harmless');
        });

        it('can be taken back', async () => {
            assert.equal((await t.api('/me/erasure-request', { method: 'DELETE', token: student })).status, 204);
            assert.equal((await t.api('/me/erasure-request', { method: 'DELETE', token: student })).status, 404);
            assert.equal((await t.api('/me/erasure-request', { method: 'POST', token: student, body: { password: SEED_PASSWORD } })).status, 202);
        });
    });

    describe('administrator erases', () => {
        it('lists pending requests with their blockers, for administrators only', async () => {
            assert.equal((await t.api('/admin/erasure-requests', { token: sup })).status, 403);
            const r = await t.api('/admin/erasure-requests', { token: admin });
            assert.equal(r.status, 200);
            const mine = r.data.find((x) => x.user_id === userId);
            assert.ok(mine && mine.blockers.length === 2);
        });

        it('refuses while the resident still has a room or an open ticket', async () => {
            const r = await t.api(`/admin/users/${userId}/erase`, { method: 'POST', token: admin });
            assert.equal(r.status, 409);
            assert.equal(r.data.code, 'ERASURE_BLOCKED');
            assert.equal((await t.sql('SELECT erased_at FROM users WHERE user_id = $1', [userId])).rows[0].erased_at, null);
        });

        it('refuses residents who have not asked, and accounts that are not residents', async () => {
            const notAsked = await t.api(`/admin/users/${(await t.sql('SELECT user_id FROM users WHERE reg_or_emp_id = $1', [SEED.student])).rows[0].user_id}/erase`, { method: 'POST', token: admin });
            assert.equal(notAsked.status, 409);
            assert.equal(notAsked.data.code, 'NO_REQUEST');
            const staffId = (await t.sql('SELECT user_id FROM users WHERE reg_or_emp_id = $1', [SEED.electrician])).rows[0].user_id;
            assert.equal((await t.api(`/admin/users/${staffId}/erase`, { method: 'POST', token: admin })).status, 400);
        });

        it('removes the personal data once the resident has left, and keeps the operational record', async () => {
            // The resident vacates and their ticket is finished, with a review.
            await t.sql('DELETE FROM student_room_allotments WHERE student_id = $1', [userId]);
            await t.sql(`UPDATE complaints SET status = 'COMPLETED', resolved_at = NOW(), closed_at = NOW(), closure_reason = 'CONFIRMED' WHERE complaint_id = $1`, [ticketId]);
            await t.sql(
                `INSERT INTO complaint_feedback (complaint_id, student_id, is_satisfactorily_resolved, rating, student_comments) VALUES ($1, $2, TRUE, 4, 'Priya here, thanks')`,
                [ticketId, userId]
            );

            const r = await t.api(`/admin/users/${userId}/erase`, { method: 'POST', token: admin });
            assert.equal(r.status, 200, JSON.stringify(r.data));

            const u = (await t.sql('SELECT * FROM users WHERE user_id = $1', [userId])).rows[0];
            assert.equal(u.full_name, 'Former resident');
            assert.match(u.email, /@erased\.invalid$/);
            assert.equal(u.phone_number, '0000000000');
            assert.equal(u.is_active, false);
            assert.ok(u.erased_at);
            assert.notEqual(u.reg_or_emp_id, SEED.student4);
            assert.equal((await t.sql('SELECT COUNT(*)::int AS n FROM student_profiles WHERE user_id = $1', [userId])).rows[0].n, 0);

            const ticket = (await t.sql('SELECT description, status FROM complaints WHERE complaint_id = $1', [ticketId])).rows[0];
            assert.equal(ticket.description, null);
            assert.equal(ticket.status, 'COMPLETED', 'the ticket itself stays');
            const fb = (await t.sql('SELECT rating, student_comments FROM complaint_feedback WHERE complaint_id = $1', [ticketId])).rows[0];
            assert.equal(fb.rating, 4, 'the rating still counts for the technician');
            assert.equal(fb.student_comments, null);

            const audit = await t.sql(`SELECT actor_user_id FROM audit_log WHERE action = 'privacy.erased' AND target_id = $1`, [userId]);
            assert.equal(audit.rows.length, 1);
        });

        it('leaves no way back in', async () => {
            const login = await t.api('/auth/student/login', { method: 'POST', body: { reg_or_emp_id: SEED.student4, password: SEED_PASSWORD } });
            assert.notEqual(login.status, 200);
            assert.equal((await t.api('/me', { token: student })).status, 401, 'the old session is dead');
            assert.equal((await t.api(`/admin/users/${userId}/erase`, { method: 'POST', token: admin })).status, 409, 'cannot be erased twice');
        });

        it('does not touch anyone else', async () => {
            const me = await t.api('/me', { token: other });
            assert.equal(me.status, 200);
            assert.equal(me.data.reg_or_emp_id, SEED.student);
        });
    });
});
