const db = require('../config/db');
const { AppError, asyncHandler } = require('../middleware/errorHandler');
const { recordAudit } = require('../services/auditService');
const { slaDueSql, slaStatusSql } = require('../services/slaService');
const { photoUrl, sanitizeImage, savePhoto, removePhoto, findPhoto, sendPhoto } = require('../services/attachmentService');
const { managedBlocks, scopeCondition, inScope, assertTicketInScope } = require('../services/scopeService');
const { MANAGER_ROLES } = require('../config/roles');
const { autoDispatchIfEnabled } = require('../services/autopilot');

// Ticket model (migrations 007-008): the ROOM or COMMON AREA is the unit of a
// ticket, not the person. There is at most one live ticket per location and
// issue type; everyone who reports it is recorded in complaint_reporters.
//   * Students see every ticket they reported, plus their current room's
//     tickets (live ones, and closed ones raised since they moved in).
//   * A room ticket is confirmed by any current resident; a common-area
//     ticket by anyone who reported it.

const LIVE_STATUSES = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'PENDING_VERIFICATION', 'ESCALATED'];

// required_specialization lets a dispatch UI pre-filter the staff picker.
const COMPLAINT_FROM = `
    FROM complaints c
    JOIN complaint_subcategories sub ON c.subcategory_id = sub.subcategory_id
    JOIN complaint_categories cat ON sub.category_id = cat.category_id
    JOIN users u ON c.raised_by_user_id = u.user_id
`;

/**
 * SELECT list for ticket rows. `viewer` is the placeholder (e.g. "$3") bound
 * to the requesting user's id; it drives the per-viewer flags.
 */
const complaintSelect = (viewer) => `
    SELECT c.*, cat.category_name, sub.issue_name, sub.required_specialization, u.full_name as student_name,
           cat.default_sla_hours,
           ${slaDueSql()} AS sla_due_at,
           ${slaStatusSql()} AS sla_status,
           asg.staff_user_id AS assigned_staff_id, asg.full_name AS assigned_staff_name,
           (SELECT COUNT(*)::int FROM complaint_reporters cr WHERE cr.complaint_id = c.complaint_id) AS reporter_count,
           EXISTS (
               SELECT 1 FROM complaint_reporters cr
               WHERE cr.complaint_id = c.complaint_id AND cr.user_id = ${viewer}
           ) AS is_reporter,
           (c.ticket_scope = 'ROOM' AND EXISTS (
               SELECT 1 FROM student_room_allotments a
               WHERE a.room_id = c.room_id AND a.student_id = ${viewer} AND a.is_current = TRUE
           )) AS is_room_resident
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

/**
 * Student visibility, as a WHERE fragment over alias `c`: tickets they
 * reported, plus their current room's tickets that are live or were raised
 * after they moved in (a new resident doesn't read the previous occupant's
 * closed history).
 */
// Written as one uncorrelated set (the student's own tickets, then their
// room's) rather than a test per ticket, so the work depends on how many
// tickets the student can see, not on how many exist on the campus.
const studentCanSee = (student) => `c.complaint_id IN (
    SELECT cr.complaint_id FROM complaint_reporters cr WHERE cr.user_id = ${student}
    UNION
    SELECT rc.complaint_id
    FROM student_room_allotments a
    JOIN complaints rc ON rc.room_id = a.room_id AND rc.ticket_scope = 'ROOM'
    WHERE a.student_id = ${student} AND a.is_current = TRUE
      AND (rc.status IN ('${LIVE_STATUSES.join("', '")}') OR rc.created_at >= a.assigned_date)
)`;

// Shared with the notification feed so both apply the same residency rule.
exports.studentCanSee = studentCanSee;

/** Adds the viewer-specific action flags the UI needs. */
function withViewerFlags(row, { role }) {
    const isStudent = role === 'STUDENT';
    return {
        ...row,
        can_verify:
            isStudent &&
            row.status === 'PENDING_VERIFICATION' &&
            (row.ticket_scope === 'ROOM' ? row.is_room_resident : row.is_reporter),
        can_withdraw: isStudent && row.is_reporter && row.status === 'OPEN',
        can_attach_photo: isStudent && row.is_reporter && LIVE_STATUSES.includes(row.status),
    };
}

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

// When this many people have reported the same common-area fault, its
// priority goes up one level (never beyond HIGH: an emergency is a human call).
const positiveInt = (value, fallback) => {
    const n = parseInt(value, 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
};
const REPORTER_PRIORITY_BUMP_AT = positiveInt(process.env.COMMON_AREA_PRIORITY_BUMP_AT, 5);

/** Escapes LIKE wildcards in user-supplied search text. */
const likeEscape = (text) => text.replace(/[\\%_]/g, (ch) => `\\${ch}`);

/** The short reference the UI shows, e.g. TKT-000001. */
const ticketRef = (id) => `TKT-${String(id).replace(/[^a-zA-Z0-9]/g, '').slice(-6).toUpperCase()}`;

// Without an explicit limit, the list is capped rather than unbounded, so one
// request can't pull the whole table. The real total is always in the
// X-Total-Count response header, so a client can tell when it hit the cap.
const DEFAULT_LIST_LIMIT = 500;

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

/** Visibility rule shared by the detail, logs and related endpoints. */
async function assertCanView(complaintId, user) {
    const { role, userId } = user;
    if (MANAGER_ROLES.includes(role)) {
        await assertTicketInScope(user, complaintId);
        return;
    }
    if (role === 'STUDENT') {
        const visible = await db.query(`SELECT 1 FROM complaints c WHERE c.complaint_id = $1 AND ${studentCanSee('$2')}`, [
            complaintId,
            userId,
        ]);
        if (visible.rows.length === 0) {
            throw new AppError(403, 'You may only view tickets you reported or tickets for the room you live in.');
        }
    }
    if (role === 'STAFF') {
        const assigned = await db.query(
            'SELECT 1 FROM complaint_assignments WHERE complaint_id = $1 AND staff_user_id = $2',
            [complaintId, userId]
        );
        if (assigned.rows.length === 0) {
            throw new AppError(403, 'You may only view complaints assigned to you.');
        }
    }
}

/** Loads a ticket row FOR UPDATE inside a transaction, or 404s. */
async function lockComplaint(client, complaintId) {
    const result = await client.query('SELECT * FROM complaints WHERE complaint_id = $1 FOR UPDATE', [complaintId]);
    if (result.rows.length === 0) {
        throw new AppError(404, 'Complaint not found.');
    }
    return result.rows[0];
}

/**
 * The status-change trigger writes a generic "Transition: A -> B" entry.
 * Replace it with a note that says why, attributed to the acting user.
 */
async function annotateLastTransition(client, complaintId, fromStatus, toStatus, note) {
    await client.query(
        `UPDATE complaint_logs SET action_note = $4
         WHERE log_id = (
             SELECT log_id FROM complaint_logs
             WHERE complaint_id = $1 AND previous_status = $2 AND new_status = $3
             ORDER BY log_id DESC LIMIT 1
         )`,
        [complaintId, fromStatus, toStatus, note]
    );
}

/** A history entry that doesn't change the status (e.g. "also reported by"). */
async function addNote(client, complaintId, status, userId, note) {
    await client.query(
        `INSERT INTO complaint_logs (complaint_id, changed_by_user_id, previous_status, new_status, action_note)
         VALUES ($1, $2, $3, $3, $4)`,
        [complaintId, userId, status, note]
    );
}

async function nameOf(client, userId) {
    const r = await client.query('SELECT full_name FROM users WHERE user_id = $1', [userId]);
    return r.rows[0] ? r.rows[0].full_name : 'Someone';
}

const isLiveDuplicateViolation = (err) =>
    err && err.code === '23505' && typeof err.constraint === 'string' && err.constraint.startsWith('uq_live_');

// POST /api/complaints (STUDENT, SUPERVISOR, ADMIN)
//
// 201 { joined: false, complaint }  a new ticket was created
// 200 { joined: true,  complaint }  this issue was already open at this
//                                   location; the caller was added as a reporter
exports.createComplaint = asyncHandler(async (req, res) => {
    const { ticket_scope, room_id, common_area_id, block_id, subcategory_id, description, photo_evidence_url, priority, preferred_timeslot } = req.body;
    const { userId, role } = req.user;
    const roomId = ticket_scope === 'ROOM' ? room_id : null;
    const areaId = ticket_scope === 'COMMON_AREA' ? common_area_id : null;

    let outcome;
    try {
        outcome = await db.withTransaction(async (client) => {
            // Serialize everything that files this issue at this location: two
            // roommates submitting at the same instant (or one double-tap)
            // queue here, so exactly one ticket is created and the second
            // request joins it. The partial unique indexes from migration 007
            // are the backstop if anything bypasses this path.
            const locationKey = roomId ? `room:${roomId}` : `area:${areaId}`;
            await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`complaint-location:${locationKey}:${subcategory_id}`]);

            await assertValidLocation(client, { ticket_scope, room_id, common_area_id, block_id, userId, role });
            if (MANAGER_ROLES.includes(role) && !inScope(await managedBlocks(req.user, client), block_id)) {
                throw new AppError(403, 'You can only raise tickets in the blocks you manage.', { code: 'OUT_OF_SCOPE' });
            }

            const issue = await client.query('SELECT priority_level, issue_name FROM complaint_subcategories WHERE subcategory_id = $1', [
                subcategory_id,
            ]);
            if (issue.rows.length === 0) {
                throw new AppError(400, 'Unknown issue type.');
            }
            const effectivePriority = resolvePriority(priority, issue.rows[0].priority_level, role);

            const existing = await client.query(
                `SELECT * FROM complaints
                 WHERE subcategory_id = $1
                   AND room_id IS NOT DISTINCT FROM $2 AND common_area_id IS NOT DISTINCT FROM $3
                   AND status = ANY($4)
                 FOR UPDATE`,
                [subcategory_id, roomId, areaId, LIVE_STATUSES]
            );

            if (existing.rows.length > 0) {
                // Quote the joiner's description in the history only when they
                // wrote it; the 1-click tiles send a generated one.
                const typed = description && description.trim() !== `1-Click Quick Action: ${issue.rows[0].issue_name}` ? description : null;
                return joinExistingTicket(client, existing.rows[0], { userId, description: typed, ticket_scope });
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
            return { joined: false, complaint: created };
        }, userId);
    } catch (err) {
        if (isLiveDuplicateViolation(err)) {
            throw new AppError(409, 'This issue was reported at this location a moment ago. Refresh to see the ticket.', {
                code: 'DUPLICATE_LIVE_TICKET',
            });
        }
        throw err;
    }

    if (outcome.joined) {
        return res.status(200).json({
            joined: true,
            message:
                ticket_scope === 'ROOM'
                    ? 'This was already requested for your room. You have been added to the existing ticket.'
                    : 'This was already reported. You have been added to the existing ticket.',
            complaint: outcome.complaint,
        });
    }
    // Blocks and trades on AUTO are dispatched straight away, after the ticket
    // is committed (never inside its transaction). The answer reports it.
    const dispatched = await autoDispatchIfEnabled(outcome.complaint.complaint_id);
    const complaint = dispatched && dispatched.assigned ? { ...outcome.complaint, status: 'ASSIGNED', assigned_staff_name: dispatched.staff_name } : outcome.complaint;
    res.status(201).json({ joined: false, message: 'Complaint registered', complaint, autopilot: dispatched });
});

/** Adds the caller as a reporter of an existing live ticket (inside the create transaction). */
async function joinExistingTicket(client, ticket, { userId, description, ticket_scope }) {
    const mine = await client.query('SELECT 1 FROM complaint_reporters WHERE complaint_id = $1 AND user_id = $2', [
        ticket.complaint_id,
        userId,
    ]);
    if (mine.rows.length > 0) {
        throw new AppError(409, `You have already reported this issue. It is being tracked as ${ticketRef(ticket.complaint_id)}.`, {
            code: 'ALREADY_REPORTED',
            details: { complaint_id: ticket.complaint_id },
        });
    }

    await client.query('INSERT INTO complaint_reporters (complaint_id, user_id, is_original) VALUES ($1, $2, FALSE)', [
        ticket.complaint_id,
        userId,
    ]);
    // The history entry is attributed to the reporter, so the note itself
    // carries only what they added.
    const typed = description && description.trim() ? `: "${description.trim().slice(0, 200)}"` : '';
    await addNote(client, ticket.complaint_id, ticket.status, userId, `Also reported${typed}`);

    let complaint = ticket;
    if (ticket_scope === 'COMMON_AREA') {
        const count = await client.query('SELECT COUNT(*)::int AS n FROM complaint_reporters WHERE complaint_id = $1', [ticket.complaint_id]);
        const level = PRIORITY_ORDER.indexOf(ticket.priority);
        if (count.rows[0].n === REPORTER_PRIORITY_BUMP_AT && level >= 0 && level < PRIORITY_ORDER.indexOf('HIGH')) {
            const raised = PRIORITY_ORDER[level + 1];
            const updated = await client.query('UPDATE complaints SET priority = $2 WHERE complaint_id = $1 RETURNING *', [
                ticket.complaint_id,
                raised,
            ]);
            complaint = updated.rows[0];
            await addNote(
                client,
                ticket.complaint_id,
                ticket.status,
                null,
                `Priority raised to ${PRIORITY_LABEL[raised]}: ${REPORTER_PRIORITY_BUMP_AT} people have reported this issue`
            );
        }
    }
    return { joined: true, complaint };
}

// GET /api/complaints - role-scoped list. Filters: status, block_id, q, sla
// (ON_TRACK | AT_RISK | OVERDUE | MET | BREACHED).
//   STUDENT: tickets they reported + their current room's tickets.
//   STAFF: tickets they have (or had) an assignment on.
//   SUPERVISOR / ADMIN: all tickets.
exports.getComplaints = asyncHandler(async (req, res) => {
    const { role, userId } = req.user;
    const { status, block_id, q, sla } = req.query;
    const limit = req.query.limit || DEFAULT_LIST_LIMIT;
    const offset = req.query.offset || 0;

    const where = ['1=1'];
    const params = [];

    if (role === 'STUDENT') {
        params.push(userId);
        where.push(studentCanSee(`$${params.length}`));
    } else if (MANAGER_ROLES.includes(role)) {
        const scoped = scopeCondition(await managedBlocks(req.user), 'c.block_id', params);
        if (scoped) where.push(scoped);
    } else if (role === 'STAFF') {
        params.push(userId);
        where.push(`EXISTS (
            SELECT 1 FROM complaint_assignments ca
            WHERE ca.complaint_id = c.complaint_id AND ca.staff_user_id = $${params.length}
        )`);
    }
    if (sla) {
        params.push(sla);
        where.push(`${slaStatusSql()} = $${params.length}`);
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
    const n = params.length;
    const [{ rows: countRows }, { rows }] = await Promise.all([
        db.query(`SELECT COUNT(*)::int AS total ${COMPLAINT_FROM} WHERE ${whereSql}`, params),
        db.query(
            `${complaintSelect(`$${n + 1}`)} WHERE ${whereSql}
             ORDER BY c.created_at DESC, c.complaint_id
             LIMIT $${n + 2} OFFSET $${n + 3}`,
            [...params, userId, limit, offset]
        ),
    ]);

    res.set('X-Total-Count', String(countRows[0].total));
    res.json(rows.map((row) => withViewerFlags(row, req.user)));
});

// GET /api/complaints/:id
// Adds `reporters`: names for supervisors/admins and for a room's residents
// (roommates know each other); for a common-area ticket a student only sees
// how many people reported it.
exports.getComplaintById = asyncHandler(async (req, res) => {
    const { role, userId } = req.user;
    const result = await db.query(`${complaintSelect('$2')} WHERE c.complaint_id = $1`, [req.params.id, userId]);
    if (result.rows.length === 0) {
        throw new AppError(404, 'Complaint not found.');
    }
    await assertCanView(req.params.id, req.user);
    const complaint = withViewerFlags(result.rows[0], req.user);

    const showNames = MANAGER_ROLES.includes(role) || (role === 'STUDENT' && complaint.ticket_scope === 'ROOM');
    if (showNames) {
        const reporters = await db.query(
            `SELECT cr.user_id, u.full_name, cr.is_original, cr.reported_at
             FROM complaint_reporters cr JOIN users u ON u.user_id = cr.user_id
             WHERE cr.complaint_id = $1
             ORDER BY cr.reported_at, cr.user_id`,
            [req.params.id]
        );
        complaint.reporters = reporters.rows.map((r) => ({
            name: r.full_name,
            is_original: r.is_original,
            reported_at: r.reported_at,
            is_you: r.user_id === userId,
        }));
    }
    if (complaint.merged_into_id) {
        complaint.merged_into_ref = ticketRef(complaint.merged_into_id);
    }
    res.json(complaint);
});

// ---- Photo attachment ------------------------------------------------------------
// Files live in UPLOAD_DIR (see attachmentService); the ticket's existing
// photo_evidence_url column points at GET /api/complaints/:id/photo.

/** Reporter-only, live-ticket-only guard shared by upload and removal. */
async function lockForPhotoChange(client, complaintId, userId) {
    const ticket = await lockComplaint(client, complaintId);
    const mine = await client.query('SELECT 1 FROM complaint_reporters WHERE complaint_id = $1 AND user_id = $2', [ticket.complaint_id, userId]);
    if (mine.rows.length === 0) {
        throw new AppError(403, 'Only people who reported this issue can change its photo.');
    }
    if (!LIVE_STATUSES.includes(ticket.status)) {
        throw new AppError(409, 'This ticket is closed, so its photo can no longer be changed.');
    }
    return ticket;
}

// PUT /api/complaints/:id/photo (STUDENT) - body is the image itself
// (Content-Type image/jpeg or image/png, at most 5 MB). Replaces any earlier photo.
exports.uploadPhoto = asyncHandler(async (req, res) => {
    const image = sanitizeImage(req.body, req.headers['content-type']);
    if (!image) {
        throw new AppError(415, 'Send a JPEG or PNG photo (up to 5 MB) as the request body.');
    }
    const url = photoUrl(req.params.id);
    await db.withTransaction(async (client) => {
        await lockForPhotoChange(client, req.params.id, req.user.userId);
        await client.query('UPDATE complaints SET photo_evidence_url = $2 WHERE complaint_id = $1', [req.params.id, url]);
        // Inside the transaction: if the file cannot be written, nothing points at it.
        await savePhoto(req.params.id, image.buffer, image.ext);
    }, req.user.userId);
    res.json({ photo_evidence_url: url });
});

// DELETE /api/complaints/:id/photo (STUDENT)
exports.deletePhoto = asyncHandler(async (req, res) => {
    await db.withTransaction(async (client) => {
        await lockForPhotoChange(client, req.params.id, req.user.userId);
        await client.query('UPDATE complaints SET photo_evidence_url = NULL WHERE complaint_id = $1', [req.params.id]);
        await removePhoto(req.params.id);
    }, req.user.userId);
    res.status(204).end();
});

// GET /api/complaints/:id/photo - the stored photo, for anyone who may see the ticket.
exports.getPhoto = asyncHandler(async (req, res) => {
    const found = await db.query('SELECT 1 FROM complaints WHERE complaint_id = $1', [req.params.id]);
    if (found.rows.length === 0) {
        throw new AppError(404, 'Complaint not found.');
    }
    await assertCanView(req.params.id, req.user);
    const photo = await findPhoto(req.params.id);
    if (!photo) {
        throw new AppError(404, 'This ticket has no photo.');
    }
    // Never rendered as a page: fixed type, no sniffing, no scripts even if it somehow were.
    res.set({
        'Content-Type': photo.contentType,
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'Content-Disposition': `inline; filename="ticket-photo.${photo.ext}"`,
        'Cache-Control': 'private, max-age=300',
    });
    sendPhoto(res, photo);
});

// GET /api/complaints/:id/logs - audit trail, same visibility as the detail view.
exports.getComplaintLogs = asyncHandler(async (req, res) => {
    const found = await db.query('SELECT 1 FROM complaints WHERE complaint_id = $1', [req.params.id]);
    if (found.rows.length === 0) {
        throw new AppError(404, 'Complaint not found.');
    }
    await assertCanView(req.params.id, req.user);

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

// GET /api/complaints/:id/related (SUPERVISOR, ADMIN) - other live tickets at
// the same room or common area: the candidates for a merge.
exports.getRelatedComplaints = asyncHandler(async (req, res) => {
    await assertTicketInScope(req.user, req.params.id);
    const base = await db.query('SELECT room_id, common_area_id FROM complaints WHERE complaint_id = $1', [req.params.id]);
    if (base.rows.length === 0) {
        throw new AppError(404, 'Complaint not found.');
    }
    const { room_id, common_area_id } = base.rows[0];
    const result = await db.query(
        `${complaintSelect('$4')}
         WHERE c.complaint_id <> $1
           AND c.room_id IS NOT DISTINCT FROM $2 AND c.common_area_id IS NOT DISTINCT FROM $3
           AND c.status = ANY($5)
         ORDER BY c.created_at`,
        [req.params.id, room_id, common_area_id, req.user.userId, LIVE_STATUSES]
    );
    res.json(result.rows.map((row) => withViewerFlags(row, req.user)));
});

// POST /api/complaints/:id/withdraw (STUDENT)
// Allowed while the ticket is OPEN (nobody has been sent yet). If other people
// reported the same issue the ticket stays open for them and only the caller
// is removed; the last reporter withdrawing cancels it.
exports.withdrawComplaint = asyncHandler(async (req, res) => {
    const { userId } = req.user;
    const result = await db.withTransaction(async (client) => {
        const ticket = await lockComplaint(client, req.params.id);
        const mine = await client.query('SELECT 1 FROM complaint_reporters WHERE complaint_id = $1 AND user_id = $2', [
            ticket.complaint_id,
            userId,
        ]);
        if (mine.rows.length === 0) {
            throw new AppError(403, 'Only people who reported this issue can withdraw it.');
        }
        if (ticket.status !== 'OPEN') {
            throw new AppError(
                409,
                'This ticket can no longer be withdrawn because a technician has already been assigned. Ask your hostel supervisor if it is no longer needed.'
            );
        }
        const name = await nameOf(client, userId);
        const others = await client.query('SELECT COUNT(*)::int AS n FROM complaint_reporters WHERE complaint_id = $1 AND user_id <> $2', [
            ticket.complaint_id,
            userId,
        ]);
        if (others.rows[0].n > 0) {
            await client.query('DELETE FROM complaint_reporters WHERE complaint_id = $1 AND user_id = $2', [ticket.complaint_id, userId]);
            await addNote(client, ticket.complaint_id, ticket.status, userId, `${name} withdrew their report; the ticket stays open for the others who reported it`);
            return { cancelled: false, remaining_reporters: others.rows[0].n };
        }
        await client.query(
            `UPDATE complaints SET status = 'CANCELLED', closure_reason = 'WITHDRAWN', closure_note = $2 WHERE complaint_id = $1`,
            [ticket.complaint_id, `Withdrawn by ${name}`]
        );
        await annotateLastTransition(client, ticket.complaint_id, 'OPEN', 'CANCELLED', `Withdrawn by ${name}`);
        return { cancelled: true, remaining_reporters: 0 };
    }, userId);

    res.json({
        ...result,
        message: result.cancelled
            ? 'Ticket withdrawn.'
            : 'You have been removed from this ticket. It stays open for the others who reported it.',
    });
});

// POST /api/complaints/:id/reject (SUPERVISOR, ADMIN) { reason }
// Closes a ticket that is not valid work (spam, not a maintenance issue, ...).
// Any live assignment is withdrawn from the technician's queue.
exports.rejectComplaint = asyncHandler(async (req, res) => {
    const { userId } = req.user;
    const reason = req.body.reason.trim();
    await assertTicketInScope(req.user, req.params.id);
    await db.withTransaction(async (client) => {
        const ticket = await lockComplaint(client, req.params.id);
        if (!['OPEN', 'ESCALATED', 'ASSIGNED', 'IN_PROGRESS'].includes(ticket.status)) {
            throw new AppError(409, `This ticket is ${ticket.status} and cannot be rejected.`);
        }
        await client.query(
            `UPDATE complaint_assignments SET current_state = 'DECLINED'
             WHERE complaint_id = $1 AND current_state IN ('ASSIGNED', 'ACCEPTED', 'EN_ROUTE', 'IN_PROGRESS')`,
            [ticket.complaint_id]
        );
        await client.query(
            `UPDATE complaints SET status = 'REJECTED', closure_reason = 'INVALID', closure_note = $2 WHERE complaint_id = $1`,
            [ticket.complaint_id, reason]
        );
        await annotateLastTransition(client, ticket.complaint_id, ticket.status, 'REJECTED', `Rejected: ${reason}`);
        await recordAudit(client, req, {
            action: 'ticket.reject',
            targetType: 'complaint',
            targetId: ticket.complaint_id,
            details: { reason, previous_status: ticket.status },
        });
    }, userId);
    res.json({ message: 'Ticket rejected.' });
});

// POST /api/complaints/:id/merge (SUPERVISOR, ADMIN) { target_id }
// Folds a duplicate into another live ticket at the same location: its
// reporters move to the target, it is closed as a DUPLICATE pointing there.
exports.mergeComplaint = asyncHandler(async (req, res) => {
    const { userId } = req.user;
    const sourceId = req.params.id;
    const targetId = req.body.target_id.trim();
    if (sourceId === targetId) {
        throw new AppError(400, 'A ticket cannot be merged into itself.');
    }
    // Only tickets at the same location merge, so the target shares this block.
    await assertTicketInScope(req.user, sourceId);
    const outcome = await db.withTransaction(async (client) => {
        // Lock both tickets in a fixed (id) order: two supervisors merging A
        // into B and B into A at once must not deadlock.
        const locked = await client.query(
            'SELECT * FROM complaints WHERE complaint_id = ANY($1) ORDER BY complaint_id FOR UPDATE',
            [[sourceId, targetId]]
        );
        const source = locked.rows.find((r) => r.complaint_id === sourceId);
        const target = locked.rows.find((r) => r.complaint_id === targetId);
        if (!source || !target) {
            throw new AppError(404, 'Complaint not found.');
        }
        if (!LIVE_STATUSES.includes(source.status)) {
            throw new AppError(409, `This ticket is ${source.status} and cannot be merged.`);
        }
        if (!LIVE_STATUSES.includes(target.status)) {
            throw new AppError(409, `${ticketRef(targetId)} is ${target.status}; merge into an active ticket instead.`);
        }
        if (source.room_id !== target.room_id || source.common_area_id !== target.common_area_id) {
            throw new AppError(400, 'Only tickets for the same room or common area can be merged.');
        }

        const moved = await client.query(
            `INSERT INTO complaint_reporters (complaint_id, user_id, reported_at, is_original)
             SELECT $2, user_id, reported_at, FALSE FROM complaint_reporters WHERE complaint_id = $1
             ON CONFLICT (complaint_id, user_id) DO NOTHING
             RETURNING user_id`,
            [sourceId, targetId]
        );
        await client.query(
            `UPDATE complaint_assignments SET current_state = 'DECLINED'
             WHERE complaint_id = $1 AND current_state IN ('ASSIGNED', 'ACCEPTED', 'EN_ROUTE', 'IN_PROGRESS')`,
            [sourceId]
        );
        const note = `Merged into ${ticketRef(targetId)} as a duplicate`;
        await client.query(
            `UPDATE complaints SET status = 'REJECTED', closure_reason = 'DUPLICATE', merged_into_id = $2, closure_note = $3
             WHERE complaint_id = $1`,
            [sourceId, targetId, note]
        );
        await annotateLastTransition(client, sourceId, source.status, 'REJECTED', note);
        await addNote(
            client,
            targetId,
            target.status,
            userId,
            `${ticketRef(sourceId)} merged into this ticket` + (moved.rows.length ? ` (${moved.rows.length} more reporter${moved.rows.length === 1 ? '' : 's'})` : '')
        );
        await recordAudit(client, req, {
            action: 'ticket.merge',
            targetType: 'complaint',
            targetId: sourceId,
            details: { merged_into: targetId, reporters_moved: moved.rows.length },
        });
        return { reporters_moved: moved.rows.length };
    }, userId);
    res.json({ message: `Merged into ${ticketRef(targetId)}.`, merged_into_id: targetId, ...outcome });
});
