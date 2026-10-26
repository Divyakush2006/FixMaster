// A short resend cooldown so the suite can exercise it without waiting a minute.
process.env.EMAIL_CODE_RESEND_SECONDS = '1';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { resetDatabase, startApp, SEED, studentProfile } = require('./helpers');

// VIT-only sign-up (migration 010): university address and reg. number
// format, an emailed code before the first sign-in, and a complete profile
// before anything else is usable.

const student = (n, extra = {}) => ({
    reg_or_emp_id: `25MIS0${String(n).padStart(3, '0')}`,
    full_name: `Onboarding Student ${n}`,
    email: `onboard${n}@vitstudent.ac.in`,
    phone_number: '9000000123',
    password: 'Lantern8River',
    ...extra,
});

describe('onboarding: VIT-only sign-up, email verification and the profile gate', () => {
    let t;
    let admin;

    before(async () => {
        await resetDatabase();
        t = await startApp();
        admin = await t.login(SEED.admin);
    });
    after(async () => t && t.close());

    const register = (body) => t.api('/auth/student/register', { method: 'POST', body });
    const verify = (regNo, code) => t.api('/auth/student/verify-email', { method: 'POST', body: { reg_or_emp_id: regNo, code } });
    const login = (regNo, password = 'Lantern8River') => t.api('/auth/student/login', { method: 'POST', body: { reg_or_emp_id: regNo, password } });

    it('accepts only university addresses, matched exactly on the domain', async () => {
        for (const email of [
            'someone@gmail.com',
            'someone@vit.ac.in',
            'someone@evil-vitstudent.ac.in',
            'someone@vitstudent.ac.in.example.com',
            'someone@sub.vitstudent.ac.in',
        ]) {
            const r = await register(student(1, { email }));
            assert.equal(r.status, 400, email);
            assert.match(r.data.error, /university email address/, email);
        }
        const none = await t.sql("SELECT COUNT(*)::int AS n FROM users WHERE reg_or_emp_id = '25MIS0001'");
        assert.equal(none.rows[0].n, 0);
    });

    it('requires a registration number in the university format', async () => {
        for (const id of ['STUDENT01', '2BCE0843', '21BCE843', '21B3E0843']) {
            const r = await register(student(1, { reg_or_emp_id: id }));
            assert.equal(r.status, 400, id);
            assert.match(r.data.error, /registration number/, id);
        }
    });

    it('emails a code, stores only its hash, and refuses sign-in until it is confirmed', async () => {
        const r = await register(student(2));
        assert.equal(r.status, 201);
        assert.equal(r.data.user.account_status, 'PENDING_VERIFICATION');
        assert.equal(r.data.verification.email, 'on***@vitstudent.ac.in');
        const code = t.lastCodeFor('onboard2@vitstudent.ac.in');
        const stored = await t.sql('SELECT code_hash FROM email_verifications WHERE user_id = $1', [r.data.user.user_id]);
        assert.equal(stored.rows.length, 1);
        assert.notEqual(stored.rows[0].code_hash, code);
        assert.ok(!stored.rows[0].code_hash.includes(code));

        const blocked = await login('25MIS0002');
        assert.equal(blocked.status, 403);
        assert.equal(blocked.data.code, 'EMAIL_NOT_VERIFIED');
        // A wrong password learns nothing about the account's state.
        const wrong = await login('25MIS0002', 'Not-the-password1');
        assert.equal(wrong.status, 401);
        assert.equal(wrong.data.code, undefined);
    });

    it('kills a code after five wrong guesses, and answers every failure the same way', async () => {
        await register(student(3));
        const code = t.lastCodeFor('onboard3@vitstudent.ac.in');
        const wrongCode = code === '000000' ? '111111' : '000000';
        const unknown = await verify('25MIS0999', wrongCode);
        for (let i = 0; i < 5; i++) {
            const r = await verify('25MIS0003', wrongCode);
            assert.equal(r.status, 400);
            assert.deepEqual(r.data, unknown.data, 'an unknown account and a wrong code look the same');
        }
        const late = await verify('25MIS0003', code);
        assert.equal(late.status, 400, 'the right code no longer works after five wrong guesses');
    });

    it('resends a fresh code at most once per cooldown; only the newest code works', async () => {
        await new Promise((r) => setTimeout(r, 1100));
        const before = t.outbox.length;
        const first = await t.api('/auth/student/resend-code', { method: 'POST', body: { reg_or_emp_id: '25MIS0003' } });
        assert.equal(first.status, 202);
        await new Promise((r) => setImmediate(r));
        assert.equal(t.outbox.length, before + 1);
        const again = await t.api('/auth/student/resend-code', { method: 'POST', body: { reg_or_emp_id: '25MIS0003' } });
        assert.equal(again.status, 202);
        await new Promise((r) => setImmediate(r));
        assert.equal(t.outbox.length, before + 1, 'inside the cooldown nothing is sent');
        const nobody = await t.api('/auth/student/resend-code', { method: 'POST', body: { reg_or_emp_id: '25MIS0888' } });
        assert.deepEqual(nobody.data, first.data, 'the answer does not reveal whether the account exists');

        const ok = await verify('25MIS0003', t.lastCodeFor('onboard3@vitstudent.ac.in'));
        assert.equal(ok.status, 200);
        assert.equal(ok.data.user.account_status, 'PENDING_PROFILE');
        assert.ok(ok.data.token);
        const reuse = await verify('25MIS0003', t.lastCodeFor('onboard3@vitstudent.ac.in'));
        assert.equal(reuse.status, 400, 'a code works once');
    });

    it('lets a student with no profile reach onboarding endpoints only', async () => {
        const token = (await login('25MIS0003')).data.token;
        const me = await t.api('/me', { token });
        assert.equal(me.status, 200);
        assert.equal(me.data.profile_complete, false);
        assert.equal(me.data.account_status, 'PENDING_PROFILE');
        assert.equal((await t.api('/me/profile', { token })).data.profile, null);
        assert.equal((await t.api('/me/room-request', { token })).status, 200);
        for (const path of ['/complaints', '/notifications']) {
            const r = await t.api(path, { token });
            assert.equal(r.status, 403, path);
            assert.equal(r.data.code, 'PROFILE_INCOMPLETE', path);
        }
        const raise = await t.api('/complaints', { method: 'POST', token, body: { ticket_scope: 'ROOM', block_id: 'L_BLOCK', room_id: 'L-810', subcategory_id: SEED.sub.tubeLight } });
        assert.equal(raise.status, 403);
        assert.equal(raise.data.code, 'PROFILE_INCOMPLETE');
    });

    it('validates the profile, including consent and health-detail rules', async () => {
        const token = (await login('25MIS0003')).data.token;
        const put = (extra) => t.api('/me/profile', { method: 'PUT', token, body: studentProfile(extra) });
        const cases = [
            [{ privacy_consent: false }, /privacy notice/],
            [{ privacy_notice_version: '2019-01' }, /privacy notice has changed/],
            [{ blood_group: 'O+', health_consent: false }, /only kept if you agree/],
            [{ expected_graduation_year: new Date().getFullYear() - 3 }, /within 7 years after admission/],
            [{ guardian_phone: '12345' }, /10 digits/],
            [{ permanent_pincode: '012345' }, /PIN code/],
            [{ date_of_birth: '2024-01-01' }, /Date of birth/],
            [{ gender: 'ROBOT' }, /gender/],
        ];
        for (const [extra, pattern] of cases) {
            const r = await put(extra);
            assert.equal(r.status, 400, JSON.stringify(extra));
            assert.match(r.data.error, pattern, JSON.stringify(extra));
        }
        assert.equal((await t.sql("SELECT COUNT(*)::int AS n FROM student_profiles")).rows[0].n, 0);
    });

    it('activates the account when the profile is saved, and audits without personal details', async () => {
        const token = (await login('25MIS0003')).data.token;
        const r = await t.api('/me/profile', {
            method: 'PUT',
            token,
            body: studentProfile({ health_consent: true, blood_group: 'B+', medical_notes: 'Asthma; inhaler in desk drawer' }),
        });
        assert.equal(r.status, 201);
        assert.equal(r.data.account_status, 'ACTIVE');
        assert.equal(r.data.profile.blood_group, 'B+');
        assert.equal((await t.api('/complaints', { token })).status, 200);

        const audit = await t.sql("SELECT details FROM audit_log WHERE action = 'profile.completed' ORDER BY audit_id DESC LIMIT 1");
        const details = JSON.stringify(audit.rows[0].details);
        assert.ok(!details.includes('Asthma') && !details.includes('R. Iyer'), 'no personal data in the audit log');

        const update = await t.api('/me/profile', { method: 'PUT', token, body: studentProfile({ health_consent: false }) });
        assert.equal(update.status, 200);
        assert.equal(update.data.profile.blood_group, null, 'withdrawing consent removes the health details');
        assert.equal(update.data.profile.medical_notes, null);
    });

    it('applies the same identity rules when an administrator creates a student', async () => {
        const base = { full_name: 'Office Created', phone_number: '9000000222', password: 'Harbour5Glass' };
        const bad = await t.api('/admin/users', { method: 'POST', token: admin, body: { ...base, reg_or_emp_id: '25MIS0400', email: 'office@gmail.com', role: 'STUDENT' } });
        assert.equal(bad.status, 400);
        const ok = await t.api('/admin/users', { method: 'POST', token: admin, body: { ...base, reg_or_emp_id: '25MIS0401', email: 'office401@vitstudent.ac.in', role: 'STUDENT' } });
        assert.equal(ok.status, 201);
        assert.equal(ok.data.user.account_status, 'ACTIVE', 'office-created accounts skip self-service onboarding');
        const staff = await t.api('/admin/users', {
            method: 'POST',
            token: admin,
            body: { ...base, reg_or_emp_id: 'EMP_CLN_77', email: 'cleaner77@gmail.com', role: 'STAFF', specialization: 'CLEANING' },
        });
        assert.equal(staff.status, 201, 'staff are not bound to the student domain');
    });

    it('lets the real owner register over an abandoned, unverified sign-up after a day', async () => {
        const first = await register(student(5));
        assert.equal(first.status, 201);
        const clash = await register(student(5, { email: 'onboard5b@vitstudent.ac.in' }));
        assert.equal(clash.status, 409, 'a fresh pending sign-up still holds the number');
        await t.sql("UPDATE users SET created_at = NOW() - INTERVAL '25 hours' WHERE reg_or_emp_id = '25MIS0005'");
        const again = await register(student(5, { email: 'onboard5b@vitstudent.ac.in' }));
        assert.equal(again.status, 201);
        assert.equal(again.data.user.email, 'onboard5b@vitstudent.ac.in');
    });

    it('refuses sign-up when no email can be delivered', async () => {
        const mailer = require('../src/services/mailer');
        mailer.setTransportForTests(null); // NODE_ENV=test with no SMTP_URL: nothing could be sent
        try {
            const r = await register(student(6));
            assert.equal(r.status, 503);
            assert.equal((await t.api('/auth/capabilities')).data.student_signup, false);
        } finally {
            mailer.setTransportForTests({ sendMail: async (msg) => t.outbox.push(msg) });
        }
    });
});
