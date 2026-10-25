# FIX_MASTER — Production Readiness Audit & Hardening Specification

This document details the hardening pass on `production-hardening` following the initial merge. Every issue listed was reproduced against the running API, fixed, and integrated into automated regression test suites.

Earlier bugfixes (IDOR, transaction pooling, admin registration) are in [BUGFIXES.md](BUGFIXES.md).

---

## 1. Executive Summary

| Metric | Before Hardening | After Hardening |
|---|---|---|
| **Reproduced Security / Logic Bugs** | 14 open defects | 14 resolved with regression tests |
| **Automated Test Coverage** | 0 tests | 48 API/DB tests + 11 frontend unit tests |
| **Database Migrations** | Destructive `init_all.sql` drops | Versioned, checksummed, locked migrations |
| **Continuous Integration (CI)** | None | GitHub Actions (PG 15 & 16, lint, build, audit) |
| **Containerization** | None | Multi-stage Dockerfiles + `docker-compose.yml` |
| **Dependency Vulnerabilities** | 1 Critical, 1 Moderate | 0 known vulnerabilities |
| **Initial JS Download** | 723 kB single bundle | ~260 kB route-split bundle |

---

## 2. Defects Fixed (Reproduced Against Live API)

| ID | Severity | Defect & Impact | Root Cause & Resolution | Automated Test Name |
|---|:---:|---|---|---|
| **P1** | **Critical** | Early Ticket Verification: Students could verify `OPEN` tickets before work was performed, bypassing dispatch and closed-loop verification. | `sp_confirm_resolution` locks ticket row and requires `status = 'PENDING_VERIFICATION'`. | `lifecycle: cannot be closed by feedback before the work is done` |
| **P2** | **Critical** | Permanent Stall on Rework: Rejecting unsatisfactory work permanently prevented ticket closure due to `UNIQUE(complaint_id)` on `complaint_feedback`. | Shifted to one feedback row per verification round; replaced constraint with partial unique index allowing one accepted sign-off. | `lifecycle: a rejected ticket can be reworked ... and then closed` |
| **P3** | **High** | Ghost Queue Work: Reassigned tickets remained visible in the original technician's active task queue. | `view_staff_active_queue` updated to filter on assignment state (`ASSIGNED`, `IN_PROGRESS`), not merely ticket status. | Same test (asserts original technician's queue) |
| **P4** | **High** | Unverifiable Supervisor Tickets: Complaints raised by supervisors could never be closed because verification was restricted to `STUDENT`. | Unified verification logic: any authenticated user role who raised the ticket can verify and sign off. | `lifecycle: a ticket raised by a supervisor can be verified and closed` |
| **P5** | **Critical** | New Student Deadlock: Newly registered students were unable to file room tickets due to missing room allotment and no self-allotment UI. | Added Admin Allotment API + UI with bed capacity checks; room tickets automatically bind to the resident's active allotment. | `admin: newly registered student can file room tickets once room is allotted`, `enforces room bed capacity` |
| **P6** | **Medium** | Server Crash on Malformed Body: Invalid JSON payloads triggered unhandled 500 crashes. | Added Express body-parser error handler mapping malformed syntax to clean HTTP 400 / 413. | `auth: returns 400 (not 500) for a malformed JSON body` |
| **P7** | **High** | Stored XSS via Evidence URL: `photo_evidence_url` accepted `javascript:` URIs rendered as clickable links. | Enforced strict http/https URL scheme validation on API ingest and UI anchor rendering. | `complaints: only accepts http(s) photo links` |
| **P8** | **Low** | Case-Sensitive Login ID: Lowercase student IDs (e.g., `21bce0843`) were rejected. | Standardized registration/login IDs to uppercase in database and queries. | `auth: login IDs are case-insensitive` |
| **P9** | **Medium** | Email Normalization Corruption: Submissions with dots or `+tags` were modified unexpectedly. | Removed overzealous normalization; emails are trimmed and lowercased only. | `auth: stores the email exactly as typed` |
| **P10** | **Medium** | Duplicate Rapid Submissions: Double-clicking submit created duplicate open tickets for the same fault. | Enforced 409 conflict on duplicate live tickets via advisory locks and partial unique indexes. | `complaints: refuses a duplicate ... including concurrent double-taps` |
| **P11** | **High** | Stale Token Privilege Persistence: Role changes or deactivations did not revoke existing 24h JWTs. | Added `is_active` check per request; user role queried live from DB; password reset revokes all sessions. | `auth: deactivated account ...`, `uses current role from DB`, `password change revokes sessions` |
| **P12** | **Medium** | Unbounded Query Load: `GET /complaints` returned all records, risking memory exhaustion. | Added server-side pagination (`limit`/`offset`, default cap 500) with total count in `X-Total-Count`. | `complaints: paginates with limit/offset` |
| **P13** | **Medium** | Silent Password Truncation: Passwords >72 bytes were silently truncated by BCrypt. | Enforced 72-byte maximum length validation in API and client forms. | `auth: rejects passwords longer than 72 bytes` |
| **P14** | **Medium** | Category ID Sequence Collision: Explicit IDs in seed data did not advance PostgreSQL sequences. | Synced sequences post-seeding using `setval(pg_get_serial_sequence(...))`. | `complaints: new categories can be added after seeding` |
| — | **High** | Concurrent Dispatch Conflict: Simultaneous supervisor dispatches on the same ticket caused duplicate assignments. | Added row-level `FOR UPDATE` locking on ticket before dispatching. | `lifecycle: two simultaneous dispatches ... exactly one assignment` |
| — | **Medium** | Orphaned Tasks on Staff Deactivation: Deactivating a technician stranded their in-progress tasks. | Automated reassignment workflow returns pending tasks to `OPEN` with audit notes. | `admin: deactivating a technician releases their live tasks` |
| — | **Medium** | Incomplete Creation Audit: Complaint creation was omitted from `complaint_logs`. | Ticket creation logged in the same transaction. | `complaints: records ticket creation in the audit trail` |
| — | **Low** | KPI Double-Counting: Repeated verification rounds caused duplicate counts in supervisor KPI views. | Grouped feedback entries by ticket ID prior to joining in views. | `lifecycle: asserts KPI total equals actual count` |

---

## 3. Security & Operability Hardening

### 3.1 Security Hardening
- **Timing Attack Mitigation**: Login checks execute BCrypt comparisons on dummy hashes for non-existent users, equalizing response times (~250ms).
- **JWT Algorithm Pinning**: Enforced `HS256` explicitly; tokens with `alg: none` are rejected.
- **Reverse Proxy Protection (`TRUST_PROXY`)**: Correctly extracts client IP behind nginx/load balancers to ensure rate limits are not shared across clients.
- **Production Startup Guard**: Server halts on boot if `JWT_SECRET` is unset, <32 chars, or matches example keys, or if `CORS_ORIGIN` is missing.
- **Database Statement Timeout**: Configured 15s timeout on SQL queries to prevent runaway queries from blocking connection pools.
- **Frontend Session Isolation**: Client cache (TanStack Query) and state are completely wiped on logout, preventing data leakage on shared hostel terminals.

### 3.2 Operability & Database Lifecycle
- **Versioned Migrations (`npm run db:migrate`)**: Replaces destructive scripts with transactional, checksummed migrations in `database/migrations/`.
- **Health Probes**:
  - `GET /api/health/live`: Lightweight process liveness probe.
  - `GET /api/health`: Readiness probe verifying database connectivity and latency.
- **Graceful Shutdown**: Traps `SIGTERM`/`SIGINT`, drains inflight requests, closes connection pool, and restarts cleanly on uncaught errors.

---

## 4. Multi-Portal Authentication Architecture

| Portal | Route | Allowed Roles | API Endpoint | Session Expiry |
|---|---|---|---|:---:|
| **Student** | `/login` (Student Tab) | `STUDENT` | `POST /api/auth/student/login` | 24 Hours |
| **Staff** | `/login` (Staff Tab) | `STAFF`, `SUPERVISOR` | `POST /api/auth/staff/login` | 24 Hours |
| **Admin** | `/admin` | `ADMIN` | `POST /api/auth/admin/login` | 8 Hours |

- Tokens are strictly bound to their portal scope (`portal` claim + JWT audience).
- Portal separation prevents credential stuffing across interfaces; unprivileged users attempting admin login receive standard "Invalid credentials" without revealing account existence.

---

## 5. Hostel Infrastructure & Spatial Hierarchy

- **Blocks A to T**: Seeded with Ground + 10 floors out of the box (migration `004`).
- **Standardized Room Numbering**:
  - Format: `<Block>-<FloorCode><RoomNumber>` (e.g., `A-428`, `C-G01`, `L-1007` for 10th floor).
  - Enforced by database CHECK constraint `chk_room_number_format`.
- **Bed Capacity Management**: Occupied rooms cannot be deactivated or have capacity reduced below active occupancy count.

---

## 6. Verification & Audit Findings (Round 3)

| ID | Finding | Resolution |
|---|---|---|
| **R1** | Campus-wide IP lockout due to shared NAT | Keyed login rate limiters per account + IP (`rateLimiters.js`). |
| **R2** | Brute force attack vulnerability | Per-account lockout in DB (10 failures = 15 min lock with `Retry-After`). |
| **R3** | Weak passwords accepted | Enforced policy: 8–72 bytes, alphanumeric, not matching user ID. |
| **R4** | Arbitrary student priority escalation | Priority defaults to issue safety matrix; students can adjust at most +1 level. |
| **R5** | Stuck tasks with unavailable technicians | Supervisors granted reassignment workflow for `ASSIGNED`/`IN_PROGRESS` tasks. |
| **R6** | Stateless token persistence after logout | Added `revoked_tokens` table; `POST /api/auth/logout` revokes token `jti`. |
| **R7** | 1-second JWT timestamp race condition | Revocation window includes current second; replacement token issued at `t + 1s`. |
| **R8** | CPU starvation during login bursts | Switched to native `bcrypt` (C++ libuv threads) increasing throughput 3 → 17 req/s. |
| **R9** | Missing administrative audit history | Append-only `audit_log` records all administrative mutations with actor details. |
| **R10**| Client-side memory overload on large lists | Server-side pagination, search, and filtering with `X-Total-Count`. |

---

## 7. Verification Test Suite Results

| Test Category | Suite / Framework | Result |
|---|---|:---:|
| **API & Database Tests** | Node.js Test Runner (`tests/*.test.js`) | **114 / 114 Passed** |
| **Frontend Unit Tests** | Vitest (`client/**/*.test.ts`) | **30 / 30 Passed** |
| **Browser End-to-End** | Playwright (Shared room & lifecycle) | **29 / 29 Passed** |
| **Security Probes** | Automated penetration script | **40 / 40 Clean** |
| **Accessibility Audit** | axe-core (WCAG 2.1 AA) | **21 / 21 Screens Compliant** |
| **Dependency Vulnerabilities** | `npm audit` | **0 Vulnerabilities** |

---

## 8. Deployment & Execution Reference

```bash
# Local Development
cp .env.example .env
npm ci && npm run db:migrate && npm run db:seed
npm run dev

# Run Automated Test Suite
npm test

# Production Container Stack
docker compose up -d --build
```
