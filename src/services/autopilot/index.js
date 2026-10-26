const db = require('../../config/db');
const { AppError } = require('../../middleware/errorHandler');
const { rank, normaliseWeights } = require('./scoring');

// The dispatch autopilot (docs/ROADMAP.md section 6).
//
// Two steps for every ticket: hard rules decide who may take it at all, then
// a weighted score ranks whoever is left (scoring.js). Every excluded person
// comes back with the reason, and every automatic assignment stores its full
// score, so a supervisor can always see why.
//
// The assignment itself goes through sp_supervisor_assign_task - the same
// procedure, locks and checks as a supervisor's manual dispatch.

const LIVE_STATES = ['ASSIGNED', 'ACCEPTED', 'EN_ROUTE', 'IN_PROGRESS'];
const DEFAULT_SETTINGS = { mode: 'SUGGEST', live_job_cap: 6, weights: null };
const DEFAULT_CAMPUS_MEAN = 4.0;
const RECOVERY_DAYS = 30;
const TIMEZONE = () => process.env.APP_TIMEZONE || 'Asia/Kolkata';

/** MORNING 06-14, EVENING 14-22, NIGHT 22-06, in campus time. */
function currentShift(now = new Date()) {
    const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: TIMEZONE() }).format(now));
    if (hour >= 6 && hour < 14) return 'MORNING';
    if (hour >= 14 && hour < 22) return 'EVENING';
    return 'NIGHT';
}

/** The block's own setting for a trade, else the campus default, else SUGGEST. */
async function settingsFor(blockId, specialization, executor = db) {
    const { rows } = await executor.query(
        `SELECT block_id, mode, live_job_cap, weights FROM autopilot_settings
         WHERE specialization = $2 AND (block_id = $1 OR block_id IS NULL)
         ORDER BY block_id NULLS LAST LIMIT 1`,
        [blockId, specialization]
    );
    const row = rows[0];
    return row
        ? { mode: row.mode, live_job_cap: row.live_job_cap, weights: row.weights, inherited: row.block_id === null }
        : { ...DEFAULT_SETTINGS, inherited: true };
}

async function loadTicket(executor, complaintId, { lock = false } = {}) {
    const { rows } = await executor.query(
        `SELECT c.complaint_id, c.status, c.block_id, c.room_id, c.common_area_id, c.ticket_scope,
                COALESCE(r.floor_number, ca.floor_number) AS floor_number,
                sub.required_specialization AS specialization, sub.issue_name
         FROM complaints c
         JOIN complaint_subcategories sub ON sub.subcategory_id = c.subcategory_id
         LEFT JOIN rooms r ON r.room_id = c.room_id
         LEFT JOIN common_areas ca ON ca.area_id = c.common_area_id
         WHERE c.complaint_id = $1
         ${lock ? 'FOR UPDATE OF c' : ''}`,
        [complaintId]
    );
    if (rows.length === 0) throw new AppError(404, 'Complaint not found.');
    return rows[0];
}

/** Every active technician of the trade, with what the rules and the score need. */
async function staffWithMetrics(executor, ticket) {
    const { rows } = await executor.query(
        `WITH perf AS (
             SELECT staff_user_id, COUNT(rating)::int AS rated, COALESCE(SUM(rating), 0)::int AS rating_sum,
                    COUNT(*) FILTER (WHERE NOT satisfied)::int AS rework
             FROM view_staff_feedback WHERE verified_at >= NOW() - INTERVAL '60 days'
             GROUP BY staff_user_id
         ), done AS (
             SELECT a.staff_user_id, COUNT(*)::int AS completed,
                    COUNT(*) FILTER (WHERE a.work_completed_at <= c.created_at + make_interval(hours => cat.default_sla_hours))::int AS on_time
             FROM complaint_assignments a
             JOIN complaints c ON c.complaint_id = a.complaint_id
             JOIN complaint_subcategories sub ON sub.subcategory_id = c.subcategory_id
             JOIN complaint_categories cat ON cat.category_id = sub.category_id
             WHERE a.work_completed_at >= NOW() - INTERVAL '60 days'
             GROUP BY a.staff_user_id
         ), live AS (
             SELECT staff_user_id, COUNT(*)::int AS live_jobs FROM complaint_assignments
             WHERE current_state = ANY($4) GROUP BY staff_user_id
         ), here AS (
             SELECT DISTINCT ON (a.staff_user_id) a.staff_user_id, c.block_id AS cur_block,
                    COALESCE(r.floor_number, ca.floor_number) AS cur_floor
             FROM complaint_assignments a
             JOIN complaints c ON c.complaint_id = a.complaint_id
             LEFT JOIN rooms r ON r.room_id = c.room_id
             LEFT JOIN common_areas ca ON ca.area_id = c.common_area_id
             WHERE a.current_state = ANY($4)
             ORDER BY a.staff_user_id, a.assigned_at DESC
         ), last AS (
             SELECT staff_user_id, MAX(assigned_at) AS last_assigned_at FROM complaint_assignments GROUP BY staff_user_id
         ), place AS (
             SELECT staff_user_id,
                    AVG(rating) FILTER (WHERE rating IS NOT NULL) AS place_avg,
                    BOOL_OR((NOT satisfied OR rating <= 2) AND verified_at >= NOW() - make_interval(days => $5)) AS bad_recent
             FROM view_staff_feedback
             WHERE room_id IS NOT DISTINCT FROM $2 AND common_area_id IS NOT DISTINCT FROM $3
               AND verified_at >= NOW() - INTERVAL '180 days'
             GROUP BY staff_user_id
         )
         SELECT u.user_id, u.full_name, u.home_block_id, u.shift, u.is_available,
                EXISTS (SELECT 1 FROM staff_leave l WHERE l.staff_user_id = u.user_id AND CURRENT_DATE BETWEEN l.starts_on AND l.ends_on) AS on_leave,
                COALESCE(perf.rated, 0) AS rated, COALESCE(perf.rating_sum, 0) AS rating_sum, COALESCE(perf.rework, 0) AS rework,
                COALESCE(done.completed, 0) AS completed, COALESCE(done.on_time, 0) AS on_time,
                COALESCE(live.live_jobs, 0) AS live_jobs, here.cur_block, here.cur_floor, last.last_assigned_at,
                place.place_avg::float AS place_avg, COALESCE(place.bad_recent, FALSE) AS bad_recent
         FROM users u
         LEFT JOIN perf ON perf.staff_user_id = u.user_id
         LEFT JOIN done ON done.staff_user_id = u.user_id
         LEFT JOIN live ON live.staff_user_id = u.user_id
         LEFT JOIN here ON here.staff_user_id = u.user_id
         LEFT JOIN last ON last.staff_user_id = u.user_id
         LEFT JOIN place ON place.staff_user_id = u.user_id
         WHERE u.role = 'STAFF' AND u.is_active AND u.specialization = $1
         ORDER BY u.user_id`,
        [ticket.specialization, ticket.room_id, ticket.common_area_id, LIVE_STATES, RECOVERY_DAYS]
    );
    return rows;
}

async function campusMean(executor) {
    const { rows } = await executor.query(`SELECT AVG(rating)::float AS mean FROM view_staff_feedback WHERE verified_at >= NOW() - INTERVAL '60 days'`);
    return rows[0].mean || DEFAULT_CAMPUS_MEAN;
}

/**
 * Applies the hard rules. Returns { eligible, excluded } where every excluded
 * person carries the reason they were not considered.
 */
function applyRules(staff, ticket, { cap, now }) {
    const shift = currentShift(now);
    const excluded = [];
    const passing = [];
    for (const s of staff) {
        const why =
            (!s.is_available && 'OFF_DUTY') ||
            (s.on_leave && 'ON_LEAVE') ||
            (s.shift && s.shift !== shift && 'OFF_SHIFT') ||
            (s.home_block_id && s.home_block_id !== ticket.block_id && 'OTHER_BLOCK') ||
            (s.live_jobs >= cap && 'AT_CAPACITY') ||
            (s.bad_recent && 'BAD_EXPERIENCE_HERE') ||
            null;
        if (why) excluded.push({ user_id: s.user_id, full_name: s.full_name, reason: why });
        else passing.push(s);
    }
    // The block's own staff first; the campus pool only when none of them can take it.
    const ownBlock = passing.filter((s) => s.home_block_id === ticket.block_id);
    const eligible = ownBlock.length > 0 ? ownBlock : passing;
    if (ownBlock.length > 0) {
        for (const s of passing.filter((p) => p.home_block_id !== ticket.block_id)) {
            excluded.push({ user_id: s.user_id, full_name: s.full_name, reason: 'BLOCK_STAFF_AVAILABLE' });
        }
    }
    return { eligible, excluded, shift };
}

/** The ranked shortlist for a ticket, with exclusions and the settings in force. */
async function evaluate(executor, ticket, now = new Date()) {
    const settings = await settingsFor(ticket.block_id, ticket.specialization, executor);
    const staff = await staffWithMetrics(executor, ticket);
    const { eligible, excluded, shift } = applyRules(staff, ticket, { cap: settings.live_job_cap, now });
    const recovery = staff.some((s) => s.bad_recent);
    const ranked = rank(
        eligible.map((s) => ({
            userId: s.user_id,
            fullName: s.full_name,
            homeBlock: s.home_block_id,
            currentBlock: s.cur_block,
            currentFloor: s.cur_floor,
            liveJobs: s.live_jobs,
            lastAssignedAt: s.last_assigned_at,
            rated: s.rated,
            ratingSum: s.rating_sum,
            rework: s.rework,
            completed: s.completed,
            onTime: s.on_time,
            roomAvgRating: s.place_avg,
        })),
        {
            ticket: { blockId: ticket.block_id, floor: ticket.floor_number },
            now,
            cap: settings.live_job_cap,
            campusMean: await campusMean(executor),
            recovery,
            weights: settings.weights,
        }
    );
    return {
        settings: { mode: settings.mode, live_job_cap: settings.live_job_cap, weights: normaliseWeights(settings.weights), inherited: settings.inherited },
        shift,
        recovery,
        candidates: ranked.map((c) => ({
            user_id: c.userId,
            full_name: c.fullName,
            score: c.score,
            components: c.components,
            weights: c.weights,
            live_jobs: c.liveJobs,
            rated_jobs: c.rated,
            home_block_id: c.homeBlock,
        })),
        excluded,
    };
}

/** GET suggestions: read-only, for the dispatch screen. */
async function suggest(complaintId) {
    const ticket = await loadTicket(db, complaintId);
    return { ticket: { complaint_id: ticket.complaint_id, status: ticket.status, block_id: ticket.block_id, specialization: ticket.specialization }, ...(await evaluate(db, ticket)) };
}

/**
 * Assigns the top-ranked technician. `source` is AUTOPILOT (nobody asked)
 * or SUGGESTION (a manager accepted the suggestion). Returns
 * { assigned: false, reason } when nobody is eligible - a normal outcome.
 */
async function dispatch(complaintId, { actorUserId = null, source = 'AUTOPILOT' } = {}) {
    return db.withTransaction(async (client) => {
        const ticket = await loadTicket(client, complaintId, { lock: true });
        if (!['OPEN', 'ESCALATED'].includes(ticket.status)) {
            throw new AppError(409, `This ticket is ${ticket.status}; only open or escalated tickets are dispatched.`);
        }
        // One pick per trade at a time, so two tickets never take the last free person.
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`fm-dispatch-pick:${ticket.specialization}`]);
        const result = await evaluate(client, ticket);
        const best = result.candidates[0];
        if (!best) return { assigned: false, reason: 'NO_ELIGIBLE_STAFF', excluded: result.excluded };

        await client.query('CALL sp_supervisor_assign_task($1, $2, $3, FALSE, NULL, FALSE)', [complaintId, best.user_id, actorUserId]);
        const breakdown = { score: best.score, components: best.components, weights: best.weights, recovery: result.recovery, shift: result.shift, considered: result.candidates.length };
        await client.query(
            `UPDATE complaint_assignments SET dispatch_source = $3, score_breakdown = $4
             WHERE assignment_id = (SELECT assignment_id FROM complaint_assignments
                                    WHERE complaint_id = $1 AND staff_user_id = $2 AND current_state = 'ASSIGNED'
                                    ORDER BY assignment_id DESC LIMIT 1)`,
            [complaintId, best.user_id, source, breakdown]
        );
        // Explain the hand-over on the history entry the dispatch itself wrote
        // (a separate entry would notify the residents twice).
        await client.query(
            `UPDATE complaint_logs SET action_note = $2
             WHERE log_id = (SELECT log_id FROM complaint_logs WHERE complaint_id = $1 AND new_status = 'ASSIGNED' ORDER BY log_id DESC LIMIT 1)`,
            [
                complaintId,
                `${source === 'AUTOPILOT' ? 'Autopilot assigned' : 'Suggested and assigned'} ${best.full_name} (score ${best.score} of ${result.candidates.length} considered${result.recovery ? ', recovery mode' : ''})`,
            ]
        );
        return { assigned: true, staff_user_id: best.user_id, staff_name: best.full_name, score: best.score, recovery: result.recovery };
    }, actorUserId);
}

/** After a ticket is raised or sent back: dispatch it if its block and trade are on AUTO. Never throws. */
async function autoDispatchIfEnabled(complaintId, log = console) {
    try {
        const ticket = await loadTicket(db, complaintId);
        if (!['OPEN', 'ESCALATED'].includes(ticket.status)) return null;
        const settings = await settingsFor(ticket.block_id, ticket.specialization);
        if (settings.mode !== 'AUTO') return null;
        return await dispatch(complaintId, { source: 'AUTOPILOT' });
    } catch (err) {
        log.error(`[autopilot] ${complaintId}: ${err.message}`);
        return null;
    }
}

module.exports = { suggest, dispatch, autoDispatchIfEnabled, settingsFor, currentShift, applyRules, LIVE_STATES };
