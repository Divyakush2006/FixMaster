-- ============================================================================
-- FIX_MASTER migration 010: VIT-only identity and first-run onboarding
-- ----------------------------------------------------------------------------
-- 1. Account lifecycle. A self-registered student starts PENDING_VERIFICATION
--    (they must prove they own the university mailbox), becomes
--    PENDING_PROFILE once the emailed code is confirmed, and ACTIVE when the
--    profile is complete. Accounts created before this migration, and every
--    account an administrator creates, are ACTIVE.
-- 2. email_verifications: single-use, short-lived codes. Only a keyed hash of
--    the code is stored, never the code.
-- 3. student_profiles: the record the hostel office keeps for each resident,
--    one row per student (1:1 with users), with the consent that covers it.
--    Health details are optional and only kept with their own consent.
-- ============================================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS account_status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_account_status;
ALTER TABLE users ADD CONSTRAINT chk_users_account_status
    CHECK (account_status IN ('PENDING_VERIFICATION', 'PENDING_PROFILE', 'ACTIVE'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMP WITH TIME ZONE;

-- Only students go through self-service onboarding.
ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_onboarding_students_only;
ALTER TABLE users ADD CONSTRAINT chk_users_onboarding_students_only
    CHECK (account_status = 'ACTIVE' OR role = 'STUDENT');

CREATE TABLE IF NOT EXISTS email_verifications (
    verification_id SERIAL PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    code_hash CHAR(64) NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    attempts INT NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    consumed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_email_verification_window CHECK (expires_at > created_at)
);
CREATE INDEX IF NOT EXISTS idx_email_verifications_user ON email_verifications (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS student_profiles (
    user_id VARCHAR(36) PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,

    -- Academic
    school VARCHAR(20) NOT NULL,
    programme VARCHAR(100) NOT NULL,
    admission_year SMALLINT NOT NULL CHECK (admission_year BETWEEN 2000 AND 2100),
    expected_graduation_year SMALLINT NOT NULL CHECK (expected_graduation_year BETWEEN 2000 AND 2110),

    -- Personal
    gender VARCHAR(20) NOT NULL CHECK (gender IN ('MALE', 'FEMALE', 'OTHER', 'UNDISCLOSED')),
    date_of_birth DATE NOT NULL,

    -- Emergency contacts
    guardian_name VARCHAR(100) NOT NULL,
    guardian_relation VARCHAR(30) NOT NULL,
    guardian_phone VARCHAR(15) NOT NULL CHECK (guardian_phone ~ '^[0-9]{10}$'),
    local_guardian_name VARCHAR(100),
    local_guardian_phone VARCHAR(15) CHECK (local_guardian_phone IS NULL OR local_guardian_phone ~ '^[0-9]{10}$'),

    -- Permanent address
    permanent_city VARCHAR(60) NOT NULL,
    permanent_state VARCHAR(60) NOT NULL,
    permanent_pincode CHAR(6) NOT NULL CHECK (permanent_pincode ~ '^[1-9][0-9]{5}$'),

    -- Preferences used by the service
    preferred_cleaning_slot VARCHAR(10) NOT NULL DEFAULT 'ANY'
        CHECK (preferred_cleaning_slot IN ('MORNING', 'AFTERNOON', 'EVENING', 'ANY')),
    preferred_language VARCHAR(5) NOT NULL DEFAULT 'en' CHECK (preferred_language IN ('en', 'hi', 'ta', 'te')),

    -- Health (optional, separate consent; visible to wardens only)
    health_consent BOOLEAN NOT NULL DEFAULT FALSE,
    blood_group VARCHAR(3) CHECK (blood_group IS NULL OR blood_group IN ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-')),
    medical_notes VARCHAR(500),

    -- Consent to the privacy notice that covers this record
    privacy_notice_version VARCHAR(20) NOT NULL,
    privacy_consented_at TIMESTAMP WITH TIME ZONE NOT NULL,

    completed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_profile_graduation_after_admission CHECK (expected_graduation_year >= admission_year),
    CONSTRAINT chk_profile_health_needs_consent CHECK (health_consent OR (blood_group IS NULL AND medical_notes IS NULL))
);
