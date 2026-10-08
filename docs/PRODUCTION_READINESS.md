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

## Sign-in: three separate portals

| Portal | Where | Accepts | API |
|---|---|---|---|
| Student | `/login`, Student tab | `STUDENT` | `POST /api/auth/student/login` (+ `/student/register`) |
| Staff | `/login`, Staff tab | `STAFF` (technicians) and `SUPERVISOR` | `POST /api/auth/staff/login` |
| Admin | `/admin` | `ADMIN` | `POST /api/auth/admin/login` |

- Each endpoint only signs in its own accounts. Using the wrong tab between
  Student and Staff gets a "use the other tab" message, but only after the
  password has been verified. Admin accounts don't exist as far as `/login` is
  concerned, and student/staff accounts don't exist at `/admin`: both get the
  same "Invalid credentials" as a wrong password.
- A session token is bound to its portal (`portal` claim + JWT audience) and is
  only accepted while the account's role still belongs to that portal.
- Separate failed-login limits per portal; admin is stricter (10 / 15 min) and
  admin sessions last 8 h instead of 24 h.
- Only students can self-register. Staff, supervisor and admin accounts are
  created by an administrator. The old shared `/api/auth/login` and
  `/api/auth/register` endpoints are removed.
- Decision recorded: supervisors sign in on the Staff tab (they are hostel
  employees like technicians); the admin portal is for estates administrators only.

## Hostel infrastructure: blocks, floors, rooms

- Blocks **A to T** exist out of the box (migration 004), each with **Ground +
  floors 1-10**. The original demo blocks (L-Block's demo rooms, PRP, MH) are
  unchanged.
- Floors are rows in `block_floors`. An admin can add a floor (Admin -> Blocks & Rooms,
  "Add floor above") or remove an empty one; `hostel_blocks.total_floors`
  follows automatically. New blocks get their floors automatically.
- **Room numbering** is generated from the floor and enforced by the database:
  - room number = floor code + two-digit room `01`-`99`; floor code = `G` for
    the ground floor, otherwise the floor number;
  - `G01` = ground floor room 1, `428` = floor 4 room 28;
  - room id = `<block>-<room number>`, e.g. `A-428`, `C-G01`;
  - a number that doesn't match its floor (e.g. `428` on floor 3), a one-digit
    room (`G1`), room `00`, or a room on a floor that doesn't exist is rejected.
- **Floors 10 and above** can't fit the 3-character format with a one-character
  floor code, so their rooms are 4 characters: floor 10 room 7 = `1007`. If the
  hostel uses a different convention for the top floor, the rule lives in one
  CHECK constraint (`chk_room_number_format`) and one helper on each side.
- Admins add rooms per floor, singly or as a range (e.g. floor 4, rooms 1-20 ->
  `401`-`420`). Re-submitting a range skips the rooms that already exist. An
  occupied room can't be closed or have its capacity reduced below its
  occupancy; closed rooms are hidden from students.

## Production verification (round 3)

A black-box review of the running system: a security probe against the live
API (and again through the production nginx proxy), browser end-to-end suites
against both the dev server and the production container build, an automated
WCAG audit of every screen, and a load test.

### Loopholes found and fixed

| # | Finding (how it was confirmed) | Fix |
|---|---|---|
| R1 | **One mistyping student could lock the whole campus out.** Login throttling counted failures per IP; a hostel reaches the API through a few NAT addresses. Probe: 22 failures for one account, then a *different* user from the same IP got 429. | Login limits are keyed per account + IP, with only a coarse per-IP ceiling (`rateLimiters.js`). The general limiter counts signed-in users per user (verified token), anonymous traffic per IP. |
| R2 | **No protection against distributed password guessing.** Per-IP limits never trip when an attacker rotates addresses. | Per-account lockout in the database (migration 005): 10 consecutive failures from anywhere lock the account for 15 min (`Retry-After` sent). The lockout is audited, shown to admins (banner + "Locked" badge) and can be cleared with **Unlock** or a password reset. |
| R3 | **Weak passwords accepted** (`aaaaaaaa`, `12345678`, `password123`). | One policy everywhere a password is set: 8-72 bytes, at least one letter and one digit, not a well-known password, not containing the account ID. The UI checks the same rules before submitting. |
| R4 | **Priority abuse.** A student could file "trash clearance" as EMERGENCY and jump every technician's queue. The server also defaulted every ticket to MEDIUM instead of the issue's real priority. | Default priority comes from the issue type. Students may raise it by at most one level (a sparking socket can be an emergency; cleaning cannot); supervisors and admins may set anything. The form only offers allowed values. |
| R5 | **Tickets got stuck with an unavailable technician.** Once ASSIGNED / IN_PROGRESS nothing could move a ticket except deactivating the technician's whole account. | Supervisors can reassign ASSIGNED and IN_PROGRESS tickets (migration 006). The old assignment is closed, it leaves that technician's queue, and the history records "Reassigned from X to Y". The dispatch panel shows who currently has the ticket. |
| R6 | **Sign-out did not end the session.** Tokens are stateless, so a copied token kept working for up to 24 h after "Sign out". | Every token has a unique id; `POST /api/auth/logout` revokes it server-side (`revoked_tokens`, cleaned up after expiry). Tokens without an id are refused. |
| R7 | **A token issued in the same second as a password change survived it** (JWT `iat` is whole seconds; the check was `<`). Seen intermittently in the probe. | Revocation includes that second; the replacement token is stamped one second later. Covered by a deterministic test. |
| R8 | **Sign-in bursts froze the API.** `bcryptjs` hashes on the main thread: with 20 concurrent sign-ins, unrelated requests went from 76 ms to **3.3 s** p50. | Native `bcrypt` (libuv thread pool, prebuilt for glibc and musl). Same load: other requests **43 ms** p50 (457 req/s vs 5); sign-in throughput 3 → 17/s. Hashes are format-compatible, no password resets needed. |
| R9 | **No record of administrative actions.** | Append-only `audit_log` (migration 005): account create / deactivate / reactivate / unlock / password reset / duty changes, allotments (create, move, end), blocks, floors, rooms, admin sign-in/out and lockouts - each with actor, target, details, IP and request id, written in the same transaction as the change. Admin **Audit log** page with filters. |
| R10 | **Lists would not scale.** The ticket register, users and allotments pulled every row (capped at 500) and paged in the browser; the allotment form had a dropdown of every student. | Server-side search, filters and paging with `X-Total-Count` for tickets (incl. `TKT-xxxxxx` references), users (+ role/status counts) and allotments. Type-ahead student picker; room picker shows live occupancy. LIKE wildcards in search are escaped. |
| R11 | **Sessions on shared hostel PCs never timed out.** | Idle sign-out: 30 min for administrators, 60 supervisors, 2 h students, 4 h technicians, with a one-minute "Are you still there?" warning. Reloading the page does not count as activity. Signing out in one tab signs out every tab; a different account signing in elsewhere reloads the tab. |
| R12 | **Accessibility**: 131 WCAG AA colour-contrast failures (sidebar labels, light grey text), charts without text alternatives, a skipped heading level, a scroll region unreachable by keyboard, white-on-green buttons at 3.8:1. | Contrast-safe secondary text colour, darker success buttons, screen-reader summaries for charts, focusable scroll regions. axe-core (WCAG 2.1 A/AA + best practice): **21/21 screens and dialogs, zero violations**. |
| R13 | Unknown addresses silently redirected; the API error mapper hid any server message over 120 characters (e.g. the lockout explanation). | Proper 404 page; server messages up to 240 characters are shown. |
| R14 | Dev dependency advisories in the API (`nodemon` → `braces`). | `nodemon` replaced by Node's built-in `node --watch`; the API now has **0 vulnerabilities including dev dependencies**, and CI audits all of them. |

### Evidence

| Check | Result |
|---|---|
| API test suite (`npm test`, real PostgreSQL) | 87 tests, all pass - incl. 21 new regression tests in `tests/security.test.js` |
| Web unit tests (`client: npm test`) | 26 tests, all pass |
| Security probe (headers, input handling, JWT tampering/`alg=none`/forged signature, vertical + horizontal authorization, mass assignment, business rules, races, sessions, brute force) | 39 / 39 against the dev API **and** through the production nginx proxy |
| Browser end-to-end, production build behind nginx + CSP | Full ticket lifecycle (12 steps) and hardening suite (22 steps), no page or console errors |
| Accessibility (axe-core, WCAG 2.1 AA) | 21 / 21 screens, 0 violations |
| Load (50 concurrent connections) | 550-650 authenticated req/s, p99 ≈ 120 ms, 0 errors; sign-in bursts no longer degrade other traffic |
| Container stack | Migrations apply on start, production guard rejects weak secrets, CSP / HSTS / frame / nosniff headers present, assets immutable-cached and gzipped |
| CI | Now also starts the composed stack and smoke-tests it through nginx |

## Not done — accepted risks and decisions for the team

These were deliberately left out. Each is either a product decision, out of scope for code changes, or something that needs infrastructure this repo doesn't control.

1. **The JWT is stored in `localStorage`.** Any XSS could read it. Mitigated by the strict CSP and by React escaping. The stronger fix, httpOnly cookies plus CSRF protection, changes the auth contract on both sides; recommended before handling sensitive data.
2. **Supervisors are not scoped to a block.** Any supervisor sees and dispatches every block. The schema has no supervisor↔block relationship, so this needs a product decision on how wardens map to blocks.
3. **Rate limits are per-process.** Correct for one API instance. Running several replicas needs a shared store (e.g. Redis) or the limits multiply. (The per-account lockout lives in the database and already works across replicas.)
4. **No notifications.** Nobody is told when a ticket is assigned or awaits verification; users must open the app. Needs an email/SMS/push provider.
5. **Forgotten passwords** can only be reset by an admin; there is no self-service email reset.
6. **Photo evidence is a URL field**, not an upload. Real uploads need object storage.
7. **SLA tracking is not implemented**: `default_sla_hours` is stored but nothing measures or reports breaches. The academic report now states this as planned work.
8. **No deployed environment.** The containers here are deployable; choosing and provisioning a host is a team task. (The rubric mapping, now in `docs/ACADEMIC_REPORT.md` §7.2–7.3, says so instead of describing deployments that don't exist.)
9. **Browser end-to-end suites are not in CI yet.** They were run for this audit (Playwright against the dev server and the production containers) but live outside the repo; adding them to CI needs a browser in the pipeline.
10. **Resolved: documentation matches the code.** The README is now a product README; the rubric mapping moved to `docs/ACADEMIC_REPORT.md` with the Prisma, Next.js and cloud-deployment claims corrected to what is actually built.
11. **Backups:** `backup_restore.sh/.ps1` work but nothing schedules them. Use the managed database's automated backups, or schedule the script.
12. **Web dev-only dependency advisories** remain inside Tailwind 3's build tooling (`braces` via its file watcher, `postcss-selector-parser`; fixed only in Tailwind 4). They run only at build time on our own source files, are not in any image and are not shipped to browsers. The web job audits production dependencies; the API job audits everything.
13. **Session token in `localStorage`** (see 1) is now mitigated further by server-side revocation on sign-out and idle sign-out, but the cookie-based design remains the recommended next step.

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
