# FIX_MASTER — Backend Developer Handover & Architecture Guide

> **To**: Backend Engineering Team  
> **From**: Database Architecture Team  
> **Course**: BCSE307L – Database Systems (Dr. Deepika J, VIT Vellore)  
> **Database Status**: **100% Implemented & Verified Live on Neon Serverless PostgreSQL**  
> **Live DB Engine**: PostgreSQL 16  

---

## 1. Live Database Connection & Environment

The database is live and hosted on Neon. Configure your backend `.env` file as follows:

```env
# Server Configuration
PORT=5000
NODE_ENV=development

# Neon Serverless Cloud PostgreSQL Connection String
DATABASE_URL="<ADD FROM THE NEOM CONSOLE>"

# JWT Authentication Secrets
JWT_SECRET="<generate: node -e \"console.log(require('crypto').randomBytes(48).toString('hex'))\">"
JWT_EXPIRES_IN="24h"
```

---

## 2. Database Schema & Entity Summary (11 Tables)

All tables are created in 3NF with strict referential constraints and indexes:

| Table Name | Description | Key Columns |
|---|---|---|
| **`hostel_blocks`** | Master hostel building registry | `block_id` (PK), `block_name`, `total_floors` |
| **`rooms`** | Hostel rooms categorized by floor | `room_id` (PK, e.g. `L-843`), `block_id` (FK), `room_number`, `floor_number`, `room_type` |
| **`common_areas`** | Shared utilities (Water Coolers, Washrooms, Lifts) | `area_id` (PK, e.g. `L-F08-COOLER-01`), `block_id` (FK), `floor_number`, `area_type` |
| **`users`** | **Unified single table for all roles (Rubric Requirement)** | `user_id` (PK), `reg_or_emp_id` (UK), `full_name`, `email` (UK), `password_hash`, `role`, `specialization`, `is_available` |
| **`student_room_allotments`** | Resident to room mapping | `allotment_id` (PK), `student_id` (FK), `room_id` (FK), `is_current` |
| **`complaint_categories`** | Service domains (Cleaning, Electrical, AC, etc.) | `category_id` (PK), `category_code`, `category_name`, `is_quick_action`, `default_sla_hours` |
| **`complaint_subcategories`** | 25 Granular issue types | `subcategory_id` (PK), `category_id` (FK), `issue_name`, `priority_level`, `required_specialization` |
| **`complaints`** | Primary transaction registry | `complaint_id` (PK), `ticket_scope` (`ROOM`/`COMMON_AREA`), `room_id` (FK), `common_area_id` (FK), `status`, `priority` |
| **`complaint_assignments`** | Technician task queue & dispatch tracking | `assignment_id` (PK), `complaint_id` (FK), `staff_user_id` (FK), `current_state` |
| **`complaint_feedback`** | Student resolution confirmation & 1–5 star rating | `feedback_id` (PK), `complaint_id` (UK, FK), `student_id` (FK), `is_satisfactorily_resolved`, `rating` |
| **`complaint_logs`** | Immutable automated audit trail | `log_id` (PK), `complaint_id` (FK), `previous_status`, `new_status`, `action_note`, `timestamp` |

---

## 3. Database Triggers, Stored Procedures & Analytical Views

### 3.1 Pre-Built Stored Procedures (Call directly via SQL or ORM)

1. **`sp_auto_dispatch_cleaning(p_complaint_id VARCHAR)`**:
   - Finds the least-loaded on-duty cleaning staff (`role='STAFF'`, `specialization='CLEANING'`, `is_available=TRUE`).
   - Atomically inserts a row into `complaint_assignments` and updates `complaints.status = 'ASSIGNED'`.
   - *Backend usage*: Call immediately after creating a 1-click room cleaning complaint.

2. **`sp_confirm_resolution(p_complaint_id, p_student_id, p_is_satisfied, p_rating, p_comments)`**:
   - Validates that `p_student_id` actually owns the complaint.
   - Inserts feedback rating record into `complaint_feedback`.
   - If `p_is_satisfied = TRUE`: transitions status to `COMPLETED` and sets `closed_at = NOW()`.
   - If `p_is_satisfied = FALSE`: escalates ticket to `ESCALATED` for supervisor review.

3. **`sp_supervisor_assign_task(p_complaint_id, p_staff_user_id, p_supervisor_user_id)`**:
   - Manually overrides and assigns a technician.

### 3.2 Pre-Built Analytical Views (Query with standard `SELECT`)

1. **`SELECT * FROM view_staff_active_queue;`**:
   - Returns tasks sorted by `floor_number ASC` and `priority DESC` for technicians.
2. **`SELECT * FROM view_block_supervisor_summary;`**:
   - Returns aggregated block KPIs (Total, Pending, Active, Awaiting Student Verification, Resolved, Avg Rating).
3. **`SELECT * FROM view_recurring_defects_alert;`**:
   - Returns recurring failure hotspots ($\ge 2$ complaints within 14 days).

### 3.3 Active Triggers
- **`trg_complaint_status_audit`**: Automatically writes to `complaint_logs` on any update of `complaints.status`.
- **`trg_update_complaint_timestamps`**: Automatically maintains `resolved_at` and `closed_at` timestamps.

---

## 4. Role-Based Access Control (RBAC) & Auth Rules

### User Roles (`role` column in `users` table):
1. **`STUDENT`**: Has room allotment (e.g. Room `L-843`), can raise quick cleaning or technical tickets, and confirm resolution.
2. **`STAFF`**: Has `specialization` (`CLEANING`, `ELECTRICIAN`, `CARPENTER`, `AC_TECH`, `PLUMBER`), views task queue, marks work done.
3. **`SUPERVISOR`**: Manages block operations, views analytics, reassigns tickets.
4. **`ADMIN`**: Full estates access.

### JWT Payload Structure:
```json
{
  "userId": "u009-stud-0843-uuid-000000000009",
  "regOrEmpId": "21BCE0843",
  "role": "STUDENT",
  "specialization": null,
  "fullName": "Vihaan Sharma",
  "email": "vihaan.sharma2021@vitstudent.ac.in"
}
```

---

## 5. REST API Routes Specification

### 5.1 Authentication (`/api/auth`)
- `POST /api/auth/login` $
ightarrow$ Body: `{ regOrEmpId, password }`. Returns `{ token, user }`.
- `GET /api/auth/profile` $
ightarrow$ Headers: `Bearer <token>`. Returns user profile + active room allotment.

### 5.2 Student Endpoints (`/api/complaints`) [Requires `role: 'STUDENT'`]
- **`POST /api/complaints/quick-clean`** (1-Click Instant Room Cleaning):
  - Fetches student's current room allotment (`L-843`).
  - Creates complaint under `CLN_ROOM_SWEEP`.
  - Executes `sp_auto_dispatch_cleaning(complaintId)`.
- **`POST /api/complaints/raise`** (Technical Issue Form):
  - Body: `{ ticketScope: "ROOM"|"COMMON_AREA", roomId, commonAreaId, blockId: "L_BLOCK", subcategoryId: 5, description: "...", preferredTimeslot: "04:00 PM - 06:00 PM" }`.
- **`GET /api/complaints/student/active`**:
  - Returns student's active and past complaints with assigned technician name, contact, and state.
- **`POST /api/complaints/:id/confirm`** (Closed-Loop Resolution):
  - Body: `{ isSatisfied: true, rating: 5, comments: "Well fixed!" }`.
  - Calls `sp_confirm_resolution`.

### 5.3 Staff Endpoints (`/api/staff`) [Requires `role: 'STAFF'`]
- **`GET /api/staff/queue`**: Returns active assignments sorted by floor order.
- **`PATCH /api/staff/assignment/:id/status`**: Body: `{ status: "IN_PROGRESS" | "PENDING_VERIFICATION" }`.
- **`PATCH /api/staff/availability`**: Toggles `isAvailable` (On-Duty / Off-Duty).

### 5.4 Supervisor Endpoints (`/api/supervisor`) [Requires `role: 'SUPERVISOR'` or `'ADMIN'`]
- **`GET /api/supervisor/dashboard`**: Returns block KPI metrics.
- **`GET /api/supervisor/complaints`**: Query params: `?blockId=L_BLOCK&status=OPEN&page=1&limit=10&search=843`.
- **`POST /api/supervisor/assign`**: Body: `{ complaintId, staffUserId }`.
- **`GET /api/supervisor/staff`**: List of all staff and availability.

### 5.5 Master Data Endpoints (`/api/master`) [Public / Authenticated]
- **`GET /api/master/categories`**: All 6 categories and 25 subcategories.
- **`GET /api/master/blocks/:blockId`**: Rooms and common areas for dropdowns.

---

## 6. Seed Test Credentials (Password: `Password@123` for all)

| User Role | Username / ID | Name / Notes | Room / Skill |
|---|---|---|---|
| **Student** | `21BCE0843` | Vihaan Sharma | Room `L-843` |
| **Student** | `21BCE1042` | Rahul Varma | Room `L-810` |
| **Staff (Cleaning)** | `EMP_CLN_01` | Murugan K | Housekeeping |
| **Staff (Electrician)**| `EMP_ELEC_01` | Suresh Kumar | Electrical |
| **Staff (Carpenter)** | `EMP_CARP_01` | Govindraj M | Carpentry |
| **Staff (AC Tech)** | `EMP_AC_01` | Dhanush V | AC & HVAC |
| **Staff (Plumber)** | `EMP_PLB_01` | Karthik N | Plumbing |
| **Supervisor** | `SUP_LBLOCK_01` | Mr. R. Sundaram | L-Block Supervisor |
| **Admin** | `ADMIN_ESTATES_01`| Chief Warden | Estates & Hostels |
