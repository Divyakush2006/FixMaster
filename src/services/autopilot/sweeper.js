const db = require('../../config/db');
const { dispatch, suggest, explainNobody } = require('./index');
const steps = require('../handling/steps');

// The autopilot acts when a ticket is raised or sent back. That alone leaves
// gaps: a ticket raised while nobody was eligible (everyone at their limit,
// off shift, on leave), a ticket raised before its block was switched to
// Automatic, a block that was Suggest and is now Automatic. Each of those would
// wait for a supervisor forever. This job looks at every open ticket whose
// block and trade are on Automatic and gives it another go, oldest and most
// urgent first, so Automatic means "without anyone having to look".
//
// Assignment still goes through dispatch(): the same rules, score, locks and
// history entry as a ticket assigned the moment it was raised.

const SWEEP_LOCK_KEY = 7253104; // arbitrary, app-specific (see verificationSweeper.js)
const DEFAULT_SECONDS = 60;
const DEFAULT_BATCH = 100;
// A ticket nobody could take for this long is flagged to the supervisors in its trail (and on the status card).
const alertAfterMinutes = () => Number.parseInt(process.env.TICKET_WAIT_ALERT_MINUTES, 10) || 30;

/** Writes why a ticket is still waiting, once per change, and a follow-up line when it has waited too long. */
async function noteWaiting(t, excluded) {
    await steps.recordIfChanged(db, t.complaint_id, {
        stage: 'DISPATCH',
        actor: 'AUTOPILOT',
        outcome: 'WAITING',
        title: 'Waiting for a technician to become free',
        detail: `${explainNobody(t.specialization, excluded)} It is tried again every minute, and a supervisor can assign someone sooner.`,
        data: { reason: 'NO_ELIGIBLE_STAFF', excluded: excluded.length },
    });
    const minutes = (Date.now() - new Date(t.created_at).getTime()) / 60000;
    if (minutes >= alertAfterMinutes()) {
        const done = await db.query("SELECT 1 FROM ticket_handling_steps WHERE complaint_id = $1 AND stage = 'FOLLOW_UP' LIMIT 1", [t.complaint_id]);
        if (done.rows.length === 0) {
            await steps.record(db, t.complaint_id, {
                stage: 'FOLLOW_UP',
                actor: 'SYSTEM',
                outcome: 'WAITING',
                title: 'Flagged to the supervisors',
                detail: `No technician has been free for ${alertAfterMinutes()} minutes, so this ticket is listed for the supervisors to assign or chase.`,
            });
        }
    }
}

const last = { at: null, assigned: 0, waiting: 0, failed: 0 };

/** Open tickets whose block and trade are on Automatic, in the order they should be taken. */
const WAITING_FROM = `
    FROM complaints c
    JOIN complaint_subcategories sub ON sub.subcategory_id = c.subcategory_id
    WHERE c.status = 'OPEN'
      AND ($1::varchar[] IS NULL OR c.block_id = ANY($1::varchar[]))
      AND COALESCE((SELECT s.mode FROM autopilot_settings s
                    WHERE s.specialization = sub.required_specialization AND (s.block_id = c.block_id OR s.block_id IS NULL)
                    ORDER BY s.block_id NULLS LAST LIMIT 1), 'SUGGEST') = 'AUTO'`;

async function waitingTickets(executor, blocks, limit) {
    const { rows } = await executor.query(
        `SELECT c.complaint_id, c.block_id, c.priority, c.created_at, sub.required_specialization AS specialization, sub.issue_name
         ${WAITING_FROM}
         ORDER BY CASE c.priority WHEN 'EMERGENCY' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END, c.created_at
         LIMIT $2`,
        [blocks, limit]
    );
    return rows;
}

async function countWaiting(executor, blocks) {
    const { rows } = await executor.query(`SELECT COUNT(*)::int AS n ${WAITING_FROM}`, [blocks]);
    return rows[0].n;
}

/**
 * One pass. `blocks` limits it to a manager's scope (null: everything).
 * Returns { checked, assigned, waiting, failed }; "waiting" tickets had nobody
 * eligible and are tried again on the next pass.
 */
async function sweepOnce({ blocks = null, limit = DEFAULT_BATCH, log = console } = {}) {
    const tickets = await waitingTickets(db, blocks, limit);
    const out = { checked: tickets.length, assigned: 0, waiting: 0, failed: 0 };
    // Nobody free for a block and trade stays true for its other tickets too, so they are not tried again in this pass.
    const stuck = new Map(); // block:trade -> the exclusions that left nobody
    for (const t of tickets) {
        const key = `${t.block_id}:${t.specialization}`;
        if (stuck.has(key)) {
            out.waiting += 1;
            await noteWaiting(t, stuck.get(key)).catch(() => {});
            continue;
        }
        try {
            const r = await dispatch(t.complaint_id, { source: 'AUTOPILOT', trigger: 'RETRY' });
            if (r.assigned) out.assigned += 1;
            else {
                out.waiting += 1;
                await noteWaiting(t, r.excluded).catch(() => {});
                // A bad experience in one room excludes one person for that room only, so it says nothing about the block.
                if (!r.excluded.some((e) => e.reason === 'BAD_EXPERIENCE_HERE')) stuck.set(key, r.excluded);
            }
        } catch (err) {
            // Taken by a supervisor or another instance a moment ago (409) is fine; anything else is worth a line.
            if (err.statusCode !== 409) {
                out.failed += 1;
                log.error(`[autopilot] sweep ${t.complaint_id}: ${err.message}`);
            }
        }
    }
    return out;
}

/** Why a waiting ticket has not been assigned, from the same rules the autopilot applies. */
async function explainWaiting(complaintId) {
    const s = await suggest(complaintId);
    const reasons = {};
    for (const e of s.excluded) reasons[e.reason] = (reasons[e.reason] || 0) + 1;
    return { eligible: s.candidates.length, trade_staff: s.candidates.length + s.excluded.length, reasons };
}

/** What a manager sees on the settings page: what the autopilot did lately and what is still waiting for it. */
async function status(blocks) {
    const [waiting, total, done] = await Promise.all([
        waitingTickets(db, blocks, 10),
        countWaiting(db, blocks),
        db.query(
            `SELECT COUNT(*)::int AS n FROM complaint_assignments a JOIN complaints c ON c.complaint_id = a.complaint_id
             WHERE a.dispatch_source = 'AUTOPILOT' AND a.assigned_at >= NOW() - INTERVAL '24 hours'
               AND ($1::varchar[] IS NULL OR c.block_id = ANY($1::varchar[]))`,
            [blocks]
        ),
    ]);
    const now = Date.now();
    const rows = [];
    for (const t of waiting) {
        rows.push({ ...t, waiting_minutes: Math.max(0, Math.round((now - new Date(t.created_at).getTime()) / 60000)), ...(await explainWaiting(t.complaint_id)) });
    }
    return { assigned_last_24h: done.rows[0].n, waiting_total: total, waiting: rows, last_sweep: last.at ? { ...last } : null };
}

/** One pass under a cross-instance lock, remembering the outcome for the status panel. */
async function sweepLocked(opts) {
    const client = await db.pool.connect();
    try {
        const lock = await client.query('SELECT pg_try_advisory_lock($1) AS ok', [SWEEP_LOCK_KEY]);
        if (!lock.rows[0].ok) return null; // another instance is sweeping
        try {
            const r = await sweepOnce(opts);
            Object.assign(last, { at: new Date().toISOString(), assigned: r.assigned, waiting: r.waiting, failed: r.failed });
            return r;
        } finally {
            await client.query('SELECT pg_advisory_unlock($1)', [SWEEP_LOCK_KEY]);
        }
    } finally {
        client.release();
    }
}

/**
 * Runs every AUTOPILOT_SWEEP_SECONDS (default 60; 0 switches it off).
 * Returns a function that stops the timer (used on shutdown).
 */
function startAutopilotSweeper({ log = console } = {}) {
    const n = Number.parseInt(process.env.AUTOPILOT_SWEEP_SECONDS, 10);
    const seconds = Number.isFinite(n) && n >= 0 ? n : DEFAULT_SECONDS;
    if (seconds === 0) return () => {};
    const batch = Number.parseInt(process.env.AUTOPILOT_SWEEP_BATCH, 10) || DEFAULT_BATCH;
    const run = async () => {
        try {
            const r = await sweepLocked({ limit: batch, log });
            if (r && r.assigned > 0) log.log(`Autopilot assigned ${r.assigned} waiting ticket(s); ${r.waiting} still have nobody eligible.`);
        } catch (err) {
            // Retried on the next tick; must never take the API down.
            log.error('Autopilot sweep failed:', err.message);
        }
    };
    const first = setTimeout(run, 20_000);
    const timer = setInterval(run, seconds * 1000);
    first.unref();
    timer.unref();
    return () => {
        clearTimeout(first);
        clearInterval(timer);
    };
}

module.exports = { sweepOnce, sweepLocked, status, explainWaiting, startAutopilotSweeper };
