const db = require('../config/db');
const { AppError, asyncHandler } = require('../middleware/errorHandler');
const { createUser, hashPassword, PUBLIC_USER_COLUMNS } = require('../services/userService');

// ---- Users -------------------------------------------------------------------

// GET /api/admin/users?role=
exports.listUsers = asyncHandler(async (req, res) => {
    const params = [];
    let where = '';
    if (req.query.role) {
        params.push(req.query.role);
        where = 'WHERE role = $1';
    }
    const result = await db.query(
        `SELECT ${PUBLIC_USER_COLUMNS} FROM users ${where} ORDER BY role, full_name`,
        params
    );
    res.json(result.rows);
});

// POST /api/admin/users - the only way to create STAFF / SUPERVISOR / ADMIN
// accounts (public registration always creates STUDENT).
exports.createUser = asyncHandler(async (req, res) => {
    const { reg_or_emp_id, full_name, email, phone_number, password, role, specialization } = req.body;
    const user = await createUser({ reg_or_emp_id, full_name, email, phone_number, password, role, specialization });
    res.status(201).json({ message: 'User created', user });
});

// PATCH /api/admin/users/:user_id - activate/deactivate, set duty status.
exports.updateUser = asyncHandler(async (req, res) => {
    const { user_id } = req.params;
    const { is_active, is_available } = req.body;

    if (is_active === false && user_id === req.user.userId) {
        throw new AppError(400, 'You cannot deactivate your own account.');
    }

    const result = await db.withTransaction(async (client) => {
        const target = await client.query('SELECT role FROM users WHERE user_id = $1 FOR UPDATE', [user_id]);
        if (target.rows.length === 0) {
            throw new AppError(404, 'User not found.');
        }
        if (is_available !== undefined && target.rows[0].role !== 'STAFF') {
            throw new AppError(400, 'is_available only applies to STAFF accounts.');
        }
        if (is_active === false && target.rows[0].role === 'ADMIN') {
            const others = await client.query(
                `SELECT COUNT(*)::int AS n FROM users WHERE role = 'ADMIN' AND is_active = TRUE AND user_id <> $1`,
                [user_id]
            );
            if (others.rows[0].n === 0) {
                throw new AppError(400, 'Cannot deactivate the last active administrator.');
            }
        }
        let releasedTickets = 0;
        if (is_active === false && target.rows[0].role === 'STAFF') {
            // A deactivated technician's live tasks would otherwise be stuck:
            // nobody else may act on them and they no longer appear in any
            // working queue. Hand them back to OPEN for reassignment.
            const released = await client.query(
                `UPDATE complaint_assignments SET current_state = 'DECLINED'
                 WHERE staff_user_id = $1 AND current_state IN ('ASSIGNED', 'ACCEPTED', 'EN_ROUTE', 'IN_PROGRESS')
                 RETURNING complaint_id`,
                [user_id]
            );
            if (released.rows.length > 0) {
                const reopened = await client.query(
                    `UPDATE complaints SET status = 'OPEN'
                     WHERE complaint_id = ANY($1) AND status IN ('ASSIGNED', 'IN_PROGRESS')
                     RETURNING complaint_id`,
                    [released.rows.map((r) => r.complaint_id)]
                );
                releasedTickets = reopened.rows.length;
            }
        }

        const updated = await client.query(
            `UPDATE users
             SET is_active = COALESCE($2, is_active),
                 is_available = COALESCE($3, is_available)
             WHERE user_id = $1
             RETURNING ${PUBLIC_USER_COLUMNS}`,
            [user_id, is_active ?? null, is_available ?? null]
        );
        return { user: updated.rows[0], releasedTickets };
    }, req.user.userId);

    res.json({ ...result.user, released_tickets: result.releasedTickets });
});

// POST /api/admin/users/:user_id/reset-password - for users locked out of
// their account. Revokes every existing session of that user.
exports.resetPassword = asyncHandler(async (req, res) => {
    const result = await db.query(
        `UPDATE users SET password_hash = $1, credentials_changed_at = CURRENT_TIMESTAMP
         WHERE user_id = $2 RETURNING user_id`,
        [await hashPassword(req.body.new_password), req.params.user_id]
    );
    if (result.rows.length === 0) {
        throw new AppError(404, 'User not found.');
    }
    res.json({ message: 'Password reset. The user has been signed out of all sessions.' });
});

// ---- Room allotments ------------------------------------------------------------

// GET /api/admin/allotments?block_id= - current allotments.
exports.listAllotments = asyncHandler(async (req, res) => {
    const params = [];
    let blockFilter = '';
    if (req.query.block_id) {
        params.push(req.query.block_id);
        blockFilter = 'AND r.block_id = $1';
    }
    const result = await db.query(
        `SELECT sra.allotment_id, sra.student_id, u.reg_or_emp_id, u.full_name,
                sra.room_id, r.block_id, r.room_number, r.floor_number, r.bed_capacity,
                sra.academic_year, sra.assigned_date
         FROM student_room_allotments sra
         JOIN users u ON u.user_id = sra.student_id
         JOIN rooms r ON r.room_id = sra.room_id
         WHERE sra.is_current = TRUE ${blockFilter}
         ORDER BY r.block_id, r.floor_number, r.room_number, u.full_name`,
        params
    );
    res.json(result.rows);
});

// POST /api/admin/allotments - allot (or move) a student to a room.
// Any previous current allotment becomes history, and the room's
// bed_capacity is enforced.
exports.allotRoom = asyncHandler(async (req, res) => {
    const { student_id, room_id, academic_year } = req.body;

    const allotment = await db.withTransaction(async (client) => {
        const student = await client.query('SELECT role, is_active FROM users WHERE user_id = $1', [student_id]);
        if (student.rows.length === 0) {
            throw new AppError(404, 'Student not found.');
        }
        if (student.rows[0].role !== 'STUDENT') {
            throw new AppError(400, 'Only STUDENT accounts can be allotted a room.');
        }
        if (!student.rows[0].is_active) {
            throw new AppError(400, 'That student account is deactivated.');
        }

        // Lock the room so two concurrent allotments can't both take its last bed.
        const room = await client.query(
            'SELECT bed_capacity, is_active FROM rooms WHERE room_id = $1 FOR UPDATE',
            [room_id]
        );
        if (room.rows.length === 0 || !room.rows[0].is_active) {
            throw new AppError(404, `Room ${room_id} was not found or is inactive.`);
        }
        const occupancy = await client.query(
            `SELECT COUNT(*)::int AS n FROM student_room_allotments
             WHERE room_id = $1 AND is_current = TRUE AND student_id <> $2`,
            [room_id, student_id]
        );
        if (occupancy.rows[0].n >= room.rows[0].bed_capacity) {
            throw new AppError(409, `Room ${room_id} is full (${room.rows[0].bed_capacity} beds).`);
        }

        await client.query(
            'UPDATE student_room_allotments SET is_current = FALSE WHERE student_id = $1 AND is_current = TRUE',
            [student_id]
        );
        const inserted = await client.query(
            `INSERT INTO student_room_allotments (student_id, room_id, academic_year, is_current)
             VALUES ($1, $2, $3, TRUE)
             RETURNING allotment_id, student_id, room_id, academic_year, assigned_date`,
            [student_id, room_id, academic_year]
        );
        return inserted.rows[0];
    }, req.user.userId);

    res.status(201).json({ message: 'Room allotted', allotment });
});

// DELETE /api/admin/allotments/:student_id - end the student's current
// allotment (moved out). The row is kept as history.
exports.endAllotment = asyncHandler(async (req, res) => {
    const result = await db.query(
        `UPDATE student_room_allotments SET is_current = FALSE
         WHERE student_id = $1 AND is_current = TRUE RETURNING allotment_id`,
        [req.params.student_id]
    );
    if (result.rows.length === 0) {
        throw new AppError(404, 'That student has no current allotment.');
    }
    res.json({ message: 'Allotment ended.' });
});
