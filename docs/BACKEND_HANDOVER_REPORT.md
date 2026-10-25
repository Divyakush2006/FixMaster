# FIX_MASTER — Backend Developer Handover & Architecture Guide

> **To**: Backend Engineering Team | **Course**: BCSE307L – Database Systems  
> **Database Status**: **100% Implemented & Verified** on PostgreSQL 15/16 (Local & Docker)

---

## 1. Environment & Database Configuration

FixMaster connects to PostgreSQL using parameterized connections via `pg.Pool` (with automatic TLS for cloud databases like Neon or Supabase). Configure `.env` based on `.env.example`:

```env
PORT=5000
NODE_ENV=development

# PostgreSQL Connection String (never commit real credentials)
DATABASE_URL="postgresql://postgres:<password>@localhost:5432/fix_master_db"

# JWT Secret (minimum 32 characters in production)
JWT_SECRET="<generate: node -e \"console.log(require('crypto').randomBytes(48).toString('hex'))\">"
JWT_EXPIRES_IN="24h"
```

---

## 2. Database Schema & Entity Summary

All tables are 3NF-normalized with strict referential constraints, cascades, and indexes:

| Table Name | Purpose | Key Columns |
|---|---|---|
| **`hostel_blocks`** | Hostel block registry | `block_id` (PK), `block_name`, `total_floors` |
| **`block_floors`** | Floor configuration & room numbering | `(block_id, floor_number)` (PK), `room_prefix` |
| **`rooms`** | Hostel rooms categorized by floor | `room_id` (PK), `block_id` (FK), `room_number`, `floor_number`, `room_type`, `bed_capacity` |
| **`common_areas`** | Shared utilities (water coolers, washrooms, lifts) | `area_id` (PK), `block_id` (FK), `floor_number`, `area_type`, `is_operational` |
| **`users`** | **Unified single table for all roles** | `user_id` (PK), `reg_or_emp_id` (UK), `full_name`, `email` (UK), `role`, `specialization`, `is_available`, `failed_login_count` |
| **`student_room_allotments`** | Resident to room mapping | `allotment_id` (PK), `student_id` (FK), `room_id` (FK), `is_current` |
| **`complaint_categories`** | Service domains (Cleaning, Electrical, AC, etc.) | `category_id` (PK), `category_code`, `category_name`, `is_quick_action`, `default_sla_hours` |
| **`complaint_subcategories`** | 25 Granular issue classifications | `subcategory_id` (PK), `category_id` (FK), `issue_name`, `priority_level`, `required_specialization` |
| **`complaints`** | Core work orders / tickets | `complaint_id` (PK), `ticket_scope`, `room_id` (FK), `common_area_id` (FK), `status`, `priority`, AI audit columns |
| **`complaint_assignments`** | Technician task assignments | `assignment_id` (PK), `complaint_id` (FK), `staff_user_id` (FK), `current_state`, AI allocation columns |
| **`complaint_feedback`** | Student verification & 1–5 star rating | `feedback_id` (PK), `complaint_id` (FK), `student_id` (FK), `is_satisfactorily_resolved`, `rating` |
| **`complaint_logs`** | Ticket status audit trail | `log_id` (PK), `complaint_id` (FK), `previous_status`, `new_status`, `action_note`, `timestamp` |
| **`complaint_reporters`** | Joint reporters on shared room/area issues | `(complaint_id, user_id)` (PK), `reported_at` |
| **`audit_log`** | Administrative & security event audit | `audit_id` (PK), `occurred_at`, `actor_user_id`, `action`, `target_type`, `target_id`, `details` |
| **`revoked_tokens`** | Server-side sign-out token blocklist | `jti` (PK), `user_id` (FK), `expires_at`, `revoked_at` |

---

## 3. Database Triggers, Stored Procedures & Analytical Views

### 3.1 Stored Procedures
1. **`sp_auto_dispatch_cleaning(p_complaint_id)`**:
   Selects the least-loaded available cleaner (`role='STAFF'`, `specialization='CLEANING'`, `is_available=TRUE`), creates assignment, and transitions ticket to `ASSIGNED`.
2. **`sp_confirm_resolution(p_complaint_id, p_student_id, p_is_satisfied, p_rating, p_comments)`**:
   Validates ticket ownership, writes feedback row, closes ticket as `COMPLETED` (if satisfied) or escalates to `ESCALATED` (if unsatisfied).
3. **`sp_supervisor_assign_task(p_complaint_id, p_staff_user_id, p_supervisor_user_id)`**:
   Enables supervisor manual dispatch or reassignment, recording supervisor identity.

### 3.2 Pre-Built Analytical Views
- **`view_staff_active_queue`**: Technician active queue ordered by `floor_number ASC`, `priority DESC`, `assigned_at ASC`.
- **`view_block_supervisor_summary`**: Aggregated block metrics (total, pending, active, awaiting verification, completed, average rating).
- **`view_recurring_defects_alert`**: Flags failure hotspots ($\ge 2$ complaints for same facility within 14 days).

### 3.3 Active Triggers
- **`trg_complaint_status_audit`**: Automatically writes status transitions to `complaint_logs`.
- **`trg_update_complaint_timestamps`**: Automatically maintains `resolved_at` and `closed_at` timestamps.

---

## 4. Role-Based Access Control (RBAC) & Authentication

- **Single Table Identity**: All users authenticate through `users`.
- **Authentication**: JWT signed with `JWT_SECRET`. Each token contains `userId`, `regOrEmpId`, `role`, and unique token ID `jti`.
- **Server-Side Revocation**: Sign-out stores `jti` in `revoked_tokens`.
- **Account Lockout**: 10 failed login attempts lock the account for 15 minutes (`failed_login_count`, `locked_until`).

---

## 5. REST API Route Catalog

### 5.1 Authentication (`/api/auth`)
- `POST /api/auth/login` → Login with `{ regOrEmpId, password }`. Returns `{ token, user }`.
- `POST /api/auth/register` → Student registration (role forced to `STUDENT`).
- `POST /api/auth/logout` → Revokes current token `jti` on server.

### 5.2 Complaints (`/api/complaints`)
- `POST /api/complaints` → Raise ticket (1-click cleaning or technical form).
- `GET /api/complaints` → List complaints with filters (`status`, `blockId`, `priority`), search, and pagination.
- `GET /api/complaints/:id` → Detailed complaint history and audit logs.
- `POST /api/complaints/:id/confirm` → Submit resolution confirmation / rejection.

### 5.3 Dispatch & Tasks (`/api/dispatch`)
- `GET /api/dispatch/tasks` → Active queue for authenticated technician sorted by floor.
- `PATCH /api/dispatch/tasks/:id` → Staff transitions (`startWork`, `markWorkCompleted`).
- `POST /api/dispatch/reassign` → Supervisor manual dispatch override (`sp_supervisor_assign_task`).

### 5.4 Metadata & Infrastructure (`/api/meta`)
- `GET /api/meta/categories` → All categories and 25 subcategories.
- `GET /api/meta/blocks` → Hostel blocks, floors, rooms, and common areas.

### 5.5 AI Triage & Health (`/api/ai`)
- `POST /api/ai/triage` → Natural language classification, safety advisories, and candidate allocation.
- `GET /api/ai/health` → Live operational status of AI subsystem (`HEALTHY`, `DEGRADED`, `DOWN`).
- `POST /api/ai/outage/simulate` → Outage drill trigger for supervisor testing.

### 5.6 Admin & Analytics (`/api/admin`, `/api/analytics`)
- `GET /api/analytics/kpis` → System-wide KPIs and resolution metrics.
- `GET /api/admin/users` & `POST /api/admin/users` → Privileged user management.
- `POST /api/admin/allotments` → Manage room allocations and bed capacities.

---

## 6. Seed Test Credentials (Default Password: `Password@123`)

| Role | Username / ID | Name | Assignment / Scope |
|---|---|---|---|
| **Student** | `21BCE0843` | Vihaan Sharma | Room `L-843` |
| **Student** | `21BCE1042` | Rahul Varma | Room `L-810` |
| **Staff (Cleaning)** | `EMP_CLN_01` | Murugan K | Housekeeping Trade |
| **Staff (Electrician)**| `EMP_ELEC_01` | Suresh Kumar | Electrical Trade |
| **Staff (Carpenter)** | `EMP_CARP_01` | Govindraj M | Carpentry Trade |
| **Staff (AC Tech)** | `EMP_AC_01` | Dhanush V | AC & HVAC Trade |
| **Staff (Plumber)** | `EMP_PLB_01` | Karthik N | Plumbing Trade |
| **Supervisor** | `SUP_LBLOCK_01` | Mr. R. Sundaram | L-Block Facility Supervisor |
| **Admin** | `ADMIN_ESTATES_01`| Chief Warden | Estates & Infrastructure Lead |
