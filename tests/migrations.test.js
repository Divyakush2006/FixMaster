const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const { TEST_DB_URL, resetDatabase } = require('./helpers');
const { migrate, listMigrations } = require('../scripts/migrate');

const withDb = async (url, fn) => {
    const c = new Client({ connectionString: url });
    await c.connect();
    try {
        return await fn(c);
    } finally {
        await c.end();
    }
};

function siblingUrl(dbName) {
    const u = new URL(TEST_DB_URL);
    u.pathname = `/${dbName}`;
    return u.toString();
}

describe('database migrations', () => {
    before(async () => {
        await resetDatabase();
    });

    it('re-running migrations on an up-to-date database is a no-op', async () => {
        const applied = await migrate({ connectionString: TEST_DB_URL, log: () => {} });
        assert.deepEqual(applied, []);
    });

    it('refuses to run if an applied migration was edited afterwards', async () => {
        await withDb(TEST_DB_URL, (c) => c.query("UPDATE schema_migrations SET checksum = 'tampered' WHERE version = '001_schema'"));
        try {
            await assert.rejects(migrate({ connectionString: TEST_DB_URL, log: () => {} }), /edited after being applied/);
        } finally {
            await resetDatabase();
        }
    });

    it('upgrades a database built by the ORIGINAL init_all.sql, keeping its data', async () => {
        const legacyName = 'fix_master_test_legacy';
        const legacyUrl = siblingUrl(legacyName);
        const admin = siblingUrl('postgres');
        await withDb(admin, async (c) => {
            await c.query(`DROP DATABASE IF EXISTS ${legacyName}`);
            await c.query(`CREATE DATABASE ${legacyName}`);
        });
        try {
            const legacySql = fs.readFileSync(path.join(__dirname, 'fixtures', 'legacy_init_all.sql'), 'utf8');
            await withDb(legacyUrl, (c) => c.query(legacySql));

            const applied = await migrate({ connectionString: legacyUrl, log: () => {} });
            assert.equal(applied.length, listMigrations().length);

            await withDb(legacyUrl, async (c) => {
                const counts = await c.query('SELECT (SELECT COUNT(*) FROM users)::int AS users, (SELECT COUNT(*) FROM complaints)::int AS complaints');
                assert.deepEqual(counts.rows[0], { users: 12, complaints: 5 }, 'existing data survives the upgrade');

                const constraints = await c.query(
                    "SELECT conname FROM pg_constraint WHERE conname IN ('uq_student_active_allotment', 'complaint_feedback_complaint_id_key', 'chk_staff_specialization')"
                );
                assert.deepEqual(constraints.rows.map((r) => r.conname), ['chk_staff_specialization']);

                const procs = await c.query("SELECT pg_get_function_identity_arguments(oid) AS args FROM pg_proc WHERE proname = 'sp_auto_dispatch_cleaning'");
                assert.equal(procs.rows.length, 1, 'the old 1-argument procedure is gone');

                const col = await c.query("SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'is_active'");
                assert.equal(col.rows.length, 1);

                // Blocks A-T added alongside the original three; original rows untouched. Migration 016 then
                // makes two hostels: S goes (nothing was ever built in it) and the ladies' A-H, J and S arrive.
                const blocks = await c.query('SELECT COUNT(*)::int AS n FROM hostel_blocks');
                assert.equal(blocks.rows[0].n, 22 - 1 + 10, 'A-T without S, PRP and MH, and ten ladies blocks');
                const kinds = await c.query("SELECT block_id, block_kind, hostel_type FROM hostel_blocks WHERE block_id IN ('PRP_BLOCK', 'MH_BLOCK', 'S_BLOCK', 'LS_BLOCK', 'LA_BLOCK') ORDER BY block_id");
                assert.deepEqual(
                    kinds.rows.map((r) => [r.block_id, r.block_kind, r.hostel_type]),
                    [['LA_BLOCK', 'RESIDENTIAL', 'LADIES'], ['LS_BLOCK', 'RESIDENTIAL', 'LADIES'], ['MH_BLOCK', 'HOSTEL_WIDE', 'MENS'], ['PRP_BLOCK', 'ACADEMIC', null]]
                );
                const l = await c.query("SELECT block_name, total_floors, hostel_type FROM hostel_blocks WHERE block_id = 'L_BLOCK'");
                assert.deepEqual(l.rows[0], { block_name: 'L-Block', total_floors: 10, hostel_type: 'MENS' });
                const floors = await c.query("SELECT COUNT(*)::int AS n FROM block_floors WHERE block_id = 'L_BLOCK'");
                assert.equal(floors.rows[0].n, 11, 'Ground + 1..10 backfilled for an existing block');

                // The original location loophole is closed on the upgraded database too.
                await assert.rejects(
                    c.query(
                        `INSERT INTO complaints (ticket_scope, room_id, common_area_id, block_id, raised_by_user_id, subcategory_id)
                         VALUES ('COMMON_AREA', 'L-843', 'L-F08-COOLER-01', 'L_BLOCK', 'u009-stud-0843-uuid-000000000009', 21)`
                    ),
                    /chk_complaint_location/
                );
            });

            assert.deepEqual(await migrate({ connectionString: legacyUrl, log: () => {} }), [], 'second run is a no-op');
        } finally {
            await withDb(admin, (c) => c.query(`DROP DATABASE IF EXISTS ${legacyName} WITH (FORCE)`));
        }
    });

    it('007 merges live duplicates that already exist before enforcing one live ticket per location and issue', async () => {
        const name = 'fix_master_test_dupes';
        const url = siblingUrl(name);
        const admin = siblingUrl('postgres');
        await withDb(admin, async (c) => {
            await c.query(`DROP DATABASE IF EXISTS ${name}`);
            await c.query(`CREATE DATABASE ${name}`);
        });
        try {
            // A database at version 006 - before the rule existed - with the
            // demo data and two roommates' duplicate requests on top.
            const before007 = listMigrations().filter((m) => m.version < '007');
            await withDb(url, async (c) => {
                await c.query(`CREATE TABLE schema_migrations (
                    version TEXT PRIMARY KEY, checksum TEXT NOT NULL,
                    applied_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
                for (const m of before007) {
                    await c.query(m.sql);
                    await c.query('INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)', [m.version, m.checksum]);
                }
                // The seed is written for the current schema; at version 006 blocks have no hostel or kind yet.
                const seed = fs
                    .readFileSync(path.join(__dirname, '..', 'database', 'seed_data.sql'), 'utf8')
                    .replace(
                        /INSERT INTO hostel_blocks \(block_id, block_name, total_floors, hostel_type, block_kind\) VALUES[\s\S]*?ON CONFLICT \(block_id\) DO NOTHING;/,
                        "INSERT INTO hostel_blocks (block_id, block_name, total_floors) VALUES ('L_BLOCK', 'L-Block', 10), ('PRP_BLOCK', 'PRP', 8), ('MH_BLOCK', 'MH', 2) ON CONFLICT (block_id) DO NOTHING;"
                    );
                await c.query(seed);
                // Seed has L-843 room cleaning IN_PROGRESS (Vihaan). Two more
                // live requests for the same thing from his roommates:
                await c.query(`
                    INSERT INTO complaints (complaint_id, ticket_scope, room_id, block_id, raised_by_user_id, subcategory_id, status, created_at)
                    VALUES ('dup-0001', 'ROOM', 'L-843', 'L_BLOCK', 'u024-stud-0843-uuid-000000000024', 1, 'OPEN', CURRENT_TIMESTAMP - INTERVAL '3 hours'),
                           ('dup-0002', 'ROOM', 'L-843', 'L_BLOCK', 'u025-stud-0843-uuid-000000000025', 1, 'ASSIGNED', CURRENT_TIMESTAMP)`);
                await c.query(`INSERT INTO complaint_assignments (complaint_id, staff_user_id, current_state)
                               VALUES ('dup-0002', 'u004-staf-clean-uuid-000000000004', 'ASSIGNED')`);
            });

            const applied = await migrate({ connectionString: url, log: () => {} });
            assert.ok(applied.includes('007_room_centric_tickets'));

            await withDb(url, async (c) => {
                // The ticket furthest along (in progress) survives, even though
                // a duplicate is older.
                const live = await c.query(
                    `SELECT complaint_id FROM complaints WHERE room_id = 'L-843' AND subcategory_id = 1
                     AND status IN ('OPEN','ASSIGNED','IN_PROGRESS','PENDING_VERIFICATION','ESCALATED')`
                );
                assert.deepEqual(live.rows.map((r) => r.complaint_id), ['cmp-843-0001-uuid-000000000001']);

                const merged = await c.query(
                    "SELECT complaint_id, status, closure_reason, merged_into_id, closed_at FROM complaints WHERE complaint_id LIKE 'dup-%' ORDER BY 1"
                );
                for (const row of merged.rows) {
                    assert.equal(row.status, 'REJECTED');
                    assert.equal(row.closure_reason, 'DUPLICATE');
                    assert.equal(row.merged_into_id, 'cmp-843-0001-uuid-000000000001');
                    assert.ok(row.closed_at);
                }
                const reporters = await c.query(
                    "SELECT COUNT(*)::int AS n FROM complaint_reporters WHERE complaint_id = 'cmp-843-0001-uuid-000000000001'"
                );
                assert.equal(reporters.rows[0].n, 3, 'all three roommates are reporters of the surviving ticket');
                const declined = await c.query("SELECT current_state FROM complaint_assignments WHERE complaint_id = 'dup-0002'");
                assert.equal(declined.rows[0].current_state, 'DECLINED', "the duplicate's cleaner is released");
                // Nothing was deleted.
                assert.equal((await c.query("SELECT COUNT(*)::int AS n FROM complaints WHERE complaint_id LIKE 'dup-%'")).rows[0].n, 2);
            });
        } finally {
            await withDb(admin, (c) => c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
        }
    });
});
