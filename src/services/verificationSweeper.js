/**
 * Closes tickets whose work was marked done but that no resident confirmed or
 * rejected within VERIFICATION_AUTO_CLOSE_HOURS (default 72). Without this a
 * ticket whose reporter is away or has moved out waits for verification
 * forever and keeps counting as unresolved.
 *
 * The work is done by sp_auto_close_stale_verifications (migration 008).
 * Safe with several API instances: each run takes a transaction-level
 * advisory lock and skips if another instance is already sweeping.
 */
const db = require('../config/db');

const SWEEP_LOCK_KEY = 7253102; // arbitrary, app-specific (migrate.js uses 7253101)

const positiveInt = (value, fallback) => {
    const n = parseInt(value, 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
};

const autoCloseHours = () => positiveInt(process.env.VERIFICATION_AUTO_CLOSE_HOURS, 72);

/** One sweep. Returns the number of tickets closed (0 if another instance holds the lock). */
async function sweepOnce() {
    return db.withTransaction(async (client) => {
        const lock = await client.query('SELECT pg_try_advisory_xact_lock($1) AS ok', [SWEEP_LOCK_KEY]);
        if (!lock.rows[0].ok) return 0;
        const result = await client.query('CALL sp_auto_close_stale_verifications($1, NULL)', [autoCloseHours()]);
        return result.rows[0] ? result.rows[0].p_closed : 0;
    });
}

/**
 * Runs a sweep now and then every VERIFICATION_SWEEP_MINUTES (default 15).
 * Returns a function that stops the timer (used on shutdown).
 */
function startVerificationSweeper({ log = console } = {}) {
    const everyMs = positiveInt(process.env.VERIFICATION_SWEEP_MINUTES, 15) * 60 * 1000;
    const run = async () => {
        try {
            const closed = await sweepOnce();
            if (closed > 0) {
                log.log(`Auto-closed ${closed} ticket(s) left unverified for ${autoCloseHours()} hours.`);
            }
        } catch (err) {
            // A failed sweep is retried on the next tick; it must never take
            // the API down.
            log.error('Verification sweep failed:', err.message);
        }
    };
    run();
    const timer = setInterval(run, everyMs);
    timer.unref();
    return () => clearInterval(timer);
}

module.exports = { sweepOnce, startVerificationSweeper, autoCloseHours };
