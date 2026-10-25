# FIX_MASTER — Technical Implementation & Engineering Guide

This guide details the technical implementation, architecture, and operational runbooks for the FixMaster hostel facility maintenance system.

---

## 1. System Architecture & Component Layout

```mermaid
graph TD
    Client["React 18 + Vite Web App<br>(Port 3000 / 8080)"]
    Nginx["Nginx Reverse Proxy & Static Host"]
    API["Express 5.2.1 REST API<br>(Port 5000)"]
    Postgres[("PostgreSQL 15/16<br>(Port 5432)")]
    AI["Google Gemini 2.5 Flash<br>+ Heuristic Fallback Engine"]

    Client -->|HTTP / REST| Nginx
    Nginx -->|Reverse Proxy /api| API
    API -->|node-postgres parameterized SQL| Postgres
    API -->|AI Triage & Classification| AI
```

### Module Directory Organization
```text
FIX_MASTER/
├── src/                          # Express REST API Backend
│   ├── config/db.js              # pg.Pool and withTransaction helper
│   ├── controllers/              # Business logic (complaints, dispatch, auth, admin, ai)
│   ├── middleware/               # Auth, RBAC, rate-limiting, error handling
│   ├── routes/                   # Mounted API endpoints
│   ├── services/                 # AI service, heuristic fallback, audit service
│   ├── app.js                    # Express application configuration
│   └── server.js                 # HTTP listener & lifecycle management
├── client/                       # React Frontend Application
│   ├── src/features/             # Role-based portals (student, staff, supervisor, admin)
│   ├── src/components/           # Reusable UI components & layouts
│   └── src/api/                  # Fetch client and endpoint declarations
├── database/                     # Database Engine Artifacts
│   ├── migrations/               # 001 to 009 versioned SQL migrations
│   ├── backup_restore.sh/.ps1    # Database backup and restore scripts
│   ├── schema.sql                # Complete consolidated DDL
│   ├── triggers_procedures.sql   # Procedures, triggers, and views
│   └── seed_data.sql             # Realistic demo dataset
├── scripts/                      # Developer automation scripts
│   ├── migrate.js                # Migration runner with checksum verification
│   ├── seed.js                   # Seed runner
│   └── reset-dev-db.js           # Rebuild local dev database
└── docker-compose.yml            # Multi-container orchestration
```

---

## 2. Environment Setup & Configuration

### Prerequisites
- Node.js (v20+ recommended)
- PostgreSQL (v15/v16) or Docker
- Git

### Environment Variables (`.env`)
```env
PORT=5000
NODE_ENV=development

# PostgreSQL Connection
DATABASE_URL="postgresql://postgres:password@localhost:5432/fix_master_db"

# JWT Authentication
JWT_SECRET="<generate: node -e \"console.log(require('crypto').randomBytes(48).toString('hex'))\">"
JWT_EXPIRES_IN="24h"

# Optional AI Key (free tier / standard)
GEMINI_API_KEY=""

# Optional Production Overrides
CORS_ORIGIN="http://localhost:3000,http://localhost:8080"
TRUST_PROXY="1"
```

---

## 3. Database Lifecycle & Migrations

### 3.1 Migration Management
Migrations are located in `database/migrations/` and managed via `scripts/migrate.js`:
```bash
# Run pending migrations
npm run db:migrate

# Seed development dataset
npm run db:seed

# Reset and rebuild local dev database (caution: destructive)
npm run db:reset -- --yes

# Rebuild consolidated SQL bundles from migrations
npm run db:bundle
```

### 3.2 Backup & Recovery Runbooks
```bash
# Linux / macOS
./database/backup_restore.sh backup
./database/backup_restore.sh restore ./database/backups/fix_master_20261025.dump

# Windows PowerShell
.\database\backup_restore.ps1 backup
.\database\backup_restore.ps1 restore .\database\backups\fix_master_20261025.dump
```

---

## 4. Multi-Portal Authentication & Security Flow

```mermaid
sequenceDiagram
    participant User as Client Browser
    participant Auth as Auth Controller
    participant DB as PostgreSQL
    participant App as Protected Routes

    User->>Auth: POST /api/auth/{student|staff|admin}/login
    Auth->>DB: Query user by reg_or_emp_id
    Auth->>Auth: Verify password (bcrypt) & portal audience
    Auth->>User: Returns JWT (includes userId, role, portal, jti)
    User->>App: GET /api/complaints (Bearer Token)
    App->>DB: Check revoked_tokens & users.is_active
    App->>User: 200 OK Response
```

- **Portal Isolation**: Student, Staff, and Admin credentials are partitioned by endpoint.
- **Lockout Policy**: 10 failed login attempts trigger a 15-minute lockout (`Retry-After` header sent).
- **Server-Side Logout**: `POST /api/auth/logout` records token `jti` in `revoked_tokens`.

---

## 5. Core API Endpoints

| Resource | Method & Path | Description | Access |
|---|---|---|---|
| **Auth** | `POST /api/auth/student/login` | Student portal sign-in | Public |
| **Auth** | `POST /api/auth/staff/login` | Staff / Supervisor sign-in | Public |
| **Auth** | `POST /api/auth/admin/login` | Admin portal sign-in | Public |
| **Auth** | `POST /api/auth/logout` | Server-side token revocation | Authenticated |
| **Complaints** | `POST /api/complaints` | Create room or common-area ticket | `STUDENT`, `SUPERVISOR`, `ADMIN` |
| **Complaints** | `GET /api/complaints` | List complaints (filtered, paged) | Authenticated |
| **Complaints** | `GET /api/complaints/:id` | Full complaint details & history | Authenticated |
| **Complaints** | `POST /api/complaints/:id/confirm` | Confirm resolution or reject work | Ticket Raiser |
| **Dispatch** | `GET /api/dispatch/tasks` | Active floor-ordered task queue | `STAFF` |
| **Dispatch** | `PATCH /api/dispatch/tasks/:id` | Status transition (`IN_PROGRESS`, `DONE`) | Assigned Staff |
| **Dispatch** | `POST /api/dispatch/reassign` | Supervisor manual task assignment | `SUPERVISOR`, `ADMIN` |
| **AI** | `POST /api/ai/triage` | Natural language classification & triage | Authenticated |
| **AI** | `GET /api/ai/health` | Subsystem status (`HEALTHY`/`DOWN`) | Authenticated |
| **Admin** | `POST /api/admin/allotments` | Assign student to room with capacity check | `ADMIN` |
| **Admin** | `GET /api/admin/audit-log` | Review administrative actions | `ADMIN` |

---

## 6. AI Triage & Graceful Fallback Architecture

1. **Intake**: Natural language description submitted via `POST /api/ai/triage`.
2. **Analysis**: Gemini models evaluate category, subcategory, urgency, and safety warnings.
3. **Safety-Net Floor**: Rule-based heuristic scanner checks for life-safety terms (*sparks*, *fire*, *burst*, *smoke*) and enforces a non-downgradable `EMERGENCY` priority.
4. **Quota / Network Failover**: On any API timeout or quota exhaustion (HTTP 429), the heuristic engine immediately takes over (<50ms) to ensure zero workflow interruptions.
5. **Supervisor Telemetry**: Subsystem health status transitions to `DOWN` and displays a notification banner on supervisor dashboards.

---

## 7. Testing & Verification Suites

```bash
# Run backend API and database integration tests
npm test

# Run frontend unit tests (Vitest)
cd client && npm test

# Run comprehensive AI test suite (21 scenarios)
node scripts/test-ai-integration-all-cases.js
```

---

## 8. Docker Deployment Reference

```bash
# 1. Build and run production stack
docker compose up -d --build

# 2. View running service logs
docker compose logs -f api

# 3. Access web application
# Open browser at http://localhost:8080
```

---

## 9. Demo Credentials Reference (Default Password: `Password@123`)

| Role | Username / ID | Name | Assigned Scope |
|---|---|---|---|
| **Student** | `21BCE0843` | Vihaan Sharma | Room `L-843` |
| **Student** | `21BCE1042` | Rahul Varma | Room `L-810` |
| **Staff (Housekeeping)** | `EMP_CLN_01` | Murugan K | Housekeeping Trade |
| **Staff (Electrician)** | `EMP_ELEC_01` | Suresh Kumar | Electrical Trade |
| **Staff (Carpenter)** | `EMP_CARP_01` | Govindraj M | Carpentry Trade |
| **Staff (AC Tech)** | `EMP_AC_01` | Dhanush V | AC & HVAC Trade |
| **Staff (Plumber)** | `EMP_PLB_01` | Karthik N | Plumbing Trade |
| **Supervisor** | `SUP_LBLOCK_01` | Mr. R. Sundaram | L-Block Facility Supervisor |
| **Admin** | `ADMIN_ESTATES_01`| Chief Warden | Estates & Infrastructure Lead |
