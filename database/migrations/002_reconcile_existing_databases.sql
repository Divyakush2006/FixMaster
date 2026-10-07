-- ============================================================================
-- FIX_MASTER migration 002: bring a pre-migration database up to 001's shape
-- ----------------------------------------------------------------------------
-- Before migrations existed, databases were built with init_all.sql. 001 uses
-- CREATE TABLE IF NOT EXISTS, so on such a database it leaves the old tables
-- (and their old constraints) in place. Everything here corrects those
-- differences. Each statement is idempotent: on a database created fresh by
-- 001 it is a no-op.
-- ============================================================================

-- users: account deactivation flag (new).
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
-- users: password change/reset timestamp used to revoke older tokens (new).
ALTER TABLE users ADD COLUMN IF NOT EXISTS credentials_changed_at TIMESTAMP WITH TIME ZONE;

-- users: store identifiers in canonical case so the case-insensitive unique
-- indexes below can be created. If two rows differ only by case this fails
-- loudly - that is two accounts for one person and needs a human decision.
UPDATE users SET reg_or_emp_id = UPPER(reg_or_emp_id) WHERE reg_or_emp_id <> UPPER(reg_or_emp_id);
UPDATE users SET email = LOWER(email) WHERE email <> LOWER(email);
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_reg_or_emp_id_ci ON users (UPPER(reg_or_emp_id));
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email_ci ON users (LOWER(email));

-- users: role <-> specialization must agree.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_staff_specialization') THEN
        ALTER TABLE users ADD CONSTRAINT chk_staff_specialization
            CHECK ((role = 'STAFF') = (specialization IS NOT NULL));
    END IF;
END $$;

-- student_room_allotments: the original UNIQUE(student_id, is_current)
-- capped every student at one historical allotment. Replace with a partial
-- unique index on the current allotment only.
ALTER TABLE student_room_allotments DROP CONSTRAINT IF EXISTS uq_student_active_allotment;
CREATE UNIQUE INDEX IF NOT EXISTS uq_student_current_allotment
    ON student_room_allotments (student_id) WHERE is_current = TRUE;
CREATE INDEX IF NOT EXISTS idx_allotments_room_current
    ON student_room_allotments (room_id) WHERE is_current = TRUE;

-- complaints: the original location check let a COMMON_AREA ticket also
-- carry a room_id.
ALTER TABLE complaints DROP CONSTRAINT IF EXISTS chk_complaint_location;
ALTER TABLE complaints ADD CONSTRAINT chk_complaint_location CHECK (
    (ticket_scope = 'ROOM' AND room_id IS NOT NULL AND common_area_id IS NULL) OR
    (ticket_scope = 'COMMON_AREA' AND common_area_id IS NOT NULL AND room_id IS NULL)
);

-- complaint_feedback: UNIQUE(complaint_id) made a rejected-then-reworked
-- ticket impossible to ever close (its second verification collided with
-- the first). Allow one row per verification round, at most one acceptance.
ALTER TABLE complaint_feedback DROP CONSTRAINT IF EXISTS complaint_feedback_complaint_id_key;
CREATE INDEX IF NOT EXISTS idx_feedback_complaint ON complaint_feedback (complaint_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_feedback_single_acceptance
    ON complaint_feedback (complaint_id) WHERE is_satisfactorily_resolved = TRUE;

-- Indexes added after the original schema.
CREATE INDEX IF NOT EXISTS idx_complaints_common_area ON complaints(common_area_id);
CREATE INDEX IF NOT EXISTS idx_complaints_created_at ON complaints(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_assignments_complaint ON complaint_assignments(complaint_id);
CREATE INDEX IF NOT EXISTS idx_logs_complaint_time ON complaint_logs(complaint_id, timestamp);

-- Serial sequences: seed data inserts categories/subcategories with explicit
-- ids, which does not advance the sequence. Left alone, the next row added
-- through the default would collide with id 1. Re-sync to the current max.
SELECT setval(pg_get_serial_sequence('complaint_categories', 'category_id'),
              GREATEST((SELECT COALESCE(MAX(category_id), 0) FROM complaint_categories), 1),
              (SELECT COUNT(*) > 0 FROM complaint_categories));
SELECT setval(pg_get_serial_sequence('complaint_subcategories', 'subcategory_id'),
              GREATEST((SELECT COALESCE(MAX(subcategory_id), 0) FROM complaint_subcategories), 1),
              (SELECT COUNT(*) > 0 FROM complaint_subcategories));
