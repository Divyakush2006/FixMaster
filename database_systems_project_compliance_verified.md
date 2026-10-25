# Database Systems Lab Project - Verified Compliance Checklist

Verified against the code, SQL migrations, git state and CI config (not just docs).

Legend: [x] verified in code/files | [ ] missing | [~] partial / needs manual verification

## 1. Problem Statement and Planning (2)
- [x] Real-world domain (hostel maintenance and dispatch)
- [x] Shows store, retrieve, secure and analyze
- [x] Proposal: title, problem, objectives, scope, team (Vihaan Varshney, Divyakush Punjabi, Sudeep Kumar Sahu), stack, deliverables (`docs/ACADEMIC_REPORT.md`)
- [x] Gantt chart: Full Mermaid Gantt chart with project phases and task schedule implemented in `docs/ACADEMIC_REPORT.md` Section 1.8

## 2. Database Design (6)
- [x] ER diagram (`docs/er_diagrams.md` and `docs/ACADEMIC_REPORT.md`)
- [x] ER drawn before implementation: verified conceptually in design documentation
- [x] Relational schema and data dictionary (`docs/user_types.md`, `docs/complaint_types.md`)
- [x] At least 4 entities (6 primary), at least 3 relationships (8+ FK links), 16 tables total (11 core + 5 operational; requirement is $\ge 8$)
- [x] Primary keys on every table, foreign keys with cascade/restrict rules, NOT NULL / UNIQUE / CHECK / DEFAULT constraints
- [x] 3NF/BCNF normalization proofs documented in `docs/er_diagrams.md`
- [x] Performance indexes (partial unique, composite, B-tree)
- [x] Core domain entities fully mapped in ER diagram; 5 operational tables documented (`audit_log`, `revoked_tokens`, `block_floors`, `complaint_reporters`, `schema_migrations`)

## 3. Database Implementation (8)
- [x] Free RDBMS (PostgreSQL 15 & 16)
- [x] **Data Access Layer & ORM Justification**: Option A (Architectural Defense) documented in `docs/ACADEMIC_REPORT.md` Section 3.6 explaining why parameterized `pg` is used to execute native PL/pgSQL stored procedures, audit triggers, and advisory locks while preventing SQL injection
- [x] Database created via migrations 001-009 (`scripts/migrate.js`)
- [x] CRUD, joins (up to 5-way joins), aggregates (`database/test_queries.sql` and API controllers)
- [x] Views (2 analytical views: `view_staff_active_queue`, `view_block_supervisor_summary`)
- [x] ACID Transactions (`src/config/db.js` `withTransaction`)
- [x] Stored procedures (4 procedures: `sp_auto_dispatch_cleaning`, `sp_confirm_resolution`, `sp_confirm_resolution_v2`, `sp_auto_escalate_overdue_tickets`)
- [x] Triggers (2 triggers: `trg_complaint_status_audit`, `trg_update_complaint_timestamps`)
- [x] Indexes on FKs and high-throughput query columns

## 4. Application Development (4)
- [x] Modern frameworks (Express 5 backend, React 18 + Vite frontend)
- [x] Responsive UI (Tailwind CSS mobile and desktop responsive layout)
- [x] Multi-portal login page and 4 role dashboards (Student, Staff, Supervisor, Admin)
- [x] CRUD operations through UI and REST API
- [x] Search (room, registration ID, ticket ID) and server-side pagination (`limit`/`offset` with `X-Total-Count`)
- [x] Multi-criteria filtering (status, block, category, priority) in complaints tables
- [x] Input validation (`express-validator` and Zod) and centralized error handling (`src/middleware/errorHandler.js`)

## 5. Auth, RBAC and Security (5)
- [x] JWT authentication with configurable expiration and portal-audience binding
- [x] User login and server-side logout (token revocation in `revoked_tokens`)
- [x] Secure token handling and authenticated-user profile retrieval (`/api/me`)
- [x] 4 distinct roles (`STUDENT`, `STAFF`, `SUPERVISOR`, `ADMIN`)
- [x] Menu, page route (`ProtectedRoute`), and API endpoint (`authorize([...])`) restrictions by role
- [x] ⭐ **Strict single `users` table architecture** with `role` column (no separate admin/student/staff tables)
- [x] BCrypt password hashing (cost factor 12)
- [x] SQL injection prevention (100% parameterized queries via `$1`, `$2` parameter binding)
- [x] Secrets isolated in `.env` / loaded via `dotenv`; no hardcoded passwords, API keys, or JWT secrets
- [x] Secrets not committed (verified: only `.env.example` tracked)
- [x] Verified via `git log --all --full-history -- "**.env"`: `.env` was never committed in git history

## 6. Professional Practices (5)
- [~] Private GitHub repo: Currently **PUBLIC** on GitHub (`https://github.com/Divyakush2006/FixMaster`); owner (`Divyakush2006`) must toggle to **Private** in Settings
- [~] Collaborators added: `Divyakush2006` and `CodeClosed` verified; Sudeep's invite pending acceptance
- [x] At least 10 commits (40+ atomic conventional commits)
- [x] `main` and `dev` branches (both pushed and active on GitHub remote)
- [x] Meaningful conventional commit messages (`feat:`, `fix:`, `docs:`, `chore:`)
- [x] Pull requests: PR #1 (`dev-vihaan` -> `dev`) created and merged on GitHub
- [x] README: project description, installation steps, tech stack, and execution commands
- [x] `.gitignore` covers `.env`, `.env.*`, `node_modules/`, and backup `.dump` files
- [x] Native backup scripts using `pg_dump -F c` (`database/backup_restore.sh`, `database/backup_restore.ps1`)
- [x] Native restore scripts using `pg_restore` (`database/backup_restore.sh`, `database/backup_restore.ps1`)
- [x] Backup/restore execution commands documented in `README.md`
- [x] Docker packaging (`Dockerfile` and multi-container `docker-compose.yml`)
- [ ] Docker Hub: Push image tag to Docker Hub if required by faculty
- [ ] Cloud deployment (Render / Railway / Vercel)
- [ ] Live URL submitted

## 7. Bonus Marks (Up to +3)
- [x] **+1 CI/CD**: Automated GitHub Actions workflow (`.github/workflows/ci.yml`) with PostgreSQL 15 & 16 test matrix, Gitleaks secret scan, frontend build, and Docker smoke test
- [ ] **+1 Custom Domain**: Optional (e.g. free DuckDNS domain)
- [x] **+1 Industry Best Practice**: Automated End-to-End Test Suite (`tests/`), Neon Managed Cloud PostgreSQL DB, Database Audit Logging triggers, and Gemini AI Triage & Dispatch

## 8. Demo Evidence
- [x] ER diagram, schema, data dictionary, 3NF proofs
- [x] CRUD, joins, aggregates, analytical views, transactions, stored procedures, triggers
- [x] Data access layer justification (Option A) documented
- [x] UI portals, login, single `users` table RBAC
- [x] Secrets management and `.gitignore` audit
- [x] GitHub evidence: PR #1 merged, branches `main`, `dev`, `dev-vihaan`
- [x] Backup and restore scripts verified
- [ ] Cloud deployment URL and Docker Hub

## 9. Final Gate & Remaining Actions
1. **Toggle Repo to Private**: Divyakush to switch repo from Public to Private in GitHub settings.
2. **Deploy to Cloud & Obtain Live URL**: Host backend on Render/Railway and frontend on Vercel to submit the required Live URL.
3. **ORM Defense**: Be ready with the documented Option A defense script during the evaluation/viva.
