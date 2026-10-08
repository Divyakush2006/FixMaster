const bcrypt = require('bcrypt');
const db = require('../config/db');
const { AppError, asyncHandler } = require('../middleware/errorHandler');
const { PUBLIC_USER_COLUMNS, hashPassword } = require('../services/userService');
const { signToken } = require('../middleware/auth');
const { countLiveJobs, releaseLiveJobs } = require('../services/taskService');

// GET /api/me - full profile of the caller (password_hash never selected).
exports.getMe = asyncHandler(async (req, res) => {
    const result = await db.query(`SELECT ${PUBLIC_USER_COLUMNS} FROM users WHERE user_id = $1`, [req.user.userId]);
    if (result.rows.length === 0) {
        throw new AppError(404, 'User not found.');
    }
    res.json(result.rows[0]);
});

// GET /api/me/allotment - the student's current room (404 if none).
exports.getMyAllotment = asyncHandler(async (req, res) => {
    if (req.user.role !== 'STUDENT') {
        throw new AppError(403, 'Only students have room allotments.');
    }
    const result = await db.query(
        `SELECT sra.room_id, r.block_id, r.room_number, r.floor_number, r.room_type, sra.academic_year, sra.assigned_date
         FROM student_room_allotments sra
         JOIN rooms r ON sra.room_id = r.room_id
         WHERE sra.student_id = $1 AND sra.is_current = TRUE`,
        [req.user.userId]
    );
    if (result.rows.length === 0) {
        throw new AppError(404, 'No current room allotment found for this student.');
    }
    res.json(result.rows[0]);
});

// PATCH /api/me/password - change own password (requires the current one).
exports.changePassword = asyncHandler(async (req, res) => {
    const { current_password, new_password } = req.body;
    const result = await db.query('SELECT password_hash FROM users WHERE user_id = $1', [req.user.userId]);
    if (result.rows.length === 0) {
        throw new AppError(404, 'User not found.');
    }
    const ok = await bcrypt.compare(current_password, result.rows[0].password_hash);
    if (!ok) {
        // 400, not 401: the session is fine, only the confirmation was wrong,
        // and clients log the user out on 401.
        throw new AppError(400, 'Current password is incorrect.');
    }
    if (current_password === new_password) {
        throw new AppError(400, 'The new password must be different from the current one.');
    }
    const updated = await db.query(
        `UPDATE users SET password_hash = $1, credentials_changed_at = CURRENT_TIMESTAMP
         WHERE user_id = $2
         RETURNING user_id, role, reg_or_emp_id, credentials_changed_at`,
        [await hashPassword(new_password), req.user.userId]
    );
    // Every token issued before now is revoked (see auth.js), including the
    // one that made this request - so hand back a fresh one to keep this
    // session signed in while every other session is signed out.
    res.json({ message: 'Password updated. Other sessions have been signed out.', token: signToken(updated.rows[0]) });
});

// PATCH /api/me/availability (STAFF) - go on/off duty. Auto-dispatch only
// picks staff who are available.
//
// Going off duty with jobs still in the queue must be a deliberate choice,
// otherwise those jobs sit unnoticed until the next shift:
//   no release_open_jobs   -> 409, code OPEN_JOBS, details.open_jobs = n
//   release_open_jobs=false -> go off duty and keep them (supervisors see
//                              "off duty with n open jobs")
//   release_open_jobs=true  -> hand them back for reassignment
exports.setAvailability = asyncHandler(async (req, res) => {
    const { is_available, release_open_jobs } = req.body;
    const { userId } = req.user;

    const outcome = await db.withTransaction(async (client) => {
        const me = await client.query('SELECT full_name FROM users WHERE user_id = $1 FOR UPDATE', [userId]);
        let released = [];
        if (is_available === false) {
            const open = await countLiveJobs(client, userId);
            if (open > 0 && release_open_jobs === undefined) {
                throw new AppError(
                    409,
                    `You have ${open} open job${open === 1 ? '' : 's'}. Keep ${open === 1 ? 'it' : 'them'}, or hand ${open === 1 ? 'it' : 'them'} back to your supervisor for reassignment?`,
                    { code: 'OPEN_JOBS', details: { open_jobs: open } }
                );
            }
            if (open > 0 && release_open_jobs === true) {
                released = await releaseLiveJobs(client, userId, `Returned for reassignment: ${me.rows[0].full_name} went off duty`);
            }
        }
        const updated = await client.query('UPDATE users SET is_available = $1 WHERE user_id = $2 RETURNING is_available', [
            is_available,
            userId,
        ]);
        return { is_available: updated.rows[0].is_available, released };
    }, userId);

    res.json({
        is_available: outcome.is_available,
        open_jobs: await countLiveJobs(db, userId),
        released_jobs: outcome.released.length,
    });
});
