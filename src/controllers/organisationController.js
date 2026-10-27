const db = require('../config/db');
const { AppError, asyncHandler } = require('../middleware/errorHandler');
const { recordAudit } = require('../services/auditService');
const { getProfile, forViewer } = require('../services/profileService');
const { managedBlocks, inScope } = require('../services/scopeService');

// Campus organisation (migration 011): who runs which blocks, where staff are
// based and when they work, and when they are on leave.

async function lockUser(client, userId) {
    const { rows } = await client.query('SELECT user_id, role, reg_or_emp_id FROM users WHERE user_id = $1 FOR UPDATE', [userId]);
    if (rows.length === 0) throw new AppError(404, 'User not found.');
    return rows[0];
}

// PATCH /api/admin/users/:user_id/placement { home_block_id, shift } (STAFF)
// null clears either one; a staff member with no home block is in the campus pool.
exports.updateStaffPlacement = asyncHandler(async (req, res) => {
    const { home_block_id = undefined, shift = undefined } = req.body;
    const user = await db.withTransaction(async (client) => {
        const target = await lockUser(client, req.params.user_id);
        if (target.role !== 'STAFF') throw new AppError(400, 'Home block and shift only apply to staff accounts.');
        if (home_block_id) {
            const block = await client.query('SELECT 1 FROM hostel_blocks WHERE block_id = $1', [home_block_id]);
            if (block.rows.length === 0) throw new AppError(404, 'That block does not exist.');
        }
        const { rows } = await client.query(
            `UPDATE users
             SET home_block_id = CASE WHEN $2 THEN $3 ELSE home_block_id END,
                 shift = CASE WHEN $4 THEN $5 ELSE shift END
             WHERE user_id = $1
             RETURNING user_id, reg_or_emp_id, home_block_id, shift`,
            [target.user_id, home_block_id !== undefined, home_block_id || null, shift !== undefined, shift || null]
        );
        await recordAudit(client, req, {
            action: 'user.set_placement',
            targetType: 'user',
            targetId: target.user_id,
            details: { reg_or_emp_id: target.reg_or_emp_id, home_block_id: rows[0].home_block_id, shift: rows[0].shift },
        });
        return rows[0];
    }, req.user.userId);
    res.json(user);
});

// PUT /api/admin/users/:user_id/hostel { hostel_type } (SUPERVISOR, CHIEF_WARDEN)
// The hostel (MENS or LADIES) a supervisor or chief warden belongs to; null
// detaches them again. A chief warden runs their whole hostel, a supervisor
// only blocks of their hostel, so blocks of the other hostel are unassigned.
exports.setUserHostel = asyncHandler(async (req, res) => {
    const hostel = req.body.hostel_type ?? null;
    const outcome = await db.withTransaction(async (client) => {
        const target = await lockUser(client, req.params.user_id);
        if (target.role !== 'SUPERVISOR' && target.role !== 'CHIEF_WARDEN') {
            throw new AppError(400, 'Only supervisors and chief wardens belong to a hostel.');
        }
        if (hostel && target.role === 'CHIEF_WARDEN') {
            const other = await client.query(
                `SELECT reg_or_emp_id FROM users WHERE role = 'CHIEF_WARDEN' AND hostel_type = $1 AND is_active AND user_id <> $2`,
                [hostel, target.user_id]
            );
            if (other.rows.length > 0) {
                throw new AppError(409, `${other.rows[0].reg_or_emp_id} is already the chief warden of that hostel. Move them first.`);
            }
        }
        await client.query('UPDATE users SET hostel_type = $2 WHERE user_id = $1', [target.user_id, hostel]);
        let unassigned = [];
        if (hostel && target.role === 'SUPERVISOR') {
            const dropped = await client.query(
                `DELETE FROM supervisor_blocks sb USING hostel_blocks b
                 WHERE sb.supervisor_user_id = $1 AND b.block_id = sb.block_id AND b.hostel_type IS NOT NULL AND b.hostel_type <> $2
                 RETURNING sb.block_id`,
                [target.user_id, hostel]
            );
            unassigned = dropped.rows.map((r) => r.block_id).sort();
        }
        await recordAudit(client, req, {
            action: 'user.set_hostel',
            targetType: 'user',
            targetId: target.user_id,
            details: { reg_or_emp_id: target.reg_or_emp_id, hostel_type: hostel, unassigned_blocks: unassigned },
        });
        return { user_id: target.user_id, hostel_type: hostel, unassigned_blocks: unassigned };
    }, req.user.userId);
    res.json(outcome);
});

// PUT /api/admin/users/:user_id/blocks { block_ids } (SUPERVISOR)
// Replaces the supervisor's blocks. An empty list makes them responsible for
// their whole hostel (or every block, for a supervisor with no hostel yet).
exports.setSupervisorBlocks = asyncHandler(async (req, res) => {
    const blockIds = [...new Set(req.body.block_ids)];
    const blocks = await db.withTransaction(async (client) => {
        const target = await lockUser(client, req.params.user_id);
        if (target.role !== 'SUPERVISOR') throw new AppError(400, 'Only supervisors are assigned to blocks.');
        if (blockIds.length > 0) {
            const known = await client.query('SELECT block_id, hostel_type FROM hostel_blocks WHERE block_id = ANY($1::varchar[])', [blockIds]);
            if (known.rows.length !== blockIds.length) throw new AppError(404, 'One or more of those blocks do not exist.');
            const hostel = (await client.query('SELECT hostel_type FROM users WHERE user_id = $1', [target.user_id])).rows[0].hostel_type;
            const foreign = hostel && known.rows.filter((b) => b.hostel_type && b.hostel_type !== hostel).map((b) => b.block_id);
            if (foreign && foreign.length > 0) {
                throw new AppError(400, `${foreign.join(', ')} belong to the other hostel; a supervisor can only run blocks of their own hostel.`);
            }
        }
        await client.query('DELETE FROM supervisor_blocks WHERE supervisor_user_id = $1', [target.user_id]);
        if (blockIds.length > 0) {
            await client.query(
                `INSERT INTO supervisor_blocks (supervisor_user_id, block_id, assigned_by_user_id)
                 SELECT $1, unnest($2::varchar[]), $3`,
                [target.user_id, blockIds, req.user.userId]
            );
        }
        await recordAudit(client, req, {
            action: 'user.set_blocks',
            targetType: 'user',
            targetId: target.user_id,
            details: { reg_or_emp_id: target.reg_or_emp_id, block_ids: blockIds },
        });
        return blockIds.sort();
    }, req.user.userId);
    res.json({ user_id: req.params.user_id, block_ids: blocks, campus_wide: blocks.length === 0 });
});

// GET /api/admin/users/:user_id/leave - upcoming and recent leave (90 days back).
exports.listLeave = asyncHandler(async (req, res) => {
    const { rows } = await db.query(
        `SELECT leave_id, staff_user_id, to_char(starts_on, 'YYYY-MM-DD') AS starts_on, to_char(ends_on, 'YYYY-MM-DD') AS ends_on,
                reason, created_at
         FROM staff_leave
         WHERE staff_user_id = $1 AND ends_on >= CURRENT_DATE - 90
         ORDER BY starts_on DESC`,
        [req.params.user_id]
    );
    res.json(rows);
});

// POST /api/admin/users/:user_id/leave { starts_on, ends_on, reason }
// While on leave a technician is never picked by the autopilot.
exports.addLeave = asyncHandler(async (req, res) => {
    const { starts_on, ends_on, reason } = req.body;
    const leave = await db.withTransaction(async (client) => {
        const target = await lockUser(client, req.params.user_id);
        if (target.role !== 'STAFF') throw new AppError(400, 'Leave is recorded for staff accounts.');
        const overlap = await client.query(
            'SELECT 1 FROM staff_leave WHERE staff_user_id = $1 AND starts_on <= $3 AND ends_on >= $2',
            [target.user_id, starts_on, ends_on]
        );
        if (overlap.rows.length > 0) throw new AppError(409, 'This overlaps leave that is already recorded.');
        const { rows } = await client.query(
            `INSERT INTO staff_leave (staff_user_id, starts_on, ends_on, reason, created_by_user_id)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING leave_id, staff_user_id, to_char(starts_on, 'YYYY-MM-DD') AS starts_on, to_char(ends_on, 'YYYY-MM-DD') AS ends_on, reason`,
            [target.user_id, starts_on, ends_on, reason || null, req.user.userId]
        );
        await recordAudit(client, req, {
            action: 'staff.leave_add',
            targetType: 'user',
            targetId: target.user_id,
            details: { reg_or_emp_id: target.reg_or_emp_id, starts_on, ends_on },
        });
        return rows[0];
    }, req.user.userId);
    res.status(201).json(leave);
});

// DELETE /api/admin/leave/:leave_id
exports.deleteLeave = asyncHandler(async (req, res) => {
    await db.withTransaction(async (client) => {
        const { rows } = await client.query('DELETE FROM staff_leave WHERE leave_id = $1 RETURNING staff_user_id, starts_on, ends_on', [
            req.params.leave_id,
        ]);
        if (rows.length === 0) throw new AppError(404, 'Leave record not found.');
        await recordAudit(client, req, { action: 'staff.leave_remove', targetType: 'user', targetId: rows[0].staff_user_id });
    }, req.user.userId);
    res.status(204).end();
});

// GET /api/residents/:user_id/profile (SUPERVISOR, CHIEF_WARDEN, ADMIN)
// A resident's record, e.g. to call their family in an emergency. A
// block-scoped supervisor sees residents currently living in their blocks.
// Every read is audited: this is personal data.
exports.getResidentProfile = asyncHandler(async (req, res) => {
    const { rows } = await db.query(
        `SELECT u.user_id, u.reg_or_emp_id, u.full_name, u.email, u.phone_number, u.role,
                a.room_id, r.block_id
         FROM users u
         LEFT JOIN student_room_allotments a ON a.student_id = u.user_id AND a.is_current = TRUE
         LEFT JOIN rooms r ON r.room_id = a.room_id
         WHERE u.user_id = $1`,
        [req.params.user_id]
    );
    const resident = rows[0];
    if (!resident || resident.role !== 'STUDENT') throw new AppError(404, 'Resident not found.');
    const scope = await managedBlocks(req.user);
    if (scope !== null && !(resident.block_id && inScope(scope, resident.block_id))) {
        throw new AppError(403, 'This student does not live in a block you manage.', { code: 'OUT_OF_SCOPE' });
    }
    const profile = forViewer(await getProfile(db, resident.user_id), req.user.role);
    await recordAudit(null, req, { action: 'profile.viewed', targetType: 'user', targetId: resident.user_id });
    const { role, ...person } = resident; // eslint-disable-line no-unused-vars
    res.json({ resident: person, profile });
});
