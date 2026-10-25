# FIX_MASTER — Phase 0 Discovery & Architecture Mapping

**Inspection Date:** 2026-10-24 | **Baseline Commit:** `8f0a5c7` | **Environment:** Node 20+, Express 5, React 18, PostgreSQL 15/16

---

## 1. Concept to Codebase Entity Mapping

| System Concept | Source File / Route | Database Table / Entity | Implementation Notes |
|:---|:---|:---|:---|
| **Backend Entry** | `src/server.js`, `src/app.js` | N/A | Express 5.2.1, CommonJS, mounted at `/api/*`. |
| **Database Pool** | `src/config/db.js` | N/A | `pg.Pool`, SSL auto-detection, `withTransaction(client => ...)` helper. |
| **Complaints** | `src/controllers/complaintController.js`, `src/routes/complaintRoutes.js` | `complaints` | Columns: `complaint_id`, `ticket_scope`, `room_id`, `common_area_id`, `block_id`, `raised_by_user_id`, `subcategory_id`, `description`, `photo_evidence_url`, `status`, `priority`, `preferred_timeslot`. |
| **Assignments** | `src/controllers/dispatchController.js`, `src/routes/dispatchRoutes.js` | `complaint_assignments` | Columns: `assignment_id`, `complaint_id`, `staff_user_id`, `assigned_by_user_id`, `assigned_at`, `current_state` (`ASSIGNED`, `ACCEPTED`, `IN_PROGRESS`, `DONE`, `DECLINED`). |
| **Users / Staff** | `src/controllers/authController.js`, `src/controllers/adminController.js` | `users` | Columns: `user_id`, `reg_or_emp_id`, `full_name`, `email`, `role`, `specialization`, `is_available`, `failed_login_count`, `locked_until`. |
| **Infrastructure** | `src/controllers/infrastructureController.js` | `rooms`, `hostel_blocks`, `block_floors`, `common_areas` | Rooms categorized by floor and bed capacity; common utilities mapped by block and floor. |
| **Categories & SLAs**| `src/controllers/metaController.js`, `src/routes/metaRoutes.js` | `complaint_categories`, `complaint_subcategories` | 6 service categories, 25 subcategories with estimated minutes, SLA hours, default priority, and required specialization. |
| **Audit Trails** | `src/services/auditService.js` | `complaint_logs`, `audit_log` | `complaint_logs` captures ticket state transitions; `audit_log` captures administrative actions and security events. |
| **Frontend Form** | `client/src/features/student/NewComplaintForm.tsx` | N/A | React 18 with TanStack Query, Lucide icons, Tailwind CSS, read-only AI priority badge. |
| **Student Home** | `client/src/features/student/StudentHome.tsx` | N/A | 1-Click quick action card, active tickets table, verification modal. |
| **API Client** | `client/src/api/endpoints.ts`, `client/src/api/client.ts` | N/A | Centralized fetch wrapper with automatic token injection and error handling. |

---

## 2. Technical Stack Baseline Confirmation

- **Node.js & Module System**: CommonJS (`"type": "commonjs"`) in Express backend; ESM in Vite + React frontend.
- **Database Engine**: PostgreSQL 15/16; client is `pg` with parameterized SQL (zero ORM overhead).
- **Frontend**: React 18, Vite, TypeScript 5, Tailwind CSS, TanStack React Query v5.
- **AI Integration**: `@google/genai` with deterministic heuristic fallback engine.

---

## 3. Core Architectural Nuances

1. **Shared Location Model**: Complaints are keyed by `(location, subcategory_id)`. Roommates filing for the same defect join the existing ticket via `complaint_reporters` rather than creating duplicate work orders.
2. **Student Priority Immutability**: Students cannot arbitrarily elevate ticket priority. Priority is computed by the AI triage engine or derived from the issue default, backed by a strict safety floor.
3. **Staff Dispatch Eligibility**: Technician auto-allocation enforces: `role = 'STAFF'`, `specialization = required_specialization`, and `is_available = TRUE`.
4. **Audit Columns**: AI triage and allocation decisions persist explanatory reasoning in `ai_priority_reasoning`, `ai_safety_advisory`, and `ai_allocation_reasoning` (Migration `009`).

---

## 4. Baseline Verification Checklist

- [x] Backend connects to PostgreSQL; all migrations (001–009) apply cleanly.
- [x] Client builds with zero TypeScript or Vite bundle errors.
- [x] Database procedures and triggers active and verified in automated tests.
