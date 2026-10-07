-- ============================================================================
-- GENERATED FILE - DO NOT EDIT BY HAND.
-- Built by scripts/build-sql-bundles.js from: every migration in order + seed_data.sql
-- Change the schema by adding a migration under database/migrations/.
-- ============================================================================

-- DEVELOPMENT ONLY: everything below starts by DROPPING every table.
-- Never run this against a database whose data you want to keep; production
-- schemas are created and upgraded with `npm run db:migrate`.
DROP TABLE IF EXISTS schema_migrations CASCADE;
DROP TABLE IF EXISTS audit_log CASCADE;
DROP TABLE IF EXISTS revoked_tokens CASCADE;
DROP TABLE IF EXISTS complaint_logs CASCADE;
DROP TABLE IF EXISTS complaint_feedback CASCADE;
DROP TABLE IF EXISTS complaint_assignments CASCADE;
DROP TABLE IF EXISTS complaints CASCADE;
DROP TABLE IF EXISTS complaint_subcategories CASCADE;
DROP TABLE IF EXISTS complaint_categories CASCADE;
DROP TABLE IF EXISTS student_room_allotments CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS common_areas CASCADE;
DROP TABLE IF EXISTS rooms CASCADE;
DROP TABLE IF EXISTS block_floors CASCADE;
DROP TABLE IF EXISTS hostel_blocks CASCADE;

-- >>>>> MIGRATION 001_schema.sql <<<<<
-- ============================================================================
-- FIX_MASTER migration 001: tables, constraints and indexes
-- ----------------------------------------------------------------------------
-- Source of truth for the table layer. Applied by scripts/migrate.js, which
-- records it in schema_migrations so it runs exactly once per database.
-- Every statement is IF NOT EXISTS so this is also safe against a database
-- that was originally built with the old, destructive init_all.sql; 002
-- then reconciles any constraint differences on such a database.
--
-- Never put DROP TABLE in a migration. Schema changes go in a new numbered
-- file (004_..., 005_...), never by editing an already-applied one.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- 1. INFRASTRUCTURE & SPATIAL HIERARCHY
-- ============================================================================

CREATE TABLE IF NOT EXISTS hostel_blocks (
    block_id VARCHAR(10) PRIMARY KEY,
    block_name VARCHAR(50) NOT NULL,
    total_floors INT NOT NULL CHECK (total_floors > 0),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS rooms (
    room_id VARCHAR(20) PRIMARY KEY, -- e.g. 'L-843'
    block_id VARCHAR(10) NOT NULL REFERENCES hostel_blocks(block_id) ON DELETE CASCADE,
    room_number VARCHAR(10) NOT NULL,
    floor_number INT NOT NULL CHECK (floor_number >= 0),
    room_type VARCHAR(20) DEFAULT 'NON_AC' CHECK (room_type IN ('AC', 'NON_AC', 'DELUXE_AC')),
    bed_capacity INT DEFAULT 3 CHECK (bed_capacity BETWEEN 1 AND 6),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_block_room UNIQUE (block_id, room_number)
);

CREATE TABLE IF NOT EXISTS common_areas (
    area_id VARCHAR(30) PRIMARY KEY, -- e.g. 'L-F08-COOLER-01'
    block_id VARCHAR(10) NOT NULL REFERENCES hostel_blocks(block_id) ON DELETE CASCADE,
    floor_number INT NOT NULL,
    area_type VARCHAR(50) NOT NULL CHECK (
        area_type IN ('WATER_COOLER', 'COMMON_WASHROOM', 'SHOWER_ROOM', 'ELEVATOR', 'CORRIDOR', 'STUDY_HALL')
    ),
    description VARCHAR(150) NOT NULL,
    is_operational BOOLEAN DEFAULT TRUE
);

-- ============================================================================
-- 2. USER MANAGEMENT & RBAC (SINGLE USERS TABLE)
-- ============================================================================

CREATE TABLE IF NOT EXISTS users (
    user_id VARCHAR(36) PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    reg_or_emp_id VARCHAR(30) UNIQUE NOT NULL, -- Student RegNo or Staff Employee ID (stored upper-case)
    full_name VARCHAR(100) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,         -- stored lower-case
    phone_number VARCHAR(15) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL CHECK (role IN ('STUDENT', 'STAFF', 'SUPERVISOR', 'ADMIN')),
    specialization VARCHAR(30) CHECK (
        specialization IS NULL OR
        specialization IN ('CLEANING', 'ELECTRICIAN', 'CARPENTER', 'AC_TECH', 'PLUMBER')
    ),
    is_available BOOLEAN DEFAULT TRUE,   -- on/off duty (staff); used by auto-dispatch
    is_active BOOLEAN NOT NULL DEFAULT TRUE, -- account enabled; FALSE blocks login and every API call
    -- Set on password change/reset. Tokens issued before it are rejected, so
    -- changing a password signs out every other session.
    credentials_changed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    -- A STAFF account without a trade can never be matched by dispatch, and a
    -- trade on a non-staff account is meaningless.
    CONSTRAINT chk_staff_specialization CHECK ((role = 'STAFF') = (specialization IS NOT NULL))
);

-- Case-insensitive identity: '21bce0843' and '21BCE0843' are the same person.
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_reg_or_emp_id_ci ON users (UPPER(reg_or_emp_id));
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email_ci ON users (LOWER(email));

CREATE TABLE IF NOT EXISTS student_room_allotments (
    allotment_id SERIAL PRIMARY KEY,
    student_id VARCHAR(36) NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    room_id VARCHAR(20) NOT NULL REFERENCES rooms(room_id) ON DELETE RESTRICT,
    academic_year VARCHAR(10) NOT NULL, -- e.g. '2026-2027'
    is_current BOOLEAN DEFAULT TRUE,
    assigned_date DATE DEFAULT CURRENT_DATE
);

-- At most one CURRENT allotment per student; any number of historical rows.
CREATE UNIQUE INDEX IF NOT EXISTS uq_student_current_allotment
    ON student_room_allotments (student_id)
    WHERE is_current = TRUE;
CREATE INDEX IF NOT EXISTS idx_allotments_room_current
    ON student_room_allotments (room_id)
    WHERE is_current = TRUE;

-- ============================================================================
-- 3. CATEGORIES & TAXONOMY
-- ============================================================================

CREATE TABLE IF NOT EXISTS complaint_categories (
    category_id SERIAL PRIMARY KEY,
    category_code VARCHAR(30) UNIQUE NOT NULL,
    category_name VARCHAR(50) NOT NULL,
    is_quick_action BOOLEAN DEFAULT FALSE,
    default_sla_hours INT NOT NULL DEFAULT 24 CHECK (default_sla_hours > 0)
);

CREATE TABLE IF NOT EXISTS complaint_subcategories (
    subcategory_id SERIAL PRIMARY KEY,
    category_id INT NOT NULL REFERENCES complaint_categories(category_id) ON DELETE CASCADE,
    subcategory_code VARCHAR(30) UNIQUE NOT NULL,
    issue_name VARCHAR(100) NOT NULL,
    estimated_resolution_mins INT DEFAULT 30 CHECK (estimated_resolution_mins > 0),
    priority_level VARCHAR(10) DEFAULT 'MEDIUM' CHECK (priority_level IN ('LOW', 'MEDIUM', 'HIGH', 'EMERGENCY')),
    required_specialization VARCHAR(30) NOT NULL CHECK (
        required_specialization IN ('CLEANING', 'ELECTRICIAN', 'CARPENTER', 'AC_TECH', 'PLUMBER')
    )
);

-- ============================================================================
-- 4. COMPLAINTS, DISPATCH & FEEDBACK
-- ============================================================================

CREATE TABLE IF NOT EXISTS complaints (
    complaint_id VARCHAR(36) PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    ticket_scope VARCHAR(15) NOT NULL CHECK (ticket_scope IN ('ROOM', 'COMMON_AREA')),
    room_id VARCHAR(20) REFERENCES rooms(room_id) ON DELETE SET NULL,
    common_area_id VARCHAR(30) REFERENCES common_areas(area_id) ON DELETE SET NULL,
    block_id VARCHAR(10) NOT NULL REFERENCES hostel_blocks(block_id) ON DELETE RESTRICT,
    raised_by_user_id VARCHAR(36) NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    subcategory_id INT NOT NULL REFERENCES complaint_subcategories(subcategory_id) ON DELETE RESTRICT,
    description TEXT,
    photo_evidence_url VARCHAR(255),
    status VARCHAR(25) NOT NULL DEFAULT 'OPEN' CHECK (
        status IN ('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'PENDING_VERIFICATION', 'COMPLETED', 'ESCALATED', 'REJECTED')
    ),
    priority VARCHAR(10) DEFAULT 'MEDIUM' CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH', 'EMERGENCY')),
    preferred_timeslot VARCHAR(50),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMP WITH TIME ZONE,
    closed_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT chk_complaint_location CHECK (
        (ticket_scope = 'ROOM' AND room_id IS NOT NULL AND common_area_id IS NULL) OR
        (ticket_scope = 'COMMON_AREA' AND common_area_id IS NOT NULL AND room_id IS NULL)
    )
);

CREATE TABLE IF NOT EXISTS complaint_assignments (
    assignment_id SERIAL PRIMARY KEY,
    complaint_id VARCHAR(36) NOT NULL REFERENCES complaints(complaint_id) ON DELETE CASCADE,
    staff_user_id VARCHAR(36) NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    assigned_by_user_id VARCHAR(36) REFERENCES users(user_id) ON DELETE SET NULL,
    assigned_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    started_at TIMESTAMP WITH TIME ZONE,
    work_completed_at TIMESTAMP WITH TIME ZONE,
    current_state VARCHAR(20) DEFAULT 'ASSIGNED' CHECK (
        current_state IN ('ASSIGNED', 'ACCEPTED', 'EN_ROUTE', 'IN_PROGRESS', 'DONE', 'DECLINED')
    )
);

-- One feedback row per verification ROUND. A rejected round (ESCALATED) is
-- kept as history and the ticket goes back for rework, so the same complaint
-- legitimately collects several rows - but only one can ever accept the work.
CREATE TABLE IF NOT EXISTS complaint_feedback (
    feedback_id SERIAL PRIMARY KEY,
    complaint_id VARCHAR(36) NOT NULL REFERENCES complaints(complaint_id) ON DELETE CASCADE,
    student_id VARCHAR(36) NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    is_satisfactorily_resolved BOOLEAN NOT NULL,
    rating INT CHECK (rating BETWEEN 1 AND 5),
    student_comments TEXT,
    verified_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_feedback_complaint ON complaint_feedback (complaint_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_feedback_single_acceptance
    ON complaint_feedback (complaint_id)
    WHERE is_satisfactorily_resolved = TRUE;

CREATE TABLE IF NOT EXISTS complaint_logs (
    log_id SERIAL PRIMARY KEY,
    complaint_id VARCHAR(36) NOT NULL REFERENCES complaints(complaint_id) ON DELETE CASCADE,
    changed_by_user_id VARCHAR(36) REFERENCES users(user_id) ON DELETE SET NULL,
    previous_status VARCHAR(25),
    new_status VARCHAR(25) NOT NULL,
    action_note TEXT,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- 5. PERFORMANCE INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_complaints_block_status ON complaints(block_id, status);
CREATE INDEX IF NOT EXISTS idx_complaints_raised_by ON complaints(raised_by_user_id, status);
CREATE INDEX IF NOT EXISTS idx_complaints_room ON complaints(room_id);
CREATE INDEX IF NOT EXISTS idx_complaints_common_area ON complaints(common_area_id);
CREATE INDEX IF NOT EXISTS idx_complaints_created_at ON complaints(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_assignments_staff_state ON complaint_assignments(staff_user_id, current_state);
-- Foreign-key side of every complaint -> assignment/log join. Without these,
-- each lookup by complaint_id is a sequential scan of the whole table.
CREATE INDEX IF NOT EXISTS idx_assignments_complaint ON complaint_assignments(complaint_id);
CREATE INDEX IF NOT EXISTS idx_logs_complaint_time ON complaint_logs(complaint_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_users_staff_dispatch ON users(role, specialization, is_available) WHERE role = 'STAFF';

-- >>>>> MIGRATION 002_reconcile_existing_databases.sql <<<<<
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

-- >>>>> MIGRATION 003_programmable_objects.sql <<<<<
-- ============================================================================
-- FIX_MASTER migration 003: triggers, stored procedures and views
-- ----------------------------------------------------------------------------
-- Every object is CREATE OR REPLACE / DROP IF EXISTS + CREATE, so this file
-- is idempotent. To change one of these objects later, add a new migration
-- containing the new definition - do not edit this file after it has been
-- applied anywhere.
--
-- Error contract with the API (src/middleware/errorHandler.js): procedures
-- raise with a custom SQLSTATE whose last three digits are the HTTP status
-- the API should answer with, and a message that is safe to show a user.
--   FM400 bad request   FM403 forbidden   FM404 not found   FM409 conflict
-- ============================================================================

-- ============================================================================
-- 1. TRIGGERS
-- ============================================================================

-- Trigger 1: audit every complaint status change.
-- The acting user comes from the transaction-local setting app.current_user_id,
-- set by the API (src/config/db.js withTransaction). A change made outside the
-- API (manual SQL) is logged with changed_by_user_id = NULL rather than failing.
CREATE OR REPLACE FUNCTION fn_audit_complaint_status_change()
RETURNS TRIGGER AS $$
DECLARE
    v_actor_id VARCHAR(36);
BEGIN
    IF (OLD.status IS DISTINCT FROM NEW.status) THEN
        v_actor_id := NULLIF(current_setting('app.current_user_id', true), '');

        INSERT INTO complaint_logs (complaint_id, changed_by_user_id, previous_status, new_status, action_note)
        VALUES (NEW.complaint_id, v_actor_id, OLD.status, NEW.status,
                CONCAT('Transition: ', OLD.status, ' -> ', NEW.status));
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_complaint_status_audit ON complaints;
CREATE TRIGGER trg_complaint_status_audit
AFTER UPDATE OF status ON complaints
FOR EACH ROW
EXECUTE FUNCTION fn_audit_complaint_status_change();

-- Trigger 2: maintain resolved_at / closed_at.
-- resolved_at = "technician finished"; it is cleared when the student rejects
-- the work, so time-to-resolve reflects the round that actually fixed it.
CREATE OR REPLACE FUNCTION fn_update_complaint_timestamps()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'PENDING_VERIFICATION' AND OLD.status IS DISTINCT FROM 'PENDING_VERIFICATION' THEN
        NEW.resolved_at = CURRENT_TIMESTAMP;
    ELSIF NEW.status = 'ESCALATED' AND OLD.status IS DISTINCT FROM 'ESCALATED' THEN
        NEW.resolved_at = NULL;
    ELSIF NEW.status = 'COMPLETED' AND OLD.status IS DISTINCT FROM 'COMPLETED' THEN
        NEW.closed_at = CURRENT_TIMESTAMP;
        IF NEW.resolved_at IS NULL THEN
            NEW.resolved_at = CURRENT_TIMESTAMP;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_complaint_timestamps ON complaints;
CREATE TRIGGER trg_update_complaint_timestamps
BEFORE UPDATE OF status ON complaints
FOR EACH ROW
EXECUTE FUNCTION fn_update_complaint_timestamps();

-- ============================================================================
-- 2. STORED PROCEDURES
-- ============================================================================

-- Procedure 1: 1-click auto-dispatch to the least-loaded on-duty cleaner.
-- p_assigned_staff_id comes back NULL when nobody was available (the ticket
-- stays OPEN) - callers must check it rather than assume success.
-- The original 1-argument version is dropped so only this signature exists.
DROP PROCEDURE IF EXISTS sp_auto_dispatch_cleaning(VARCHAR);

CREATE OR REPLACE PROCEDURE sp_auto_dispatch_cleaning(
    p_complaint_id VARCHAR(36),
    INOUT p_assigned_staff_id VARCHAR(36) DEFAULT NULL
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_status VARCHAR(25);
    v_specialization VARCHAR(30);
BEGIN
    -- Lock the ticket: two concurrent dispatch calls must not both assign it.
    SELECT c.status, sub.required_specialization INTO v_status, v_specialization
    FROM complaints c
    JOIN complaint_subcategories sub ON sub.subcategory_id = c.subcategory_id
    WHERE c.complaint_id = p_complaint_id
    FOR UPDATE OF c;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Complaint not found.' USING ERRCODE = 'FM404';
    END IF;
    IF v_specialization <> 'CLEANING' THEN
        RAISE EXCEPTION 'Auto-dispatch only applies to cleaning tickets. Use manual assignment for this complaint.' USING ERRCODE = 'FM400';
    END IF;
    IF v_status NOT IN ('OPEN', 'ESCALATED') THEN
        RAISE EXCEPTION 'Complaint is % and cannot be dispatched right now.', v_status USING ERRCODE = 'FM409';
    END IF;

    SELECT u.user_id INTO p_assigned_staff_id
    FROM users u
    LEFT JOIN complaint_assignments ca
        ON u.user_id = ca.staff_user_id
        AND ca.current_state IN ('ASSIGNED', 'ACCEPTED', 'EN_ROUTE', 'IN_PROGRESS')
    WHERE u.role = 'STAFF'
      AND u.specialization = 'CLEANING'
      AND u.is_available = TRUE
      AND u.is_active = TRUE
    GROUP BY u.user_id
    ORDER BY COUNT(ca.assignment_id) ASC, u.created_at ASC
    LIMIT 1;

    IF p_assigned_staff_id IS NOT NULL THEN
        INSERT INTO complaint_assignments (complaint_id, staff_user_id, current_state)
        VALUES (p_complaint_id, p_assigned_staff_id, 'ASSIGNED');

        UPDATE complaints SET status = 'ASSIGNED' WHERE complaint_id = p_complaint_id;
    END IF;
    -- No staff available: leave the ticket exactly as it was (OPEN or ESCALATED).
END;
$$;

-- Procedure 2: closed-loop verification by the person who raised the ticket.
-- Fixes vs. the original:
--   * the ticket must actually be PENDING_VERIFICATION. Previously a student
--     could "verify" an OPEN ticket nobody had touched and close it as
--     COMPLETED, bypassing the whole dispatch -> work -> verify loop;
--   * one feedback row per verification round, so a rejected ticket can be
--     reworked and verified again (previously it dead-ended forever);
--   * only the assignment(s) in this round are touched - the original
--     rewrote every assignment's state and completion time on the ticket.
CREATE OR REPLACE PROCEDURE sp_confirm_resolution(
    p_complaint_id VARCHAR(36),
    p_student_id VARCHAR(36),
    p_is_satisfied BOOLEAN,
    p_rating INT,
    p_comments TEXT
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_ticket_student_id VARCHAR(36);
    v_current_status VARCHAR(25);
BEGIN
    SELECT raised_by_user_id, status
    INTO v_ticket_student_id, v_current_status
    FROM complaints
    WHERE complaint_id = p_complaint_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Complaint not found.' USING ERRCODE = 'FM404';
    END IF;
    IF v_ticket_student_id <> p_student_id THEN
        RAISE EXCEPTION 'Only the person who raised this complaint can verify it.' USING ERRCODE = 'FM403';
    END IF;
    IF v_current_status <> 'PENDING_VERIFICATION' THEN
        RAISE EXCEPTION 'This complaint is % - it can only be verified after the technician marks the work done.', v_current_status
            USING ERRCODE = 'FM409';
    END IF;

    INSERT INTO complaint_feedback (complaint_id, student_id, is_satisfactorily_resolved, rating, student_comments)
    VALUES (p_complaint_id, p_student_id, p_is_satisfied, p_rating, p_comments);

    IF p_is_satisfied THEN
        UPDATE complaints SET status = 'COMPLETED' WHERE complaint_id = p_complaint_id;
    ELSE
        UPDATE complaints SET status = 'ESCALATED' WHERE complaint_id = p_complaint_id;
        -- The work in this round was rejected.
        UPDATE complaint_assignments
        SET current_state = 'DECLINED'
        WHERE complaint_id = p_complaint_id AND current_state = 'DONE';
    END IF;
END;
$$;

-- Procedure 3: supervisor manual dispatch / re-dispatch.
-- The procedure is the authority on whether the assignment is valid; the
-- API's own checks exist only to produce friendlier messages first.
CREATE OR REPLACE PROCEDURE sp_supervisor_assign_task(
    p_complaint_id VARCHAR(36),
    p_staff_user_id VARCHAR(36),
    p_supervisor_user_id VARCHAR(36)
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_status VARCHAR(25);
    v_required VARCHAR(30);
    v_role VARCHAR(20);
    v_specialization VARCHAR(30);
    v_active BOOLEAN;
BEGIN
    SELECT c.status, sub.required_specialization INTO v_status, v_required
    FROM complaints c
    JOIN complaint_subcategories sub ON sub.subcategory_id = c.subcategory_id
    WHERE c.complaint_id = p_complaint_id
    FOR UPDATE OF c;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Complaint not found.' USING ERRCODE = 'FM404';
    END IF;
    IF v_status NOT IN ('OPEN', 'ESCALATED') THEN
        RAISE EXCEPTION 'Complaint is % and cannot be (re)assigned right now.', v_status USING ERRCODE = 'FM409';
    END IF;

    SELECT role, specialization, is_active INTO v_role, v_specialization, v_active
    FROM users WHERE user_id = p_staff_user_id;

    IF NOT FOUND OR v_role <> 'STAFF' THEN
        RAISE EXCEPTION 'staff_user_id does not refer to a staff member.' USING ERRCODE = 'FM400';
    END IF;
    IF NOT v_active THEN
        RAISE EXCEPTION 'That staff account is deactivated.' USING ERRCODE = 'FM400';
    END IF;
    IF v_specialization <> v_required THEN
        RAISE EXCEPTION 'This complaint needs a % technician; the selected staff member is %.', v_required, v_specialization
            USING ERRCODE = 'FM400';
    END IF;

    INSERT INTO complaint_assignments (complaint_id, staff_user_id, assigned_by_user_id, current_state)
    VALUES (p_complaint_id, p_staff_user_id, p_supervisor_user_id, 'ASSIGNED');

    UPDATE complaints SET status = 'ASSIGNED' WHERE complaint_id = p_complaint_id;
END;
$$;

-- ============================================================================
-- 3. VIEWS
-- ============================================================================

-- View 1: floor-ordered active queue per technician.
-- Filters on the ASSIGNMENT's state as well as the ticket's. Previously it
-- filtered on ticket status only, so after a rejected ticket was reassigned
-- to someone else, the first technician's old (DECLINED) assignment showed
-- up in their queue again as live work.
DROP VIEW IF EXISTS view_staff_active_queue;
CREATE VIEW view_staff_active_queue AS
SELECT
    ca.assignment_id,
    ca.staff_user_id,
    u_staff.full_name AS staff_name,
    u_staff.specialization,
    c.complaint_id,
    c.ticket_scope,
    COALESCE(r.room_number, ca_area.description) AS location_identifier,
    COALESCE(r.floor_number, ca_area.floor_number) AS floor_number,
    c.priority,
    cat.category_name,
    sub.issue_name,
    c.status,
    ca.current_state AS assignment_state,
    ca.assigned_at,
    u_student.full_name AS student_name,
    u_student.phone_number AS student_phone
FROM complaint_assignments ca
JOIN complaints c ON ca.complaint_id = c.complaint_id
JOIN users u_staff ON ca.staff_user_id = u_staff.user_id
JOIN users u_student ON c.raised_by_user_id = u_student.user_id
JOIN complaint_subcategories sub ON c.subcategory_id = sub.subcategory_id
JOIN complaint_categories cat ON sub.category_id = cat.category_id
LEFT JOIN rooms r ON c.room_id = r.room_id
LEFT JOIN common_areas ca_area ON c.common_area_id = ca_area.area_id
WHERE c.status IN ('ASSIGNED', 'IN_PROGRESS')
  AND ca.current_state IN ('ASSIGNED', 'ACCEPTED', 'EN_ROUTE', 'IN_PROGRESS')
ORDER BY
    COALESCE(r.floor_number, ca_area.floor_number) ASC,
    CASE c.priority
        WHEN 'EMERGENCY' THEN 1
        WHEN 'HIGH' THEN 2
        WHEN 'MEDIUM' THEN 3
        WHEN 'LOW' THEN 4
    END ASC,
    ca.assigned_at ASC;

-- View 2: per-block KPI summary.
-- Ratings are aggregated per complaint first. Joining complaint_feedback
-- directly would count a complaint once per verification round, inflating
-- every count for tickets that were rejected and reworked.
DROP VIEW IF EXISTS view_block_supervisor_summary;
CREATE VIEW view_block_supervisor_summary AS
SELECT
    b.block_id,
    b.block_name,
    COUNT(c.complaint_id) AS total_complaints,
    COUNT(CASE WHEN c.status IN ('OPEN', 'ASSIGNED') THEN 1 END) AS pending_complaints,
    COUNT(CASE WHEN c.status = 'IN_PROGRESS' THEN 1 END) AS active_in_progress,
    COUNT(CASE WHEN c.status = 'PENDING_VERIFICATION' THEN 1 END) AS awaiting_student_verification,
    COUNT(CASE WHEN c.status = 'COMPLETED' THEN 1 END) AS resolved_count,
    COUNT(CASE WHEN c.status = 'ESCALATED' THEN 1 END) AS escalated_count,
    COUNT(CASE WHEN c.ticket_scope = 'COMMON_AREA' THEN 1 END) AS common_area_issues,
    ROUND(COALESCE(AVG(fb.accepted_rating), 0), 2) AS average_student_rating
FROM hostel_blocks b
LEFT JOIN complaints c ON b.block_id = c.block_id
LEFT JOIN (
    SELECT complaint_id, MAX(rating) AS accepted_rating
    FROM complaint_feedback
    WHERE is_satisfactorily_resolved = TRUE AND rating IS NOT NULL
    GROUP BY complaint_id
) fb ON c.complaint_id = fb.complaint_id
GROUP BY b.block_id, b.block_name;

-- View 3: recurring defects in the last 14 days.
DROP VIEW IF EXISTS view_recurring_defects_alert;
CREATE VIEW view_recurring_defects_alert AS
SELECT
    c.block_id,
    c.ticket_scope,
    COALESCE(r.room_number, ca_area.description) AS asset_location,
    cat.category_name,
    COUNT(c.complaint_id) AS incident_count_14_days,
    MAX(c.created_at) AS most_recent_incident
FROM complaints c
JOIN complaint_subcategories sub ON c.subcategory_id = sub.subcategory_id
JOIN complaint_categories cat ON sub.category_id = cat.category_id
LEFT JOIN rooms r ON c.room_id = r.room_id
LEFT JOIN common_areas ca_area ON c.common_area_id = ca_area.area_id
WHERE c.created_at >= (CURRENT_TIMESTAMP - INTERVAL '14 days')
GROUP BY c.block_id, c.ticket_scope, COALESCE(r.room_number, ca_area.description), cat.category_name
HAVING COUNT(c.complaint_id) >= 2
ORDER BY incident_count_14_days DESC;

-- >>>>> MIGRATION 004_floors_room_numbering_and_blocks.sql <<<<<
-- ============================================================================
-- FIX_MASTER migration 004: floors as data, room numbering rules, blocks A-T
-- ----------------------------------------------------------------------------
-- 1. block_floors: every floor of every block is a row (floor 0 = Ground).
--    Previously a block only had a total_floors number, so there was no way
--    to add a floor, and nothing tied a room's floor to its block.
-- 2. Room numbering is enforced by the database:
--      room_number = <floor code><two-digit room 01-99>
--      floor code  = 'G' for the ground floor, otherwise the floor number
--      e.g. G01 = ground floor room 1, 428 = floor 4 room 28, 1007 = floor 10 room 7
--      room_id     = <block code>-<room_number>, e.g. A-428 (block code = block_id
--                    without its _BLOCK suffix; matches existing ids like L-843)
-- 3. Hostel blocks A to T exist out of the box, each with Ground + floors 1-10.
--    Rooms are added per block by an administrator.
--
-- Existing rows are untouched: the seed's L_BLOCK row is inserted here with
-- exactly the same values the seed uses, and every seed room already follows
-- the numbering rule.
-- ============================================================================

-- ---- 1. Floors -------------------------------------------------------------

CREATE TABLE IF NOT EXISTS block_floors (
    block_id VARCHAR(10) NOT NULL REFERENCES hostel_blocks(block_id) ON DELETE CASCADE,
    floor_number INT NOT NULL CHECK (floor_number BETWEEN 0 AND 99),
    -- 'G' for ground, otherwise the number: the prefix every room number on
    -- this floor must start with.
    floor_code VARCHAR(2) GENERATED ALWAYS AS (
        CASE WHEN floor_number = 0 THEN 'G' ELSE floor_number::text END
    ) STORED,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (block_id, floor_number)
);

-- Backfill floors for blocks that already exist: Ground + 1..total_floors,
-- plus any floor already used by a room or common area.
INSERT INTO block_floors (block_id, floor_number)
SELECT b.block_id, gs.n
FROM hostel_blocks b
CROSS JOIN LATERAL generate_series(0, b.total_floors) AS gs(n)
ON CONFLICT DO NOTHING;

INSERT INTO block_floors (block_id, floor_number)
SELECT DISTINCT block_id, floor_number FROM rooms
ON CONFLICT DO NOTHING;

INSERT INTO block_floors (block_id, floor_number)
SELECT DISTINCT block_id, floor_number FROM common_areas
ON CONFLICT DO NOTHING;

-- A new block automatically gets Ground + floors 1..total_floors.
CREATE OR REPLACE FUNCTION fn_create_block_floors()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO block_floors (block_id, floor_number)
    SELECT NEW.block_id, gs.n FROM generate_series(0, NEW.total_floors) AS gs(n)
    ON CONFLICT DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_create_block_floors ON hostel_blocks;
CREATE TRIGGER trg_create_block_floors
AFTER INSERT ON hostel_blocks
FOR EACH ROW
EXECUTE FUNCTION fn_create_block_floors();

-- hostel_blocks.total_floors stays meaningful (the highest floor above
-- ground) as floors are added or removed.
CREATE OR REPLACE FUNCTION fn_sync_block_total_floors()
RETURNS TRIGGER AS $$
DECLARE
    v_block_id VARCHAR(10) := COALESCE(NEW.block_id, OLD.block_id);
    v_top INT;
BEGIN
    SELECT GREATEST(1, COALESCE(MAX(floor_number), 1)) INTO v_top
    FROM block_floors WHERE block_id = v_block_id;

    UPDATE hostel_blocks SET total_floors = v_top
    WHERE block_id = v_block_id AND total_floors IS DISTINCT FROM v_top;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_block_total_floors ON block_floors;
CREATE TRIGGER trg_sync_block_total_floors
AFTER INSERT OR DELETE ON block_floors
FOR EACH ROW
EXECUTE FUNCTION fn_sync_block_total_floors();

-- ---- 2. Rooms and common areas belong to a real floor ------------------------

CREATE INDEX IF NOT EXISTS idx_rooms_block_floor ON rooms (block_id, floor_number);

DO $$
BEGIN
    -- NO ACTION (checked at end of statement) rather than RESTRICT, so that
    -- deleting a whole block can cascade to its rooms and floors together.
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_rooms_floor') THEN
        ALTER TABLE rooms ADD CONSTRAINT fk_rooms_floor
            FOREIGN KEY (block_id, floor_number) REFERENCES block_floors (block_id, floor_number);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_common_areas_floor') THEN
        ALTER TABLE common_areas ADD CONSTRAINT fk_common_areas_floor
            FOREIGN KEY (block_id, floor_number) REFERENCES block_floors (block_id, floor_number);
    END IF;

    -- Room number = floor code + two digits 01-99, and the floor code must be
    -- the room's own floor: 428 can only be on floor 4, G01 only on ground.
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_room_number_format') THEN
        ALTER TABLE rooms ADD CONSTRAINT chk_room_number_format CHECK (
            room_number ~ '^(G|[1-9][0-9]?)[0-9]{2}$'
            AND room_number = (CASE WHEN floor_number = 0 THEN 'G' ELSE floor_number::text END) || right(room_number, 2)
            AND right(room_number, 2) <> '00'
        );
    END IF;

    -- room_id is derived, never free text: <block code>-<room number>.
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_room_id_format') THEN
        ALTER TABLE rooms ADD CONSTRAINT chk_room_id_format CHECK (
            room_id = split_part(block_id, '_', 1) || '-' || room_number
        );
    END IF;
END $$;

-- ---- 3. Hostel blocks A to T --------------------------------------------------
-- Each gets Ground + floors 1-10 via trg_create_block_floors. L_BLOCK uses the
-- exact values of the existing seed row so that row is identical either way.

INSERT INTO hostel_blocks (block_id, block_name, total_floors) VALUES
('A_BLOCK', 'A-Block', 10),
('B_BLOCK', 'B-Block', 10),
('C_BLOCK', 'C-Block', 10),
('D_BLOCK', 'D-Block', 10),
('E_BLOCK', 'E-Block', 10),
('F_BLOCK', 'F-Block', 10),
('G_BLOCK', 'G-Block', 10),
('H_BLOCK', 'H-Block', 10),
('I_BLOCK', 'I-Block', 10),
('J_BLOCK', 'J-Block', 10),
('K_BLOCK', 'K-Block', 10),
('L_BLOCK', 'L-Block (Ladies/Mens Hostel)', 10),
('M_BLOCK', 'M-Block', 10),
('N_BLOCK', 'N-Block', 10),
('O_BLOCK', 'O-Block', 10),
('P_BLOCK', 'P-Block', 10),
('Q_BLOCK', 'Q-Block', 10),
('R_BLOCK', 'R-Block', 10),
('S_BLOCK', 'S-Block', 10),
('T_BLOCK', 'T-Block', 10)
ON CONFLICT (block_id) DO NOTHING;

-- >>>>> MIGRATION 005_account_security_and_audit_log.sql <<<<<
-- ============================================================================
-- FIX_MASTER migration 005: account lockout + administrative audit log
-- ----------------------------------------------------------------------------
-- Idempotent (IF NOT EXISTS everywhere). Do not edit after it has been applied;
-- add a new migration instead.
-- ============================================================================

-- ---- Per-account sign-in lockout ---------------------------------------------
-- IP-based rate limits alone are not enough: a hostel campus sits behind a
-- few NAT addresses (so a per-IP limit locks out everyone at once), while a
-- distributed attacker rotates addresses (so a per-IP limit never trips).
-- The account itself therefore counts consecutive failures and is locked for
-- a cooling-off period after too many, wherever they come from.
ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_count INT NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_users_failed_login_count') THEN
        ALTER TABLE users ADD CONSTRAINT chk_users_failed_login_count CHECK (failed_login_count >= 0);
    END IF;
END $$;

-- ---- Server-side sign-out -------------------------------------------------------
-- Session tokens are stateless JWTs, so deleting one in the browser does not
-- stop a copy of it from working until it expires. Every token carries a
-- unique id (jti); signing out records it here and the API refuses it from
-- then on. Rows are only needed until the token would have expired anyway.
CREATE TABLE IF NOT EXISTS revoked_tokens (
    jti VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(36) REFERENCES users(user_id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_revoked_tokens_expiry ON revoked_tokens (expires_at);

-- ---- Administrative audit log -------------------------------------------------
-- Who did what to which record, and when. Complaint status history already
-- lives in complaint_logs; this table covers everything else that changes
-- access or capacity: accounts, passwords, allotments, blocks, floors, rooms,
-- administrator sign-ins and account lockouts.
-- Rows are append-only: the API never updates or deletes them.
CREATE TABLE IF NOT EXISTS audit_log (
    audit_id BIGSERIAL PRIMARY KEY,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actor_user_id VARCHAR(36) REFERENCES users(user_id) ON DELETE SET NULL,
    action VARCHAR(60) NOT NULL,
    target_type VARCHAR(30),
    target_id VARCHAR(60),
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    ip_address VARCHAR(64),
    request_id VARCHAR(64)
);

CREATE INDEX IF NOT EXISTS idx_audit_log_time ON audit_log (occurred_at DESC, audit_id DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON audit_log (actor_user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log (action, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_target ON audit_log (target_type, target_id);

-- >>>>> MIGRATION 006_dispatch_reassignment.sql <<<<<
-- ============================================================================
-- FIX_MASTER migration 006: supervisors can reassign work in progress
-- ----------------------------------------------------------------------------
-- Replaces sp_supervisor_assign_task (migration 003). Before this, a ticket
-- could only be assigned while OPEN or ESCALATED, so once a technician had it
-- (ASSIGNED / IN_PROGRESS) nobody could move it: a technician who went off
-- shift, fell sick or simply never turned up left the ticket stuck until an
-- administrator deactivated their whole account.
--
-- Now an ASSIGNED or IN_PROGRESS ticket can be handed to another technician
-- of the right trade. The previous assignment is closed as DECLINED (it no
-- longer appears in that technician's queue) and the hand-over is recorded in
-- complaint_logs with both names.
-- ============================================================================

CREATE OR REPLACE PROCEDURE sp_supervisor_assign_task(
    p_complaint_id VARCHAR(36),
    p_staff_user_id VARCHAR(36),
    p_supervisor_user_id VARCHAR(36)
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_status VARCHAR(25);
    v_required VARCHAR(30);
    v_role VARCHAR(20);
    v_specialization VARCHAR(30);
    v_active BOOLEAN;
    v_new_name VARCHAR(100);
    v_previous_staff_id VARCHAR(36);
    v_previous_name VARCHAR(100);
BEGIN
    SELECT c.status, sub.required_specialization INTO v_status, v_required
    FROM complaints c
    JOIN complaint_subcategories sub ON sub.subcategory_id = c.subcategory_id
    WHERE c.complaint_id = p_complaint_id
    FOR UPDATE OF c;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Complaint not found.' USING ERRCODE = 'FM404';
    END IF;
    IF v_status NOT IN ('OPEN', 'ESCALATED', 'ASSIGNED', 'IN_PROGRESS') THEN
        RAISE EXCEPTION 'Complaint is % and cannot be (re)assigned right now.', v_status USING ERRCODE = 'FM409';
    END IF;

    SELECT role, specialization, is_active, full_name INTO v_role, v_specialization, v_active, v_new_name
    FROM users WHERE user_id = p_staff_user_id;

    IF NOT FOUND OR v_role <> 'STAFF' THEN
        RAISE EXCEPTION 'staff_user_id does not refer to a staff member.' USING ERRCODE = 'FM400';
    END IF;
    IF NOT v_active THEN
        RAISE EXCEPTION 'That staff account is deactivated.' USING ERRCODE = 'FM400';
    END IF;
    IF v_specialization <> v_required THEN
        RAISE EXCEPTION 'This complaint needs a % technician; the selected staff member is %.', v_required, v_specialization
            USING ERRCODE = 'FM400';
    END IF;

    -- Reassignment: close the live assignment(s) of the current technician.
    IF v_status IN ('ASSIGNED', 'IN_PROGRESS') THEN
        SELECT ca.staff_user_id, u.full_name INTO v_previous_staff_id, v_previous_name
        FROM complaint_assignments ca
        JOIN users u ON u.user_id = ca.staff_user_id
        WHERE ca.complaint_id = p_complaint_id
          AND ca.current_state IN ('ASSIGNED', 'ACCEPTED', 'EN_ROUTE', 'IN_PROGRESS')
        ORDER BY ca.assigned_at DESC
        LIMIT 1;

        IF v_previous_staff_id = p_staff_user_id THEN
            RAISE EXCEPTION 'This ticket is already assigned to %.', v_new_name USING ERRCODE = 'FM409';
        END IF;

        UPDATE complaint_assignments
        SET current_state = 'DECLINED'
        WHERE complaint_id = p_complaint_id
          AND current_state IN ('ASSIGNED', 'ACCEPTED', 'EN_ROUTE', 'IN_PROGRESS');
    END IF;

    INSERT INTO complaint_assignments (complaint_id, staff_user_id, assigned_by_user_id, current_state)
    VALUES (p_complaint_id, p_staff_user_id, p_supervisor_user_id, 'ASSIGNED');

    UPDATE complaints SET status = 'ASSIGNED' WHERE complaint_id = p_complaint_id;

    -- Record the hand-over with both names. ASSIGNED -> ASSIGNED is not a
    -- status change, so the status trigger wrote nothing and the entry is
    -- added here; IN_PROGRESS -> ASSIGNED was just logged by the trigger, so
    -- that entry's generic note is replaced instead of adding a duplicate.
    IF v_previous_staff_id IS NOT NULL THEN
        IF v_status = 'ASSIGNED' THEN
            INSERT INTO complaint_logs (complaint_id, changed_by_user_id, previous_status, new_status, action_note)
            VALUES (p_complaint_id, p_supervisor_user_id, 'ASSIGNED', 'ASSIGNED',
                    CONCAT('Reassigned from ', COALESCE(v_previous_name, 'previous technician'), ' to ', v_new_name));
        ELSE
            UPDATE complaint_logs
            SET action_note = CONCAT('Reassigned from ', COALESCE(v_previous_name, 'previous technician'), ' to ', v_new_name)
            WHERE log_id = (
                SELECT log_id FROM complaint_logs
                WHERE complaint_id = p_complaint_id AND previous_status = v_status AND new_status = 'ASSIGNED'
                ORDER BY log_id DESC LIMIT 1
            );
        END IF;
    END IF;
END;
$$;

-- >>>>> SEED DATA (VIT L-BLOCK DEMO) <<<<<
-- ============================================================================
-- FIX_MASTER: Realistic Seed Dataset for VIT Vellore (L-Block Focus)
-- Course: BCSE307L - Database Systems (SCOPE, VIT Vellore)
-- Database Engine: PostgreSQL 15+
-- ============================================================================

-- 1. Insert Hostel Blocks
INSERT INTO hostel_blocks (block_id, block_name, total_floors) VALUES
('L_BLOCK', 'L-Block (Ladies/Mens Hostel)', 10),
('PRP_BLOCK', 'PRP Block', 8),
('MH_BLOCK', 'Mens Hostel Block Q', 12)
ON CONFLICT (block_id) DO NOTHING;

-- 2. Insert Rooms for L-Block (Floors 1-10, with full Floor 8 rooms: L-801 to L-850)
INSERT INTO rooms (room_id, block_id, room_number, floor_number, room_type, bed_capacity) VALUES
-- Floor 8 (Primary focus: Room 843, 810, 825, etc.)
('L-801', 'L_BLOCK', '801', 8, 'AC', 3),
('L-802', 'L_BLOCK', '802', 8, 'AC', 3),
('L-810', 'L_BLOCK', '810', 8, 'NON_AC', 4),
('L-825', 'L_BLOCK', '825', 8, 'AC', 2),
('L-840', 'L_BLOCK', '840', 8, 'NON_AC', 3),
('L-841', 'L_BLOCK', '841', 8, 'AC', 3),
('L-842', 'L_BLOCK', '842', 8, 'AC', 3),
('L-843', 'L_BLOCK', '843', 8, 'AC', 3), -- Target demonstration room
('L-844', 'L_BLOCK', '844', 8, 'AC', 3),
('L-845', 'L_BLOCK', '845', 8, 'NON_AC', 4),
('L-850', 'L_BLOCK', '850', 8, 'DELUXE_AC', 2),
-- Other floors for routing demonstration
('L-101', 'L_BLOCK', '101', 1, 'NON_AC', 3),
('L-201', 'L_BLOCK', '201', 2, 'AC', 3),
('L-305', 'L_BLOCK', '305', 3, 'AC', 3),
('L-412', 'L_BLOCK', '412', 4, 'NON_AC', 4),
('L-520', 'L_BLOCK', '520', 5, 'AC', 3),
('L-615', 'L_BLOCK', '615', 6, 'NON_AC', 3),
('L-730', 'L_BLOCK', '730', 7, 'AC', 2)
ON CONFLICT (room_id) DO NOTHING;

-- 3. Insert Common Areas in L-Block
INSERT INTO common_areas (area_id, block_id, floor_number, area_type, description, is_operational) VALUES
('L-F08-COOLER-01', 'L_BLOCK', 8, 'WATER_COOLER', 'Floor 8 Water Cooler (Near Lift A)', TRUE),
('L-F08-WASHROOM-01', 'L_BLOCK', 8, 'COMMON_WASHROOM', 'Floor 8 West Wing Washroom Block', TRUE),
('L-F04-COOLER-01', 'L_BLOCK', 4, 'WATER_COOLER', 'Floor 4 Water Cooler (Near Stairs)', TRUE),
('L-F04-WASHROOM-01', 'L_BLOCK', 4, 'COMMON_WASHROOM', 'Floor 4 East Wing Washroom', TRUE),
('L-ELEVATOR-01', 'L_BLOCK', 1, 'ELEVATOR', 'L-Block Main Passenger Lift 1', TRUE),
('L-ELEVATOR-02', 'L_BLOCK', 1, 'ELEVATOR', 'L-Block Main Passenger Lift 2', TRUE)
ON CONFLICT (area_id) DO NOTHING;

-- 4. Insert Unified Users (Admins, Supervisors, Staff, Students)
-- Password for all seed users is 'Password@123' (bcrypt, cost 12, verified to match).
-- This is a shared demo credential for local development only - rotate it before
-- any deployment that isn't strictly local.
INSERT INTO users (user_id, reg_or_emp_id, full_name, email, phone_number, password_hash, role, specialization, is_available) VALUES
-- Admin
('u001-admin-0001-uuid-000000000001', 'ADMIN_ESTATES_01', 'Chief Warden / Estates Admin', 'admin.hostels@vit.ac.in', '9876543210', '$2b$12$FHrTmI5VL8yWlJQ07Vfcx.nuZhvBoNSdei0tQSGyJwCjM1BY2uxiS', 'ADMIN', NULL, TRUE),

-- Supervisors
('u002-supv-0001-uuid-000000000002', 'SUP_LBLOCK_01', 'Mr. R. Sundaram (L-Block Supervisor)', 'supervisor.lblock@vit.ac.in', '9876543211', '$2b$12$FHrTmI5VL8yWlJQ07Vfcx.nuZhvBoNSdei0tQSGyJwCjM1BY2uxiS', 'SUPERVISOR', NULL, TRUE),

-- Maintenance Staff (5 Specializations)
('u003-staf-clean-uuid-000000000003', 'EMP_CLN_01', 'Murugan K (Housekeeper)', 'murugan.cln@vit.ac.in', '9876543220', '$2b$12$FHrTmI5VL8yWlJQ07Vfcx.nuZhvBoNSdei0tQSGyJwCjM1BY2uxiS', 'STAFF', 'CLEANING', TRUE),
('u004-staf-clean-uuid-000000000004', 'EMP_CLN_02', 'Ramesh P (Housekeeper)', 'ramesh.cln@vit.ac.in', '9876543221', '$2b$12$FHrTmI5VL8yWlJQ07Vfcx.nuZhvBoNSdei0tQSGyJwCjM1BY2uxiS', 'STAFF', 'CLEANING', TRUE),
('u005-staf-elec-uuid-000000000005', 'EMP_ELEC_01', 'Suresh Kumar (Electrician)', 'suresh.elec@vit.ac.in', '9876543222', '$2b$12$FHrTmI5VL8yWlJQ07Vfcx.nuZhvBoNSdei0tQSGyJwCjM1BY2uxiS', 'STAFF', 'ELECTRICIAN', TRUE),
('u006-staf-carp-uuid-000000000006', 'EMP_CARP_01', 'Govindraj M (Carpenter)', 'govind.carp@vit.ac.in', '9876543223', '$2b$12$FHrTmI5VL8yWlJQ07Vfcx.nuZhvBoNSdei0tQSGyJwCjM1BY2uxiS', 'STAFF', 'CARPENTER', TRUE),
('u007-staf-actech-uuid-000000000007', 'EMP_AC_01', 'Dhanush V (AC Specialist)', 'dhanush.ac@vit.ac.in', '9876543224', '$2b$12$FHrTmI5VL8yWlJQ07Vfcx.nuZhvBoNSdei0tQSGyJwCjM1BY2uxiS', 'STAFF', 'AC_TECH', TRUE),
('u008-staf-plumb-uuid-000000000008', 'EMP_PLB_01', 'Karthik N (Plumber)', 'karthik.plb@vit.ac.in', '9876543225', '$2b$12$FHrTmI5VL8yWlJQ07Vfcx.nuZhvBoNSdei0tQSGyJwCjM1BY2uxiS', 'STAFF', 'PLUMBER', TRUE),

-- Students residing in L-Block
('u009-stud-0843-uuid-000000000009', '21BCE0843', 'Vihaan Sharma', 'vihaan.sharma2021@vitstudent.ac.in', '9876543230', '$2b$12$FHrTmI5VL8yWlJQ07Vfcx.nuZhvBoNSdei0tQSGyJwCjM1BY2uxiS', 'STUDENT', NULL, TRUE),
('u010-stud-0810-uuid-000000000010', '21BCE1042', 'Rahul Varma', 'rahul.varma2021@vitstudent.ac.in', '9876543231', '$2b$12$FHrTmI5VL8yWlJQ07Vfcx.nuZhvBoNSdei0tQSGyJwCjM1BY2uxiS', 'STUDENT', NULL, TRUE),
('u011-stud-0825-uuid-000000000011', '21BCE1523', 'Aditya Nair', 'aditya.nair2021@vitstudent.ac.in', '9876543232', '$2b$12$FHrTmI5VL8yWlJQ07Vfcx.nuZhvBoNSdei0tQSGyJwCjM1BY2uxiS', 'STUDENT', NULL, TRUE),
('u012-stud-0305-uuid-000000000012', '22BCE0190', 'Priya Iyer', 'priya.iyer2022@vitstudent.ac.in', '9876543233', '$2b$12$FHrTmI5VL8yWlJQ07Vfcx.nuZhvBoNSdei0tQSGyJwCjM1BY2uxiS', 'STUDENT', NULL, TRUE)
ON CONFLICT (user_id) DO NOTHING;

-- 5. Insert Student Room Allotments
INSERT INTO student_room_allotments (student_id, room_id, academic_year, is_current) VALUES
('u009-stud-0843-uuid-000000000009', 'L-843', '2026-2027', TRUE),
('u010-stud-0810-uuid-000000000010', 'L-810', '2026-2027', TRUE),
('u011-stud-0825-uuid-000000000011', 'L-825', '2026-2027', TRUE),
('u012-stud-0305-uuid-000000000012', 'L-305', '2026-2027', TRUE)
ON CONFLICT DO NOTHING;

-- 6. Insert Complaint Categories Master
INSERT INTO complaint_categories (category_id, category_code, category_name, is_quick_action, default_sla_hours) VALUES
(1, 'CLEANING', 'Housekeeping & Cleaning', TRUE, 4),
(2, 'ELECTRICAL', 'Electrical & Power Systems', FALSE, 12),
(3, 'AC_MAINTENANCE', 'AC & HVAC Maintenance', FALSE, 24),
(4, 'CARPENTER', 'Carpentry & Furniture', FALSE, 24),
(5, 'PLUMBING', 'Plumbing & Sanitary', FALSE, 12),
(6, 'COMMON_AREA_INFRA', 'Hostel Block Infrastructure', FALSE, 6)
ON CONFLICT (category_id) DO NOTHING;

-- 7. Insert Complaint Subcategories (25 Issues)
INSERT INTO complaint_subcategories (subcategory_id, category_id, subcategory_code, issue_name, estimated_resolution_mins, priority_level, required_specialization) VALUES
-- Housekeeping
(1, 1, 'CLN_ROOM_SWEEP', '1-Click Room Cleaning & Mopping', 20, 'LOW', 'CLEANING'),
(2, 1, 'CLN_DUSTING', 'Room Dusting & Balcony Sweep', 30, 'LOW', 'CLEANING'),
(3, 1, 'CLN_TRASH', 'Room Trash / Dustbin Clearance', 15, 'LOW', 'CLEANING'),

-- Electrical
(4, 2, 'ELEC_LIGHT', 'Tube Light / Bulb Failure', 20, 'MEDIUM', 'ELECTRICIAN'),
(5, 2, 'ELEC_SOCKET', 'Power Socket Damaged / Sparking', 30, 'HIGH', 'ELECTRICIAN'),
(6, 2, 'ELEC_SWITCH', 'Switch Board Loose / Burnt', 25, 'HIGH', 'ELECTRICIAN'),
(7, 2, 'ELEC_FAN', 'Fan Regulator Broken / Not Rotating', 30, 'MEDIUM', 'ELECTRICIAN'),
(8, 2, 'ELEC_MCB', 'Room MCB Tripped / Main Power Loss', 15, 'HIGH', 'ELECTRICIAN'),

-- AC & HVAC
(9, 3, 'AC_COOLING', 'AC Not Cooling / Weak Airflow', 45, 'MEDIUM', 'AC_TECH'),
(10, 3, 'AC_SMELL', 'AC Foul / Burning Smell', 40, 'HIGH', 'AC_TECH'),
(11, 3, 'AC_LEAKAGE', 'Water Dripping / Leakage in Room', 45, 'HIGH', 'AC_TECH'),
(12, 3, 'AC_REMOTE', 'AC Remote Malfunction / Error Code', 20, 'LOW', 'AC_TECH'),

-- Carpentry
(13, 4, 'CARP_DESK_CHAIR', 'Study Table / Chair Leg Broken', 40, 'MEDIUM', 'CARPENTER'),
(14, 4, 'CARP_ALMIRAH', 'Almirah / Wardrobe Hinge Broken', 35, 'MEDIUM', 'CARPENTER'),
(15, 4, 'CARP_DOOR_LOCK', 'Room Door Lock / Latch Jammed', 30, 'HIGH', 'CARPENTER'),
(16, 4, 'CARP_BED', 'Bed Frame / Plywood Base Cracked', 60, 'HIGH', 'CARPENTER'),

-- Plumbing
(17, 5, 'PLUMB_TAP', 'Water Tap Leaking / Broken Nozzle', 20, 'LOW', 'PLUMBER'),
(18, 5, 'PLUMB_FLUSH', 'Flush Tank Overflow / Not Filling', 30, 'MEDIUM', 'PLUMBER'),
(19, 5, 'PLUMB_DRAIN', 'Washbasin / Drain Clogged', 35, 'HIGH', 'PLUMBER'),
(20, 5, 'PLUMB_GEYSER', 'Geyser / Hot Water Not Working', 45, 'MEDIUM', 'PLUMBER'),

-- Common Area
(21, 6, 'INFRA_COOLER_TEMP', 'Water Cooler No Cold Water', 60, 'HIGH', 'AC_TECH'),
(22, 6, 'INFRA_COOLER_RO', 'Purifier Filter Choked / Bad Taste', 45, 'HIGH', 'PLUMBER'),
(23, 6, 'INFRA_WASHROOM_BURST', 'Common Washroom Main Pipe Burst', 30, 'EMERGENCY', 'PLUMBER'),
(24, 6, 'INFRA_LIFT_FAULT', 'Elevator Jerking / Door Sensor Fault', 45, 'EMERGENCY', 'ELECTRICIAN'),
(25, 6, 'INFRA_CORRIDOR_LIGHT', 'Corridor Tube Lights Out', 30, 'MEDIUM', 'ELECTRICIAN')
ON CONFLICT (subcategory_id) DO NOTHING;

-- 8. Insert Sample Active & Past Complaints across states
INSERT INTO complaints (complaint_id, ticket_scope, room_id, common_area_id, block_id, raised_by_user_id, subcategory_id, description, status, priority, preferred_timeslot, created_at, resolved_at, closed_at) VALUES
-- 1. Vihaan in Room 843: Active 1-Click Cleaning (In Progress)
('cmp-843-0001-uuid-000000000001', 'ROOM', 'L-843', NULL, 'L_BLOCK', 'u009-stud-0843-uuid-000000000009', 1, 'Quick 1-Click Daily Room Cleaning requested for Room 843.', 'IN_PROGRESS', 'LOW', 'Immediate', CURRENT_TIMESTAMP - INTERVAL '1 hour', NULL, NULL),

-- 2. Vihaan in Room 843: Electrical Socket Sparking (Assigned)
('cmp-843-0002-uuid-000000000002', 'ROOM', 'L-843', NULL, 'L_BLOCK', 'u009-stud-0843-uuid-000000000009', 5, 'Left study table socket has spark when laptop charger is plugged in.', 'ASSIGNED', 'HIGH', '04:00 PM - 06:00 PM', CURRENT_TIMESTAMP - INTERVAL '3 hours', NULL, NULL),

-- 3. Rahul in Room 810: Table Leg Broken (Pending Verification)
('cmp-810-0001-uuid-000000000003', 'ROOM', 'L-810', NULL, 'L_BLOCK', 'u010-stud-0810-uuid-000000000010', 13, 'Study chair backrest broken and table leg screw loose.', 'PENDING_VERIFICATION', 'MEDIUM', '02:00 PM - 04:00 PM', CURRENT_TIMESTAMP - INTERVAL '6 hours', CURRENT_TIMESTAMP - INTERVAL '30 mins', NULL),

-- 4. Aditya in Room 825: AC Water Dripping (Completed & Rated 5 Stars)
('cmp-825-0001-uuid-000000000004', 'ROOM', 'L-825', NULL, 'L_BLOCK', 'u011-stud-0825-uuid-000000000011', 11, 'AC water dripping over wardrobe.', 'COMPLETED', 'HIGH', 'Morning', CURRENT_TIMESTAMP - INTERVAL '2 days', CURRENT_TIMESTAMP - INTERVAL '1 day', CURRENT_TIMESTAMP - INTERVAL '1 day'),

-- 5. Common Area Outage: Floor 8 Water Cooler Down
('cmp-cmn-0001-uuid-000000000005', 'COMMON_AREA', NULL, 'L-F08-COOLER-01', 'L_BLOCK', 'u009-stud-0843-uuid-000000000009', 21, 'Floor 8 water cooler is dispensing warm water since morning.', 'ASSIGNED', 'HIGH', 'Anytime', CURRENT_TIMESTAMP - INTERVAL '5 hours', NULL, NULL)
ON CONFLICT (complaint_id) DO NOTHING;

-- 9. Insert Complaint Assignments for Active Complaints
INSERT INTO complaint_assignments (complaint_id, staff_user_id, assigned_by_user_id, assigned_at, started_at, work_completed_at, current_state) VALUES
('cmp-843-0001-uuid-000000000001', 'u003-staf-clean-uuid-000000000003', NULL, CURRENT_TIMESTAMP - INTERVAL '50 mins', CURRENT_TIMESTAMP - INTERVAL '30 mins', NULL, 'IN_PROGRESS'),
('cmp-843-0002-uuid-000000000002', 'u005-staf-elec-uuid-000000000005', 'u002-supv-0001-uuid-000000000002', CURRENT_TIMESTAMP - INTERVAL '2 hours', NULL, NULL, 'ASSIGNED'),
('cmp-810-0001-uuid-000000000003', 'u006-staf-carp-uuid-000000000006', 'u002-supv-0001-uuid-000000000002', CURRENT_TIMESTAMP - INTERVAL '5 hours', CURRENT_TIMESTAMP - INTERVAL '2 hours', CURRENT_TIMESTAMP - INTERVAL '30 mins', 'DONE'),
('cmp-825-0001-uuid-000000000004', 'u007-staf-actech-uuid-000000000007', NULL, CURRENT_TIMESTAMP - INTERVAL '2 days', CURRENT_TIMESTAMP - INTERVAL '1 day', CURRENT_TIMESTAMP - INTERVAL '1 day', 'DONE'),
('cmp-cmn-0001-uuid-000000000005', 'u007-staf-actech-uuid-000000000007', 'u002-supv-0001-uuid-000000000002', CURRENT_TIMESTAMP - INTERVAL '4 hours', NULL, NULL, 'ASSIGNED')
ON CONFLICT DO NOTHING;

-- 10. Insert Feedback for Completed Complaint
INSERT INTO complaint_feedback (complaint_id, student_id, is_satisfactorily_resolved, rating, student_comments, verified_at) VALUES
('cmp-825-0001-uuid-000000000004', 'u011-stud-0825-uuid-000000000011', TRUE, 5, 'AC technician cleaned the drainage pipe thoroughly. No more leaking.', CURRENT_TIMESTAMP - INTERVAL '1 day')
ON CONFLICT (complaint_id) WHERE is_satisfactorily_resolved = TRUE DO NOTHING;

-- 11. Insert Audit History Logs
INSERT INTO complaint_logs (complaint_id, changed_by_user_id, previous_status, new_status, action_note, timestamp) VALUES
('cmp-843-0001-uuid-000000000001', 'u009-stud-0843-uuid-000000000009', NULL, 'OPEN', 'Student raised 1-click room cleaning', CURRENT_TIMESTAMP - INTERVAL '1 hour'),
('cmp-843-0001-uuid-000000000001', NULL, 'OPEN', 'ASSIGNED', 'System auto-dispatched to Murugan K (Cleaning Staff)', CURRENT_TIMESTAMP - INTERVAL '50 mins'),
('cmp-843-0001-uuid-000000000001', 'u003-staf-clean-uuid-000000000003', 'ASSIGNED', 'IN_PROGRESS', 'Staff arrived at Room 843 and commenced cleaning', CURRENT_TIMESTAMP - INTERVAL '30 mins'),
('cmp-825-0001-uuid-000000000004', 'u011-stud-0825-uuid-000000000011', 'PENDING_VERIFICATION', 'COMPLETED', 'Student verified work and gave 5 stars', CURRENT_TIMESTAMP - INTERVAL '1 day')
ON CONFLICT DO NOTHING;

-- 12. Re-sync serial sequences.
-- Categories and subcategories above are inserted with explicit ids, which
-- does not advance their sequences. Without this the next category or
-- subcategory created through the column default collides with id 1.
SELECT setval(pg_get_serial_sequence('complaint_categories', 'category_id'), (SELECT MAX(category_id) FROM complaint_categories));
SELECT setval(pg_get_serial_sequence('complaint_subcategories', 'subcategory_id'), (SELECT MAX(subcategory_id) FROM complaint_subcategories));
