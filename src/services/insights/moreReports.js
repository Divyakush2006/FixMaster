const db = require('../../config/db');
const { slaStatusSql } = require('../slaService');
const { blocksFor } = require('./reports');

// More read-only reports (see reports.js for the rules every report follows:
// parameters are checked here, results stay inside the manager's block scope,
// nothing is built from free text). Each takes (scope, { blockId, days }).

const LIVE = `('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'PENDING_VERIFICATION', 'ESCALATED')`;
const TRADES = ['CLEANING', 'ELECTRICIAN', 'PLUMBER', 'CARPENTER', 'AC_TECH'];
const NOT_COUNTED = `c.status <> 'CANCELLED' AND c.closure_reason IS DISTINCT FROM 'DUPLICATE'`;
const URGENT_FIRST = `CASE c.priority WHEN 'EMERGENCY' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END`;

const clamp = (n, lo, hi, fallback) => {
    const v = Number.parseInt(n, 10);
    return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
};
const weeksFor = (days) => clamp(Math.ceil(clamp(days, 1, 180, 56) / 7), 4, 26, 8);

/** Share of finished tickets that met their deadline, per block, over the last `days` days. */
async function slaCompliance(scope, { blockId, days = 30 } = {}) {
    const { rows } = await db.query(
        `SELECT block_id,
                COUNT(*) FILTER (WHERE st = 'MET')::int AS met,
                COUNT(*) FILTER (WHERE st = 'BREACHED')::int AS breached,
                ROUND(100.0 * COUNT(*) FILTER (WHERE st = 'MET') / NULLIF(COUNT(*) FILTER (WHERE st IN ('MET', 'BREACHED')), 0), 1)::float AS compliance_pct
         FROM (
             SELECT c.block_id, ${slaStatusSql()} AS st
             FROM complaints c
             JOIN complaint_subcategories sub ON sub.subcategory_id = c.subcategory_id
             JOIN complaint_categories cat ON cat.category_id = sub.category_id
             WHERE c.created_at >= CURRENT_TIMESTAMP - make_interval(days => $2) AND ${NOT_COUNTED}
               AND ($1::varchar[] IS NULL OR c.block_id = ANY($1::varchar[]))
         ) t
         GROUP BY block_id ORDER BY compliance_pct NULLS LAST, block_id`,
        [blocksFor(scope, blockId), clamp(days, 1, 180, 30)]
    );
    const met = rows.reduce((s, r) => s + r.met, 0);
    const breached = rows.reduce((s, r) => s + r.breached, 0);
    return { met, breached, compliance_pct: met + breached ? Math.round((1000 * met) / (met + breached)) / 10 : null, blocks: rows };
}

/** One row per block over the last `days` days: volume, deadlines, speed, ratings, open escalations. Worst first. */
async function blockComparison(scope, { days = 30 } = {}) {
    const { rows } = await db.query(
        `SELECT b.block_id, b.block_name,
                COUNT(t.complaint_id)::int AS tickets,
                COUNT(t.complaint_id) FILTER (WHERE t.priority IN ('HIGH', 'EMERGENCY'))::int AS urgent,
                COUNT(t.complaint_id) FILTER (WHERE t.st = 'MET')::int AS met,
                COUNT(t.complaint_id) FILTER (WHERE t.st = 'BREACHED')::int AS breached,
                ROUND(100.0 * COUNT(t.complaint_id) FILTER (WHERE t.st = 'MET') / NULLIF(COUNT(t.complaint_id) FILTER (WHERE t.st IN ('MET', 'BREACHED')), 0), 1)::float AS compliance_pct,
                COUNT(t.complaint_id) FILTER (WHERE t.st = 'OVERDUE')::int AS overdue_now,
                COUNT(t.complaint_id) FILTER (WHERE t.status = 'ESCALATED')::int AS escalated_now,
                ROUND(AVG(EXTRACT(EPOCH FROM (t.resolved_at - t.created_at)) / 3600) FILTER (WHERE t.resolved_at IS NOT NULL)::numeric, 1)::float AS avg_hours,
                ROUND(AVG(t.rating), 2)::float AS avg_rating
         FROM hostel_blocks b
         LEFT JOIN (
             SELECT c.complaint_id, c.block_id, c.priority, c.status, c.created_at, c.resolved_at, ${slaStatusSql()} AS st, fb.rating
             FROM complaints c
             JOIN complaint_subcategories sub ON sub.subcategory_id = c.subcategory_id
             JOIN complaint_categories cat ON cat.category_id = sub.category_id
             LEFT JOIN complaint_feedback fb ON fb.complaint_id = c.complaint_id AND fb.is_satisfactorily_resolved AND fb.rating IS NOT NULL
             WHERE c.created_at >= CURRENT_TIMESTAMP - make_interval(days => $2) AND ${NOT_COUNTED}
         ) t ON t.block_id = b.block_id
         WHERE $1::varchar[] IS NULL OR b.block_id = ANY($1::varchar[])
         GROUP BY b.block_id, b.block_name
         HAVING COUNT(t.complaint_id) > 0
         ORDER BY compliance_pct NULLS LAST, overdue_now DESC, b.block_id`,
        [scope, clamp(days, 1, 180, 30)]
    );
    return rows;
}

const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
const std = (xs) => {
    const m = mean(xs);
    return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length);
};

/**
 * Tickets per week for the last full weeks, flagging weeks that are far from
 * the others, and blocks whose last seven days are well above their own usual
 * week. "Unusual" means at least two standard deviations from the rest (and at
 * least five tickets more, for blocks) - a prompt to look, not a diagnosis.
 */
async function volumeTrend(scope, { blockId, days = 56 } = {}) {
    const weeks = weeksFor(days);
    const params = [blocksFor(scope, blockId), weeks];
    const weekly = await db.query(
        `SELECT w::date AS week_start,
                COUNT(c.complaint_id)::int AS tickets,
                COUNT(c.complaint_id) FILTER (WHERE c.priority IN ('HIGH', 'EMERGENCY'))::int AS urgent
         FROM generate_series(date_trunc('week', CURRENT_TIMESTAMP) - make_interval(weeks => $2),
                              date_trunc('week', CURRENT_TIMESTAMP) - INTERVAL '1 week', INTERVAL '1 week') AS w
         LEFT JOIN complaints c ON c.created_at >= w AND c.created_at < w + INTERVAL '1 week' AND ${NOT_COUNTED}
              AND ($1::varchar[] IS NULL OR c.block_id = ANY($1::varchar[]))
         GROUP BY w ORDER BY w`,
        params
    );
    const counts = weekly.rows.map((r) => r.tickets);
    // A floor of one ticket on the spread keeps a perfectly steady history from making any change "infinite".
    const series = weekly.rows.map((r, i) => {
        const others = counts.filter((_, j) => j !== i);
        // Needs an established baseline: a young system with a few quiet weeks says nothing about what is usual.
        if (others.length < 4 || others.filter((x) => x > 0).length < 3) return { ...r, z: 0, unusual: false };
        const s = Math.max(std(others), 1);
        const gap = r.tickets - mean(others);
        return { ...r, z: Math.round((gap / s) * 10) / 10, unusual: Math.abs(gap) >= 2 * s && Math.abs(gap) >= 5 };
    });

    // Rolling windows ending now: 0 = the last seven days, 1 = the seven before, and so on.
    const perBlock = await db.query(
        `SELECT c.block_id, floor(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - c.created_at)) / 604800)::int AS wk_ago, COUNT(*)::int AS n
         FROM complaints c
         WHERE c.created_at >= CURRENT_TIMESTAMP - make_interval(weeks => $2 + 1) AND ${NOT_COUNTED}
           AND ($1::varchar[] IS NULL OR c.block_id = ANY($1::varchar[]))
         GROUP BY 1, 2`,
        params
    );
    const byBlock = new Map();
    for (const r of perBlock.rows) {
        if (!byBlock.has(r.block_id)) byBlock.set(r.block_id, new Array(weeks + 1).fill(0));
        if (r.wk_ago <= weeks) byBlock.get(r.block_id)[r.wk_ago] = r.n;
    }
    const blocks = [];
    for (const [block, w] of byBlock) {
        const [current, ...past] = w;
        if (past.filter((x) => x > 0).length < 3) continue; // no established baseline for this block yet
        const m = mean(past);
        const s = Math.max(std(past), 1);
        if (current >= m + 5 && current - m >= 2 * s) {
            blocks.push({ block_id: block, last_7_days: current, usual_week: Math.round(m * 10) / 10, z: Math.round(((current - m) / s) * 10) / 10 });
        }
    }
    blocks.sort((a, b) => b.z - a.z);
    return { weeks: series, blocks };
}

/** Where there are open tickets but too few technicians on duty for the trade, block by block. */
async function staffingGaps(scope, { blockId } = {}) {
    const { rows } = await db.query(
        `WITH people AS (
             SELECT u.home_block_id AS block_id, u.specialization AS trade,
                    COUNT(*)::int AS staff,
                    COUNT(*) FILTER (WHERE u.is_available AND NOT EXISTS (
                        SELECT 1 FROM staff_leave l WHERE l.staff_user_id = u.user_id AND CURRENT_DATE BETWEEN l.starts_on AND l.ends_on))::int AS on_duty
             FROM users u WHERE u.role = 'STAFF' AND u.is_active GROUP BY 1, 2
         ), demand AS (
             SELECT c.block_id, sub.required_specialization AS trade, COUNT(*)::int AS open_tickets
             FROM complaints c JOIN complaint_subcategories sub ON sub.subcategory_id = c.subcategory_id
             WHERE c.status IN ${LIVE} GROUP BY 1, 2
         )
         SELECT b.block_id, t.trade, COALESCE(p.staff, 0) AS staff, COALESCE(p.on_duty, 0) AS on_duty,
                COALESCE(pool.on_duty, 0) AS pool_on_duty, COALESCE(d.open_tickets, 0) AS open_tickets
         FROM hostel_blocks b
         CROSS JOIN (VALUES ${TRADES.map((t) => `('${t}')`).join(',')}) AS t(trade)
         LEFT JOIN people p ON p.block_id = b.block_id AND p.trade = t.trade
         LEFT JOIN people pool ON pool.block_id IS NULL AND pool.trade = t.trade
         LEFT JOIN demand d ON d.block_id = b.block_id AND d.trade = t.trade
         WHERE $1::varchar[] IS NULL OR b.block_id = ANY($1::varchar[])`,
        [blocksFor(scope, blockId)]
    );
    const CAP = 6; // the default live-job cap per technician
    const classify = (r) => {
        if (r.open_tickets === 0) return 'OK';
        if (r.on_duty === 0) return r.pool_on_duty > 0 ? 'POOL_ONLY' : 'NO_COVER';
        return r.open_tickets / r.on_duty > CAP ? 'STRETCHED' : 'OK';
    };
    const order = { NO_COVER: 0, POOL_ONLY: 1, STRETCHED: 2 };
    return rows
        .map((r) => ({ ...r, status: classify(r) }))
        .filter((r) => r.status !== 'OK')
        .sort((a, b) => order[a.status] - order[b.status] || b.open_tickets - a.open_tickets || a.block_id.localeCompare(b.block_id))
        .slice(0, 50);
}

/** Technicians off duty or on leave today, and the open jobs each still holds. */
async function staffAbsence(scope, { blockId } = {}) {
    const { rows } = await db.query(
        `SELECT u.full_name, u.specialization, u.home_block_id AS block_id,
                CASE WHEN EXISTS (SELECT 1 FROM staff_leave l WHERE l.staff_user_id = u.user_id AND CURRENT_DATE BETWEEN l.starts_on AND l.ends_on)
                     THEN 'ON_LEAVE' ELSE 'OFF_DUTY' END AS reason,
                (SELECT COUNT(*)::int FROM complaint_assignments a WHERE a.staff_user_id = u.user_id AND a.current_state IN ('ASSIGNED', 'ACCEPTED', 'EN_ROUTE', 'IN_PROGRESS')) AS open_jobs
         FROM users u
         WHERE u.role = 'STAFF' AND u.is_active
           AND (NOT u.is_available OR EXISTS (SELECT 1 FROM staff_leave l WHERE l.staff_user_id = u.user_id AND CURRENT_DATE BETWEEN l.starts_on AND l.ends_on))
           AND ($1::varchar[] IS NULL OR u.home_block_id IS NULL OR u.home_block_id = ANY($1::varchar[]))
         ORDER BY open_jobs DESC, u.full_name LIMIT 50`,
        [blocksFor(scope, blockId)]
    );
    return rows;
}

/** Tickets a resident sent back as not fixed, still waiting for the work to be redone. */
async function escalations(scope, { blockId } = {}) {
    const { rows } = await db.query(
        `SELECT c.complaint_id, c.block_id, c.priority, cat.category_name, sub.issue_name, COALESCE(r.room_number, ca.description) AS location,
                ROUND((EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - c.created_at)) / 3600)::numeric, 1)::float AS hours_open,
                (SELECT COUNT(*)::int FROM complaint_feedback f WHERE f.complaint_id = c.complaint_id AND NOT f.is_satisfactorily_resolved) AS times_sent_back
         FROM complaints c
         JOIN complaint_subcategories sub ON sub.subcategory_id = c.subcategory_id
         JOIN complaint_categories cat ON cat.category_id = sub.category_id
         LEFT JOIN rooms r ON r.room_id = c.room_id
         LEFT JOIN common_areas ca ON ca.area_id = c.common_area_id
         WHERE c.status = 'ESCALATED' AND ($1::varchar[] IS NULL OR c.block_id = ANY($1::varchar[]))
         ORDER BY times_sent_back DESC, ${URGENT_FIRST}, c.created_at LIMIT 25`,
        [blocksFor(scope, blockId)]
    );
    return rows;
}

/** How long each kind of work takes against its deadline, over the last `days` days. */
async function resolutionTimes(scope, { blockId, days = 30 } = {}) {
    const { rows } = await db.query(
        `SELECT cat.category_name, cat.default_sla_hours AS sla_hours, COUNT(*)::int AS tickets,
                ROUND(AVG(h)::numeric, 1)::float AS avg_hours,
                ROUND((percentile_cont(0.9) WITHIN GROUP (ORDER BY h))::numeric, 1)::float AS p90_hours,
                ROUND(100.0 * COUNT(*) FILTER (WHERE h <= cat.default_sla_hours) / COUNT(*), 1)::float AS within_deadline_pct
         FROM (
             SELECT c.subcategory_id, EXTRACT(EPOCH FROM (COALESCE(c.resolved_at, c.closed_at) - c.created_at)) / 3600 AS h
             FROM complaints c
             WHERE COALESCE(c.resolved_at, c.closed_at) IS NOT NULL AND c.created_at >= CURRENT_TIMESTAMP - make_interval(days => $2)
               AND ${NOT_COUNTED} AND c.status IN ('COMPLETED', 'PENDING_VERIFICATION')
               AND ($1::varchar[] IS NULL OR c.block_id = ANY($1::varchar[]))
         ) x
         JOIN complaint_subcategories sub ON sub.subcategory_id = x.subcategory_id
         JOIN complaint_categories cat ON cat.category_id = sub.category_id
         GROUP BY cat.category_name, cat.default_sla_hours ORDER BY avg_hours DESC`,
        [blocksFor(scope, blockId), clamp(days, 1, 180, 30)]
    );
    return rows;
}

/** Average resident rating per week for the last weeks. */
async function ratingTrend(scope, { blockId, days = 56 } = {}) {
    const weeks = weeksFor(days);
    const { rows } = await db.query(
        `SELECT w::date AS week_start, COUNT(f.rating)::int AS ratings, ROUND(AVG(f.rating), 2)::float AS avg_rating
         FROM generate_series(date_trunc('week', CURRENT_TIMESTAMP) - make_interval(weeks => $2), date_trunc('week', CURRENT_TIMESTAMP), INTERVAL '1 week') AS w
         LEFT JOIN (
             SELECT f.rating, f.verified_at FROM complaint_feedback f JOIN complaints c ON c.complaint_id = f.complaint_id
             WHERE f.is_satisfactorily_resolved AND f.rating IS NOT NULL AND ($1::varchar[] IS NULL OR c.block_id = ANY($1::varchar[]))
         ) f ON f.verified_at >= w AND f.verified_at < w + INTERVAL '1 week'
         GROUP BY w ORDER BY w`,
        [blocksFor(scope, blockId), weeks]
    );
    return rows;
}

/** Emergency tickets that are still open. */
async function emergencies(scope, { blockId } = {}) {
    const { rows } = await db.query(
        `SELECT c.complaint_id, c.block_id, c.status, cat.category_name, sub.issue_name, COALESCE(r.room_number, ca.description) AS location,
                ROUND((EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - c.created_at)) / 3600)::numeric, 1)::float AS hours_open,
                u.full_name AS assigned_to
         FROM complaints c
         JOIN complaint_subcategories sub ON sub.subcategory_id = c.subcategory_id
         JOIN complaint_categories cat ON cat.category_id = sub.category_id
         LEFT JOIN rooms r ON r.room_id = c.room_id
         LEFT JOIN common_areas ca ON ca.area_id = c.common_area_id
         LEFT JOIN LATERAL (
             SELECT staff_user_id FROM complaint_assignments a WHERE a.complaint_id = c.complaint_id AND a.current_state <> 'DECLINED' ORDER BY a.assigned_at DESC LIMIT 1
         ) la ON TRUE
         LEFT JOIN users u ON u.user_id = la.staff_user_id
         WHERE c.priority = 'EMERGENCY' AND c.status IN ${LIVE} AND ($1::varchar[] IS NULL OR c.block_id = ANY($1::varchar[]))
         ORDER BY c.created_at LIMIT 25`,
        [blocksFor(scope, blockId)]
    );
    return rows;
}

/** The floors that raise the most tickets over the last `days` days. */
async function busiestFloors(scope, { blockId, days = 30 } = {}) {
    const { rows } = await db.query(
        `SELECT c.block_id, COALESCE(r.floor_number, ca.floor_number) AS floor_number, COUNT(*)::int AS tickets,
                COUNT(*) FILTER (WHERE c.priority IN ('HIGH', 'EMERGENCY'))::int AS urgent
         FROM complaints c
         LEFT JOIN rooms r ON r.room_id = c.room_id
         LEFT JOIN common_areas ca ON ca.area_id = c.common_area_id
         WHERE c.created_at >= CURRENT_TIMESTAMP - make_interval(days => $2) AND ${NOT_COUNTED}
           AND ($1::varchar[] IS NULL OR c.block_id = ANY($1::varchar[]))
         GROUP BY c.block_id, COALESCE(r.floor_number, ca.floor_number)
         ORDER BY tickets DESC, urgent DESC, c.block_id, floor_number LIMIT 15`,
        [blocksFor(scope, blockId), clamp(days, 1, 180, 30)]
    );
    return rows;
}

module.exports = { slaCompliance, blockComparison, volumeTrend, staffingGaps, staffAbsence, escalations, resolutionTimes, ratingTrend, emergencies, busiestFloors };
