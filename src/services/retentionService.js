const db = require('../config/db');

// Data retention: personal and operational records are kept only as long as
// they are needed, then removed on a schedule (DPDP Act 2023: storage
// limitation). Each period is a setting; 0 means "keep".
//
//   RETENTION_AI_CALL_DAYS         model-call log (no text, but it names users)         default 90
//   RETENTION_BRIEFING_DAYS        stored daily briefings                               default 90
//   RETENTION_VERIFICATION_DAYS    used or expired sign-up codes                        default 30
//   RETENTION_UNVERIFIED_DAYS      sign-ups that never confirmed their email, with no tickets  default 14
//   RETENTION_AUDIT_DAYS           the audit log (records who did what)                 default 0 (keep)
//
// Expired sign-in revocation entries are removed as soon as the token they
// blocked could no longer be used anyway. Erased accounts and finished tickets
// are not touched: tickets and ratings are the service record and carry no
// personal data once the resident is erased.

const POLICY = {
    ai_calls: { env: 'RETENTION_AI_CALL_DAYS', fallback: 90 },
    ai_briefings: { env: 'RETENTION_BRIEFING_DAYS', fallback: 90 },
    email_verifications: { env: 'RETENTION_VERIFICATION_DAYS', fallback: 30 },
    unverified_accounts: { env: 'RETENTION_UNVERIFIED_DAYS', fallback: 14 },
    audit_log: { env: 'RETENTION_AUDIT_DAYS', fallback: 0 },
};

const days = (key) => {
    const raw = process.env[POLICY[key].env];
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : POLICY[key].fallback;
};

const LOCK_KEY = 7253104;

/** The periods in force, for the admin who asks "how long do you keep this?". */
const currentPolicy = () => Object.fromEntries(Object.keys(POLICY).map((k) => [k, days(k)]));

/** Removes what is past its period. Returns the number of rows removed per kind. */
async function sweep() {
    const client = await db.pool.connect();
    try {
        const lock = await client.query('SELECT pg_try_advisory_lock($1) AS ok', [LOCK_KEY]);
        if (!lock.rows[0].ok) return null; // another server is doing it
        try {
            const removed = {};
            const run = async (name, sql, params = []) => {
                removed[name] = (await client.query(sql, params)).rowCount;
            };
            if (days('ai_calls')) await run('ai_calls', `DELETE FROM ai_calls WHERE created_at < NOW() - make_interval(days => $1)`, [days('ai_calls')]);
            if (days('ai_briefings')) await run('ai_briefings', `DELETE FROM ai_briefings WHERE briefing_date < CURRENT_DATE - $1::int`, [days('ai_briefings')]);
            if (days('email_verifications')) {
                await run(
                    'email_verifications',
                    `DELETE FROM email_verifications WHERE COALESCE(consumed_at, expires_at) < NOW() - make_interval(days => $1)`,
                    [days('email_verifications')]
                );
            }
            await run('revoked_tokens', `DELETE FROM revoked_tokens WHERE expires_at < NOW()`);
            if (days('unverified_accounts')) {
                await run(
                    'unverified_accounts',
                    `DELETE FROM users u
                     WHERE u.account_status = 'PENDING_VERIFICATION' AND u.role = 'STUDENT' AND u.created_at < NOW() - make_interval(days => $1)
                       AND NOT EXISTS (SELECT 1 FROM complaints c WHERE c.raised_by_user_id = u.user_id)
                       AND NOT EXISTS (SELECT 1 FROM student_room_allotments a WHERE a.student_id = u.user_id)`,
                    [days('unverified_accounts')]
                );
            }
            if (days('audit_log')) await run('audit_log', `DELETE FROM audit_log WHERE occurred_at < NOW() - make_interval(days => $1)`, [days('audit_log')]);
            return removed;
        } finally {
            await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]);
        }
    } finally {
        client.release();
    }
}

/** Runs shortly after start and then daily. Returns a stop function. */
function startRetentionSweeper({ log = console } = {}) {
    const run = () =>
        sweep()
            .then((r) => {
                const total = r ? Object.values(r).reduce((s, n) => s + n, 0) : 0;
                if (total) log.log(`Retention: removed ${JSON.stringify(r)}`);
            })
            .catch((err) => log.error('Retention sweep failed:', err.message));
    const first = setTimeout(run, 120_000);
    const timer = setInterval(run, 24 * 3_600_000);
    first.unref();
    timer.unref();
    return () => {
        clearTimeout(first);
        clearInterval(timer);
    };
}

module.exports = { sweep, currentPolicy, startRetentionSweeper, POLICY };
