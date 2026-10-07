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
