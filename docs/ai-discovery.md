# FIX_MASTER — Phase 0 Discovery & Architecture Mapping

**Inspection Date:** 2026-10-24  
**Target Repository:** `Divyakush2006/FixMaster`  
**Current Commit:** `8f0a5c7` (*feat: run on the project's own Neon Postgres*)  

---

## 1. Concept to Codebase Entity Mapping

| Plan Concept | Actual Codebase File / Route | Actual DB Table / Column | Notes & Deviations |
| :--- | :--- | :--- | :--- |
| **Backend Entry** | `src/server.js`, `src/app.js` | N/A | Express 5.2.1, CommonJS, mounts at `/api/*`. |
| **Database Pool** | `src/config/db.js` | N/A | Uses `pg.Pool`, supports Neon pooled vs direct SSL, provides `withTransaction`. |
| **Complaints** | `src/controllers/complaintController.js`, `src/routes/complaintRoutes.js` | `complaints` | Columns: `complaint_id` (UUID), `ticket_scope` (`ROOM` or `COMMON_AREA`), `room_id`, `common_area_id`, `block_id`, `raised_by_user_id`, `subcategory_id`, `description`, `photo_evidence_url`, `status`, `priority`, `preferred_timeslot`. |
| **Assignments** | `src/controllers/dispatchController.js`, `src/routes/dispatchRoutes.js` | `complaint_assignments` | Columns: `assignment_id` (SERIAL), `complaint_id`, `staff_user_id`, `assigned_by_user_id`, `assigned_at`, `current_state` (`ASSIGNED`, `ACCEPTED`, `EN_ROUTE`, `IN_PROGRESS`, `DONE`, `DECLINED`). |
| **Users / Staff** | `src/controllers/authController.js`, `src/controllers/adminController.js` | `users` | Columns: `user_id`, `reg_or_emp_id`, `full_name`, `role` (`STUDENT`, `STAFF`, `SUPERVISOR`, `ADMIN`), `specialization` (`CLEANING`, `ELECTRICIAN`, `CARPENTER`, `AC_TECH`, `PLUMBER`), `is_available` (BOOLEAN), `is_active` (BOOLEAN). |
| **Rooms & Floors** | `src/controllers/infrastructureController.js` | `rooms`, `hostel_blocks` | `rooms` has `room_id`, `block_id`, `floor_number`, `room_type`, `bed_capacity`, `is_active`. `hostel_blocks` has `block_id`, `block_name`, `total_floors`. |
| **Categories & Issues** | `src/controllers/metaController.js` | `complaint_categories`, `complaint_subcategories` | `complaint_categories`: `category_id`, `category_code`, `category_name`, `is_quick_action`, `default_sla_hours`. `complaint_subcategories`: `subcategory_id`, `category_id`, `subcategory_code`, `issue_name`, `estimated_resolution_mins`, `priority_level`, `required_specialization`. |
| **Audit & Logs** | `src/services/auditService.js` | `complaint_logs`, `audit_log` | `complaint_logs` tracks complaint lifecycle status transitions. `audit_log` tracks admin/security events. |
| **Frontend Form** | `client/src/features/student/NewComplaintForm.tsx` | N/A | React with `useState`, `@tanstack/react-query`, Lucide icons, Tailwind CSS. |
| **Student Dashboard**| `client/src/features/student/StudentHome.tsx` | N/A | Quick action cards, active tickets table, verification modal. |
| **Frontend API** | `client/src/api/endpoints.ts` | N/A | Uses custom fetch wrapper in `client/src/api/client.ts`. |

---

## 2. Technical Stack Baseline Confirmation

1. **Node.js & Module System:**
   - Node version: `v24.12.0` (Node 20+ engine satisfied).
   - Backend module system: **CommonJS** (`"type": "commonjs"` in `package.json`).
   - Frontend module system: **ESM** with Vite and TypeScript.
2. **Database Engine & Client:**
   - Database: **PostgreSQL (Neon replica)**.
   - Client: `pg` (`^8.23.0`) parameterized SQL. No ORM.
   - Transactions: Handled using `db.withTransaction(async (client) => { ... })`.
3. **Frontend Stack:**
   - React 18, Vite 6, TailwindCSS 3, TanStack React Query v5.
   - Type-checked with TypeScript 5.

---

## 3. Assumptions and Codebase Nuances

1. **Shared Ticket Model (Migrations 007-008):**
   - The ticket unit is the **location** (`room_id` or `common_area_id`) + `subcategory_id`.
   - If an issue is already open for a room, raising it again joins the existing complaint (`joined: true`) and increments `complaint_reporters`. The AI integration must preserve this behavior.
2. **Priority Policy:**
   - In standard mode, students can only raise default priority by 1 level ceiling.
   - Under AI mode, the priority is computed by Gemini / deterministic fallback with strict floor rules (e.g. sparks/gas = `EMERGENCY`).
3. **Staff Roles:**
   - Staff candidates must have `role = 'STAFF'`, matching `specialization = required_specialization`, and `is_available = TRUE`.
4. **Missing AI Infrastructure (To be added in Phase 1 & 2):**
   - No AI columns exist yet on `complaints` (`ai_priority_reasoning`, `ai_safety_advisory`, `ai_decided`).
   - No AI columns exist yet on `complaint_assignments` (`ai_allocation_reasoning`, `ai_allocated`).
   - `@google/genai` is not yet installed in root `package.json`.

---

## 4. Phase 0 Verification Status

- [x] Application builds cleanly (`client` build verified with 0 errors).
- [x] Backend connects to live PostgreSQL database; all 8 baseline migrations applied.
- [x] Environment configured with valid `DATABASE_URL` and `GEMINI_API_KEY`.
- [x] Discovery documentation generated. No source code modified.
