-- ============================================================================
-- FIX_MASTER: COMPLETE DATABASE INITIALIZATION (ALL-IN-ONE SCRIPT)
-- Course: BCSE307L - Database Systems (SCOPE, VIT Vellore)
-- Target: PostgreSQL 15+ / Neon.tech Serverless Cloud PostgreSQL
-- ============================================================================

-- >>>>> PART 1: SCHEMA & TABLES (DDL) <<<<<
-- ============================================================================
-- FIX_MASTER: Relational Database Schema Specification
-- Course: BCSE307L - Database Systems (SCOPE, VIT Vellore)
-- Database Engine: PostgreSQL 15+
-- Normalized to 3NF / BCNF
-- ============================================================================

-- Enable UUID extension for globally unique primary keys
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Drop existing tables in reverse dependency order
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
DROP TABLE IF EXISTS hostel_blocks CASCADE;

-- ============================================================================
-- 1. INFRASTRUCTURE & SPATIAL HIERARCHY
-- ============================================================================

-- 1. Hostel Blocks Master Table
CREATE TABLE hostel_blocks (
    block_id VARCHAR(10) PRIMARY KEY,
    block_name VARCHAR(50) NOT NULL,
    total_floors INT NOT NULL CHECK (total_floors > 0),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Hostel Rooms Table
CREATE TABLE rooms (
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

-- 3. Common Areas & Public Facilities Table
CREATE TABLE common_areas (
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

-- 4. Unified Users Table
CREATE TABLE users (
    user_id VARCHAR(36) PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    reg_or_emp_id VARCHAR(30) UNIQUE NOT NULL, -- Student RegNo or Staff Employee ID
    full_name VARCHAR(100) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    phone_number VARCHAR(15) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL CHECK (role IN ('STUDENT', 'STAFF', 'SUPERVISOR', 'ADMIN')),
    specialization VARCHAR(30) CHECK (
        specialization IS NULL OR 
        specialization IN ('CLEANING', 'ELECTRICIAN', 'CARPENTER', 'AC_TECH', 'PLUMBER')
    ),
    is_available BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 5. Student Room Allotment Table
CREATE TABLE student_room_allotments (
    allotment_id SERIAL PRIMARY KEY,
    student_id VARCHAR(36) NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    room_id VARCHAR(20) NOT NULL REFERENCES rooms(room_id) ON DELETE RESTRICT,
    academic_year VARCHAR(10) NOT NULL, -- e.g. '2026-2027'
    is_current BOOLEAN DEFAULT TRUE,
    assigned_date DATE DEFAULT CURRENT_DATE,
    CONSTRAINT uq_student_active_allotment UNIQUE (student_id, is_current)
);

-- ============================================================================
-- 3. CATEGORIES & TAXONOMY
-- ============================================================================

-- 6. Complaint Categories Master
CREATE TABLE complaint_categories (
    category_id SERIAL PRIMARY KEY,
    category_code VARCHAR(30) UNIQUE NOT NULL,
    category_name VARCHAR(50) NOT NULL,
    is_quick_action BOOLEAN DEFAULT FALSE,
    default_sla_hours INT NOT NULL DEFAULT 24 CHECK (default_sla_hours > 0)
);

-- 7. Granular Complaint Subcategories & Fault Types
CREATE TABLE complaint_subcategories (
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

-- 8. Core Complaints Registry
CREATE TABLE complaints (
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
        (ticket_scope = 'COMMON_AREA' AND common_area_id IS NOT NULL)
    )
);

-- 9. Staff Task Dispatch Queue
CREATE TABLE complaint_assignments (
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

-- 10. Student Closed-Loop Verification & Feedback
CREATE TABLE complaint_feedback (
    feedback_id SERIAL PRIMARY KEY,
    complaint_id VARCHAR(36) UNIQUE NOT NULL REFERENCES complaints(complaint_id) ON DELETE CASCADE,
    student_id VARCHAR(36) NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    is_satisfactorily_resolved BOOLEAN NOT NULL,
    rating INT CHECK (rating BETWEEN 1 AND 5),
    student_comments TEXT,
    verified_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 11. Immutable Complaint Audit Trail
CREATE TABLE complaint_logs (
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

CREATE INDEX idx_complaints_block_status ON complaints(block_id, status);
CREATE INDEX idx_complaints_raised_by ON complaints(raised_by_user_id, status);
CREATE INDEX idx_complaints_room ON complaints(room_id);
CREATE INDEX idx_assignments_staff_state ON complaint_assignments(staff_user_id, current_state);
CREATE INDEX idx_users_staff_dispatch ON users(role, specialization, is_available) WHERE role = 'STAFF';


-- >>>>> PART 2: TRIGGERS, PROCEDURES & VIEWS <<<<<
-- ============================================================================
-- FIX_MASTER: Database Triggers, Stored Procedures, Functions & Views
-- Course: BCSE307L - Database Systems (SCOPE, VIT Vellore)
-- Database Engine: PostgreSQL 15+
-- ============================================================================

-- ============================================================================
-- 1. DATABASE TRIGGERS
-- ============================================================================

-- Trigger 1: Automated Audit Logging for Complaint Status Changes
CREATE OR REPLACE FUNCTION fn_audit_complaint_status_change()
RETURNS TRIGGER AS $$
BEGIN
    IF (OLD.status IS DISTINCT FROM NEW.status) THEN
        INSERT INTO complaint_logs (
            complaint_id,
            changed_by_user_id,
            previous_status,
            new_status,
            action_note
        )
        VALUES (
            NEW.complaint_id,
            NULL,
            OLD.status,
            NEW.status,
            CONCAT('Automated transition: ', OLD.status, ' -> ', NEW.status)
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_complaint_status_audit ON complaints;
CREATE TRIGGER trg_complaint_status_audit
AFTER UPDATE OF status ON complaints
FOR EACH ROW
EXECUTE FUNCTION fn_audit_complaint_status_change();

-- Trigger 2: Auto-Maintain Resolved and Closed Timestamps
CREATE OR REPLACE FUNCTION fn_update_complaint_timestamps()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'PENDING_VERIFICATION' AND OLD.status != 'PENDING_VERIFICATION' THEN
        NEW.resolved_at = CURRENT_TIMESTAMP;
    ELSIF NEW.status = 'COMPLETED' AND OLD.status != 'COMPLETED' THEN
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
-- 2. STORED PROCEDURES & ACID TRANSACTIONS
-- ============================================================================

-- Procedure 1: 1-Click Auto-Dispatch for Cleaning Staff (Least Loaded)
CREATE OR REPLACE PROCEDURE sp_auto_dispatch_cleaning(
    p_complaint_id VARCHAR(36)
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_assigned_staff_id VARCHAR(36);
BEGIN
    -- 1. Identify on-duty cleaning staff with minimum active assignments
    SELECT u.user_id INTO v_assigned_staff_id
    FROM users u
    LEFT JOIN complaint_assignments ca 
        ON u.user_id = ca.staff_user_id 
        AND ca.current_state IN ('ASSIGNED', 'IN_PROGRESS')
    WHERE u.role = 'STAFF' 
      AND u.specialization = 'CLEANING' 
      AND u.is_available = TRUE
    GROUP BY u.user_id
    ORDER BY COUNT(ca.assignment_id) ASC, u.created_at ASC
    LIMIT 1;

    IF v_assigned_staff_id IS NULL THEN
        UPDATE complaints 
        SET status = 'OPEN' 
        WHERE complaint_id = p_complaint_id;
    ELSE
        INSERT INTO complaint_assignments (complaint_id, staff_user_id, current_state)
        VALUES (p_complaint_id, v_assigned_staff_id, 'ASSIGNED');

        UPDATE complaints 
        SET status = 'ASSIGNED' 
        WHERE complaint_id = p_complaint_id;
    END IF;
END;
$$;

-- Procedure 2: Atomic Closed-Loop Resolution Verification & Rating
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
    -- 1. Security & Ownership check
    SELECT raised_by_user_id, status 
    INTO v_ticket_student_id, v_current_status
    FROM complaints 
    WHERE complaint_id = p_complaint_id;

    IF v_ticket_student_id IS NULL THEN
        RAISE EXCEPTION 'Complaint % not found', p_complaint_id;
    END IF;

    IF v_ticket_student_id != p_student_id THEN
        RAISE EXCEPTION 'Unauthorized: User % did not raise complaint %', p_student_id, p_complaint_id;
    END IF;

    -- 2. Insert feedback
    INSERT INTO complaint_feedback (
        complaint_id,
        student_id,
        is_satisfactorily_resolved,
        rating,
        student_comments
    )
    VALUES (
        p_complaint_id,
        p_student_id,
        p_is_satisfied,
        p_rating,
        p_comments
    );

    -- 3. Transition complaint status
    IF p_is_satisfied = TRUE THEN
        UPDATE complaints 
        SET status = 'COMPLETED', closed_at = CURRENT_TIMESTAMP 
        WHERE complaint_id = p_complaint_id;

        UPDATE complaint_assignments 
        SET current_state = 'DONE', work_completed_at = CURRENT_TIMESTAMP 
        WHERE complaint_id = p_complaint_id;
    ELSE
        UPDATE complaints 
        SET status = 'ESCALATED' 
        WHERE complaint_id = p_complaint_id;

        UPDATE complaint_assignments 
        SET current_state = 'DECLINED' 
        WHERE complaint_id = p_complaint_id;
    END IF;
END;
$$;

-- Procedure 3: Manual Dispatch Override (Supervisor Action)
CREATE OR REPLACE PROCEDURE sp_supervisor_assign_task(
    p_complaint_id VARCHAR(36),
    p_staff_user_id VARCHAR(36),
    p_supervisor_user_id VARCHAR(36)
)
LANGUAGE plpgsql
AS $$
BEGIN
    -- Insert new assignment
    INSERT INTO complaint_assignments (complaint_id, staff_user_id, assigned_by_user_id, current_state)
    VALUES (p_complaint_id, p_staff_user_id, p_supervisor_user_id, 'ASSIGNED');

    -- Update complaint status
    UPDATE complaints
    SET status = 'ASSIGNED'
    WHERE complaint_id = p_complaint_id;
END;
$$;

-- ============================================================================
-- 3. ANALYTICAL & OPERATIONAL VIEWS
-- ============================================================================

-- View 1: Floor-Optimized Active Queue for Staff
CREATE OR REPLACE VIEW view_staff_active_queue AS
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
ORDER BY 
    COALESCE(r.floor_number, ca_area.floor_number) ASC,
    CASE c.priority 
        WHEN 'EMERGENCY' THEN 1 
        WHEN 'HIGH' THEN 2 
        WHEN 'MEDIUM' THEN 3 
        WHEN 'LOW' THEN 4 
    END ASC,
    ca.assigned_at ASC;

-- View 2: Block Supervisor Real-Time KPI Summary
CREATE OR REPLACE VIEW view_block_supervisor_summary AS
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
    ROUND(COALESCE(AVG(fb.rating), 0), 2) AS average_student_rating
FROM hostel_blocks b
LEFT JOIN complaints c ON b.block_id = c.block_id
LEFT JOIN complaint_feedback fb ON c.complaint_id = fb.complaint_id
GROUP BY b.block_id, b.block_name;

-- View 3: Recurring Defects & Outage Hotspot Monitor (Last 14 Days)
CREATE OR REPLACE VIEW view_recurring_defects_alert AS
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


-- >>>>> PART 3: REALISTIC SEED DATA (VIT L-BLOCK) <<<<<
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
-- Password for all seed users is 'Password@123' (BCrypt hash)
INSERT INTO users (user_id, reg_or_emp_id, full_name, email, phone_number, password_hash, role, specialization, is_available) VALUES
-- Admin
('u001-admin-0001-uuid-000000000001', 'ADMIN_ESTATES_01', 'Chief Warden / Estates Admin', 'admin.hostels@vit.ac.in', '9876543210', '$2a$12$eKx6v1s97N8zL6a1k2qJ6.k4pZ2hY6dG9oP4eN1mB3vC7xS5tU0q2', 'ADMIN', NULL, TRUE),

-- Supervisors
('u002-supv-0001-uuid-000000000002', 'SUP_LBLOCK_01', 'Mr. R. Sundaram (L-Block Supervisor)', 'supervisor.lblock@vit.ac.in', '9876543211', '$2a$12$eKx6v1s97N8zL6a1k2qJ6.k4pZ2hY6dG9oP4eN1mB3vC7xS5tU0q2', 'SUPERVISOR', NULL, TRUE),

-- Maintenance Staff (5 Specializations)
('u003-staf-clean-uuid-000000000003', 'EMP_CLN_01', 'Murugan K (Housekeeper)', 'murugan.cln@vit.ac.in', '9876543220', '$2a$12$eKx6v1s97N8zL6a1k2qJ6.k4pZ2hY6dG9oP4eN1mB3vC7xS5tU0q2', 'STAFF', 'CLEANING', TRUE),
('u004-staf-clean-uuid-000000000004', 'EMP_CLN_02', 'Ramesh P (Housekeeper)', 'ramesh.cln@vit.ac.in', '9876543221', '$2a$12$eKx6v1s97N8zL6a1k2qJ6.k4pZ2hY6dG9oP4eN1mB3vC7xS5tU0q2', 'STAFF', 'CLEANING', TRUE),
('u005-staf-elec-uuid-000000000005', 'EMP_ELEC_01', 'Suresh Kumar (Electrician)', 'suresh.elec@vit.ac.in', '9876543222', '$2a$12$eKx6v1s97N8zL6a1k2qJ6.k4pZ2hY6dG9oP4eN1mB3vC7xS5tU0q2', 'STAFF', 'ELECTRICIAN', TRUE),
('u006-staf-carp-uuid-000000000006', 'EMP_CARP_01', 'Govindraj M (Carpenter)', 'govind.carp@vit.ac.in', '9876543223', '$2a$12$eKx6v1s97N8zL6a1k2qJ6.k4pZ2hY6dG9oP4eN1mB3vC7xS5tU0q2', 'STAFF', 'CARPENTER', TRUE),
('u007-staf-actech-uuid-000000000007', 'EMP_AC_01', 'Dhanush V (AC Specialist)', 'dhanush.ac@vit.ac.in', '9876543224', '$2a$12$eKx6v1s97N8zL6a1k2qJ6.k4pZ2hY6dG9oP4eN1mB3vC7xS5tU0q2', 'STAFF', 'AC_TECH', TRUE),
('u008-staf-plumb-uuid-000000000008', 'EMP_PLB_01', 'Karthik N (Plumber)', 'karthik.plb@vit.ac.in', '9876543225', '$2a$12$eKx6v1s97N8zL6a1k2qJ6.k4pZ2hY6dG9oP4eN1mB3vC7xS5tU0q2', 'STAFF', 'PLUMBER', TRUE),

-- Students residing in L-Block
('u009-stud-0843-uuid-000000000009', '21BCE0843', 'Vihaan Sharma', 'vihaan.sharma2021@vitstudent.ac.in', '9876543230', '$2a$12$eKx6v1s97N8zL6a1k2qJ6.k4pZ2hY6dG9oP4eN1mB3vC7xS5tU0q2', 'STUDENT', NULL, TRUE),
('u010-stud-0810-uuid-000000000010', '21BCE1042', 'Rahul Varma', 'rahul.varma2021@vitstudent.ac.in', '9876543231', '$2a$12$eKx6v1s97N8zL6a1k2qJ6.k4pZ2hY6dG9oP4eN1mB3vC7xS5tU0q2', 'STUDENT', NULL, TRUE),
('u011-stud-0825-uuid-000000000011', '21BCE1523', 'Aditya Nair', 'aditya.nair2021@vitstudent.ac.in', '9876543232', '$2a$12$eKx6v1s97N8zL6a1k2qJ6.k4pZ2hY6dG9oP4eN1mB3vC7xS5tU0q2', 'STUDENT', NULL, TRUE),
('u012-stud-0305-uuid-000000000012', '22BCE0190', 'Priya Iyer', 'priya.iyer2022@vitstudent.ac.in', '9876543233', '$2a$12$eKx6v1s97N8zL6a1k2qJ6.k4pZ2hY6dG9oP4eN1mB3vC7xS5tU0q2', 'STUDENT', NULL, TRUE)
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
ON CONFLICT (complaint_id) DO NOTHING;

-- 11. Insert Audit History Logs
INSERT INTO complaint_logs (complaint_id, changed_by_user_id, previous_status, new_status, action_note, timestamp) VALUES
('cmp-843-0001-uuid-000000000001', 'u009-stud-0843-uuid-000000000009', NULL, 'OPEN', 'Student raised 1-click room cleaning', CURRENT_TIMESTAMP - INTERVAL '1 hour'),
('cmp-843-0001-uuid-000000000001', NULL, 'OPEN', 'ASSIGNED', 'System auto-dispatched to Murugan K (Cleaning Staff)', CURRENT_TIMESTAMP - INTERVAL '50 mins'),
('cmp-843-0001-uuid-000000000001', 'u003-staf-clean-uuid-000000000003', 'ASSIGNED', 'IN_PROGRESS', 'Staff arrived at Room 843 and commenced cleaning', CURRENT_TIMESTAMP - INTERVAL '30 mins'),
('cmp-825-0001-uuid-000000000004', 'u011-stud-0825-uuid-000000000011', 'PENDING_VERIFICATION', 'COMPLETED', 'Student verified work and gave 5 stars', CURRENT_TIMESTAMP - INTERVAL '1 day')
ON CONFLICT DO NOTHING;

