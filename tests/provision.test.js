const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { resetDatabase, startApp, TEST_DB_URL } = require('./helpers');
const { provision, render } = require('../scripts/provision-accounts');

// The accounts of a deployment: random unique passwords, correct hostels and blocks,
// rooms for the residents, and nothing created twice.

describe('provisioning accounts', () => {
    let t;
    let first;
    before(async () => {
        await resetDatabase();
        t = await startApp();
        first = await provision({ connectionString: TEST_DB_URL, admins: 2, students: 20, requireChange: true, log: () => {} });
    });
    after(async () => t && t.close());

    const of = (role) => first.created.filter((p) => p.role === role);

    it('creates the roster with a different strong password for everyone, and stores only hashes', async () => {
        assert.equal(of('ADMIN').length, 2);
        assert.equal(of('CHIEF_WARDEN').length, 2);
        assert.equal(of('SUPERVISOR').length, 12);
        assert.equal(of('STAFF').length, 82);
        assert.equal(of('STUDENT').length, 20);
        const passwords = first.created.map((p) => p.password);
        assert.equal(new Set(passwords).size, passwords.length, 'no two accounts share a password');
        for (const pw of passwords) assert.match(pw, /^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)(?=.*[@#$%&*+=?]).{14}$/);
        const { rows } = await t.sql('SELECT password_hash FROM users');
        assert.ok(rows.every((r) => r.password_hash.startsWith('$2')), 'bcrypt hashes');
        assert.ok(!rows.some((r) => passwords.includes(r.password_hash)));
    });

    it('lets every kind of account sign in through its own portal, and asks for a new password first', async () => {
        for (const [role, portal] of [['ADMIN', 'admin'], ['CHIEF_WARDEN', 'staff'], ['SUPERVISOR', 'staff'], ['STAFF', 'staff'], ['STUDENT', 'student']]) {
            const p = of(role)[0];
            const r = await t.api(`/auth/${portal}/login`, { method: 'POST', body: { reg_or_emp_id: p.id, password: p.password } });
            assert.equal(r.status, 200, `${role} ${p.id}`);
            assert.equal(r.data.user.must_change_password, true);
        }
    });

    it('puts supervisors and chief wardens in their hostel with the right blocks, one chief warden per hostel', async () => {
        const cws = (await t.sql("SELECT hostel_type FROM users WHERE role = 'CHIEF_WARDEN' ORDER BY hostel_type")).rows.map((r) => r.hostel_type);
        assert.deepEqual(cws, ['LADIES', 'MENS']);
        const m1 = (await t.sql("SELECT array_agg(block_id ORDER BY block_id) AS b FROM supervisor_blocks WHERE supervisor_user_id = (SELECT user_id FROM users WHERE reg_or_emp_id = 'SUP_M01')")).rows[0].b;
        assert.deepEqual(m1, ['A_BLOCK', 'B_BLOCK', 'C_BLOCK', 'MH_BLOCK']);
        const all = (await t.sql('SELECT block_id, COUNT(*)::int AS n FROM supervisor_blocks GROUP BY block_id')).rows;
        assert.equal(all.length, 30, 'every residential block and MH has a supervisor');
        assert.ok(all.every((r) => r.n === 1));
    });

    it('allots every resident a room in the hostel of their gender', async () => {
        const { rows } = await t.sql(
            `SELECT p.gender, b.hostel_type FROM student_room_allotments a JOIN student_profiles p ON p.user_id = a.student_id
             JOIN rooms r ON r.room_id = a.room_id JOIN hostel_blocks b ON b.block_id = r.block_id WHERE a.is_current`
        );
        assert.equal(rows.length, 20);
        assert.ok(rows.every((r) => (r.gender === 'MALE') === (r.hostel_type === 'MENS')));
    });

    it('creates only what is missing when run again, and can issue new passwords', async () => {
        const again = await provision({ connectionString: TEST_DB_URL, admins: 2, students: 20, log: () => {} });
        assert.equal(again.created.length, 0);
        assert.equal(again.existing.length, first.created.length);
        const rotated = await provision({ connectionString: TEST_DB_URL, admins: 2, students: 20, rotate: true, log: () => {} });
        assert.equal(rotated.created.length, first.created.length);
        const p = of('SUPERVISOR')[0];
        const old = await t.api('/auth/staff/login', { method: 'POST', body: { reg_or_emp_id: p.id, password: p.password } });
        assert.equal(old.status, 401, 'the old password stopped working');
        const fresh = rotated.created.find((x) => x.id === p.id);
        assert.equal((await t.api('/auth/staff/login', { method: 'POST', body: { reg_or_emp_id: p.id, password: fresh.password } })).status, 200);
    });

    it('writes a readable file that lists everyone once and says what is required', () => {
        const text = render({ created: first.created, existing: [], dbLabel: 'test', webUrl: 'https://hostel.example.edu', requireChange: true, emailDomain: 'fixmaster.example' });
        for (const p of first.created) assert.ok(text.includes(p.id) && text.includes(p.password), p.id);
        assert.match(text, /must choose its own password the first time/);
        assert.match(text, /https:\/\/hostel\.example\.edu\/admin/);
    });

    it('an administrator-only run creates just the administrator, with no campus', async () => {
        await resetDatabase();
        const before = (await t.sql('SELECT COUNT(*)::int AS n FROM users')).rows[0].n;
        const only = await provision({ connectionString: TEST_DB_URL, admins: 1, adminOnly: true, requireChange: true, log: () => {} });
        assert.equal(only.created.length, 1);
        assert.equal(only.created[0].role, 'ADMIN');
        assert.equal((await t.sql('SELECT COUNT(*)::int AS n FROM users')).rows[0].n, before + 1);
        assert.equal((await t.sql("SELECT COUNT(*)::int AS n FROM users WHERE reg_or_emp_id LIKE 'TECH\_%' OR reg_or_emp_id LIKE 'CW\_%'")).rows[0].n, 0);
    });

    it('gives the first administrator a real email address when one is passed', async () => {
        await resetDatabase();
        await provision({ connectionString: TEST_DB_URL, admins: 1, adminOnly: true, adminEmail: 'owner@example.org', log: () => {} });
        const { rows } = await t.sql("SELECT email FROM users WHERE reg_or_emp_id = 'ADMIN_01'");
        assert.equal(rows[0].email, 'owner@example.org');
    });
});
