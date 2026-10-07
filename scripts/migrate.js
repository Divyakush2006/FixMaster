#!/usr/bin/env node
/**
 * Applies database/migrations/*.sql in filename order, each exactly once,
 * recording what ran in the schema_migrations table.
 *
 *   npm run db:migrate
 *
 * This is the ONLY supported way to create or change a production schema.
 * (database/init_all.sql drops every table first and is for throwaway
 * development databases only.)
 *
 * Guarantees:
 *  - each migration runs inside its own transaction, together with the row
 *    that records it, so a failure leaves nothing half-applied;
 *  - a session advisory lock stops two processes (e.g. two API replicas
 *    starting at once) from migrating concurrently;
 *  - editing a migration after it has been applied is refused: its checksum
 *    no longer matches, and silently running a different schema in
 *    different environments is worse than a failed deploy.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Client } = require('pg');
require('dotenv').config({ quiet: true });
const { connectionConfig } = require('../src/config/dbConfig');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'database', 'migrations');
const LOCK_KEY = 7253101; // arbitrary, app-specific advisory lock id

function listMigrations() {
    return fs
        .readdirSync(MIGRATIONS_DIR)
        .filter((f) => /^\d{3}_.+\.sql$/.test(f))
        .sort()
        .map((file) => {
            const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
            // Normalize line endings so a CRLF checkout on Windows and an LF
            // checkout in CI/Docker produce the same checksum.
            const checksum = crypto.createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex');
            return { version: file.replace(/\.sql$/, ''), sql, checksum };
        });
}

async function migrate({ connectionString, log = console.log } = {}) {
    const client = new Client(connectionConfig(connectionString));
    await client.connect();
    const applied = [];
    try {
        await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
        await client.query(`
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version TEXT PRIMARY KEY,
                checksum TEXT NOT NULL,
                applied_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        `);
        const { rows } = await client.query('SELECT version, checksum FROM schema_migrations');
        const done = new Map(rows.map((r) => [r.version, r.checksum]));

        for (const m of listMigrations()) {
            if (done.has(m.version)) {
                if (done.get(m.version) !== m.checksum) {
                    throw new Error(
                        `Migration ${m.version} was edited after being applied (checksum mismatch). ` +
                            'Revert the edit and put the change in a new migration file instead.'
                    );
                }
                continue;
            }
            log(`applying ${m.version} ...`);
            try {
                await client.query('BEGIN');
                await client.query(m.sql);
                await client.query('INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)', [
                    m.version,
                    m.checksum,
                ]);
                await client.query('COMMIT');
            } catch (err) {
                await client.query('ROLLBACK').catch(() => {});
                err.message = `Migration ${m.version} failed: ${err.message}`;
                throw err;
            }
            applied.push(m.version);
        }
        log(applied.length ? `applied ${applied.length} migration(s).` : 'database schema is up to date.');
        return applied;
    } finally {
        await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => {});
        await client.end();
    }
}

module.exports = { migrate, listMigrations };

if (require.main === module) {
    migrate().catch((err) => {
        console.error(err.message);
        process.exit(1);
    });
}
