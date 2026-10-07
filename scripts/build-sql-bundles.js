#!/usr/bin/env node
/**
 * Regenerates the human-readable SQL bundles from the migrations, so there
 * is exactly one source of truth for the schema:
 *
 *   database/schema.sql              <- drops + migrations/001 + 004 + 005 (tables, floors, room rules, audit)
 *   database/triggers_procedures.sql <- migrations/003 + 006 (triggers, procedures, views)
 *   database/init_all.sql            <- drops + every migration in order + seed (dev reset)
 *
 *   npm run db:bundle           rewrite the files
 *   npm run db:bundle -- --check  exit 1 if any file is stale (used in CI)
 *
 * Edit the migrations, never these generated files.
 */
const fs = require('fs');
const path = require('path');

const DB_DIR = path.join(__dirname, '..', 'database');
const MIG_DIR = path.join(DB_DIR, 'migrations');
const read = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

const GENERATED = (sources) =>
    [
        '-- ============================================================================',
        '-- GENERATED FILE - DO NOT EDIT BY HAND.',
        `-- Built by scripts/build-sql-bundles.js from: ${sources}`,
        '-- Change the schema by adding a migration under database/migrations/.',
        '-- ============================================================================',
        '',
    ].join('\n');

const DEV_ONLY_DROPS = `-- DEVELOPMENT ONLY: everything below starts by DROPPING every table.
-- Never run this against a database whose data you want to keep; production
-- schemas are created and upgraded with \`npm run db:migrate\`.
DROP TABLE IF EXISTS schema_migrations CASCADE;
DROP TABLE IF EXISTS audit_log CASCADE;
DROP TABLE IF EXISTS revoked_tokens CASCADE;
DROP TABLE IF EXISTS complaint_logs CASCADE;
DROP TABLE IF EXISTS complaint_feedback CASCADE;
DROP TABLE IF EXISTS complaint_assignments CASCADE;
DROP TABLE IF EXISTS complaints CASCADE;
DROP TABLE IF EXISTS complaint_subcategories CASCADE;
DROP TABLE IF EXISTS complaint_categories CASCADE;
DROP TABLE IF EXISTS student_room_allotments CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS common_areas CASCADE;
DROP TABLE IF EXISTS rooms CASCADE;
DROP TABLE IF EXISTS block_floors CASCADE;
DROP TABLE IF EXISTS hostel_blocks CASCADE;
`;

function build() {
    const migrations = fs
        .readdirSync(MIG_DIR)
        .filter((f) => /^\d{3}_.+\.sql$/.test(f))
        .sort();
    const mig = (prefix) => {
        const file = migrations.find((f) => f.startsWith(`${prefix}_`));
        if (!file) throw new Error(`migration ${prefix}_*.sql not found`);
        return read(path.join(MIG_DIR, file));
    };
    const seed = read(path.join(DB_DIR, 'seed_data.sql'));

    return {
        'schema.sql': [GENERATED('migrations/001 + 004 + 005'), DEV_ONLY_DROPS, mig('001'), mig('004'), mig('005')].join('\n'),
        'triggers_procedures.sql': [GENERATED('migrations/003 + 006'), mig('003'), mig('006')].join('\n'),
        'init_all.sql': [
            GENERATED(`every migration in order + seed_data.sql`),
            DEV_ONLY_DROPS,
            ...migrations.map((f) => `-- >>>>> MIGRATION ${f} <<<<<\n${read(path.join(MIG_DIR, f))}`),
            '-- >>>>> SEED DATA (VIT L-BLOCK DEMO) <<<<<',
            seed,
        ].join('\n'),
    };
}

const check = process.argv.includes('--check');
let stale = 0;
for (const [file, content] of Object.entries(build())) {
    const target = path.join(DB_DIR, file);
    const current = fs.existsSync(target) ? read(target) : null;
    if (current === content) continue;
    if (check) {
        console.error(`stale: database/${file} (run npm run db:bundle)`);
        stale++;
    } else {
        fs.writeFileSync(target, content);
        console.log(`wrote database/${file}`);
    }
}
if (check && stale) process.exit(1);
if (check) console.log('SQL bundles are up to date.');
