# Backend Hardening — Fix Log

> **Superseded in part.** This is the first fix pass. A later production-readiness
> audit found and fixed further bugs - several in code from this pass - and replaced
> some mechanisms described below. In particular: privileged accounts are now created
> only via `POST /api/admin/users` (the admin-token-on-`/register` path described in
> #1 was removed), and the schema is managed by versioned migrations rather than
> hand-edited SQL files. See [`PRODUCTION_READINESS.md`](PRODUCTION_READINESS.md).

This documents every bug found during a manual audit of the `sudeep-dev` backend
(the only branch with a running API) and the fix applied for each, on branch
`fix/backend-hardening`. Every fix below was reproduced against the running
server and API before the change, and re-verified against the same scenario
after it.

## Security

### 1. Any unauthenticated request could self-register as ADMIN
`POST /api/auth/register` took `role` directly from the request body with no
check at all. A single unauthenticated request could mint an ADMIN account.

**Fix:** `src/routes/authRoutes.js` now runs `optionalAuthenticate` on
`/register`. `src/controllers/authController.js` forces `role = 'STUDENT'`
for any request that doesn't carry a valid ADMIN JWT; only an already-ADMIN
caller may set `role` to `STAFF`, `SUPERVISOR`, or `ADMIN`.

### 2. IDOR on task completion
`PATCH /api/dispatch/tasks/:assignment_id` never checked that the assignment
belonged to the authenticated staff member. `assignment_id` is a plain
auto-incrementing integer, so any STAFF account could complete (and thus
force into `PENDING_VERIFICATION`) any other staff member's task by
incrementing the ID.

**Fix:** `dispatchController.js` now loads the assignment `FOR UPDATE` inside
the transaction and verifies `staff_user_id` matches the caller before doing
anything, for both `markWorkCompleted` and the new `startWork` transition.
`complaint_id` is now read from the assignment row itself rather than trusted
from the request body, which also closes a secondary spoofing path (sending
a valid `assignment_id` with a mismatched `complaint_id`).

### 3. No room-ownership check on complaint creation
A student could file a `ROOM` complaint against any room in the system, not
just the one they are allotted to.

**Fix:** `complaintController.js` now checks `student_room_allotments` for a
current allotment on that room before accepting the complaint (students
only — supervisors/admins filing on a resident's behalf are unaffected). It
also now verifies the room or common area actually belongs to the
`block_id` sent, preventing a mismatched block from being recorded.

### 4. STAFF could read every complaint in the system
`GET /api/complaints` filtered results for `STUDENT` only. Any STAFF account
saw all complaints — including other students' names, phone numbers and
descriptions for tickets they had no assignment on.

**Fix:** STAFF is now scoped to complaints they have (or had) an assignment
on, via an `EXISTS` check against `complaint_assignments`.

### 5. Raw PostgreSQL errors reached the client
Missing/invalid input crashed straight through to a 500 with the driver's
internal message (e.g. `null value in column "block_id" of relation
"complaints" violates not-null constraint`), and a missing `password` on
registration threw an unhandled bcrypt error.

**Fix:** `src/middleware/errorHandler.js` adds a centralized error handler
that maps known Postgres error codes (unique/foreign-key/check violations,
etc.) to safe, friendly messages and logs the raw error server-side only.
`src/middleware/validators.js` (express-validator) now validates every
request body/param/query before it reaches a controller, so malformed input
returns a clean `400` instead of ever reaching the database or bcrypt.

### 6. No rate limiting, no security headers, JWT secret committed with no guard
`/api/auth/*` had no throttling on login/registration attempts, no `helmet`
headers were set, and the server would happily boot in production with the
JWT secret still equal to the value committed in `.env.example` — anyone
with read access to the repo could forge tokens for any user, including
ADMIN.

**Fix:** `src/middleware/rateLimiters.js` adds a 20-requests/15-min limiter
on `/api/auth/*` and a general 120/min limiter elsewhere. `helmet()` is
applied globally. `src/server.js` refuses to start when
`NODE_ENV=production` and `JWT_SECRET` is still the example value (warns in
development instead). `CORS_ORIGIN` is now configurable via env.

## Correctness

### 7. `markWorkCompleted`'s "transaction" wasn't atomic
The handler called `db.query('BEGIN')` followed by further `db.query(...)`
calls against the connection **pool**, not a single checked-out client. The
`pg` pool does not guarantee the same connection for consecutive calls, so
under load a request's `BEGIN` and its `UPDATE`s could land on different
backend connections — the `BEGIN`/`COMMIT` became no-ops on connections
nobody else touched, and the statements in between ran outside any real
transaction. Reproduced directly: with the pool saturated, one request's
first statement ran on backend pid 8976 and its second statement ran on pid
25416.

**Fix:** `src/config/db.js` adds `withTransaction(work, actingUserId)`,
which checks out one client via `pool.connect()` for the whole callback and
runs `BEGIN`/`COMMIT`/`ROLLBACK` on that same client. Every multi-statement
write path (`markWorkCompleted`, `startWork`, `assignTechnician`,
`autoDispatchCleaning`, `submitResolutionFeedback`) now goes through it.
Re-verified under the same saturated-pool condition: 10/10 concurrent
transactions stayed on a single connection.

### 8. `chk_complaint_location` had a hole
The `CHECK` constraint required `common_area_id IS NOT NULL` for a
`COMMON_AREA` ticket but never required `room_id IS NULL`. A row could carry
both a room and a common area at once; the analytical views
(`view_staff_active_queue`, `view_recurring_defects_alert`) use
`COALESCE(room, common_area)` for location, so a contradictory row dispatched
a technician to a private room for what was actually a shared-facility fault.

**Fix:** `database/schema.sql` now requires `room_id IS NULL` in the
`COMMON_AREA` branch. `complaintController.js` also normalizes the insert at
the application layer (only the field matching `ticket_scope` is ever
written), so a contradictory row can't reach the database even from a
direct SQL path.

### 9. Wrong uniqueness constraint on room allotments
`UNIQUE (student_id, is_current)` capped a student at **one historical
(`is_current = FALSE`) allotment ever** — a second past allotment was
rejected as a duplicate key, which made room-transfer history unrecordable.

**Fix:** replaced with a partial unique index,
`CREATE UNIQUE INDEX ... ON student_room_allotments (student_id) WHERE
is_current = TRUE`, which correctly allows unlimited history rows while
still guaranteeing at most one current allotment.

### 10. Audit trigger couldn't say who made a change
`fn_audit_complaint_status_change()` hardcoded `changed_by_user_id = NULL`
on every automated log row, so the audit trail could never attribute a
status change to an actor.

**Fix:** the trigger now reads the session-local setting
`app.current_user_id` (`current_setting('app.current_user_id', true)`).
`withTransaction()` sets this via `set_config()` at the start of any
transaction given an acting user, so status changes made through the API are
now attributed correctly. Verified: a `PATCH /dispatch/tasks/:id` made by
staff "Murugan K" now logs `changed_by_user_id` = Murugan's user id, where
it previously logged `NULL`.

### 11. Fabricated seed password hash
All 12 seed users shared a bcrypt hash that matched no password, including
the documented `Password@123` — every seed account was locked out.

**Fix:** `database/seed_data.sql` now uses a real bcrypt hash (cost 12) of
`Password@123`, generated and verified against `bcryptjs` directly. All 12
seed accounts can now log in with the documented password.

### 12. `/api/meta/categories` had non-deterministic order and a null-filled array
No `ORDER BY`, so `GROUP BY` output order was not guaranteed between
requests. A category with zero subcategories returned `subcategories: [null]`
(an array containing null) rather than `[]`.

**Fix:** added `ORDER BY c.category_id` and switched to
`json_agg(...) FILTER (WHERE s.subcategory_id IS NOT NULL)`.

### 13. Auto-dispatch reported success even when nobody was assigned
`sp_auto_dispatch_cleaning` left the complaint `OPEN` when no cleaning staff
were available, but the controller always responded `200 { message:
"Auto-dispatch evaluated successfully." }` regardless — a supervisor had no
way to tell a real dispatch from a silent no-op without separately
re-fetching the complaint.

**Fix:** the procedure's `p_assigned_staff_id` is now an `INOUT` parameter
that comes back `NULL` on failure. The controller reads it and returns
`{ assigned: false, message: "No cleaning staff are currently available.
The ticket remains OPEN." }` or `{ assigned: true, staff_name, ... }`
accordingly. Also added a category guard (auto-dispatch now rejects
non-cleaning tickets with a clear 400 instead of silently attempting it) and
a specialization-mismatch guard on manual assignment (`POST
/dispatch/assign` now rejects assigning an electrician's ticket to a
plumber, etc.).

## Additions (needed by the already-written frontend spec)

The following endpoints did not exist at all. They were listed as hard
blockers (B1–B7) in the frontend build specification handed off separately,
and are added here so the frontend isn't blocked when it arrives:

- `GET /api/meta/staff?specialization=` — staff roster for the supervisor's
  manual-assign picker (SUPERVISOR/ADMIN only; includes live active task
  count). *(B1)*
- `GET /api/meta/blocks/:block_id/common-areas` — previously there was no
  way to discover a `common_area_id` at all, making `COMMON_AREA` complaints
  unfileable from any client. *(B2)*
- `GET /api/me` and `GET /api/me/allotment` — the login response never
  exposed email/specialization or a student's current room, and there was no
  way to re-derive identity from a stored token. *(B3, partial)*
- `GET /api/complaints/:id` — no single-complaint endpoint existed; detail
  views had to be reconstructed from the list. *(B4)*
- `PATCH /api/dispatch/tasks/:assignment_id/start` — staff previously had no
  way to move a task from `ASSIGNED` to `IN_PROGRESS`; the only transition
  was straight to done. *(B5)*
- `GET /api/complaints/:id/logs` — exposes the audit trail
  (`complaint_logs`), which was populated in the database but never
  reachable via the API. *(B7)*

Note: seed logins were broken (see #11) and are fixed here, so the
previously-documented blocker B6 no longer applies.

## Not changed

- The stored procedures' core dispatch logic (least-loaded cleaner
  selection, floor-ordered queue view) was correct and is unchanged.
- SQL injection resistance was already solid throughout (fully
  parameterized queries) and remains so; validators now add a second layer
  in front of it.
- `backup_restore.ps1` / `.sh` were verified working and are unchanged.
