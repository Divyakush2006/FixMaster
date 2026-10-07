const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const { TEST_DB_URL, resetDatabase } = require('./helpers');
const { migrate } = require('../scripts/migrate');

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
            assert.equal(applied.length, 3);

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
});
