const bcrypt = require('bcryptjs');
const db = require('../config/db');
const { AppError, asyncHandler } = require('../middleware/errorHandler');
const { PUBLIC_USER_COLUMNS, hashPassword } = require('../services/userService');
const { signToken } = require('../middleware/auth');

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
         RETURNING user_id, role, reg_or_emp_id`,
        [await hashPassword(new_password), req.user.userId]
    );
    // Every token issued before now is revoked (see auth.js), including the
    // one that made this request - so hand back a fresh one to keep this
    // session signed in while every other session is signed out.
    res.json({ message: 'Password updated. Other sessions have been signed out.', token: signToken(updated.rows[0]) });
});

// PATCH /api/me/availability (STAFF) - go on/off duty. Auto-dispatch only
// picks staff who are available; previously nothing could change the flag.
exports.setAvailability = asyncHandler(async (req, res) => {
    const result = await db.query(
        'UPDATE users SET is_available = $1 WHERE user_id = $2 RETURNING is_available',
        [req.body.is_available, req.user.userId]
    );
    res.json({ is_available: result.rows[0].is_available });
});
