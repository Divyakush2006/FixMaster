# FIX_MASTER — Database Implementation Specification (Section 3: 8 Marks)

> **Course Code**: BCSE307L – Database Systems | **Topic**: Relational DDL, Indexes, Views, Triggers, Stored Procedures, ACID Transactions & Data Access

---

## 1. Database Creation & Schema Definition (DDL)

The FIX_MASTER database schema is implemented in PostgreSQL 15/16 with strict domain constraints, foreign key referential integrity, and cascading behaviors.

```sql
-- Database Initialization & Extensions
CREATE DATABASE fix_master_db WITH ENCODING = 'UTF8';
\c fix_master_db;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
```

### 1.1 Infrastructure & Spatial Hierarchy

```sql
-- 1. Hostel Blocks Master
CREATE TABLE hostel_blocks (
    block_id VARCHAR(10) PRIMARY KEY,               -- e.g., 'L_BLOCK', 'PRP'
    block_name VARCHAR(50) NOT NULL,
    total_floors INT NOT NULL CHECK (total_floors > 0),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Block Floors (Floor-specific room numbering)
CREATE TABLE block_floors (
    block_id VARCHAR(10) NOT NULL REFERENCES hostel_blocks(block_id) ON DELETE CASCADE,
    floor_number INT NOT NULL CHECK (floor_number >= 0),
    room_prefix VARCHAR(10),
    PRIMARY KEY (block_id, floor_number)
);

-- 3. Hostel Rooms
CREATE TABLE rooms (
    room_id VARCHAR(20) PRIMARY KEY,                -- e.g., 'L-843'
    block_id VARCHAR(10) NOT NULL REFERENCES hostel_blocks(block_id) ON DELETE CASCADE,
    room_number VARCHAR(10) NOT NULL,
    floor_number INT NOT NULL CHECK (floor_number >= 0),
    room_type VARCHAR(20) DEFAULT 'NON_AC' CHECK (room_type IN ('AC', 'NON_AC', 'DELUXE_AC')),
    bed_capacity INT DEFAULT 3 CHECK (bed_capacity BETWEEN 1 AND 6),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_block_room UNIQUE (block_id, room_number)
);

-- 4. Shared Common Areas
CREATE TABLE common_areas (
    area_id VARCHAR(30) PRIMARY KEY,                -- e.g., 'L-F08-COOLER-01'
    block_id VARCHAR(10) NOT NULL REFERENCES hostel_blocks(block_id) ON DELETE CASCADE,
    floor_number INT NOT NULL,
    area_type VARCHAR(50) NOT NULL CHECK (
        area_type IN ('WATER_COOLER', 'COMMON_WASHROOM', 'SHOWER_ROOM', 'ELEVATOR', 'CORRIDOR', 'STUDY_HALL')
    ),
    description VARCHAR(150) NOT NULL,
    is_operational BOOLEAN DEFAULT TRUE
);
```

### 1.2 User Management & Single `users` Table RBAC

```sql
-- 5. Unified Users Table (BCSE307L Single Table RBAC Requirement)
CREATE TABLE users (
    user_id VARCHAR(36) PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    reg_or_emp_id VARCHAR(30) UNIQUE NOT NULL,      -- '21BCE0843' (Student) / 'EMP_ELEC_01' (Staff)
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
    failed_login_count INT NOT NULL DEFAULT 0 CHECK (failed_login_count >= 0),
    locked_until TIMESTAMPTZ,
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 6. Student Room Allotments
CREATE TABLE student_room_allotments (
    allotment_id SERIAL PRIMARY KEY,
    student_id VARCHAR(36) NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    room_id VARCHAR(20) NOT NULL REFERENCES rooms(room_id) ON DELETE RESTRICT,
    academic_year VARCHAR(20) NOT NULL,
    is_current BOOLEAN DEFAULT TRUE,
    allotted_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 7. Administrative Audit Log
CREATE TABLE audit_log (
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

-- 8. Server-Side Token Revocation
CREATE TABLE revoked_tokens (
    jti VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(36) REFERENCES users(user_id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

### 1.3 Service Domain & Taxonomy Master

```sql
-- 9. Service Categories
CREATE TABLE complaint_categories (
    category_id SERIAL PRIMARY KEY,
    category_code VARCHAR(50) UNIQUE NOT NULL,
    category_name VARCHAR(100) NOT NULL,
    is_quick_action BOOLEAN DEFAULT FALSE,
    default_sla_hours INT NOT NULL DEFAULT 24 CHECK (default_sla_hours > 0)
);

-- 10. Granular Issue Subcategories
CREATE TABLE complaint_subcategories (
    subcategory_id SERIAL PRIMARY KEY,
    category_id INT NOT NULL REFERENCES complaint_categories(category_id) ON DELETE CASCADE,
    subcategory_code VARCHAR(50) UNIQUE NOT NULL,
    issue_name VARCHAR(100) NOT NULL,
    estimated_resolution_mins INT DEFAULT 30 CHECK (estimated_resolution_mins > 0),
    priority_level VARCHAR(10) DEFAULT 'MEDIUM' CHECK (priority_level IN ('LOW', 'MEDIUM', 'HIGH', 'EMERGENCY')),
    required_specialization VARCHAR(30) NOT NULL CHECK (
        required_specialization IN ('CLEANING', 'ELECTRICIAN', 'CARPENTER', 'AC_TECH', 'PLUMBER')
    )
);
```

### 1.4 Complaints, Task Dispatch, Feedback & Traceability

```sql
-- 11. Core Complaints Registry
CREATE TABLE complaints (
    complaint_id VARCHAR(36) PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    ticket_scope VARCHAR(15) NOT NULL CHECK (ticket_scope IN ('ROOM', 'COMMON_AREA')),
    room_id VARCHAR(20) REFERENCES rooms(room_id) ON DELETE RESTRICT,
    common_area_id VARCHAR(30) REFERENCES common_areas(area_id) ON DELETE RESTRICT,
    block_id VARCHAR(10) NOT NULL REFERENCES hostel_blocks(block_id) ON DELETE RESTRICT,
    raised_by_user_id VARCHAR(36) NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    subcategory_id INT NOT NULL REFERENCES complaint_subcategories(subcategory_id) ON DELETE RESTRICT,
    description TEXT,
    photo_evidence_url VARCHAR(255),
    status VARCHAR(25) DEFAULT 'OPEN' CHECK (
        status IN ('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'PENDING_VERIFICATION', 'COMPLETED', 'ESCALATED', 'REJECTED', 'CANCELLED')
    ),
    priority VARCHAR(10) DEFAULT 'MEDIUM' CHECK (priority_level IN ('LOW', 'MEDIUM', 'HIGH', 'EMERGENCY')),
    preferred_timeslot VARCHAR(50),
    ai_priority_reasoning TEXT,
    ai_safety_advisory TEXT,
    ai_decided BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMP WITH TIME ZONE,
    closed_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT chk_complaint_location CHECK (
        (ticket_scope = 'ROOM' AND room_id IS NOT NULL AND common_area_id IS NULL) OR
        (ticket_scope = 'COMMON_AREA' AND common_area_id IS NOT NULL AND room_id IS NULL)
    )
);

-- 12. Complaint Reporters (Roommates joining an active ticket)
CREATE TABLE complaint_reporters (
    complaint_id VARCHAR(36) NOT NULL REFERENCES complaints(complaint_id) ON DELETE CASCADE,
    user_id VARCHAR(36) NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    reported_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (complaint_id, user_id)
);

-- 13. Technician Task Assignments
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
    ),
    ai_allocation_reasoning TEXT,
    ai_allocated BOOLEAN DEFAULT FALSE
);

-- 14. Student Resolution Feedback & Rating
CREATE TABLE complaint_feedback (
    feedback_id SERIAL PRIMARY KEY,
    complaint_id VARCHAR(36) NOT NULL REFERENCES complaints(complaint_id) ON DELETE CASCADE,
    student_id VARCHAR(36) NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    is_satisfactorily_resolved BOOLEAN NOT NULL,
    rating INT CHECK (rating BETWEEN 1 AND 5),
    student_comments TEXT,
    verified_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 15. Automated Lifecycle Audit Log
CREATE TABLE complaint_logs (
    log_id SERIAL PRIMARY KEY,
    complaint_id VARCHAR(36) NOT NULL REFERENCES complaints(complaint_id) ON DELETE CASCADE,
    changed_by_user_id VARCHAR(36) REFERENCES users(user_id) ON DELETE SET NULL,
    previous_status VARCHAR(25),
    new_status VARCHAR(25) NOT NULL,
    action_note TEXT,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

---

## 2. Performance Indexes & Partial Constraints

```sql
-- Spatial and status filtering
CREATE INDEX idx_complaints_block_status ON complaints(block_id, status);
CREATE INDEX idx_complaints_room_id ON complaints(room_id);
CREATE INDEX idx_complaints_common_area ON complaints(common_area_id);
CREATE INDEX idx_complaints_raised_by ON complaints(raised_by_user_id);

-- Technician queue sorting
CREATE INDEX idx_assignments_staff_state ON complaint_assignments(staff_user_id, current_state);

-- Fast user lookups
CREATE INDEX idx_users_role_specialization ON users(role, specialization, is_available);
CREATE INDEX idx_revoked_tokens_expiry ON revoked_tokens(expires_at);
CREATE INDEX idx_audit_log_time ON audit_log(occurred_at DESC);

-- Partial unique indexes: Exactly one live ticket per location and issue
CREATE UNIQUE INDEX uq_live_room_issue 
ON complaints(room_id, subcategory_id) 
WHERE status NOT IN ('COMPLETED', 'REJECTED', 'CANCELLED') AND ticket_scope = 'ROOM';

CREATE UNIQUE INDEX uq_live_area_issue 
ON complaints(common_area_id, subcategory_id) 
WHERE status NOT IN ('COMPLETED', 'REJECTED', 'CANCELLED') AND ticket_scope = 'COMMON_AREA';
```

---

## 3. Database Views (Operational & Analytical)

### 3.1 Floor-Optimized Staff Task Queue
```sql
CREATE OR REPLACE VIEW view_staff_active_queue AS
SELECT 
    ca.assignment_id,
    ca.staff_user_id,
    c.complaint_id,
    c.ticket_scope,
    COALESCE(r.room_number, ca_area.description) AS location_identifier,
    COALESCE(r.floor_number, ca_area.floor_number) AS floor_number,
    c.priority,
    sub.issue_name,
    c.status,
    ca.current_state,
    ca.assigned_at
FROM complaint_assignments ca
JOIN complaints c ON ca.complaint_id = c.complaint_id
JOIN complaint_subcategories sub ON c.subcategory_id = sub.subcategory_id
LEFT JOIN rooms r ON c.room_id = r.room_id
LEFT JOIN common_areas ca_area ON c.common_area_id = ca_area.area_id
WHERE ca.current_state IN ('ASSIGNED', 'ACCEPTED', 'EN_ROUTE', 'IN_PROGRESS')
ORDER BY floor_number ASC, 
    CASE c.priority 
        WHEN 'EMERGENCY' THEN 1 
        WHEN 'HIGH' THEN 2 
        WHEN 'MEDIUM' THEN 3 
        WHEN 'LOW' THEN 4 
    END ASC,
    ca.assigned_at ASC;
```

### 3.2 Block Supervisor KPI Dashboard
```sql
CREATE OR REPLACE VIEW view_block_supervisor_summary AS
SELECT 
    b.block_id,
    b.block_name,
    COUNT(c.complaint_id) AS total_complaints,
    COUNT(CASE WHEN c.status IN ('OPEN', 'ASSIGNED') THEN 1 END) AS pending_complaints,
    COUNT(CASE WHEN c.status = 'IN_PROGRESS' THEN 1 END) AS active_in_progress,
    COUNT(CASE WHEN c.status = 'PENDING_VERIFICATION' THEN 1 END) AS awaiting_student_confirmation,
    COUNT(CASE WHEN c.status = 'COMPLETED' THEN 1 END) AS resolved_count,
    COUNT(CASE WHEN c.ticket_scope = 'COMMON_AREA' THEN 1 END) AS common_area_issues,
    ROUND(AVG(fb.rating)::numeric, 2) AS avg_block_rating
FROM hostel_blocks b
LEFT JOIN complaints c ON b.block_id = c.block_id
LEFT JOIN complaint_feedback fb ON c.complaint_id = fb.complaint_id
GROUP BY b.block_id, b.block_name;
```

### 3.3 Recurring Defect & Hotspot Monitor
```sql
CREATE OR REPLACE VIEW view_recurring_defects_alert AS
SELECT 
    c.block_id,
    COALESCE(r.room_number, ca.description) AS location_name,
    c.ticket_scope,
    sub.issue_name,
    COUNT(c.complaint_id) AS incident_count,
    MAX(c.created_at) AS latest_incident_at
FROM complaints c
JOIN complaint_subcategories sub ON c.subcategory_id = sub.subcategory_id
LEFT JOIN rooms r ON c.room_id = r.room_id
LEFT JOIN common_areas ca ON c.common_area_id = ca.area_id
WHERE c.created_at >= NOW() - INTERVAL '14 days'
GROUP BY c.block_id, r.room_number, ca.description, c.ticket_scope, sub.issue_name
HAVING COUNT(c.complaint_id) >= 2
ORDER BY incident_count DESC;
```

---

## 4. Database Triggers (Automated State Control)

### 4.1 Automated Audit Logging on Status Transition
```sql
CREATE OR REPLACE FUNCTION fn_audit_complaint_status_change()
RETURNS TRIGGER AS $$
BEGIN
    IF (OLD.status IS DISTINCT FROM NEW.status) THEN
        INSERT INTO complaint_logs (complaint_id, changed_by_user_id, previous_status, new_status, action_note)
        VALUES (NEW.complaint_id, NULL, OLD.status, NEW.status, 'Status transitioned via database trigger');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_complaint_status_audit
AFTER UPDATE OF status ON complaints
FOR EACH ROW
EXECUTE FUNCTION fn_audit_complaint_status_change();
```

### 4.2 Auto-Update Timestamps
```sql
CREATE OR REPLACE FUNCTION fn_update_complaint_timestamps()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'PENDING_VERIFICATION' AND OLD.status != 'PENDING_VERIFICATION' THEN
        NEW.resolved_at = CURRENT_TIMESTAMP;
    END IF;
    IF NEW.status = 'COMPLETED' AND OLD.status != 'COMPLETED' THEN
        NEW.closed_at = CURRENT_TIMESTAMP;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_update_complaint_timestamps
BEFORE UPDATE OF status ON complaints
FOR EACH ROW
EXECUTE FUNCTION fn_update_complaint_timestamps();
```

---

## 5. Stored Procedures & ACID Transactions

### 5.1 Auto-Dispatch for Cleaning Staff
```sql
CREATE OR REPLACE PROCEDURE sp_auto_dispatch_cleaning(
    p_complaint_id VARCHAR(36)
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_staff_id VARCHAR(36);
BEGIN
    -- Select on-duty cleaning staff with the lowest active workload
    SELECT u.user_id INTO v_staff_id
    FROM users u
    LEFT JOIN complaint_assignments ca 
        ON u.user_id = ca.staff_user_id AND ca.current_state IN ('ASSIGNED', 'IN_PROGRESS')
    WHERE u.role = 'STAFF' 
      AND u.specialization = 'CLEANING' 
      AND u.is_available = TRUE
    GROUP BY u.user_id
    ORDER BY COUNT(ca.assignment_id) ASC
    LIMIT 1;

    IF v_staff_id IS NOT NULL THEN
        INSERT INTO complaint_assignments (complaint_id, staff_user_id, current_state)
        VALUES (p_complaint_id, v_staff_id, 'ASSIGNED');

        UPDATE complaints 
        SET status = 'ASSIGNED' 
        WHERE complaint_id = p_complaint_id;
    END IF;
END;
$$;
```

### 5.2 Atomic Resolution Verification
```sql
CREATE OR REPLACE PROCEDURE sp_confirm_resolution(
    p_complaint_id VARCHAR(36),
    p_student_id VARCHAR(36),
    p_is_satisfied BOOLEAN,
    p_rating INT,
    p_comments TEXT
)
LANGUAGE plpgsql
AS $$
BEGIN
    -- 1. Authorization: Verify student raised the ticket
    IF NOT EXISTS (
        SELECT 1 FROM complaints 
        WHERE complaint_id = p_complaint_id AND raised_by_user_id = p_student_id
    ) THEN
        RAISE EXCEPTION 'Unauthorized: Student did not raise this complaint.';
    END IF;

    -- 2. Verify ticket state
    IF NOT EXISTS (
        SELECT 1 FROM complaints
        WHERE complaint_id = p_complaint_id AND status = 'PENDING_VERIFICATION'
    ) THEN
        RAISE EXCEPTION 'Ticket is not in PENDING_VERIFICATION state.';
    END IF;

    -- 3. Write feedback entry
    INSERT INTO complaint_feedback (complaint_id, student_id, is_satisfactorily_resolved, rating, student_comments)
    VALUES (p_complaint_id, p_student_id, p_is_satisfied, p_rating, p_comments);

    -- 4. Transition ticket state based on satisfaction
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
        SET current_state = 'DONE' 
        WHERE complaint_id = p_complaint_id;
    END IF;
END;
$$;
```

### 5.3 Supervisor Manual Reassignment
```sql
CREATE OR REPLACE PROCEDURE sp_supervisor_assign_task(
    p_complaint_id VARCHAR(36),
    p_staff_user_id VARCHAR(36),
    p_supervisor_user_id VARCHAR(36)
)
LANGUAGE plpgsql
AS $$
BEGIN
    INSERT INTO complaint_assignments (complaint_id, staff_user_id, assigned_by_user_id, current_state, ai_allocated)
    VALUES (p_complaint_id, p_staff_user_id, p_supervisor_user_id, 'ASSIGNED', FALSE);

    UPDATE complaints 
    SET status = 'ASSIGNED' 
    WHERE complaint_id = p_complaint_id;
END;
$$;
```

---

## 6. Complex Joins & Aggregate Reporting Queries

### 6.1 Multi-Table Student Ticket View
```sql
SELECT 
    c.complaint_id,
    c.ticket_scope,
    COALESCE(r.room_number, 'Common Facility') AS location,
    cat.category_name,
    sub.issue_name,
    c.priority,
    c.status,
    u_staff.full_name AS assigned_technician_name,
    u_staff.phone_number AS technician_contact,
    ca.current_state AS technician_status
FROM complaints c
JOIN complaint_subcategories sub ON c.subcategory_id = sub.subcategory_id
JOIN complaint_categories cat ON sub.category_id = cat.category_id
LEFT JOIN rooms r ON c.room_id = r.room_id
LEFT JOIN complaint_assignments ca ON c.complaint_id = ca.complaint_id AND ca.current_state != 'DECLINED'
LEFT JOIN users u_staff ON ca.staff_user_id = u_staff.user_id
WHERE c.raised_by_user_id = $1
ORDER BY c.created_at DESC;
```

### 6.2 Aggregate SLA Performance & Resolution Times
```sql
SELECT 
    cat.category_name,
    COUNT(c.complaint_id) AS total_closed_tickets,
    cat.default_sla_hours,
    ROUND(AVG(EXTRACT(EPOCH FROM (c.closed_at - c.created_at))/3600)::numeric, 2) AS avg_resolution_hours,
    COUNT(CASE 
        WHEN EXTRACT(EPOCH FROM (c.closed_at - c.created_at))/3600 > cat.default_sla_hours THEN 1 
    END) AS sla_breaches_count,
    ROUND(AVG(fb.rating), 2) AS avg_student_rating
FROM complaints c
JOIN complaint_subcategories sub ON c.subcategory_id = sub.subcategory_id
JOIN complaint_categories cat ON sub.category_id = cat.category_id
JOIN complaint_feedback fb ON c.complaint_id = fb.complaint_id
WHERE c.status = 'COMPLETED'
GROUP BY cat.category_id, cat.category_name, cat.default_sla_hours
ORDER BY avg_resolution_hours DESC;
```

---

## 7. Data Access Architecture & ORM Model Mapping

The backend API connects via `pg.Pool` utilizing parameterized queries and explicit client transactions (`db.withTransaction`). For reference and schema parity across toolchains, the corresponding Prisma schema mapping is maintained:

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

enum UserRole {
  STUDENT
  STAFF
  SUPERVISOR
  ADMIN
}

enum Specialization {
  CLEANING
  ELECTRICIAN
  CARPENTER
  AC_TECH
  PLUMBER
}

enum ComplaintStatus {
  OPEN
  ASSIGNED
  IN_PROGRESS
  PENDING_VERIFICATION
  COMPLETED
  ESCALATED
  REJECTED
  CANCELLED
}

enum PriorityLevel {
  LOW
  MEDIUM
  HIGH
  EMERGENCY
}

model User {
  userId           String                 @id @default(uuid()) @map("user_id")
  regOrEmpId       String                 @unique @map("reg_or_emp_id")
  fullName         String                 @map("full_name")
  email            String                 @unique
  phoneNumber      String                 @map("phone_number")
  passwordHash     String                 @map("password_hash")
  role             UserRole
  specialization   Specialization?
  isAvailable      Boolean                @default(true) @map("is_available")
  failedLoginCount Int                    @default(0) @map("failed_login_count")
  lockedUntil      DateTime?              @map("locked_until")
  lastLoginAt      DateTime?              @map("last_login_at")
  createdAt        DateTime               @default(now()) @map("created_at")

  allotments       StudentRoomAllotment[]
  complaints       Complaint[]            @relation("RaisedByStudent")
  assignments      ComplaintAssignment[]  @relation("AssignedToStaff")
  dispatchedTasks  ComplaintAssignment[]  @relation("DispatchedBySupervisor")
  feedback         ComplaintFeedback[]
  auditLogs        ComplaintLog[]

  @@map("users")
}

model HostelBlock {
  blockId     String       @id @map("block_id")
  blockName   String       @map("block_name")
  totalFloors Int          @map("total_floors")
  createdAt   DateTime     @default(now()) @map("created_at")

  rooms       Room[]
  commonAreas CommonArea[]
  complaints  Complaint[]

  @@map("hostel_blocks")
}

model Room {
  roomId      String       @id @map("room_id")
  blockId     String       @map("block_id")
  roomNumber  String       @map("room_number")
  floorNumber Int          @map("floor_number")
  roomType    String       @default("NON_AC") @map("room_type")
  bedCapacity Int          @default(3) @map("bed_capacity")
  isActive    Boolean      @default(true) @map("is_active")
  createdAt   DateTime     @default(now()) @map("created_at")

  block       HostelBlock  @relation(fields: [blockId], references: [blockId], onDelete: Cascade)
  allotments  StudentRoomAllotment[]
  complaints  Complaint[]

  @@unique([blockId, roomNumber])
  @@map("rooms")
}

model CommonArea {
  areaId        String      @id @map("area_id")
  blockId       String      @map("block_id")
  floorNumber   Int         @map("floor_number")
  areaType      String      @map("area_type")
  description   String
  isOperational Boolean     @default(true) @map("is_operational")

  block         HostelBlock @relation(fields: [blockId], references: [blockId], onDelete: Cascade)
  complaints    Complaint[]

  @@map("common_areas")
}

model StudentRoomAllotment {
  allotmentId  Int      @id @default(autoincrement()) @map("allotment_id")
  studentId    String   @map("student_id")
  roomId       String   @map("room_id")
  academicYear String   @map("academic_year")
  isCurrent    Boolean  @default(true) @map("is_current")

  student      User     @relation(fields: [studentId], references: [userId], onDelete: Cascade)
  room         Room     @relation(fields: [roomId], references: [roomId], onDelete: Restrict)

  @@map("student_room_allotments")
}

model ComplaintCategory {
  categoryId       Int                    @id @default(autoincrement()) @map("category_id")
  categoryCode     String                 @unique @map("category_code")
  categoryName     String                 @map("category_name")
  isQuickAction    Boolean                @default(false) @map("is_quick_action")
  defaultSlaHours  Int                    @default(24) @map("default_sla_hours")

  subcategories    ComplaintSubcategory[]

  @@map("complaint_categories")
}

model ComplaintSubcategory {
  subcategoryId           Int               @id @default(autoincrement()) @map("subcategory_id")
  categoryId              Int               @map("category_id")
  subcategoryCode         String            @unique @map("subcategory_code")
  issueName               String            @map("issue_name")
  estimatedResolutionMins Int               @default(30) @map("estimated_resolution_mins")
  priorityLevel           PriorityLevel     @default(MEDIUM) @map("priority_level")
  requiredSpecialization  Specialization    @map("required_specialization")

  category                ComplaintCategory @relation(fields: [categoryId], references: [categoryId], onDelete: Cascade)
  complaints              Complaint[]

  @@map("complaint_subcategories")
}

model Complaint {
  complaintId         String               @id @default(uuid()) @map("complaint_id")
  ticketScope         String               @map("ticket_scope")
  roomId              String?              @map("room_id")
  commonAreaId        String?              @map("common_area_id")
  blockId             String               @map("block_id")
  raisedByUserId      String               @map("raised_by_user_id")
  subcategoryId       Int                  @map("subcategory_id")
  description         String?
  photoEvidenceUrl    String?              @map("photo_evidence_url")
  status              ComplaintStatus      @default(OPEN)
  priority            PriorityLevel        @default(MEDIUM)
  preferredTimeslot   String?              @map("preferred_timeslot")
  aiPriorityReasoning String?              @map("ai_priority_reasoning")
  aiSafetyAdvisory    String?              @map("ai_safety_advisory")
  aiDecided           Boolean              @default(false) @map("ai_decided")
  createdAt           DateTime             @default(now()) @map("created_at")
  resolvedAt          DateTime?            @map("resolved_at")
  closedAt            DateTime?            @map("closed_at")

  block               HostelBlock          @relation(fields: [blockId], references: [blockId], onDelete: Restrict)
  room                Room?                @relation(fields: [roomId], references: [roomId])
  commonArea          CommonArea?          @relation(fields: [commonAreaId], references: [areaId])
  raisedBy            User                 @relation("RaisedByStudent", fields: [raisedByUserId], references: [userId], onDelete: Restrict)
  subcategory         ComplaintSubcategory @relation(fields: [subcategoryId], references: [subcategoryId], onDelete: Restrict)

  assignments         ComplaintAssignment[]
  feedback            ComplaintFeedback?
  logs                ComplaintLog[]

  @@map("complaints")
}

model ComplaintAssignment {
  assignmentId          Int       @id @default(autoincrement()) @map("assignment_id")
  complaintId           String    @map("complaint_id")
  staffUserId           String    @map("staff_user_id")
  assignedByUserId      String?   @map("assigned_by_user_id")
  assignedAt            DateTime  @default(now()) @map("assigned_at")
  startedAt             DateTime? @map("started_at")
  workCompletedAt       DateTime? @map("work_completed_at")
  currentState          String    @default("ASSIGNED") @map("current_state")
  aiAllocationReasoning String?   @map("ai_allocation_reasoning")
  aiAllocated           Boolean   @default(false) @map("ai_allocated")

  complaint             Complaint @relation(fields: [complaintId], references: [complaintId], onDelete: Cascade)
  staff                 User      @relation("AssignedToStaff", fields: [staffUserId], references: [userId], onDelete: Restrict)
  assignedBy            User?     @relation("DispatchedBySupervisor", fields: [assignedByUserId], references: [userId])

  @@map("complaint_assignments")
}

model ComplaintFeedback {
  feedbackId               Int       @id @default(autoincrement()) @map("feedback_id")
  complaintId              String    @unique @map("complaint_id")
  studentId                String    @map("student_id")
  isSatisfactorilyResolved Boolean   @map("is_satisfactorily_resolved")
  rating                   Int?
  studentComments          String?   @map("student_comments")
  verifiedAt               DateTime  @default(now()) @map("verified_at")

  complaint                Complaint @relation(fields: [complaintId], references: [complaintId], onDelete: Cascade)
  student                  User      @relation(fields: [studentId], references: [userId], onDelete: Restrict)

  @@map("complaint_feedback")
}

model ComplaintLog {
  logId           Int       @id @default(autoincrement()) @map("log_id")
  complaintId     String    @map("complaint_id")
  changedByUserId String?   @map("changed_by_user_id")
  previousStatus  String?   @map("previous_status")
  newStatus       String    @map("new_status")
  actionNote      String?   @map("action_note")
  timestamp       DateTime  @default(now())

  complaint       Complaint @relation(fields: [complaintId], references: [complaintId], onDelete: Cascade)
  changedBy       User?     @relation(fields: [changedByUserId], references: [userId])

  @@map("complaint_logs")
}
```
