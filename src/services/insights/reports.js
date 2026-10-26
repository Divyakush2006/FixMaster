const db = require('../../config/db');
const { slaStatusSql, slaDueSql } = require('../slaService');

// The reports "Ask FixMaster" and the briefing can draw on. This is a closed
// list: a question is only ever answered by running one of these, with
// parameters checked here, inside the asker's block scope. Nothing a person or
// a model writes is ever turned into SQL.
//
// `scope` is null for every block, or the list of block ids the manager runs
// (scopeService.managedBlocks). `blockId`, when given, narrows within it.

const OPEN = `('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'PENDING_VERIFICATION', 'ESCALATED')`;

const clamp = (n, lo, hi, fallback) => {
    const v = Number.parseInt(n, 10);
    return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
};

/** The block ids a report covers: the scope, narrowed to `blockId` when that is inside it. */
function blocksFor(scope, blockId) {
    if (blockId) return scope === null || scope.includes(blockId) ? [blockId] : [];
    return scope;
}

/** Open tickets, overdue and at-risk counts, emergencies and last-30-day rating per block. */
async function overview(scope, { blockId } = {}) {
    const blocks = blocksFor(scope, blockId);
    const { rows } = await db.query(
        `SELECT b.block_id, b.block_name,
                COUNT(c.complaint_id) FILTER (WHERE c.status IN ${OPEN})::int AS open_tickets,
                COUNT(c.complaint_id) FILTER (WHERE c.status IN ('OPEN') AND NOT EXISTS (
                    SELECT 1 FROM complaint_assignments a WHERE a.complaint_id = c.complaint_id AND a.current_state <> 'DECLINED'))::int AS unassigned,
                COUNT(c.complaint_id) FILTER (WHERE c.status IN ${OPEN} AND ${slaStatusSql()} = 'OVERDUE')::int AS overdue,
                COUNT(c.complaint_id) FILTER (WHERE c.status IN ${OPEN} AND ${slaStatusSql()} = 'AT_RISK')::int AS at_risk,
                COUNT(c.complaint_id) FILTER (WHERE c.status IN ${OPEN} AND c.priority = 'EMERGENCY')::int AS emergencies,
                COUNT(c.complaint_id) FILTER (WHERE c.created_at >= CURRENT_TIMESTAMP - INTERVAL '1 day')::int AS raised_24h,
                ROUND(AVG(fb.rating) FILTER (WHERE fb.verified_at >= CURRENT_TIMESTAMP - INTERVAL '30 days'), 2)::float AS avg_rating_30d
         FROM hostel_blocks b
         LEFT JOIN complaints c ON c.block_id = b.block_id AND c.status <> 'CANCELLED' AND c.closure_reason IS DISTINCT FROM 'DUPLICATE'
         LEFT JOIN complaint_subcategories sub ON sub.subcategory_id = c.subcategory_id
         LEFT JOIN complaint_categories cat ON cat.category_id = sub.category_id
         LEFT JOIN complaint_feedback fb ON fb.complaint_id = c.complaint_id AND fb.is_satisfactorily_resolved = TRUE AND fb.rating IS NOT NULL
         WHERE $1::varchar[] IS NULL OR b.block_id = ANY($1::varchar[])
         GROUP BY b.block_id, b.block_name
         ORDER BY b.block_id`,
        [blocks]
    );
    const total = (key) => rows.reduce((s, r) => s + r[key], 0);
    return {
        totals: {
            blocks: rows.length,
            open_tickets: total('open_tickets'),
            unassigned: total('unassigned'),
            overdue: total('overdue'),
            at_risk: total('at_risk'),
            emergencies: total('emergencies'),
            raised_24h: total('raised_24h'),
        },
        blocks: rows,
    };
}

/** Open tickets that are overdue or in the last quarter of their window, worst first. */
async function breachRisk(scope, { blockId, limit = 25 } = {}) {
    const { rows } = await db.query(
        `SELECT * FROM (
             SELECT c.complaint_id, c.block_id, c.priority, c.status, cat.category_name, sub.issue_name,
                    COALESCE(r.room_number, ca.description) AS location, ${slaStatusSql()} AS sla_status,
                    ${slaDueSql()} AS due_at,
                    ROUND((EXTRACT(EPOCH FROM (${slaDueSql()} - CURRENT_TIMESTAMP)) / 3600)::numeric, 1)::float AS hours_left,
                    u.full_name AS assigned_to
             FROM complaints c
             JOIN complaint_subcategories sub ON sub.subcategory_id = c.subcategory_id
             JOIN complaint_categories cat ON cat.category_id = sub.category_id
             LEFT JOIN rooms r ON r.room_id = c.room_id
             LEFT JOIN common_areas ca ON ca.area_id = c.common_area_id
             LEFT JOIN LATERAL (
                 SELECT staff_user_id FROM complaint_assignments a
                 WHERE a.complaint_id = c.complaint_id AND a.current_state <> 'DECLINED' ORDER BY a.assigned_at DESC LIMIT 1
             ) la ON TRUE
             LEFT JOIN users u ON u.user_id = la.staff_user_id
             WHERE c.status IN ${OPEN} AND ($1::varchar[] IS NULL OR c.block_id = ANY($1::varchar[]))
         ) t
         WHERE sla_status IN ('OVERDUE', 'AT_RISK')
         ORDER BY CASE priority WHEN 'EMERGENCY' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END, hours_left
         LIMIT $2`,
        [blocksFor(scope, blockId), clamp(limit, 1, 100, 25)]
    );
    return rows;
}

/** Places that keep breaking: the same place and kind of fault, `min` or more times in `days`. */
async function recurringFaults(scope, { blockId, days = 30, min = 3 } = {}) {
    const { rows } = await db.query(
        `SELECT c.block_id, c.ticket_scope, COALESCE(r.room_number, ca.description) AS location, cat.category_name,
                COUNT(*)::int AS incidents, MAX(c.created_at) AS most_recent
         FROM complaints c
         JOIN complaint_subcategories sub ON sub.subcategory_id = c.subcategory_id
         JOIN complaint_categories cat ON cat.category_id = sub.category_id
         LEFT JOIN rooms r ON r.room_id = c.room_id
         LEFT JOIN common_areas ca ON ca.area_id = c.common_area_id
         WHERE c.created_at >= CURRENT_TIMESTAMP - make_interval(days => $2)
           AND c.status NOT IN ('CANCELLED', 'REJECTED') AND c.closure_reason IS DISTINCT FROM 'DUPLICATE'
           AND ($1::varchar[] IS NULL OR c.block_id = ANY($1::varchar[]))
         GROUP BY c.block_id, c.ticket_scope, COALESCE(r.room_number, ca.description), cat.category_name
         HAVING COUNT(*) >= $3
         ORDER BY incidents DESC, most_recent DESC
         LIMIT 25`,
        [blocksFor(scope, blockId), clamp(days, 1, 90, 30), clamp(min, 2, 20, 3)]
    );
    return rows;
}

/** What kinds of problems were raised in the last `days`. */
async function categoryMix(scope, { blockId, days = 30 } = {}) {
    const { rows } = await db.query(
        `SELECT cat.category_name, COUNT(*)::int AS tickets,
                COUNT(*) FILTER (WHERE c.priority IN ('HIGH', 'EMERGENCY'))::int AS urgent
         FROM complaints c
         JOIN complaint_subcategories sub ON sub.subcategory_id = c.subcategory_id
         JOIN complaint_categories cat ON cat.category_id = sub.category_id
         WHERE c.created_at >= CURRENT_TIMESTAMP - make_interval(days => $2)
           AND c.status <> 'CANCELLED' AND c.closure_reason IS DISTINCT FROM 'DUPLICATE'
           AND ($1::varchar[] IS NULL OR c.block_id = ANY($1::varchar[]))
         GROUP BY cat.category_name
         ORDER BY tickets DESC`,
        [blocksFor(scope, blockId), clamp(days, 1, 90, 30)]
    );
    return rows;
}

/** Tickets nobody has been sent to, oldest first. */
async function unassigned(scope, { blockId } = {}) {
    const { rows } = await db.query(
        `SELECT c.complaint_id, c.block_id, c.priority, cat.category_name, sub.issue_name,
                COALESCE(r.room_number, ca.description) AS location,
                ROUND((EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - c.created_at)) / 3600)::numeric, 1)::float AS hours_waiting
         FROM complaints c
         JOIN complaint_subcategories sub ON sub.subcategory_id = c.subcategory_id
         JOIN complaint_categories cat ON cat.category_id = sub.category_id
         LEFT JOIN rooms r ON r.room_id = c.room_id
         LEFT JOIN common_areas ca ON ca.area_id = c.common_area_id
         WHERE c.status = 'OPEN' AND ($1::varchar[] IS NULL OR c.block_id = ANY($1::varchar[]))
           AND NOT EXISTS (SELECT 1 FROM complaint_assignments a WHERE a.complaint_id = c.complaint_id AND a.current_state <> 'DECLINED')
         ORDER BY CASE c.priority WHEN 'EMERGENCY' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END, c.created_at
         LIMIT 25`,
        [blocksFor(scope, blockId)]
    );
    return rows;
}

module.exports = { overview, breachRisk, recurringFaults, categoryMix, unassigned, blocksFor };
