# FIX_MASTER — Production Readiness Audit

Audit of the codebase as merged to `main` (PR #1), followed by the fixes on
branch `production-hardening`. Every bug listed under *Fixed* was first
reproduced against the running API, then fixed, and each one is now covered by
an automated test (named in the last column) that runs in CI.

Earlier fixes (IDOR on task completion, broken pool transaction, admin
self-registration, seed hashes, ...) are documented in
[`BUGFIXES.md`](BUGFIXES.md).

## Summary

| | Before | After |
|---|---|---|
| Reproduced logic/security bugs | 14 open | 14 fixed |
| Automated tests | 0 | 48 API/DB + 11 frontend |
| Schema changes | `init_all.sql` (drops every table) | versioned, checksummed migrations |
| CI | none (claimed in README) | GitHub Actions: tests on PG 15 & 16, audit, build, images |
| Containers | none (claimed in README) | API + web images, `docker-compose.yml` |
| Known vulnerabilities in shipped dependencies | 1 critical (API), 1 moderate (web) | 0 |
| Initial JS a student downloads | 723 kB (one bundle) | ~260 kB (route-split) |

## Fixed — bugs reproduced against the live API

| # | Severity | Problem | Fix | Covered by |
|---|---|---|---|---|
| P1 | **Critical** | A student could "verify" an `OPEN` ticket nobody had touched and close it as `COMPLETED` with 5 stars, bypassing dispatch, work and the closed loop entirely. | `sp_confirm_resolution` locks the ticket and requires `PENDING_VERIFICATION`. | `lifecycle: cannot be closed by feedback before the work is done` |
| P2 | **Critical** | Once a student rejected work, the ticket could never be closed: the second verification hit `UNIQUE(complaint_id)` on feedback (and an API pre-check returning 409). | One feedback row per verification round; a partial unique index allows only one acceptance. | `lifecycle: a rejected ticket can be reworked ... and then closed` |
| P3 | High | After a rejected ticket was reassigned to another technician, the first technician still saw it in their queue as live work. | Queue view filters on the assignment's state, not just the ticket's. | same test (asserts the first technician's queue) |
| P4 | High | A ticket raised by a supervisor could never be closed: feedback was STUDENT-only, but only the raiser may verify. | Any role that can raise a ticket can verify its own ticket. | `lifecycle: a ticket raised by a supervisor can be verified and closed` |
| P5 | **Critical** | Every newly registered student was permanently unable to raise room tickets: nothing could allot them a room (and the UI let them pick any room, which the API then rejected). | Admin allotment API + UI, with bed-capacity enforcement and history; students' room tickets always use their real allotment. | `admin: a newly registered student can file room tickets once a room is allotted`, `enforces room bed capacity`, `moving a student keeps their history` |
| P6 | Medium | A malformed JSON body returned HTTP 500. | Body-parser errors mapped to 400 / 413. | `auth: returns 400 (not 500) for a malformed JSON body` |
| P7 | High | `photo_evidence_url` accepted `javascript:` URLs, rendered as a clickable link (stored XSS). | API accepts only http(s) URLs; UI renders a link only for http(s) (covers rows stored earlier). | `complaints: only accepts http(s) photo links` |
| P8 | Low | Login ID was case-sensitive (`21bce0843` rejected). | IDs stored upper-case, case-insensitive lookup and unique index. | `auth: login IDs are case-insensitive` |
| P9 | Medium | Registration silently rewrote email addresses (`normalizeEmail` stripped dots and `+tags` from Gmail). | Email trimmed and lower-cased only; case-insensitive unique index. | `auth: stores the email exactly as typed` |
| P10 | Medium | The same open issue could be filed repeatedly (double-tapping a 1-click tile created duplicates). | Duplicate open ticket → 409, serialized per user so concurrent taps can't race. | `complaints: refuses a duplicate ... including concurrent double-taps` |
| P11 | High | No way to deactivate an account; a JWT stayed valid for 24 h whatever happened to the user, and the role inside the token was trusted. | `is_active` + per-request check; role read from the DB; password change/reset revokes older tokens. | `auth: a deactivated account ...`, `uses the current role from the database`, `password change revokes every other session` |
| P12 | Medium | `GET /complaints` was unbounded. | `limit`/`offset` (max 500, default cap 500) with `X-Total-Count`; response shape unchanged. | `complaints: paginates with limit/offset` |
| P13 | Medium | Passwords over 72 bytes were silently truncated by bcrypt: a *different* password sharing the first 72 bytes logged in. | Passwords limited to 72 bytes (API and UI). | `auth: rejects passwords longer than 72 bytes` |
| P14 | Medium | Seed data inserts categories with explicit IDs without advancing the sequences, so the first new category added collided with id 1. | Sequences re-synced (seed + migration). | `complaints: new categories can be added after seeding` |
| — | High | Two supervisors dispatching the same ticket at once could both assign it. | Dispatch procedures lock the ticket row and re-check its state. | `lifecycle: two simultaneous dispatches ... exactly one assignment` |
| — | Medium | Deactivating a technician would strand their open tasks. | Their live tasks are returned to `OPEN` for reassignment, audit-logged. | `admin: deactivating a technician releases their live tasks` |
| — | Medium | Ticket creation was never written to the audit trail, so new tickets showed an empty history. | Creation logged in the same transaction. | `complaints: records ticket creation in the audit trail` |
| — | Low | KPI view joined feedback directly; with several verification rounds per ticket it would double-count. | Ratings aggregated per ticket first. | `lifecycle: ...` (asserts KPI total equals actual count) |
| — | Low | `database/test_queries.sql` TEST 6 used a mistyped student ID and always failed. | ID corrected; whole file runs clean. | run manually: `psql -f database/test_queries.sql` |

## Fixed — security hardening (not tied to a single reproduced bug)

- **Login timing leak.** An unknown ID answered instantly but a real one took ~250 ms (bcrypt), revealing which IDs exist. Unknown IDs now cost the same.
- **JWT algorithm pinned** to HS256 (rejects `alg: none` and similar). Covered by `auth: rejects tokens signed with alg "none"`.
- **Registration is student-only**; privileged accounts come only from `POST /api/admin/users`. Separate rate limits: failed logins (20 / 15 min) and registrations (10 / hour, counting successes).
- **Reverse-proxy awareness** (`TRUST_PROXY`). Without it, all users behind nginx/a load balancer share one rate-limit bucket.
- **`proxy-addr` critical advisory** (IP spoofing via IPv4-mapped IPv6, directly relevant to the trust-proxy setting) patched; `react-router` advisories fixed by moving to v7.
- **Startup refuses unsafe production config:** example or short `JWT_SECRET`, missing `CORS_ORIGIN`.
- **Database connections:** pool size, connect timeout and a 15 s statement timeout (a runaway query no longer pins a connection forever); TLS certificates now verified by default.
- **Frontend shared-machine leak:** sign-in/sign-out now clears the query cache and all stored session data. Before, the next user on a hostel common-room PC briefly saw the previous user's tickets, and inherited a room cached under a key shared by every account.
- **Frontend 401 vs 403:** only a real authentication failure signs the user out. Covered by `client.test.ts`.
- **nginx:** strict CSP (`script-src 'self'`), no-cache `index.html`, immutable hashed assets, `X-Frame-Options: DENY`, `nosniff`.

## Fixed — operability

- **Migrations** (`npm run db:migrate`) replace running `init_all.sql`, which drops every table. They are transactional and checksummed (an edited applied migration is refused) and lock-protected (replicas can start together). They are proven to upgrade a database built by the *original* repo with its data intact (`migrations: upgrades a database built by the ORIGINAL init_all.sql`).
- **Single source of truth for SQL:** `schema.sql`, `triggers_procedures.sql` and `init_all.sql` are generated from the migrations; CI fails if they drift.
- **Seed** is refused in production and runs only once (it isn't idempotent).
- **Graceful shutdown** on SIGTERM (in-flight requests finish, pool closes); unhandled rejections restart the process cleanly.
- **Health checks:** `/api/health/live` (process) and `/api/health` (database reachable).
- **Request logging** with request IDs, JSON in production.
- **Admin & self-service screens:** user accounts, room allotments, password change, staff on/off duty (auto-dispatch depends on it, and previously nothing could change it).
- **Frontend:** route-level code splitting, error boundaries, expired tokens dropped on load.

## Not done — accepted risks and decisions for the team

These were deliberately left out. Each is either a product decision, out of scope for code changes, or something that needs infrastructure this repo doesn't control.

1. **The JWT is stored in `localStorage`.** Any XSS could read it. Mitigated by the strict CSP and by React escaping. The stronger fix, httpOnly cookies plus CSRF protection, changes the auth contract on both sides; recommended before handling sensitive data.
2. **Supervisors are not scoped to a block.** Any supervisor sees and dispatches every block. The schema has no supervisor↔block relationship, so this needs a product decision on how wardens map to blocks.
3. **Rate limits are per-process.** Correct for one API instance. Running several replicas needs a shared store (e.g. Redis) or the limits multiply.
4. **No notifications.** Nobody is told when a ticket is assigned or awaits verification; users must open the app. Needs an email/SMS/push provider.
5. **Forgotten passwords** can only be reset by an admin; there is no self-service email reset.
6. **Photo evidence is a URL field**, not an upload. Real uploads need object storage.
7. **SLA tracking is not implemented** even though the README describes it: `default_sla_hours` is stored but nothing measures or reports breaches.
8. **No deployed environment.** README §7.2–7.3 describe Render/Vercel/managed-DB deployments that don't exist. The containers here are deployable; choosing and provisioning a host is a team task.
9. **No browser end-to-end tests.** The UI is covered by type-checking, unit tests and API-level tests of every flow it uses, but no automated click-through (e.g. Playwright).
10. **README still claims Prisma ORM** (§3.6, tech stack). The code uses `pg` with parameterized SQL. This is a rubric document, so I didn't rewrite those claims; the team should decide how to reconcile them.
11. **Backups:** `backup_restore.sh/.ps1` work but nothing schedules them. Use the managed database's automated backups, or schedule the script.
12. **Dev-only dependency advisories** remain: `braces` (via nodemon/Tailwind's file watchers; no fixed release exists) and `postcss-selector-parser` (Tailwind 3; fixed only in Tailwind 4). Neither is in a production image or shipped to browsers. CI audits production dependencies only, at high severity.

## Running it

**Local development**

```bash
cp .env.example .env              # points at a local PostgreSQL
npm ci
npm run db:migrate                # create/upgrade the schema
npm run db:seed                   # optional demo data (password: Password@123)
npm run dev                       # API on :5000

cd client && npm ci && npm run dev   # web on :3000, /api proxied to :5000
```

`npm run db:reset -- --yes` rebuilds a development database from scratch.

**Tests**

```bash
npm test                 # API + database; uses TEST_DATABASE_URL (default: local fix_master_test)
cd client && npm test    # frontend unit tests
```

**Production (containers)**

```bash
cp .env.example .env     # set JWT_SECRET (>= 32 random chars) and POSTGRES_PASSWORD
docker compose up -d --build                  # http://localhost:8080
docker compose --profile demo run --rm seed   # optional demo data - never on a real deployment
```

The API container applies pending migrations on start. Production checklist: a real `JWT_SECRET`, `CORS_ORIGIN` set, `TRUST_PROXY` matching the number of proxies, TLS terminated in front of nginx, and database backups enabled.
