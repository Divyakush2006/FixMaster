const db = require('../config/db');
const { AppError, asyncHandler } = require('../middleware/errorHandler');
const { slaDueSql, slaStatusSql } = require('../services/slaService');

// Validation of dispatch requests (complaint exists, is in a dispatchable
// state, staff member exists, is active and has the right trade) lives in the
// stored procedures, which also lock the complaint row so concurrent
// dispatches can't double-assign it. Their FM4xx errors carry user-facing
// messages and are mapped to HTTP statuses by the central error handler.

// POST /api/dispatch/assign (SUPERVISOR, ADMIN)
//
// Optional body fields:
//   expected_assignee_id  who the caller's screen shows holding the ticket
//                         (null = unassigned). If someone else changed it in
//                         the meantime the request fails with 409 and code
//                         STALE_ASSIGNMENT instead of silently overriding them.
//   allow_off_duty        confirm assigning a technician who is off duty
//                         (otherwise 409, code STAFF_OFF_DUTY).
exports.assignTechnician = asyncHandler(async (req, res) => {
    const { complaint_id, staff_user_id } = req.body;
    const checkExpected = Object.prototype.hasOwnProperty.call(req.body, 'expected_assignee_id');
    const expected = checkExpected ? req.body.expected_assignee_id : null;
    const allowOffDuty = req.body.allow_off_duty === true;
    const supervisorId = req.user.userId;

    await db.withTransaction(async (client) => {
        await client.query('CALL sp_supervisor_assign_task($1, $2, $3, $4, $5, $6)', [
            complaint_id,
            staff_user_id,
            supervisorId,
            checkExpected,
            expected,
            allowOffDuty,
        ]);
    }, supervisorId);

    res.status(200).json({ message: 'Task successfully assigned to technician.' });
});

// POST /api/dispatch/auto-dispatch (SUPERVISOR, ADMIN) - cleaning tickets only.
// `assigned` is false (with HTTP 200) when no cleaner was free: that is a
// normal outcome, not an error, and the ticket stays as it was.
exports.autoDispatchCleaning = asyncHandler(async (req, res) => {
    const { complaint_id } = req.body;
    const supervisorId = req.user.userId;

    const assignedStaffId = await db.withTransaction(async (client) => {
        const call = await client.query('CALL sp_auto_dispatch_cleaning($1, $2)', [complaint_id, null]);
        return call.rows[0] ? call.rows[0].p_assigned_staff_id : null;
    }, supervisorId);

    if (!assignedStaffId) {
        return res.status(200).json({
            assigned: false,
            message: 'No cleaning staff are currently available. The ticket was left unassigned.',
        });
    }

    const staff = await db.query('SELECT full_name FROM users WHERE user_id = $1', [assignedStaffId]);
    const staffName = staff.rows[0] ? staff.rows[0].full_name : null;
    res.status(200).json({
        assigned: true,
        staff_user_id: assignedStaffId,
        staff_name: staffName,
        message: `Auto-dispatched to ${staffName || 'a technician'}.`,
    });
});

// GET /api/dispatch/queue (STAFF) - the caller's live tasks, floor-ordered.
exports.getStaffQueue = asyncHandler(async (req, res) => {
    // The existing queue view (floor, then priority) plus each job's deadline.
    const result = await db.query(
        `SELECT q.*, ${slaDueSql()} AS sla_due_at, ${slaStatusSql()} AS sla_status
         FROM view_staff_active_queue q
         JOIN complaints c ON c.complaint_id = q.complaint_id
         JOIN complaint_subcategories sub ON sub.subcategory_id = c.subcategory_id
         JOIN complaint_categories cat ON cat.category_id = sub.category_id
         WHERE q.staff_user_id = $1
         ORDER BY q.floor_number ASC,
                  CASE q.priority WHEN 'EMERGENCY' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 ELSE 4 END ASC,
                  q.assigned_at ASC`,
        [req.user.userId]
    );
    res.json(result.rows);
});

/**
 * Locks a task for the calling technician inside their transaction and checks
 * it is theirs (assignment_id is a sequential integer, so without the check
 * any staff account could act on any task).
 *
 * Lock order matters: the ticket row is locked BEFORE the assignment row, the
 * same order the dispatch procedures use. Locking the assignment first
 * deadlocked against a supervisor reassigning the same ticket at the same
 * moment (see migration 008).
 */
async function lockOwnedAssignment(client, assignmentId, staffUserId) {
    const peek = await client.query('SELECT complaint_id, staff_user_id FROM complaint_assignments WHERE assignment_id = $1', [
        assignmentId,
    ]);
    if (peek.rows.length === 0) {
        throw new AppError(404, 'Assignment not found.');
    }
    if (peek.rows[0].staff_user_id !== staffUserId) {
        throw new AppError(403, 'You can only act on tasks assigned to you.');
    }
    await client.query('SELECT 1 FROM complaints WHERE complaint_id = $1 FOR UPDATE', [peek.rows[0].complaint_id]);
    const result = await client.query(
        `SELECT assignment_id, complaint_id, staff_user_id, current_state
         FROM complaint_assignments
         WHERE assignment_id = $1
         FOR UPDATE`,
        [assignmentId]
    );
    const assignment = result.rows[0];
    if (assignment.current_state === 'DECLINED') {
        throw new AppError(409, 'This job was reassigned or withdrawn by your supervisor and is no longer yours.', {
            code: 'TASK_REASSIGNED',
        });
    }
    return assignment;
}

// PATCH /api/dispatch/tasks/:assignment_id/start (STAFF): ASSIGNED -> IN_PROGRESS
exports.startWork = asyncHandler(async (req, res) => {
    const staffId = req.user.userId;

    const complaintId = await db.withTransaction(async (client) => {
        const assignment = await lockOwnedAssignment(client, req.params.assignment_id, staffId);
        if (assignment.current_state !== 'ASSIGNED') {
            throw new AppError(409, `This task is ${assignment.current_state}, not ASSIGNED, and cannot be started.`);
        }
        await client.query(
            `UPDATE complaint_assignments SET current_state = 'IN_PROGRESS', started_at = CURRENT_TIMESTAMP WHERE assignment_id = $1`,
            [assignment.assignment_id]
        );
        await client.query(`UPDATE complaints SET status = 'IN_PROGRESS' WHERE complaint_id = $1`, [assignment.complaint_id]);
        return assignment.complaint_id;
    }, staffId);

    res.json({ message: 'Task marked in progress.', complaint_id: complaintId });
});

// PATCH /api/dispatch/tasks/:assignment_id (STAFF): -> PENDING_VERIFICATION.
// The complaint id is read from the assignment row, never from the request.
exports.markWorkCompleted = asyncHandler(async (req, res) => {
    const staffId = req.user.userId;

    const complaintId = await db.withTransaction(async (client) => {
        const assignment = await lockOwnedAssignment(client, req.params.assignment_id, staffId);
        if (!['ASSIGNED', 'IN_PROGRESS'].includes(assignment.current_state)) {
            throw new AppError(409, `This task is already ${assignment.current_state} and cannot be marked done.`);
        }
        await client.query(
            `UPDATE complaint_assignments SET current_state = 'DONE', work_completed_at = CURRENT_TIMESTAMP WHERE assignment_id = $1`,
            [assignment.assignment_id]
        );
        await client.query(`UPDATE complaints SET status = 'PENDING_VERIFICATION' WHERE complaint_id = $1`, [
            assignment.complaint_id,
        ]);
        return assignment.complaint_id;
    }, staffId);

    res.json({ message: 'Task marked done, awaiting student verification.', complaint_id: complaintId });
});
