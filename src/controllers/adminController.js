const db = require('../config/db');
const { AppError, asyncHandler } = require('../middleware/errorHandler');
const { createUser, hashPassword, PUBLIC_USER_COLUMNS } = require('../services/userService');
const { recordAudit } = require('../services/auditService');

// ---- Users -------------------------------------------------------------------

/** Escapes LIKE wildcards in user-supplied search text. */
const likeEscape = (text) => text.replace(/[\\%_]/g, (ch) => `\\${ch}`);

// GET /api/admin/users?role=&status=&q=&limit=&offset= - paged (X-Total-Count).
// status: active | deactivated | locked. q matches name, ID or email.
exports.listUsers = asyncHandler(async (req, res) => {
    const params = [];
    const where = ['1=1'];
    if (req.query.role) {
        params.push(req.query.role);
        where.push(`role = $${params.length}`);
    }
    if (req.query.status === 'active') where.push('is_active = TRUE');
    if (req.query.status === 'deactivated') where.push('is_active = FALSE');
    if (req.query.status === 'locked') where.push('locked_until > NOW()');
    if (req.query.q && req.query.q.trim()) {
        params.push(`%${likeEscape(req.query.q.trim())}%`);
        const p = `$${params.length}`;
        where.push(`(full_name ILIKE ${p} OR reg_or_emp_id ILIKE ${p} OR email ILIKE ${p})`);
    }
    const limit = req.query.limit || 50;
    const offset = req.query.offset || 0;
    const whereSql = where.join(' AND ');
    const [count, result] = await Promise.all([
        db.query(`SELECT COUNT(*)::int AS total FROM users WHERE ${whereSql}`, params),
        db.query(
            `SELECT ${PUBLIC_USER_COLUMNS} FROM users WHERE ${whereSql}
             ORDER BY role, full_name, user_id
             LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
            [...params, limit, offset]
        ),
    ]);
    res.set('X-Total-Count', String(count.rows[0].total));
    res.json(result.rows);
});

// GET /api/admin/users/summary - account counts for the Users page tabs.
exports.userSummary = asyncHandler(async (req, res) => {
    const { rows } = await db.query(`
        SELECT
            COUNT(*)::int AS all,
            COUNT(*) FILTER (WHERE role = 'STUDENT')::int AS student,
            COUNT(*) FILTER (WHERE role = 'STAFF')::int AS staff,
            COUNT(*) FILTER (WHERE role = 'SUPERVISOR')::int AS supervisor,
            COUNT(*) FILTER (WHERE role = 'ADMIN')::int AS admin,
            COUNT(*) FILTER (WHERE locked_until > NOW())::int AS locked,
            COUNT(*) FILTER (WHERE NOT is_active)::int AS deactivated
        FROM users`);
    res.json(rows[0]);
});

// POST /api/admin/users - the only way to create STAFF / SUPERVISOR / ADMIN
// accounts (public registration always creates STUDENT).
exports.createUser = asyncHandler(async (req, res) => {
    const { reg_or_emp_id, full_name, email, phone_number, password, role, specialization } = req.body;
    const user = await createUser({ reg_or_emp_id, full_name, email, phone_number, password, role, specialization });
    await recordAudit(null, req, {
        action: 'user.create',
        targetType: 'user',
        targetId: user.user_id,
        details: { reg_or_emp_id: user.reg_or_emp_id, role: user.role, specialization: user.specialization },
    });
    res.status(201).json({ message: 'User created', user });
});

// PATCH /api/admin/users/:user_id - activate/deactivate, set duty status,
// or unlock an account locked by repeated failed sign-ins.
exports.updateUser = asyncHandler(async (req, res) => {
    const { user_id } = req.params;
    const { is_active, is_available, unlock } = req.body;

    if (is_active === false && user_id === req.user.userId) {
        throw new AppError(400, 'You cannot deactivate your own account.');
    }

    const result = await db.withTransaction(async (client) => {
        const target = await client.query(
            'SELECT role, reg_or_emp_id, is_active, is_available FROM users WHERE user_id = $1 FOR UPDATE',
            [user_id]
        );
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
                 is_available = COALESCE($3, is_available),
                 failed_login_count = CASE WHEN $4 THEN 0 ELSE failed_login_count END,
                 locked_until = CASE WHEN $4 THEN NULL ELSE locked_until END
             WHERE user_id = $1
             RETURNING ${PUBLIC_USER_COLUMNS}`,
            [user_id, is_active ?? null, is_available ?? null, unlock === true]
        );

        const before = target.rows[0];
        const audit = (action, details = {}) =>
            recordAudit(client, req, {
                action,
                targetType: 'user',
                targetId: user_id,
                details: { reg_or_emp_id: before.reg_or_emp_id, ...details },
            });
        if (is_active !== undefined && is_active !== before.is_active) {
            await audit(is_active ? 'user.reactivate' : 'user.deactivate', is_active ? {} : { released_tickets: releasedTickets });
        }
        if (is_available !== undefined && is_available !== before.is_available) {
            await audit('user.set_availability', { is_available });
        }
        if (unlock === true) await audit('user.unlock');
        return { user: updated.rows[0], releasedTickets };
    }, req.user.userId);

    res.json({ ...result.user, released_tickets: result.releasedTickets });
});

// POST /api/admin/users/:user_id/reset-password - for users locked out of
// their account. Revokes every existing session of that user.
exports.resetPassword = asyncHandler(async (req, res) => {
    const passwordHash = await hashPassword(req.body.new_password);
    await db.withTransaction(async (client) => {
        // A reset also clears any sign-in lockout.
        const result = await client.query(
            `UPDATE users SET password_hash = $1, credentials_changed_at = CURRENT_TIMESTAMP,
                              failed_login_count = 0, locked_until = NULL
             WHERE user_id = $2 RETURNING user_id, reg_or_emp_id`,
            [passwordHash, req.params.user_id]
        );
        if (result.rows.length === 0) {
            throw new AppError(404, 'User not found.');
        }
        await recordAudit(client, req, {
            action: 'user.reset_password',
            targetType: 'user',
            targetId: req.params.user_id,
            details: { reg_or_emp_id: result.rows[0].reg_or_emp_id },
        });
    }, req.user.userId);
    res.json({ message: 'Password reset. The user has been signed out of all sessions.' });
});

// ---- Room allotments ------------------------------------------------------------

// GET /api/admin/allotments?block_id=&student_id=&q=&limit=&offset= - current
// allotments, paged (X-Total-Count). q matches student name, ID or room.
exports.listAllotments = asyncHandler(async (req, res) => {
    const params = [];
    const where = ['sra.is_current = TRUE'];
    if (req.query.block_id) {
        params.push(req.query.block_id);
        where.push(`r.block_id = $${params.length}`);
    }
    if (req.query.student_id) {
        params.push(req.query.student_id);
        where.push(`sra.student_id = $${params.length}`);
    }
    if (req.query.q && req.query.q.trim()) {
        params.push(`%${likeEscape(req.query.q.trim())}%`);
        const p = `$${params.length}`;
        where.push(`(u.full_name ILIKE ${p} OR u.reg_or_emp_id ILIKE ${p} OR sra.room_id ILIKE ${p})`);
    }
    const limit = req.query.limit || 50;
    const offset = req.query.offset || 0;
    const from = `FROM student_room_allotments sra
         JOIN users u ON u.user_id = sra.student_id
         JOIN rooms r ON r.room_id = sra.room_id
         WHERE ${where.join(' AND ')}`;
    const [count, result] = await Promise.all([
        db.query(`SELECT COUNT(*)::int AS total ${from}`, params),
        db.query(
            `SELECT sra.allotment_id, sra.student_id, u.reg_or_emp_id, u.full_name,
                    sra.room_id, r.block_id, r.room_number, r.floor_number, r.bed_capacity,
                    sra.academic_year, sra.assigned_date
             ${from}
             ORDER BY r.block_id, r.floor_number, r.room_number, u.full_name
             LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
            [...params, limit, offset]
        ),
    ]);
    res.set('X-Total-Count', String(count.rows[0].total));
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

        const previous = await client.query(
            'UPDATE student_room_allotments SET is_current = FALSE WHERE student_id = $1 AND is_current = TRUE RETURNING room_id',
            [student_id]
        );
        const inserted = await client.query(
            `INSERT INTO student_room_allotments (student_id, room_id, academic_year, is_current)
             VALUES ($1, $2, $3, TRUE)
             RETURNING allotment_id, student_id, room_id, academic_year, assigned_date`,
            [student_id, room_id, academic_year]
        );
        const from = previous.rows[0] ? previous.rows[0].room_id : null;
        await recordAudit(client, req, {
            action: from ? 'allotment.move' : 'allotment.create',
            targetType: 'user',
            targetId: student_id,
            details: { room_id, academic_year, ...(from ? { from_room_id: from } : {}) },
        });
        return inserted.rows[0];
    }, req.user.userId);

    res.status(201).json({ message: 'Room allotted', allotment });
});

// DELETE /api/admin/allotments/:student_id - end the student's current
// allotment (moved out). The row is kept as history.
exports.endAllotment = asyncHandler(async (req, res) => {
    await db.withTransaction(async (client) => {
        const result = await client.query(
            `UPDATE student_room_allotments SET is_current = FALSE
             WHERE student_id = $1 AND is_current = TRUE RETURNING allotment_id, room_id`,
            [req.params.student_id]
        );
        if (result.rows.length === 0) {
            throw new AppError(404, 'That student has no current allotment.');
        }
        await recordAudit(client, req, {
            action: 'allotment.end',
            targetType: 'user',
            targetId: req.params.student_id,
            details: { room_id: result.rows[0].room_id },
        });
    }, req.user.userId);
    res.json({ message: 'Allotment ended.' });
});

// ---- Audit log ----------------------------------------------------------------

// GET /api/admin/audit?action=&actor=&target_id=&limit=&offset= - newest first.
// The total is in X-Total-Count.
exports.listAudit = asyncHandler(async (req, res) => {
    const where = ['1=1'];
    const params = [];
    if (req.query.action) {
        // "user" matches user.create, user.deactivate, ...
        params.push(req.query.action, `${req.query.action}.%`);
        where.push(`(a.action = $${params.length - 1} OR a.action LIKE $${params.length})`);
    }
    if (req.query.actor) {
        params.push(req.query.actor);
        where.push(`a.actor_user_id = $${params.length}`);
    }
    if (req.query.target_id) {
        params.push(req.query.target_id);
        where.push(`a.target_id = $${params.length}`);
    }
    const limit = req.query.limit || 50;
    const offset = req.query.offset || 0;
    const whereSql = where.join(' AND ');

    const [count, rows] = await Promise.all([
        db.query(`SELECT COUNT(*)::int AS total FROM audit_log a WHERE ${whereSql}`, params),
        db.query(
            `SELECT a.audit_id, a.occurred_at, a.action, a.target_type, a.target_id, a.details, a.ip_address, a.request_id,
                    a.actor_user_id, actor.full_name AS actor_name, actor.reg_or_emp_id AS actor_reg_or_emp_id,
                    CASE WHEN a.target_type = 'user' THEN target.full_name END AS target_name
             FROM audit_log a
             LEFT JOIN users actor ON actor.user_id = a.actor_user_id
             LEFT JOIN users target ON a.target_type = 'user' AND target.user_id = a.target_id
             WHERE ${whereSql}
             ORDER BY a.occurred_at DESC, a.audit_id DESC
             LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
            [...params, limit, offset]
        ),
    ]);
    res.set('X-Total-Count', String(count.rows[0].total));
    res.json(rows.rows);
});
