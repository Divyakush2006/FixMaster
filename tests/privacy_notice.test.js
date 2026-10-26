const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { resetDatabase, startApp, SEED } = require('./helpers');

// The published privacy notice: public, tied to the retention settings in
// force, and a resident whose consent is for an older version is told.

describe('privacy notice', () => {
    let t;
    before(async () => {
        await resetDatabase();
        t = await startApp();
    });
    after(async () => {
        delete process.env.RETENTION_AI_CALL_DAYS;
        delete process.env.PRIVACY_CONTACT;
        await t.close();
    });

    it('is public, versioned, and covers what a data-protection notice must', async () => {
        const r = await t.api('/meta/privacy-notice');
        assert.equal(r.status, 200);
        assert.equal(r.data.version, require('../src/config/identity').PRIVACY_NOTICE_VERSION);
        assert.deepEqual(r.data.sections.map((s) => s.id), ['collected', 'why', 'who', 'outside', 'retention', 'rights']);
        assert.ok(r.data.sections.every((s) => s.items.length >= 3));
        const text = JSON.stringify(r.data);
        for (const must of [/erase/i, /download/i, /Data Protection Board/, /Groq|Gemini/, /priority/i, /guardian/i]) assert.match(text, must);
    });

    it('states the retention periods the system actually applies', async () => {
        process.env.RETENTION_AI_CALL_DAYS = '45';
        const r = await t.api('/meta/privacy-notice');
        const retention = r.data.sections.find((s) => s.id === 'retention').items.join('\n');
        assert.match(retention, /AI calls .*removed after 45 days/);
        assert.equal(r.data.retention.ai_calls, 45);
        process.env.RETENTION_AI_CALL_DAYS = '0';
        assert.match((await t.api('/meta/privacy-notice')).data.sections.find((s) => s.id === 'retention').items.join('\n'), /AI calls .*: kept\./);
    });

    it('names a contact, configurable', async () => {
        assert.match((await t.api('/meta/privacy-notice')).data.contact, /Hostel Estates Office/);
        process.env.PRIVACY_CONTACT = 'privacy@vit.example';
        assert.equal((await t.api('/meta/privacy-notice')).data.contact, 'privacy@vit.example');
    });

    it('tells a resident when the notice changed since they accepted it, and stops once they accept again', async () => {
        const student = await t.login(SEED.student4);
        const current = require('../src/config/identity').PRIVACY_NOTICE_VERSION;
        const { studentProfile } = require('./helpers');
        const saved = await t.api('/me/profile', { method: 'PUT', token: student, body: studentProfile() });
        assert.ok([200, 201].includes(saved.status));
        assert.equal((await t.api('/me', { token: student })).data.privacy_notice_outdated, false);

        await t.sql(`UPDATE student_profiles SET privacy_notice_version = '2025-01' WHERE user_id = (SELECT user_id FROM users WHERE reg_or_emp_id = $1)`, [SEED.student4]);
        assert.equal((await t.api('/me', { token: student })).data.privacy_notice_outdated, true);
        // Everything still works while they have not yet accepted.
        assert.equal((await t.api('/complaints', { token: student })).status, 200);

        const again = await t.api('/me/profile', { method: 'PUT', token: student, body: studentProfile() });
        assert.equal(again.status, 200);
        assert.equal(again.data.profile.privacy_notice_version, current);
        assert.equal((await t.api('/me', { token: student })).data.privacy_notice_outdated, false);
    });

    it('is not shown to staff, who have no resident profile', async () => {
        const me = await t.api('/me', { token: await t.login(SEED.supervisor) });
        assert.equal(me.data.privacy_notice_outdated, undefined);
    });
});
