const { recordAudit } = require('./auditService');
const { PRIVACY_NOTICE_VERSION } = require('../config/identity');

// The resident record collected at first sign-in (migration 010). Saving it
// for the first time finishes onboarding: the account becomes ACTIVE.

const FIELDS = [
    'school',
    'programme',
    'admission_year',
    'expected_graduation_year',
    'gender',
    'date_of_birth',
    'guardian_name',
    'guardian_relation',
    'guardian_phone',
    'local_guardian_name',
    'local_guardian_phone',
    'permanent_city',
    'permanent_state',
    'permanent_pincode',
    'preferred_cleaning_slot',
    'preferred_language',
    'health_consent',
    'blood_group',
    'medical_notes',
];

// Who may read which part of a resident's record. Health details are shown
// only to the people who would act on them in an emergency, and only when the
// student agreed to share them.
const HEALTH_READERS = new Set(['ADMIN', 'CHIEF_WARDEN', 'SUPERVISOR']);

const PROFILE_COLUMNS = `p.user_id, p.school, p.programme, p.admission_year, p.expected_graduation_year, p.gender,
    to_char(p.date_of_birth, 'YYYY-MM-DD') AS date_of_birth,
    p.guardian_name, p.guardian_relation, p.guardian_phone, p.local_guardian_name, p.local_guardian_phone,
    p.permanent_city, p.permanent_state, p.permanent_pincode, p.preferred_cleaning_slot, p.preferred_language,
    p.health_consent, p.blood_group, p.medical_notes, p.privacy_notice_version, p.privacy_consented_at,
    p.completed_at, p.updated_at`;

async function getProfile(executor, userId) {
    const { rows } = await executor.query(`SELECT ${PROFILE_COLUMNS} FROM student_profiles p WHERE p.user_id = $1`, [userId]);
    return rows[0] || null;
}

/** A profile as another person may see it. */
function forViewer(profile, viewerRole) {
    if (!profile) return null;
    if (profile.health_consent && HEALTH_READERS.has(viewerRole)) return profile;
    const { blood_group, medical_notes, ...rest } = profile; // eslint-disable-line no-unused-vars
    return { ...rest, blood_group: null, medical_notes: null };
}

/**
 * Creates or replaces the caller's profile in their transaction. Returns
 * { profile, activated } where activated means onboarding just finished.
 */
async function saveProfile(client, req, userId, input) {
    const values = FIELDS.map((f) => {
        const v = input[f];
        if (v === undefined || v === '') return null;
        return v;
    });
    // Defaults the validators leave optional.
    const idx = (f) => FIELDS.indexOf(f);
    values[idx('preferred_cleaning_slot')] = values[idx('preferred_cleaning_slot')] || 'ANY';
    values[idx('preferred_language')] = values[idx('preferred_language')] || 'en';
    values[idx('health_consent')] = input.health_consent === true;
    if (!values[idx('health_consent')]) {
        values[idx('blood_group')] = null;
        values[idx('medical_notes')] = null;
    }

    const user = await client.query('SELECT account_status FROM users WHERE user_id = $1 FOR UPDATE', [userId]);
    const existed = (await client.query('SELECT 1 FROM student_profiles WHERE user_id = $1', [userId])).rows.length > 0;

    const columns = FIELDS.join(', ');
    const params = FIELDS.map((_, i) => `$${i + 2}`).join(', ');
    const updates = FIELDS.map((f) => `${f} = EXCLUDED.${f}`).join(', ');
    await client.query(
        `INSERT INTO student_profiles (user_id, ${columns}, privacy_notice_version, privacy_consented_at)
         VALUES ($1, ${params}, $${FIELDS.length + 2}, NOW())
         ON CONFLICT (user_id) DO UPDATE SET ${updates},
             privacy_notice_version = EXCLUDED.privacy_notice_version,
             privacy_consented_at = CASE
                 WHEN student_profiles.privacy_notice_version = EXCLUDED.privacy_notice_version THEN student_profiles.privacy_consented_at
                 ELSE NOW() END,
             updated_at = NOW()`,
        [userId, ...values, PRIVACY_NOTICE_VERSION]
    );

    const activated = user.rows[0].account_status === 'PENDING_PROFILE';
    if (activated) {
        await client.query("UPDATE users SET account_status = 'ACTIVE' WHERE user_id = $1", [userId]);
    }
    await recordAudit(client, req, {
        actorUserId: userId,
        action: existed ? 'profile.updated' : 'profile.completed',
        targetType: 'user',
        targetId: userId,
        // Which consent applies, never the personal details themselves.
        details: { privacy_notice_version: PRIVACY_NOTICE_VERSION, health_consent: values[idx('health_consent')] },
    });
    return { profile: await getProfile(client, userId), activated };
}

module.exports = { getProfile, saveProfile, forViewer, PROFILE_COLUMNS };
