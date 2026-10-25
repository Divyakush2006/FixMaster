# FIX_MASTER — Backend Hardening Fix Log

> **Context**: Initial audit of the `sudeep-dev` backend branch (`fix/backend-hardening`).  
> **Subsequent Hardening**: Later production-readiness work superseded parts of this pass (e.g., privileged accounts moved exclusively to `POST /api/admin/users`, schemas moved to checksummed migrations). See [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md).

---

## 1. Security Vulnerabilities Fixed

| # | Vulnerability | Root Cause | Fix Applied | Verification |
|---|---|---|---|---|
| **1** | **Unauthenticated ADMIN Self-Registration** | `POST /api/auth/register` accepted `role` directly from request payload without validation. | Enforced `optionalAuthenticate` in auth routes. `role` is hardcoded to `STUDENT` unless caller presents a valid `ADMIN` JWT. | Tested registration with `role: "ADMIN"`; unauthenticated returns `STUDENT`. |
| **2** | **IDOR on Task Completion** | `PATCH /api/dispatch/tasks/:id` lacked staff ownership validation. Any staff member could manipulate any task. | Loaded assignment `FOR UPDATE` in transaction; verified `staff_user_id` matches caller; `complaint_id` read directly from assignment row. | Staff A attempting to complete Staff B's task is rejected with HTTP 403. |
| **3** | **Unallotted Room Complaint Creation** | Students could file room complaints against any room in the database. | Validated current room allotment in `student_room_allotments` before accepting room ticket; verified `room_id`/`common_area_id` matches `block_id`. | Cross-room complaints rejected with 403. |
| **4** | **Unrestricted Complaint Visibility for Staff** | `GET /api/complaints` only filtered for students, allowing staff to view all campus complaints and resident PII. | Scoped staff queries to complaints they are (or were) assigned to via `EXISTS` check on `complaint_assignments`. | Staff queries only return assigned workload. |
| **5** | **Raw Database Errors Leaked to Client** | Missing/invalid fields threw uncaught driver errors with internal SQL schema details. | Centralized error handler in `errorHandler.js` mapping Postgres error codes (23505, 23503, 23514) to safe messages; express-validator added on all endpoints. | Malformed input returns clean HTTP 400 with validation details. |
| **6** | **Missing Rate Limiting & Weak Secrets** | No brute-force protection on `/api/auth/*`; missing security headers; default example `JWT_SECRET` accepted in production. | Added `express-rate-limit` (20 req / 15 min on auth, 120 / min general); added `helmet()`; server refuses to start in production if `JWT_SECRET` matches example or is <32 chars. | High-frequency auth requests receive HTTP 429. |

---

## 2. Correctness & Transactional Integrity Fixes

| # | Defect | Root Cause | Fix Applied | Verification |
|---|---|---|---|---|
| **7** | **Non-Atomic Pool Transactions** | `markWorkCompleted` called `db.query('BEGIN')` on the `pg` pool instead of a single checked-out client, causing statements to execute on different connections. | Implemented `withTransaction(work, actingUserId)` in `db.js` using `pool.connect()` with guaranteed `BEGIN`/`COMMIT`/`ROLLBACK` on a single client. | 10 concurrent requests verified to maintain dedicated single-client connections under load. |
| **8** | **Ambiguous Location Constraint** | `chk_complaint_location` required `common_area_id IS NOT NULL` for `COMMON_AREA` but omitted `room_id IS NULL`. Contradictory rows could store both. | Updated CHECK constraint to enforce mutual exclusivity: `ticket_scope = 'ROOM'` requires `common_area_id IS NULL`, and vice versa. | Insertion with both fields populated is rejected with constraint violation. |
| **9** | **Room Allotment History Capped** | `UNIQUE(student_id, is_current)` prevented recording more than one historical (`is_current = FALSE`) allotment. | Replaced with partial unique index: `CREATE UNIQUE INDEX ... ON student_room_allotments (student_id) WHERE is_current = TRUE`. | Multiple historical allotments successfully recorded for room transfer audits. |
| **10** | **Audit Trigger Missing Actor Attribution** | `fn_audit_complaint_status_change()` hardcoded `changed_by_user_id = NULL`. | Trigger reads session setting `app.current_user_id`; `withTransaction()` injects acting user ID via `set_config('app.current_user_id', ...)` on execution. | Task status transitions now record acting staff ID in `complaint_logs`. |
| **11** | **Invalid Seed Password Hashes** | Seed accounts used corrupted hashes that failed comparison against documented password `Password@123`. | Re-generated seed password hashes using standard BCrypt (cost factor 12) for `Password@123`. | All 12 seed accounts log in successfully. |
| **12** | **Non-Deterministic Category Hierarchy Order** | `GET /api/meta/categories` lacked `ORDER BY` and returned `[null]` for categories with zero subcategories. | Added `ORDER BY c.category_id` and used `json_agg(...) FILTER (WHERE s.subcategory_id IS NOT NULL)`. | Predictable ordering and empty arrays `[]` returned. |
| **13** | **Silent Auto-Dispatch Failures** | `sp_auto_dispatch_cleaning` left ticket `OPEN` when no cleaners were available, but API responded with success. | Procedure modified with `INOUT p_assigned_staff_id`; controller detects null and returns `{ assigned: false }`; added trade mismatch guards. | Out-of-capacity dispatch returns clear status. |

---

## 3. Essential Endpoints Added for Frontend Integration

The following endpoints were added to unblock the frontend specification:
- `GET /api/meta/staff?specialization=` — Staff roster with live task count for manual supervisor dispatch.
- `GET /api/meta/blocks/:block_id/common-areas` — Discovers shared facilities for common area ticket filing.
- `GET /api/me` & `GET /api/me/allotment` — Current authenticated user profile, roles, and room allotment.
- `GET /api/complaints/:id` — Detailed complaint view with location, status, and assigned technician.
- `PATCH /api/dispatch/tasks/:id/start` — Transitions task from `ASSIGNED` to `IN_PROGRESS`.
- `GET /api/complaints/:id/logs` — Exposes ticket lifecycle audit trail.
