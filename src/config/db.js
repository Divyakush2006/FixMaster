const { Pool } = require('pg');
require('dotenv').config({ quiet: true });
const { connectionConfig } = require('./dbConfig');

const int = (value, fallback) => {
    const n = parseInt(value, 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
};

const pool = new Pool({
    ...connectionConfig(),
    max: int(process.env.DB_POOL_MAX, 10),
    idleTimeoutMillis: int(process.env.DB_IDLE_TIMEOUT_MS, 30000),
    // Fail fast instead of queueing forever when the database is unreachable
    // or every pooled connection is busy.
    connectionTimeoutMillis: int(process.env.DB_CONNECT_TIMEOUT_MS, 5000),
    // A runaway query is cancelled server-side rather than pinning a
    // connection (and the request waiting on it) indefinitely.
    statement_timeout: int(process.env.DB_STATEMENT_TIMEOUT_MS, 15000),
    application_name: 'fix_master_api',
});

pool.on('error', (err) => {
    console.error('Unexpected error on idle PostgreSQL client', err);
});

/**
 * Runs `work(client)` inside a single dedicated connection wrapped in
 * BEGIN/COMMIT/ROLLBACK.
 *
 * `pool.query('BEGIN')` followed by more `pool.query(...)` calls does NOT
 * reuse one connection - the pool may hand out a different client per call,
 * which splits a "transaction" across backends under load. `pool.connect()`
 * pins one client for the whole callback.
 *
 * If `actingUserId` is given it is exposed to the transaction as the
 * session-local setting `app.current_user_id` (via parameterized
 * `set_config(..., true)`, i.e. SET LOCAL semantics). The audit trigger
 * fn_audit_complaint_status_change() reads it to attribute each status
 * change to the user who caused it.
 */
async function withTransaction(work, actingUserId = null) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        if (actingUserId) {
            await client.query('SELECT set_config($1, $2, true)', ['app.current_user_id', actingUserId]);
        }
        const result = await work(client);
        await client.query('COMMIT');
        return result;
    } catch (err) {
        try {
            await client.query('ROLLBACK');
        } catch (rollbackErr) {
            console.error('Rollback failed:', rollbackErr);
        }
        throw err;
    } finally {
        client.release();
    }
}

module.exports = {
    query: (text, params) => pool.query(text, params),
    withTransaction,
    pool,
};
