const db = require('../config/db');
const { AppError, asyncHandler } = require('../middleware/errorHandler');

// required_specialization lets a dispatch UI pre-filter the staff picker.
const COMPLAINT_FROM = `
    FROM complaints c
    JOIN complaint_subcategories sub ON c.subcategory_id = sub.subcategory_id
    JOIN complaint_categories cat ON sub.category_id = cat.category_id
    JOIN users u ON c.raised_by_user_id = u.user_id
`;
const COMPLAINT_SELECT = `
    SELECT c.*, cat.category_name, sub.issue_name, sub.required_specialization, u.full_name as student_name,
           asg.staff_user_id AS assigned_staff_id, asg.full_name AS assigned_staff_name
    ${COMPLAINT_FROM}
    LEFT JOIN LATERAL (
        SELECT ca.staff_user_id, su.full_name
        FROM complaint_assignments ca
        JOIN users su ON su.user_id = ca.staff_user_id
        WHERE ca.complaint_id = c.complaint_id
          AND ca.current_state IN ('ASSIGNED', 'ACCEPTED', 'EN_ROUTE', 'IN_PROGRESS', 'DONE')
        ORDER BY ca.assigned_at DESC, ca.assignment_id DESC
        LIMIT 1
    ) asg ON TRUE
`;

// Priority policy. Every issue type has a default priority. Supervisors and
// administrators may set any priority; a student may raise it by at most one
// level (e.g. a sparking socket, HIGH, can be reported as an EMERGENCY) but
// cannot turn routine work such as room cleaning into an emergency to jump
// every technician's queue.
const PRIORITY_ORDER = ['LOW', 'MEDIUM', 'HIGH', 'EMERGENCY'];
const PRIORITY_LABEL = { LOW: 'Low', MEDIUM: 'Medium', HIGH: 'High', EMERGENCY: 'Emergency' };

function resolvePriority(requested, issueDefault, role) {
    if (!requested) return issueDefault;
    if (role !== 'STUDENT') return requested;
    const ceiling = Math.min(PRIORITY_ORDER.indexOf(issueDefault) + 1, PRIORITY_ORDER.length - 1);
    if (PRIORITY_ORDER.indexOf(requested) > ceiling) {
        throw new AppError(
            400,
            `For this issue the highest priority you can choose is ${PRIORITY_LABEL[PRIORITY_ORDER[ceiling]]}. A supervisor can raise it further if needed.`
        );
    }
    return requested;
}

/** Escapes LIKE wildcards in user-supplied search text. */
const likeEscape = (text) => text.replace(/[\\%_]/g, (ch) => `\\${ch}`);

// Without an explicit limit, the list is capped rather than unbounded, so one
// request can't pull the whole table. The real total is always in the
// X-Total-Count response header, so a client can tell when it hit the cap.
const DEFAULT_LIST_LIMIT = 500;

const CLOSED_STATUSES = ['COMPLETED', 'REJECTED'];

/**
 * Confirms the room/common-area named in the request belongs to the given
 * block, and - for a self-filing student - that it is the room they are
 * currently allotted to.
 */
async function assertValidLocation(client, { ticket_scope, room_id, common_area_id, block_id, userId, role }) {
    if (ticket_scope === 'ROOM') {
        const room = await client.query('SELECT block_id FROM rooms WHERE room_id = $1 AND is_active = TRUE', [room_id]);
        if (room.rows.length === 0) {
            throw new AppError(404, `Room ${room_id} was not found or is inactive.`);
        }
        if (room.rows[0].block_id !== block_id) {
            throw new AppError(400, `Room ${room_id} does not belong to block ${block_id}.`);
        }
        if (role === 'STUDENT') {
            const allotment = await client.query(
                'SELECT 1 FROM student_room_allotments WHERE student_id = $1 AND room_id = $2 AND is_current = TRUE',
                [userId, room_id]
            );
            if (allotment.rows.length === 0) {
                throw new AppError(403, 'You may only raise room tickets for the room you are currently allotted to.');
            }
        }
    } else {
        const area = await client.query('SELECT block_id FROM common_areas WHERE area_id = $1', [common_area_id]);
        if (area.rows.length === 0) {
            throw new AppError(404, `Common area ${common_area_id} was not found.`);
        }
        if (area.rows[0].block_id !== block_id) {
            throw new AppError(400, `Common area ${common_area_id} does not belong to block ${block_id}.`);
        }
    }
}

/** Visibility rule shared by the detail and audit-log endpoints. */
async function assertCanView(complaint, { role, userId }) {
    if (role === 'STUDENT' && complaint.raised_by_user_id !== userId) {
        throw new AppError(403, 'You may only view your own complaints.');
    }
    if (role === 'STAFF') {
        const assigned = await db.query(
            'SELECT 1 FROM complaint_assignments WHERE complaint_id = $1 AND staff_user_id = $2',
            [complaint.complaint_id, userId]
        );
        if (assigned.rows.length === 0) {
            throw new AppError(403, 'You may only view complaints assigned to you.');
        }
    }
}

// POST /api/complaints (STUDENT, SUPERVISOR, ADMIN)
exports.createComplaint = asyncHandler(async (req, res) => {
    const { ticket_scope, room_id, common_area_id, block_id, subcategory_id, description, photo_evidence_url, priority, preferred_timeslot } = req.body;
    const { userId, role } = req.user;
    const roomId = ticket_scope === 'ROOM' ? room_id : null;
    const areaId = ticket_scope === 'COMMON_AREA' ? common_area_id : null;

    const complaint = await db.withTransaction(async (client) => {
        // Serialize this user's ticket creation so two near-simultaneous
        // submits (a double-tap on a 1-click tile) can't both pass the
        // duplicate check below.
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`complaint-create:${userId}`]);

        await assertValidLocation(client, { ticket_scope, room_id, common_area_id, block_id, userId, role });

        const issue = await client.query('SELECT priority_level FROM complaint_subcategories WHERE subcategory_id = $1', [subcategory_id]);
        if (issue.rows.length === 0) {
            throw new AppError(400, 'Unknown issue type.');
        }
        const effectivePriority = resolvePriority(priority, issue.rows[0].priority_level, role);

        const duplicate = await client.query(
            `SELECT complaint_id, status FROM complaints
             WHERE raised_by_user_id = $1 AND subcategory_id = $2
               AND room_id IS NOT DISTINCT FROM $3 AND common_area_id IS NOT DISTINCT FROM $4
               AND status <> ALL($5)
             LIMIT 1`,
            [userId, subcategory_id, roomId, areaId, CLOSED_STATUSES]
        );
        if (duplicate.rows.length > 0) {
            const d = duplicate.rows[0];
            throw new AppError(
                409,
                `You already have an open ticket for this issue at this location (${d.complaint_id}, ${d.status}).`
            );
        }

        const inserted = await client.query(
            `INSERT INTO complaints (
                ticket_scope, room_id, common_area_id, block_id, raised_by_user_id,
                subcategory_id, description, photo_evidence_url, priority, preferred_timeslot
             )
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             RETURNING *`,
            [
                ticket_scope,
                roomId,
                areaId,
                block_id,
                userId,
                subcategory_id,
                description || null,
                photo_evidence_url || null,
                effectivePriority,
                preferred_timeslot || null,
            ]
        );
        const created = inserted.rows[0];

        // The status-change trigger only fires on UPDATE, so record creation
        // explicitly - otherwise the audit trail starts at the first dispatch.
        await client.query(
            `INSERT INTO complaint_logs (complaint_id, changed_by_user_id, previous_status, new_status, action_note)
             VALUES ($1, $2, NULL, 'OPEN', 'Complaint raised')`,
            [created.complaint_id, userId]
        );
        return created;
    }, userId);

    res.status(201).json({ message: 'Complaint registered', complaint });
});

// GET /api/complaints - role-scoped list.
//   STUDENT: own tickets.  STAFF: tickets they have (or had) an assignment on.
//   SUPERVISOR / ADMIN: all tickets.
exports.getComplaints = asyncHandler(async (req, res) => {
    const { role, userId } = req.user;
    const { status, block_id, q } = req.query;
    const limit = req.query.limit || DEFAULT_LIST_LIMIT;
    const offset = req.query.offset || 0;

    const where = ['1=1'];
    const params = [];

    if (role === 'STUDENT') {
        params.push(userId);
        where.push(`c.raised_by_user_id = $${params.length}`);
    } else if (role === 'STAFF') {
        params.push(userId);
        where.push(`EXISTS (
            SELECT 1 FROM complaint_assignments ca
            WHERE ca.complaint_id = c.complaint_id AND ca.staff_user_id = $${params.length}
        )`);
    }
    if (status) {
        params.push(status);
        where.push(`c.status = $${params.length}`);
    }
    if (block_id) {
        params.push(block_id);
        where.push(`c.block_id = $${params.length}`);
    }
    if (q && q.trim()) {
        // Free-text search over the issue, the person who raised it, the
        // location and the ticket id - including the short "TKT-xxxxxx"
        // reference the UI shows, which is the end of the id.
        const text = q.trim();
        const ref = text.replace(/^TKT-?/i, '').replace(/[^a-zA-Z0-9]/g, '');
        params.push(`%${likeEscape(text)}%`);
        const p = `$${params.length}`;
        const parts = [
            `sub.issue_name ILIKE ${p}`,
            `u.full_name ILIKE ${p}`,
            `c.room_id ILIKE ${p}`,
            `c.common_area_id ILIKE ${p}`,
            `c.complaint_id ILIKE ${p}`,
            `cat.category_name ILIKE ${p}`,
        ];
        if (ref) {
            params.push(`%${likeEscape(ref)}`);
            parts.push(`regexp_replace(c.complaint_id, '[^a-zA-Z0-9]', '', 'g') ILIKE $${params.length}`);
        }
        where.push(`(${parts.join(' OR ')})`);
    }

    const whereSql = where.join(' AND ');
    const [{ rows: countRows }, { rows }] = await Promise.all([
        db.query(`SELECT COUNT(*)::int AS total ${COMPLAINT_FROM} WHERE ${whereSql}`, params),
        db.query(
            `${COMPLAINT_SELECT} WHERE ${whereSql}
             ORDER BY c.created_at DESC, c.complaint_id
             LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
            [...params, limit, offset]
        ),
    ]);

    res.set('X-Total-Count', String(countRows[0].total));
    res.json(rows);
});

// GET /api/complaints/:id
exports.getComplaintById = asyncHandler(async (req, res) => {
    const result = await db.query(`${COMPLAINT_SELECT} WHERE c.complaint_id = $1`, [req.params.id]);
    if (result.rows.length === 0) {
        throw new AppError(404, 'Complaint not found.');
    }
    const complaint = result.rows[0];
    await assertCanView(complaint, req.user);
    res.json(complaint);
});

// GET /api/complaints/:id/logs - audit trail, same visibility as the detail view.
exports.getComplaintLogs = asyncHandler(async (req, res) => {
    const found = await db.query('SELECT complaint_id, raised_by_user_id FROM complaints WHERE complaint_id = $1', [req.params.id]);
    if (found.rows.length === 0) {
        throw new AppError(404, 'Complaint not found.');
    }
    await assertCanView(found.rows[0], req.user);

    const logs = await db.query(
        `SELECT cl.log_id, cl.previous_status, cl.new_status, cl.action_note, cl.timestamp, u.full_name AS changed_by_name
         FROM complaint_logs cl
         LEFT JOIN users u ON cl.changed_by_user_id = u.user_id
         WHERE cl.complaint_id = $1
         ORDER BY cl.timestamp ASC, cl.log_id ASC`,
        [req.params.id]
    );
    res.json(logs.rows);
});
