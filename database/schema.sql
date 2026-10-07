-- ============================================================================
-- GENERATED FILE - DO NOT EDIT BY HAND.
-- Built by scripts/build-sql-bundles.js from: migrations/001 + 004 + 005
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
