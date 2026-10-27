const bcrypt = require('bcrypt');
const db = require('../config/db');
const { AppError, asyncHandler } = require('../middleware/errorHandler');
const { PUBLIC_USER_COLUMNS, hashPassword } = require('../services/userService');
const jwt = require('jsonwebtoken');
const { signToken } = require('../middleware/auth');
const { setSessionCookies } = require('../utils/sessionCookies');
const { countLiveJobs, releaseLiveJobs } = require('../services/taskService');
const { assertRequestableRoom, assertHostelFits, recordRoomRequest, requestStatus, WITHDRAW } = require('../services/roomRequestService');
const { recordAudit } = require('../services/auditService');
const { getProfile, saveProfile } = require('../services/profileService');
const { managedBlocks } = require('../services/scopeService');
const { PRIVACY_NOTICE_VERSION } = require('../config/identity');

// GET /api/me - the caller's account (password_hash never selected), plus
// whether a student still has onboarding to finish.
exports.getMe = asyncHandler(async (req, res) => {
    const result = await db.query(
        `SELECT ${PUBLIC_USER_COLUMNS}, erasure_requested_at,
                EXISTS (SELECT 1 FROM student_profiles p WHERE p.user_id = users.user_id) AS profile_complete,
                (SELECT array_agg(sb.block_id ORDER BY sb.block_id) FROM supervisor_blocks sb WHERE sb.supervisor_user_id = users.user_id AND users.role = 'SUPERVISOR') AS assigned_blocks
         FROM users WHERE user_id = $1`,
        [req.user.userId]
    );
    if (result.rows.length === 0) {
        throw new AppError(404, 'User not found.');
    }
    const { assigned_blocks: assigned, ...me } = result.rows[0];
    if (me.role === 'SUPERVISOR' || me.role === 'CHIEF_WARDEN' || me.role === 'ADMIN') {
        // Exactly the blocks this manager runs; campus_wide when that is every block.
        const scope = await managedBlocks(req.user);
        me.campus_wide = scope === null;
        me.managed_blocks = scope === null ? [] : scope;
        me.assigned_blocks = assigned || [];
    }
    if (me.role === 'STUDENT' && me.profile_complete) {
        // The notice changed since this resident last accepted it: they are asked to read it again.
        const consented = await db.query('SELECT privacy_notice_version FROM student_profiles WHERE user_id = $1', [req.user.userId]);
        me.privacy_notice_outdated = consented.rows[0] ? consented.rows[0].privacy_notice_version !== PRIVACY_NOTICE_VERSION : false;
    }
    res.json(me);
});

// GET /api/me/profile (STUDENT) - the resident record, or null before onboarding.
exports.getMyProfile = asyncHandler(async (req, res) => {
    res.json({ profile: await getProfile(db, req.user.userId), account_status: req.user.accountStatus });
});

// PUT /api/me/profile (STUDENT) - completes onboarding the first time; later
// saves update the record. Validated by profileValidators.
exports.saveMyProfile = asyncHandler(async (req, res) => {
    const { profile, activated } = await db.withTransaction(
        (client) => saveProfile(client, req, req.user.userId, req.body),
        req.user.userId
    );
    res.status(activated ? 201 : 200).json({
        message: activated ? 'Profile complete. Welcome to FixMaster.' : 'Profile updated.',
        profile,
        account_status: 'ACTIVE',
    });
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

// GET /api/me/room-request - the student's latest room request (null when they
// have none, or already have a room).
exports.getMyRoomRequest = asyncHandler(async (req, res) => {
    if (req.user.role !== 'STUDENT') {
        throw new AppError(403, 'Only students request rooms.');
    }
    res.json({ request: await requestStatus(db, req.user.userId) });
});

// POST /api/me/room-request { block_id, floor_number, room_id } - (re)send a
// room request to the hostel office. Grants nothing by itself.
exports.requestRoom = asyncHandler(async (req, res) => {
    if (req.user.role !== 'STUDENT') {
        throw new AppError(403, 'Only students request rooms.');
    }
    const { block_id, floor_number, room_id } = req.body;
    await db.withTransaction(async (client) => {
        await client.query('SELECT 1 FROM users WHERE user_id = $1 FOR UPDATE', [req.user.userId]);
        const has = await client.query('SELECT 1 FROM student_room_allotments WHERE student_id = $1 AND is_current = TRUE', [req.user.userId]);
        if (has.rows.length > 0) {
            throw new AppError(409, 'You already have a room. Ask the hostel office if you need to move.');
        }
        const room = await assertRequestableRoom(client, { block_id, floor_number, room_id });
        await assertHostelFits(client, req.user.userId, room.block_id);
        const open = await requestStatus(client, req.user.userId);
        if (open && open.status === 'PENDING' && open.room_id === room_id) {
            throw new AppError(409, 'This request is already waiting for the hostel office.');
        }
        await recordRoomRequest(client, req, req.user.userId, room);
    }, req.user.userId);
    res.status(201).json({ request: await requestStatus(db, req.user.userId), message: 'Request sent to the hostel office.' });
});

// DELETE /api/me/room-request - take back a request the hostel office has not
// answered yet. Only a pending request can be withdrawn.
exports.withdrawRoomRequest = asyncHandler(async (req, res) => {
    if (req.user.role !== 'STUDENT') {
        throw new AppError(403, 'Only students request rooms.');
    }
    await db.withTransaction(async (client) => {
        // Same lock as requestRoom, so a withdrawal cannot interleave with a new request.
        await client.query('SELECT 1 FROM users WHERE user_id = $1 FOR UPDATE', [req.user.userId]);
        const open = await requestStatus(client, req.user.userId);
        if (!open || open.status !== 'PENDING') {
            throw new AppError(404, 'You have no waiting room request to withdraw.');
        }
        await recordAudit(client, req, {
            action: WITHDRAW,
            targetType: 'user',
            targetId: req.user.userId,
            details: { room_id: open.room_id },
        });
    }, req.user.userId);
    res.status(204).end();
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
        `UPDATE users SET password_hash = $1, credentials_changed_at = CURRENT_TIMESTAMP, must_change_password = FALSE
         WHERE user_id = $2
         RETURNING user_id, role, reg_or_emp_id, credentials_changed_at`,
        [await hashPassword(new_password), req.user.userId]
    );
    // Every token issued before now is revoked (see auth.js), including the
    // one that made this request - so hand back a fresh one to keep this
    // session signed in while every other session is signed out.
    const token = signToken(updated.rows[0]);
    const message = 'Password updated. Other sessions have been signed out.';
    if (req.auth.via === 'cookie') {
        // A browser session: refresh the cookie, never hand the token to page scripts.
        const { exp } = jwt.decode(token);
        setSessionCookies(req, res, token, exp);
        return res.json({ message, expires_at: new Date(exp * 1000).toISOString() });
    }
    res.json({ message, token });
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
