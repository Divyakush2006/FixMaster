const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { resetDatabase, startApp, SEED, SEED_PASSWORD } = require('./helpers');

/**
 * Regression tests for the production-readiness review: password policy,
 * per-account lockout, priority policy, reassignment of work in progress,
 * the administrative audit log and server-side ticket search.
 */
describe('security and operational controls', () => {
    let t;
    let ids;

    before(async () => {
        await resetDatabase();
        t = await startApp();
        const { rows } = await t.sql('SELECT reg_or_emp_id, user_id FROM users');
        ids = Object.fromEntries(rows.map((r) => [r.reg_or_emp_id, r.user_id]));
    });
    after(async () => t && t.close());

    const register = (id, password) =>
        t.api('/auth/student/register', {
            method: 'POST',
            body: { reg_or_emp_id: id, full_name: 'Policy Check', email: `${id.toLowerCase()}@example.com`, phone_number: '9000000050', password },
        });

    describe('password policy', () => {
        it('rejects passwords without a letter and a digit, common passwords and ones containing the ID', async () => {
            for (const [pw, pattern] of [
                ['aaaaaaaa', /letter and one number/],
                ['12345678', /letter and one number/],
                ['Password123', /too common/],
                ['xx24POL001yy', /account ID/],
            ]) {
                const r = await register('24POL001', pw);
                assert.equal(r.status, 400, pw);
                assert.match(r.data.error, pattern, pw);
            }
            assert.equal((await register('24POL001', 'Corridor7Lamp')).status, 201);
        });

        it('applies the same policy to password changes and admin resets', async () => {
            const token = await t.login('24POL001', 'Corridor7Lamp');
            const change = await t.api('/me/password', { method: 'PATCH', token, body: { current_password: 'Corridor7Lamp', new_password: 'abcdefgh' } });
            assert.equal(change.status, 400);
            const admin = await t.login(SEED.admin);
            const reset = await t.api(`/admin/users/${ids[SEED.student2]}/reset-password`, { method: 'POST', token: admin, body: { new_password: 'welcome123' } });
            assert.equal(reset.status, 400);
        });
    });

    describe('per-account lockout', () => {
        const attempt = (password) => t.api('/auth/staff/login', { method: 'POST', body: { reg_or_emp_id: SEED.plumber, password } });

        it('locks the account after 10 consecutive failures, even for the right password', async () => {
            for (let i = 0; i < 10; i++) assert.equal((await attempt(`wrong-${i}`)).status, 401);
            const locked = await attempt(SEED_PASSWORD);
            assert.equal(locked.status, 429);
            assert.match(locked.data.error, /temporarily locked/);
            assert.ok(Number(locked.headers.get('retry-after')) > 0);
        });

        it('records the lockout and lets an administrator unlock the account', async () => {
            const admin = await t.login(SEED.admin);
            const audit = await t.api(`/admin/audit?action=auth&target_id=${ids[SEED.plumber]}`, { token: admin });
            assert.ok(audit.data.some((a) => a.action === 'auth.account_locked'));

            const users = await t.api('/admin/users?role=STAFF', { token: admin });
            assert.ok(users.data.find((u) => u.user_id === ids[SEED.plumber]).locked_until);

            const unlock = await t.api(`/admin/users/${ids[SEED.plumber]}`, { method: 'PATCH', token: admin, body: { unlock: true } });
            assert.equal(unlock.status, 200);
            assert.equal(unlock.data.locked_until, null);
            assert.equal((await attempt(SEED_PASSWORD)).status, 200);
        });

        it('a successful sign-in resets the failure count', async () => {
            for (let i = 0; i < 9; i++) await attempt(`again-${i}`);
            assert.equal((await attempt(SEED_PASSWORD)).status, 200);
            assert.equal((await attempt('one-more-wrong')).status, 401);
            assert.equal((await attempt(SEED_PASSWORD)).status, 200);
        });
    });

    describe('server-side sign-out', () => {
        it('revokes only the signed-out session, immediately', async () => {
            const a = await t.login(SEED.student2, undefined, { fresh: true });
            t.clearTokens();
            const b = await t.login(SEED.student2, undefined, { fresh: true });
            assert.notEqual(a, b);
            assert.equal((await t.api('/auth/logout', { method: 'POST', token: a })).status, 204);
            assert.equal((await t.api('/me', { token: a })).status, 401);
            assert.equal((await t.api('/me', { token: b })).status, 200);
            const { rows } = await t.sql('SELECT COUNT(*)::int AS n FROM revoked_tokens WHERE user_id = $1', [ids[SEED.student2]]);
            assert.equal(rows[0].n, 1);
        });

        it('refuses a correctly signed token that has no token id', async () => {
            const jwt = require('jsonwebtoken');
            const legacy = jwt.sign({ userId: ids[SEED.student2], role: 'STUDENT', portal: 'student' }, process.env.JWT_SECRET, {
                algorithm: 'HS256',
                audience: 'fixmaster:student',
                expiresIn: '1h',
            });
            assert.equal((await t.api('/me', { token: legacy })).status, 401);
        });

        it('a password change revokes tokens issued in the same second, but not the replacement token', async () => {
            const jwt = require('jsonwebtoken');
            const crypto = require('crypto');
            const id = ids[SEED.student2];
            const token = await t.login(SEED.student2, undefined, { fresh: true });
            const change = await t.api('/me/password', {
                method: 'PATCH',
                token,
                body: { current_password: SEED_PASSWORD, new_password: 'Lantern5Quiet' },
            });
            assert.equal(change.status, 200);
            const { rows } = await t.sql('SELECT credentials_changed_at FROM users WHERE user_id = $1', [id]);
            const changedSecond = Math.floor(rows[0].credentials_changed_at.getTime() / 1000);
            // A token minted in the very second of the change (e.g. another device signing in concurrently).
            const sameSecond = jwt.sign(
                { userId: id, role: 'STUDENT', portal: 'student', iat: changedSecond },
                process.env.JWT_SECRET,
                { algorithm: 'HS256', audience: 'fixmaster:student', expiresIn: '1h', jwtid: crypto.randomUUID() }
            );
            assert.equal((await t.api('/me', { token: sameSecond })).status, 401);
            assert.equal((await t.api('/me', { token: change.data.token })).status, 200);
            // Restore the seed password for later tests.
            await t.api('/me/password', { method: 'PATCH', token: change.data.token, body: { current_password: 'Lantern5Quiet', new_password: SEED_PASSWORD } });
            t.clearTokens();
        });

        it('requires a session to sign out', async () => {
            assert.equal((await t.api('/auth/logout', { method: 'POST' })).status, 401);
        });
    });

    describe('priority policy', () => {
        const raise = (token, body) =>
            t.api('/complaints', { method: 'POST', token, body: { ticket_scope: 'COMMON_AREA', block_id: 'L_BLOCK', common_area_id: 'L-F04-COOLER-01', ...body } });

        it('a student cannot turn a routine issue into an emergency', async () => {
            const student = await t.login(SEED.student2);
            const r = await raise(student, { subcategory_id: SEED.sub.trash, priority: 'EMERGENCY' });
            assert.equal(r.status, 400);
            assert.match(r.data.error, /highest priority you can choose is Medium/);
        });

        it('a student may raise priority by one level, and the default comes from the issue', async () => {
            const student = await t.login(SEED.student2);
            const up = await raise(student, { subcategory_id: SEED.sub.socket, priority: 'EMERGENCY' });
            assert.equal(up.status, 201);
            assert.equal(up.data.complaint.priority, 'EMERGENCY');
            const def = await raise(student, { subcategory_id: SEED.sub.tubeLight });
            assert.equal(def.status, 201);
            assert.equal(def.data.complaint.priority, 'MEDIUM');
            const coolerDefault = await raise(student, { subcategory_id: SEED.sub.coolerTemp });
            assert.equal(coolerDefault.data.complaint.priority, 'HIGH');
        });

        it('a supervisor may set any priority', async () => {
            const sup = await t.login(SEED.supervisor);
            const r = await raise(sup, { subcategory_id: SEED.sub.trash, priority: 'EMERGENCY' });
            assert.equal(r.status, 201);
            assert.equal(r.data.complaint.priority, 'EMERGENCY');
        });
    });

    describe('reassigning work in progress', () => {
        let cid;
        before(async () => {
            const student = await t.login(SEED.student);
            const r = await t.api('/complaints', {
                method: 'POST',
                token: student,
                body: { ticket_scope: 'ROOM', block_id: 'L_BLOCK', room_id: 'L-843', subcategory_id: SEED.sub.dusting },
            });
            assert.equal(r.status, 201, JSON.stringify(r.data));
            cid = r.data.complaint.complaint_id;
            const sup = await t.login(SEED.supervisor);
            const a = await t.api('/dispatch/assign', { method: 'POST', token: sup, body: { complaint_id: cid, staff_user_id: ids[SEED.cleaner1] } });
            assert.equal(a.status, 200);
        });

        const queueHas = async (id) => (await t.api('/dispatch/queue', { token: await t.login(id) })).data.some((x) => x.complaint_id === cid);

        it('moves an ASSIGNED ticket to another technician and records the hand-over', async () => {
            const sup = await t.login(SEED.supervisor);
            const same = await t.api('/dispatch/assign', { method: 'POST', token: sup, body: { complaint_id: cid, staff_user_id: ids[SEED.cleaner1] } });
            assert.equal(same.status, 409);

            const r = await t.api('/dispatch/assign', { method: 'POST', token: sup, body: { complaint_id: cid, staff_user_id: ids[SEED.cleaner2] } });
            assert.equal(r.status, 200, JSON.stringify(r.data));
            assert.equal(await queueHas(SEED.cleaner1), false);
            assert.equal(await queueHas(SEED.cleaner2), true);

            const logs = await t.api(`/complaints/${cid}/logs`, { token: sup });
            assert.ok(logs.data.some((l) => /Reassigned from .+ to .+/.test(l.action_note)));
        });

        it('moves an IN_PROGRESS ticket without duplicating the history entry', async () => {
            const cleaner2 = await t.login(SEED.cleaner2);
            const task = (await t.api('/dispatch/queue', { token: cleaner2 })).data.find((x) => x.complaint_id === cid);
            assert.equal((await t.api(`/dispatch/tasks/${task.assignment_id}/start`, { method: 'PATCH', token: cleaner2 })).status, 200);

            const sup = await t.login(SEED.supervisor);
            const r = await t.api('/dispatch/assign', { method: 'POST', token: sup, body: { complaint_id: cid, staff_user_id: ids[SEED.cleaner1] } });
            assert.equal(r.status, 200);
            const logs = (await t.api(`/complaints/${cid}/logs`, { token: sup })).data;
            const handOvers = logs.filter((l) => l.previous_status === 'IN_PROGRESS' && l.new_status === 'ASSIGNED');
            assert.equal(handOvers.length, 1);
            assert.match(handOvers[0].action_note, /Reassigned from .+ to .+/);
            assert.equal(await queueHas(SEED.cleaner2), false);
            assert.equal(await queueHas(SEED.cleaner1), true);
        });

        it('the replaced technician can no longer act on the old task', async () => {
            const cleaner2 = await t.login(SEED.cleaner2);
            const { rows } = await t.sql(
                'SELECT assignment_id FROM complaint_assignments WHERE complaint_id = $1 AND staff_user_id = $2 ORDER BY assignment_id DESC LIMIT 1',
                [cid, ids[SEED.cleaner2]]
            );
            const r = await t.api(`/dispatch/tasks/${rows[0].assignment_id}`, { method: 'PATCH', token: cleaner2 });
            assert.equal(r.status, 409);
        });
    });

    describe('administrative audit log', () => {
        it('records account, allotment and infrastructure changes with the acting admin', async () => {
            const admin = await t.login(SEED.admin);
            const created = await t.api('/admin/users', {
                method: 'POST',
                token: admin,
                body: { reg_or_emp_id: 'EMP_AUD_01', full_name: 'Audit Check', email: 'audit.check@example.com', phone_number: '9000000077', password: 'Ladder4Rope', role: 'STAFF', specialization: 'PLUMBER' },
            });
            assert.equal(created.status, 201);
            await t.api(`/admin/users/${created.data.user.user_id}`, { method: 'PATCH', token: admin, body: { is_active: false } });
            await t.api('/admin/blocks/C_BLOCK/rooms', { method: 'POST', token: admin, body: { floor_number: 2, from: 1, to: 2, room_type: 'AC', bed_capacity: 2 } });
            await t.api('/admin/rooms/C-201', { method: 'PATCH', token: admin, body: { is_active: false } });

            const all = (await t.api('/admin/audit?limit=200', { token: admin })).data;
            const actions = all.map((a) => a.action);
            for (const a of ['user.create', 'user.deactivate', 'room.create', 'room.close']) assert.ok(actions.includes(a), a);
            const deact = all.find((a) => a.action === 'user.deactivate');
            assert.equal(deact.actor_user_id, ids[SEED.admin]);
            assert.equal(deact.target_name, 'Audit Check');
            const roomCreate = all.find((a) => a.action === 'room.create');
            assert.deepEqual(roomCreate.details.rooms, ['C-201', 'C-202']);
        });

        it('supports filtering, paging and is admin-only', async () => {
            const admin = await t.login(SEED.admin);
            const page = await t.api('/admin/audit?action=user&limit=1', { token: admin });
            assert.equal(page.data.length, 1);
            assert.ok(Number(page.headers.get('x-total-count')) >= 2);
            assert.ok(page.data.every((a) => a.action.startsWith('user.')));
            assert.equal((await t.api('/admin/audit', { token: await t.login(SEED.supervisor) })).status, 403);
            assert.equal((await t.api('/admin/audit?action=DROP TABLE', { token: admin })).status, 400);
        });
    });

    describe('admin lists are searched and paged on the server', () => {
        it('users: search, role/status filters, paging and summary counts', async () => {
            const admin = await t.login(SEED.admin);
            const page = await t.api('/admin/users?limit=2&offset=0', { token: admin });
            assert.equal(page.data.length, 2);
            const total = Number(page.headers.get('x-total-count'));
            const summary = (await t.api('/admin/users/summary', { token: admin })).data;
            assert.equal(summary.all, total);
            assert.equal(summary.student + summary.staff + summary.supervisor + summary.admin, total);

            const found = (await t.api('/admin/users?q=vihaan', { token: admin })).data;
            assert.deepEqual(found.map((u) => u.reg_or_emp_id), [SEED.student]);
            const staffOnly = (await t.api('/admin/users?role=STAFF&status=active&limit=200', { token: admin })).data;
            assert.ok(staffOnly.length > 0 && staffOnly.every((u) => u.role === 'STAFF' && u.is_active));
            assert.equal((await t.api('/admin/users?q=%25', { token: admin })).data.length, 0);
            assert.equal((await t.api('/admin/users?limit=5000', { token: admin })).status, 400);
        });

        it('allotments: search by student or room, filter by student, paged', async () => {
            const admin = await t.login(SEED.admin);
            const all = await t.api('/admin/allotments?limit=1', { token: admin });
            assert.equal(all.data.length, 1);
            assert.ok(Number(all.headers.get('x-total-count')) > 1);
            const byRoom = (await t.api('/admin/allotments?q=L-843', { token: admin })).data;
            assert.ok(byRoom.length > 0 && byRoom.every((a) => a.room_id === 'L-843'));
            const byStudent = (await t.api(`/admin/allotments?student_id=${ids[SEED.student]}`, { token: admin })).data;
            assert.deepEqual(byStudent.map((a) => a.room_id), ['L-843']);
        });
    });

    describe('ticket search', () => {
        it('searches issue, person, location and the short TKT reference on the server', async () => {
            const sup = await t.login(SEED.supervisor);
            const byIssue = await t.api('/complaints?q=socket', { token: sup });
            assert.ok(byIssue.data.length > 0 && byIssue.data.every((c) => /socket/i.test(c.issue_name)));
            assert.equal(Number(byIssue.headers.get('x-total-count')), byIssue.data.length);

            const byRef = await t.api('/complaints?q=TKT-000001', { token: sup });
            assert.deepEqual(byRef.data.map((c) => c.complaint_id), ['cmp-843-0001-uuid-000000000001']);

            const byPerson = await t.api('/complaints?q=vihaan', { token: sup });
            assert.ok(byPerson.data.length > 0 && byPerson.data.every((c) => c.student_name === 'Vihaan Sharma'));

            // LIKE wildcards are literal, not "match everything".
            assert.equal((await t.api('/complaints?q=%25', { token: sup })).data.length, 0);
            assert.equal((await t.api('/complaints?q=_', { token: sup })).data.length, 0);
        });

        it('stays scoped to the caller for students', async () => {
            const other = await t.login(SEED.student2);
            const r = await t.api('/complaints?q=vihaan', { token: other });
            assert.equal(r.data.length, 0);
        });
    });
});
