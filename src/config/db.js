const { Pool } = require('pg');
require('dotenv').config({ quiet: true });
const { connectionConfig } = require('./dbConfig');

const int = (value, fallback) => {
    const n = parseInt(value, 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
};

const baseConfig = connectionConfig();
const statementTimeout = int(process.env.DB_STATEMENT_TIMEOUT_MS, 15000);

// A PgBouncer pooler (Neon's "-pooler" host) rejects per-connection startup
// parameters such as statement_timeout: libpq sends it in the startup packet
// and the pooler answers "unsupported startup parameter". Passing it there
// would make the very first query fail. On a pooled host we therefore leave it
// out of the startup packet and set it per checked-out connection instead (see
// the 'connect' handler below); on a direct/local connection we keep sending it
// in the startup packet, which is reliable per-session.
const isPooler = /-pooler\./.test(baseConfig.connectionString || '');

const pool = new Pool({
    ...baseConfig,
    max: int(process.env.DB_POOL_MAX, 10),
    idleTimeoutMillis: int(process.env.DB_IDLE_TIMEOUT_MS, 30000),
    // Fail fast instead of queueing forever when the database is unreachable
    // or every pooled connection is busy.
    connectionTimeoutMillis: int(process.env.DB_CONNECT_TIMEOUT_MS, 5000),
    // A runaway query is cancelled server-side rather than pinning a
    // connection (and the request waiting on it) indefinitely.
    ...(isPooler ? {} : { statement_timeout: statementTimeout }),
    application_name: 'fix_master_api',
});

if (isPooler && statementTimeout > 0) {
    // SET (not SET LOCAL) applies for the lifetime of this physical backend,
    // so each connection the pool opens carries the cap. This complements the
    // server-side default set on the Neon database/role.
    pool.on('connect', (client) => {
        client.query(`SET statement_timeout = ${statementTimeout}`).catch(() => {});
    });
}

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
// SQLSTATEs that mean "a concurrent transaction won; nothing was changed" -
// safe to retry the whole unit of work from the start.
const RETRYABLE = new Set(['40P01', '40001']); // deadlock_detected, serialization_failure
const MAX_ATTEMPTS = 3;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * withTransaction, retried on deadlock / serialization failure.
 *
 * Lock ordering (ticket row first, then its assignments) keeps deadlocks out
 * of normal operation; this is the safety net for orderings nobody foresaw.
 * `work` must therefore be safe to run again - it is, as long as everything
 * it does goes through `client` (it all rolled back) and it does not send
 * responses or call external services.
 */
async function withTransaction(work, actingUserId = null) {
    for (let attempt = 1; ; attempt++) {
        try {
            return await runTransaction(work, actingUserId);
        } catch (err) {
            if (!RETRYABLE.has(err && err.code) || attempt >= MAX_ATTEMPTS) throw err;
            // Jittered back-off so the two contenders don't collide again.
            await sleep(15 * attempt + Math.floor(Math.random() * 35));
        }
    }
}

async function runTransaction(work, actingUserId) {
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
