const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { resetDatabase, TEST_DB_URL } = require('./helpers');

// The backup-restore drill (scripts/backup-drill.js): the demo database is
// dumped, restored into a scratch database and compared table by table.
// Skipped where pg_dump is not installed or older than the server.

describe('backup-restore drill', () => {
    let result;
    before(async () => {
        await resetDatabase();
        result = await require('../scripts/backup-drill').runDrill({ source: TEST_DB_URL, log: () => {} });
    });
    after(async () => {
        await require('../src/config/db').pool.end();
    });

    it('restores every table with the same rows and content', (t) => {
        if (result.skipped) return t.skip(result.reason);
        assert.equal(result.ok, true, JSON.stringify(result.differences || result.reason));
        assert.ok(result.rows.length >= 20, `${result.rows.length} tables`);
        assert.ok(result.rows.every((r) => r.rows === r.restored));
        assert.ok(result.rows.find((r) => r.table === 'users').rows > 20);
        assert.ok(result.rows.find((r) => r.table === 'users').checked, 'small tables are compared by content, not only by count');
    });

    it('leaves nothing behind', async (t) => {
        if (result.skipped) return t.skip(result.reason);
        const { Client } = require('pg');
        const admin = new URL(TEST_DB_URL);
        admin.pathname = '/postgres';
        const c = new Client({ connectionString: admin.toString() });
        await c.connect();
        try {
            const { rows } = await c.query(`SELECT 1 FROM pg_database WHERE datname LIKE '%\\_drill'`);
            assert.equal(rows.length, 0);
        } finally {
            await c.end();
        }
    });
});
