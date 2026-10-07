const db = require('../config/db');
const { AppError, asyncHandler } = require('../middleware/errorHandler');

// Validation of dispatch requests (complaint exists, is in a dispatchable
// state, staff member exists, is active and has the right trade) lives in the
// stored procedures, which also lock the complaint row so concurrent
// dispatches can't double-assign it. Their FM4xx errors carry user-facing
// messages and are mapped to HTTP statuses by the central error handler.

// POST /api/dispatch/assign (SUPERVISOR, ADMIN)
exports.assignTechnician = asyncHandler(async (req, res) => {
    const { complaint_id, staff_user_id } = req.body;
    const supervisorId = req.user.userId;

    await db.withTransaction(async (client) => {
        await client.query('CALL sp_supervisor_assign_task($1, $2, $3)', [complaint_id, staff_user_id, supervisorId]);
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
    const result = await db.query('SELECT * FROM view_staff_active_queue WHERE staff_user_id = $1', [req.user.userId]);
    res.json(result.rows);
});

/**
 * Loads an assignment FOR UPDATE inside the caller's transaction and checks
 * it belongs to the calling staff member. assignment_id is a sequential
 * integer, so without this check any staff account could act on any task.
 */
async function loadOwnedAssignment(client, assignmentId, staffUserId) {
    const result = await client.query(
        `SELECT assignment_id, complaint_id, staff_user_id, current_state
         FROM complaint_assignments
         WHERE assignment_id = $1
         FOR UPDATE`,
        [assignmentId]
    );
    if (result.rows.length === 0) {
        throw new AppError(404, 'Assignment not found.');
    }
    const assignment = result.rows[0];
    if (assignment.staff_user_id !== staffUserId) {
        throw new AppError(403, 'You can only act on tasks assigned to you.');
    }
    return assignment;
}

// PATCH /api/dispatch/tasks/:assignment_id/start (STAFF): ASSIGNED -> IN_PROGRESS
exports.startWork = asyncHandler(async (req, res) => {
    const staffId = req.user.userId;

    const complaintId = await db.withTransaction(async (client) => {
        const assignment = await loadOwnedAssignment(client, req.params.assignment_id, staffId);
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
        const assignment = await loadOwnedAssignment(client, req.params.assignment_id, staffId);
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
