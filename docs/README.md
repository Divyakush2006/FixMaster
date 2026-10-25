# FIX_MASTER — Documentation Directory & Master Index

Welcome to the **FIX_MASTER** documentation hub. This directory contains the complete architectural, database, engineering, testing, and academic specifications for the system.

---

## 📚 Documentation Catalog

### 1. Academic & Evaluation (BCSE307L)
- 🎓 **[ACADEMIC_REPORT.md](ACADEMIC_REPORT.md)**: Formal BCSE307L course report mapping the project directly to the 30-mark evaluation rubric + 3 bonus marks.
- 🤖 **[course_report_ai_section.md](course_report_ai_section.md)**: Academic analysis of 3NF schema preservation, ACID transactions, and concurrency control under automated AI dispatch.

### 2. Architecture & Implementation
- 🛠️ **[IMPLEMENTATION_GUIDE.md](IMPLEMENTATION_GUIDE.md)**: Full-stack system architecture, module layout, setup instructions, API catalog, and deployment guide.
- 🚀 **[BACKEND_HANDOVER_REPORT.md](BACKEND_HANDOVER_REPORT.md)**: Backend engineering handover guide, stored procedures, analytical views, and API integration rules.
- 👥 **[user_types.md](user_types.md)**: Single `users` table RBAC specification, role profiles (Student, Staff, Supervisor, Admin), and permissions matrix.
- 📋 **[complaint_types.md](complaint_types.md)**: 2-tier complaint taxonomy (6 categories, 25 subcategories), SLA windows, priorities, and lifecycle state machine.

### 3. Database Engineering
- 💾 **[database_implementation.md](database_implementation.md)**: Comprehensive database implementation specification: DDL, indexes, analytical views, triggers, stored procedures, and complex queries.
- 📊 **[er_diagrams.md](er_diagrams.md)**: Conceptual Crow's Foot ER diagrams, modular sub-system models, referential integrity action matrix, and formal normalization proofs (1NF to BCNF).

### 4. Quality Assurance, Security & Production Hardening
- ✅ **[PRODUCTION_READINESS.md](PRODUCTION_READINESS.md)**: In-depth production audit report detailing reproduced bugs (P1–P14), security hardening, multi-portal sign-in, and verification test matrices.
- 🐞 **[BUGFIXES.md](BUGFIXES.md)**: Historical fix log from the initial backend hardening pass covering 13 critical vulnerabilities and transactional integrity fixes.

### 5. AI Triage & Live Demonstration
- 🧪 **[ai-test-report.md](ai-test-report.md)**: Verification report for the AI triage and auto-allocation engine (21/21 automated tests passed, 100% pass rate).
- 🔍 **[ai-discovery.md](ai-discovery.md)**: Phase 0 discovery, codebase entity mapping, and architectural assumptions.
- 🎬 **[demo-script.md](demo-script.md)**: Step-by-step live demonstration script showcasing AI triage, emergency safety floor rules, prompt injection resistance, and heuristic failover.

---

## ⚡ Quick Reference

### Core Test Credentials (Password: `Password@123`)
| Portal | Login Identifier | User | Role / Assignment |
|---|---|---|---|
| **Student** | `21BCE0843` | Vihaan Sharma | Student Resident (Room `L-843`) |
| **Staff** | `EMP_ELEC_01` | Suresh Kumar | Maintenance Staff (Electrician) |
| **Supervisor** | `SUP_LBLOCK_01` | Mr. R. Sundaram | Block Facility Supervisor |
| **Admin** | `ADMIN_ESTATES_01`| Chief Warden | Estates & Infrastructure Lead |

### Essential Developer Commands
```bash
# Apply database migrations
npm run db:migrate

# Seed development dataset
npm run db:seed

# Run backend integration tests
npm test

# Run frontend tests
cd client && npm test

# Run AI integration suite
node scripts/test-ai-integration-all-cases.js
```
