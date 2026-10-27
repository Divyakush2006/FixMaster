const db = require('../../config/db');
const { slaStatusSql } = require('../slaService');
const { blocksFor } = require('./reports');

// A third group of read-only reports (rules as in reports.js: parameters are
// checked here, results stay inside the manager's block scope, nothing is built
// from free text). Each takes (scope, { blockId, days }).

const LIVE = `('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'PENDING_VERIFICATION', 'ESCALATED')`;
const NOT_COUNTED = `c.status <> 'CANCELLED' AND c.closure_reason IS DISTINCT FROM 'DUPLICATE'`;
const IN_SCOPE = `($1::varchar[] IS NULL OR c.block_id = ANY($1::varchar[]))`;
const SINCE = `c.created_at >= CURRENT_TIMESTAMP - make_interval(days => $2)`;
const URGENT_FIRST = `CASE c.priority WHEN 'EMERGENCY' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END`;

const clamp = (n, lo, hi, fallback) => {
    const v = Number.parseInt(n, 10);
    return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
};
const daysOf = (days, fallback = 30) => clamp(days, 1, 180, fallback);

/** Tickets by hour of the day (campus time), busiest first. */
async function peakHours(scope, { blockId, days = 30 } = {}) {
    const { rows } = await db.query(
        `SELECT EXTRACT(HOUR FROM c.created_at AT TIME ZONE 'Asia/Kolkata')::int AS hour, COUNT(*)::int AS tickets
         FROM complaints c WHERE ${SINCE} AND ${NOT_COUNTED} AND ${IN_SCOPE}
         GROUP BY 1 ORDER BY tickets DESC, hour LIMIT 24`,
        [blocksFor(scope, blockId), daysOf(days)]
    );
    return rows;
}

/** Tickets by day of the week (Monday first in the result's `weekday` number: 1 = Monday ... 7 = Sunday). */
async function weekdayPattern(scope, { blockId, days = 60 } = {}) {
    const { rows } = await db.query(
        `SELECT EXTRACT(ISODOW FROM c.created_at AT TIME ZONE 'Asia/Kolkata')::int AS weekday, COUNT(*)::int AS tickets
         FROM complaints c WHERE ${SINCE} AND ${NOT_COUNTED} AND ${IN_SCOPE}
         GROUP BY 1 ORDER BY weekday`,
        [blocksFor(scope, blockId), daysOf(days, 60)]
    );
    return rows;
}

/** Tickets per 100 rooms for each room type (AC, non-AC, deluxe), so a bigger group is not unfairly "worse". */
async function roomTypeFaults(scope, { blockId, days = 90 } = {}) {
    const { rows } = await db.query(
        `SELECT r.room_type,
                COUNT(DISTINCT r.room_id)::int AS rooms,
                COUNT(c.complaint_id)::int AS tickets,
                ROUND(100.0 * COUNT(c.complaint_id) / NULLIF(COUNT(DISTINCT r.room_id), 0), 1)::float AS per_100_rooms
         FROM rooms r
         LEFT JOIN complaints c ON c.room_id = r.room_id AND ${SINCE} AND ${NOT_COUNTED}
         WHERE r.is_active AND ($1::varchar[] IS NULL OR r.block_id = ANY($1::varchar[]))
         GROUP BY r.room_type ORDER BY per_100_rooms DESC NULLS LAST, r.room_type`,
        [blocksFor(scope, blockId), daysOf(days, 90)]
    );
    return rows;
}

/** Individual rooms with the most tickets (two or more) over the last `days` days. */
async function topRooms(scope, { blockId, days = 90 } = {}) {
    const { rows } = await db.query(
        `SELECT c.room_id, r.room_number, c.block_id, r.floor_number, COUNT(*)::int AS tickets,
                COUNT(DISTINCT sub.category_id)::int AS kinds
         FROM complaints c
         JOIN rooms r ON r.room_id = c.room_id
         JOIN complaint_subcategories sub ON sub.subcategory_id = c.subcategory_id
         WHERE ${SINCE} AND ${NOT_COUNTED} AND ${IN_SCOPE}
         GROUP BY c.room_id, r.room_number, c.block_id, r.floor_number
         HAVING COUNT(*) >= 2
         ORDER BY tickets DESC, c.block_id, r.room_number LIMIT 15`,
        [blocksFor(scope, blockId), daysOf(days, 90)]
    );
    return rows;
}

/** Beds and how many are taken, per block. Fullest first. */
async function occupancy(scope, { blockId } = {}) {
    const { rows } = await db.query(
        `SELECT b.block_id, b.block_name, b.hostel_type,
                COALESCE(SUM(r.bed_capacity), 0)::int AS beds,
                (SELECT COUNT(*)::int FROM student_room_allotments a JOIN rooms ar ON ar.room_id = a.room_id
                  WHERE a.is_current AND ar.block_id = b.block_id) AS residents
         FROM hostel_blocks b
         LEFT JOIN rooms r ON r.block_id = b.block_id AND r.is_active
         WHERE ($1::varchar[] IS NULL OR b.block_id = ANY($1::varchar[]))
         GROUP BY b.block_id, b.block_name, b.hostel_type
         ORDER BY b.block_id`,
        [blocksFor(scope, blockId)]
    );
    return rows
        .map((r) => ({ ...r, occupancy_pct: r.beds ? Math.round((1000 * r.residents) / r.beds) / 10 : null }))
        .sort((a, b) => (b.occupancy_pct ?? -1) - (a.occupancy_pct ?? -1) || a.block_id.localeCompare(b.block_id));
}

/** Deadlines met, by ticket priority. */
async function slaByPriority(scope, { blockId, days = 30 } = {}) {
    const { rows } = await db.query(
        `SELECT priority, COUNT(*)::int AS tickets,
                COUNT(*) FILTER (WHERE st = 'MET')::int AS met,
                COUNT(*) FILTER (WHERE st = 'BREACHED')::int AS breached,
                ROUND(100.0 * COUNT(*) FILTER (WHERE st = 'MET') / NULLIF(COUNT(*) FILTER (WHERE st IN ('MET', 'BREACHED')), 0), 1)::float AS compliance_pct
         FROM (
             SELECT c.priority, ${slaStatusSql()} AS st
             FROM complaints c
             JOIN complaint_subcategories sub ON sub.subcategory_id = c.subcategory_id
             JOIN complaint_categories cat ON cat.category_id = sub.category_id
             WHERE ${SINCE} AND ${NOT_COUNTED} AND ${IN_SCOPE}
         ) t
         GROUP BY priority
         ORDER BY CASE priority WHEN 'EMERGENCY' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END`,
        [blocksFor(scope, blockId), daysOf(days)]
    );
    return rows;
}

/** How often a job was declined or moved to someone else before it was done. */
async function reassignments(scope, { blockId, days = 30 } = {}) {
    const { rows } = await db.query(
        `SELECT COUNT(*)::int AS tickets_assigned,
                COUNT(*) FILTER (WHERE n.sent >= 2)::int AS moved,
                COALESCE(SUM(n.declined), 0)::int AS declined
         FROM complaints c
         JOIN LATERAL (
             SELECT COUNT(*)::int AS sent, COUNT(*) FILTER (WHERE a.current_state = 'DECLINED')::int AS declined
             FROM complaint_assignments a WHERE a.complaint_id = c.complaint_id
         ) n ON n.sent > 0
         WHERE ${SINCE} AND ${NOT_COUNTED} AND ${IN_SCOPE}`,
        [blocksFor(scope, blockId), daysOf(days)]
    );
    const r = rows[0];
    return { ...r, moved_pct: r.tickets_assigned ? Math.round((1000 * r.moved) / r.tickets_assigned) / 10 : null };
}

/** Time from a ticket being raised to the first technician being sent, by priority. */
async function firstResponse(scope, { blockId, days = 30 } = {}) {
    const { rows } = await db.query(
        `SELECT c.priority, COUNT(*)::int AS tickets,
                ROUND(AVG(g.h)::numeric, 1)::float AS avg_hours,
                ROUND((percentile_cont(0.5) WITHIN GROUP (ORDER BY g.h))::numeric, 1)::float AS median_hours,
                ROUND((percentile_cont(0.9) WITHIN GROUP (ORDER BY g.h))::numeric, 1)::float AS p90_hours
         FROM complaints c
         JOIN LATERAL (
             SELECT EXTRACT(EPOCH FROM (MIN(a.assigned_at) - c.created_at)) / 3600 AS raw_h
             FROM complaint_assignments a WHERE a.complaint_id = c.complaint_id
         ) f ON f.raw_h IS NOT NULL
         CROSS JOIN LATERAL (SELECT GREATEST(f.raw_h, 0) AS h) g
         WHERE ${SINCE} AND ${NOT_COUNTED} AND ${IN_SCOPE}
         GROUP BY c.priority
         ORDER BY CASE c.priority WHEN 'EMERGENCY' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END`,
        [blocksFor(scope, blockId), daysOf(days)]
    );
    return rows;
}

/** Kinds of work residents sent back as not fixed, as a share of the work that got a verdict. */
async function reworkByCategory(scope, { blockId, days = 60 } = {}) {
    const { rows } = await db.query(
        `SELECT cat.category_name,
                COUNT(*)::int AS verdicts,
                COUNT(*) FILTER (WHERE NOT f.is_satisfactorily_resolved)::int AS sent_back,
                ROUND(100.0 * COUNT(*) FILTER (WHERE NOT f.is_satisfactorily_resolved) / COUNT(*), 1)::float AS sent_back_pct
         FROM complaint_feedback f
         JOIN complaints c ON c.complaint_id = f.complaint_id
         JOIN complaint_subcategories sub ON sub.subcategory_id = c.subcategory_id
         JOIN complaint_categories cat ON cat.category_id = sub.category_id
         WHERE f.verified_at >= CURRENT_TIMESTAMP - make_interval(days => $2) AND ${IN_SCOPE}
         GROUP BY cat.category_name
         ORDER BY sent_back_pct DESC, verdicts DESC, cat.category_name`,
        [blocksFor(scope, blockId), daysOf(days, 60)]
    );
    return rows;
}

/** Technicians whose leave starts in the next 14 days, and the open jobs they hold now. */
async function upcomingLeave(scope, { blockId } = {}) {
    const { rows } = await db.query(
        `SELECT u.full_name, u.specialization, u.home_block_id AS block_id, l.starts_on::text AS starts_on, l.ends_on::text AS ends_on,
                (SELECT COUNT(*)::int FROM complaint_assignments a WHERE a.staff_user_id = u.user_id AND a.current_state IN ('ASSIGNED', 'ACCEPTED', 'EN_ROUTE', 'IN_PROGRESS')) AS open_jobs
         FROM staff_leave l
         JOIN users u ON u.user_id = l.staff_user_id AND u.is_active
         WHERE l.starts_on > CURRENT_DATE AND l.starts_on <= CURRENT_DATE + 14
           AND ($1::varchar[] IS NULL OR u.home_block_id IS NULL OR u.home_block_id = ANY($1::varchar[]))
         ORDER BY l.starts_on, u.full_name LIMIT 50`,
        [blocksFor(scope, blockId)]
    );
    return rows;
}

/** Open tickets nobody has touched for three days or more. */
async function staleTickets(scope, { blockId } = {}) {
    const { rows } = await db.query(
        `SELECT c.complaint_id, c.block_id, c.status, c.priority, cat.category_name, sub.issue_name, COALESCE(r.room_number, ca.description) AS location,
                ROUND((EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - last_touch.at)) / 86400)::numeric, 1)::float AS days_quiet
         FROM complaints c
         JOIN complaint_subcategories sub ON sub.subcategory_id = c.subcategory_id
         JOIN complaint_categories cat ON cat.category_id = sub.category_id
         LEFT JOIN rooms r ON r.room_id = c.room_id
         LEFT JOIN common_areas ca ON ca.area_id = c.common_area_id
         CROSS JOIN LATERAL (
             SELECT GREATEST(c.created_at, COALESCE((SELECT MAX(l.timestamp) FROM complaint_logs l WHERE l.complaint_id = c.complaint_id), c.created_at)) AS at
         ) last_touch
         WHERE c.status IN ${LIVE} AND last_touch.at < CURRENT_TIMESTAMP - INTERVAL '3 days' AND ${IN_SCOPE}
         ORDER BY days_quiet DESC, ${URGENT_FIRST} LIMIT 25`,
        [blocksFor(scope, blockId)]
    );
    return rows;
}

module.exports = { peakHours, weekdayPattern, roomTypeFaults, topRooms, occupancy, slaByPriority, reassignments, firstResponse, reworkByCategory, upcomingLeave, staleTickets };
