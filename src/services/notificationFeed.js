const db = require('../config/db');
const { slaDueSql, slaStatusSql } = require('./slaService');
const { managedBlocks } = require('./scopeService');

// In-app notifications derived from data the database already keeps: the
// ticket history (complaint_logs), assignments, and SLA deadlines. No
// notification table exists and none may be added, so:
//   * the feed is recomputed on every request (window: FEED_DAYS);
//   * "unread" is a timestamp the browser remembers (`since`), so it is per
//     device, not synced - the API only counts items newer than `since`;
//   * nothing is sent outside the app; email / SMS would need a provider.
// The person who made a change is never told about their own action.

const FEED_DAYS = 14;

const LOCATION = `COALESCE(c.room_id, ca.description, c.common_area_id, c.block_id)`;
const TICKET_FROM = `
    JOIN complaints c ON c.complaint_id = cl.complaint_id
    JOIN complaint_subcategories sub ON sub.subcategory_id = c.subcategory_id
    LEFT JOIN common_areas ca ON ca.area_id = c.common_area_id`;
const ITEM = (kind, title, body = `sub.issue_name || ' · ' || ${LOCATION}`) => ({ kind, title, body });

/** Status-change history of tickets the SQL `scope` selects, mapped to messages for `audience`. */
function logEvents(audience, scope) {
    const rows = {
        STUDENT: [
            [`cl.new_status = 'ASSIGNED'`, ITEM('ticket.assigned', `'A technician will handle your request'`)],
            [`cl.new_status = 'IN_PROGRESS'`, ITEM('ticket.started', `'Work has started'`)],
            [
                `cl.new_status = 'PENDING_VERIFICATION'`,
                ITEM('ticket.done', `'Work done: please confirm the fix'`, `sub.issue_name || ' · ' || ${LOCATION} || '. Confirm it is fixed, or tell us if it is not.'`),
            ],
            [`cl.new_status = 'COMPLETED'`, ITEM('ticket.closed', `'Ticket closed'`)],
            [`cl.new_status = 'ESCALATED'`, ITEM('ticket.escalated', `'Sent back for re-inspection'`)],
            [
                `cl.new_status = 'REJECTED'`,
                ITEM('ticket.rejected', `CASE WHEN c.closure_reason = 'DUPLICATE' THEN 'Merged with an existing ticket' ELSE 'Closed without work' END`),
            ],
        ],
        STAFF: [
            [`cl.new_status = 'ESCALATED'`, ITEM('job.rejected', `'Your fix was not accepted'`)],
            [`cl.new_status = 'COMPLETED' AND c.closure_reason = 'CONFIRMED'`, ITEM('job.confirmed', `'A resident confirmed your work'`)],
        ],
        MANAGER: [
            [`cl.new_status = 'ESCALATED'`, ITEM('ticket.escalated', `'A resident says the fix did not work'`)],
            [
                `cl.previous_status IS NULL AND cl.new_status = 'OPEN' AND c.priority IN ('HIGH', 'EMERGENCY')`,
                ITEM('ticket.urgent', `CASE WHEN c.priority = 'EMERGENCY' THEN 'New emergency ticket' ELSE 'New high-priority ticket' END`),
            ],
        ],
    }[audience];
    return rows.map(
        ([condition, item]) => `
        SELECT 'log:' || cl.log_id AS id, ${item.kind ? `'${item.kind}'` : 'NULL'} AS kind, ${item.title} AS title,
               ${item.body} AS body, c.complaint_id, cl.timestamp AS created_at
        FROM complaint_logs cl ${TICKET_FROM}
        WHERE ${condition}
          AND cl.timestamp >= NOW() - make_interval(days => ${FEED_DAYS})
          AND cl.changed_by_user_id IS DISTINCT FROM $1
          AND ${scope}`
    );
}

// Managers' feeds are limited to their blocks: the block list is bound as $4
// in every query built from the feed (after user id and the two paging or
// `since` values), so one SQL text serves both the page and the count.
function feedQuery(role, studentCanSee, scoped) {
    if (role === 'STUDENT') {
        return logEvents('STUDENT', studentCanSee('$1')).join('\nUNION ALL\n');
    }
    if (role === 'STAFF') {
        const mine = `EXISTS (SELECT 1 FROM complaint_assignments x WHERE x.complaint_id = c.complaint_id AND x.staff_user_id = $1)`;
        const assigned = `
        SELECT 'asg:' || a.assignment_id AS id, 'job.assigned' AS kind,
               CASE WHEN c.priority = 'EMERGENCY' THEN 'New emergency job' ELSE 'New job assigned to you' END AS title,
               sub.issue_name || ' · ' || ${LOCATION} AS body, c.complaint_id, a.assigned_at AS created_at
        FROM complaint_assignments a
        JOIN complaints c ON c.complaint_id = a.complaint_id
        JOIN complaint_subcategories sub ON sub.subcategory_id = c.subcategory_id
        LEFT JOIN common_areas ca ON ca.area_id = c.common_area_id
        WHERE a.staff_user_id = $1
          AND a.assigned_at >= NOW() - make_interval(days => ${FEED_DAYS})
          AND a.assigned_by_user_id IS DISTINCT FROM $1`;
        return [assigned, ...logEvents('STAFF', mine)].join('\nUNION ALL\n');
    }
    // SUPERVISOR / CHIEF_WARDEN / ADMIN
    const blockFilter = scoped ? 'c.block_id = ANY($4::varchar[])' : 'TRUE';
    const overdue = `
        SELECT 'sla:' || c.complaint_id AS id, 'ticket.overdue' AS kind, 'Ticket past its deadline' AS title,
               sub.issue_name || ' · ' || ${LOCATION} AS body, c.complaint_id, ${slaDueSql()} AS created_at
        FROM complaints c
        JOIN complaint_subcategories sub ON sub.subcategory_id = c.subcategory_id
        JOIN complaint_categories cat ON cat.category_id = sub.category_id
        LEFT JOIN common_areas ca ON ca.area_id = c.common_area_id
        WHERE ${slaStatusSql()} = 'OVERDUE'
          AND ${blockFilter}
          AND ${slaDueSql()} >= NOW() - make_interval(days => ${FEED_DAYS})`;
    return [...logEvents('MANAGER', blockFilter), overdue].join('\nUNION ALL\n');
}

/**
 * @param {{ userId: string, role: string }} user
 * @param {{ limit: number, offset: number, since?: Date|null }} opts
 * @param {(viewer: string) => string} studentCanSee  visibility predicate from the ticket controller
 */
async function getFeed(user, { limit, offset, since }, studentCanSee) {
    const isManager = !['STUDENT', 'STAFF'].includes(user.role);
    const scope = isManager ? await managedBlocks(user) : null;
    const inner = feedQuery(user.role, studentCanSee, scope !== null);
    const blocks = scope !== null ? [scope] : [];
    const [items, unread] = await Promise.all([
        db.query(`SELECT * FROM (${inner}) f ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3`, [user.userId, limit, offset, ...blocks]),
        // $3 is unused here but bound, so the block list stays at $4.
        db.query(`SELECT COUNT(*)::int AS n FROM (${inner}) f WHERE ($2::timestamptz IS NULL OR created_at > $2) AND $3::int IS NULL`, [
            user.userId,
            since,
            null,
            ...blocks,
        ]),
    ]);
    return { items: items.rows, unread: unread.rows[0].n };
}

module.exports = { getFeed, FEED_DAYS };
