const bcrypt = require('bcrypt');
const db = require('../config/db');
const { AppError, asyncHandler } = require('../middleware/errorHandler');
const { signToken } = require('../middleware/auth');
const { createUser } = require('../services/userService');
const { recordAudit } = require('../services/auditService');
const { assertRequestableRoom, recordRoomRequest } = require('../services/roomRequestService');
const { portalForRole } = require('../config/portals');
const mailer = require('../services/mailer');
const { hashPassword } = require('../services/userService');
const { issueResetToken, readResetToken, matchesCurrentPassword, TTL_MINUTES } = require('../services/passwordResetService');

// A real bcrypt hash (cost 12) of a throwaway string. Login compares against
// it when the ID doesn't exist, so an unknown ID costs the same ~250ms as a
// wrong password and response timing can't reveal which IDs are registered.
const TIMING_EQUALIZER_HASH = '$2b$12$Q4WOCyCDbVIq2xjB/N5bR.J//WJP5qWSquq38cubc.YYNRtUyl3RO';

const PORTAL_LABEL = { student: 'Student', staff: 'Staff' };

const int = (value, fallback) => {
    const n = parseInt(value, 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
};

// Per-account lockout (migration 005): after LOCKOUT_THRESHOLD consecutive
// wrong passwords - from any number of IP addresses - the account refuses
// sign-in for LOCKOUT_MINUTES. A successful sign-in or an administrator
// password reset/unlock clears the counter.
const LOCKOUT_THRESHOLD = int(process.env.LOGIN_LOCKOUT_THRESHOLD, 10);
const LOCKOUT_MINUTES = int(process.env.LOGIN_LOCKOUT_MINUTES, 15);

function lockedError(lockedUntil, res) {
    const seconds = Math.max(1, Math.ceil((lockedUntil.getTime() - Date.now()) / 1000));
    res.set('Retry-After', String(seconds));
    const minutes = Math.ceil(seconds / 60);
    return new AppError(
        429,
        `Account temporarily locked after too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`
    );
}

/**
 * POST /api/auth/logout - ends THIS session on the server: the token is
 * revoked, so a copy of it stops working immediately instead of at expiry.
 * Other sessions of the same user are unaffected.
 */
exports.logout = asyncHandler(async (req, res) => {
    const { jti, exp } = req.auth;
    await db.query(
        `INSERT INTO revoked_tokens (jti, user_id, expires_at) VALUES ($1, $2, to_timestamp($3))
         ON CONFLICT (jti) DO NOTHING`,
        [jti, req.user.userId, exp]
    );
    // Housekeeping: entries are only needed until the token would have expired.
    await db.query('DELETE FROM revoked_tokens WHERE expires_at < NOW()');
    if (req.user.role === 'ADMIN') {
        await recordAudit(null, req, { action: 'auth.admin_sign_out', targetType: 'user', targetId: req.user.userId });
    }
    res.status(204).end();
});

/**
 * POST /api/auth/student/register - public self-signup, STUDENT accounts only.
 * Staff, supervisor and admin accounts are created by an administrator.
 */
exports.registerStudent = asyncHandler(async (req, res) => {
    const { reg_or_emp_id, full_name, email, phone_number, password, block_id, floor_number, room_id } = req.body;
    const wantsRoom = !!room_id;
    // One transaction: the account and its room request exist together or not at all.
    const user = await db.withTransaction(async (client) => {
        const room = wantsRoom ? await assertRequestableRoom(client, { block_id, floor_number, room_id }) : null;
        const created = await createUser({ reg_or_emp_id, full_name, email, phone_number, password, role: 'STUDENT' }, client);
        if (room) await recordRoomRequest(client, req, created.user_id, room);
        return created;
    });
    res.status(201).json({
        message: wantsRoom
            ? 'Account created. Your room request has been sent to the hostel office; you can raise room tickets once it is approved.'
            : 'Account created. Ask the hostel office to allot you a room.',
        user,
        room_request: wantsRoom ? { status: 'PENDING', block_id, floor_number, room_id } : null,
    });
});

// ---- Password reset by email ------------------------------------------------------

const appBaseUrl = () => (process.env.APP_URL || (process.env.CORS_ORIGIN || '').split(',')[0] || 'http://localhost:3000').trim().replace(/\/+$/, '');
const RESET_REFUSED = 'This reset link is invalid or has expired. Request a new one.';

/** GET /api/auth/capabilities - lets the sign-in screens hide features this deployment cannot offer. */
exports.capabilities = (req, res) => {
    res.json({ password_reset: mailer.isConfigured() });
};

/**
 * POST /api/auth/forgot-password { reg_or_emp_id }
 * Emails a one-time reset link to the address on file. The answer is the same
 * whether or not the account exists, so this cannot be used to find accounts.
 * Administrator accounts are not eligible: another administrator resets those.
 */
exports.forgotPassword = asyncHandler(async (req, res) => {
    if (!mailer.isConfigured()) {
        throw new AppError(503, 'Password reset by email is not set up here. Please contact the hostel office.');
    }
    const { rows } = await db.query(
        `SELECT user_id, reg_or_emp_id, full_name, email, role, password_hash, is_active
         FROM users WHERE UPPER(reg_or_emp_id) = UPPER($1)`,
        [req.body.reg_or_emp_id]
    );
    const user = rows[0];
    if (user && user.is_active && portalForRole(user.role) !== 'admin') {
        const link = `${appBaseUrl()}/reset-password#token=${issueResetToken(user)}`;
        // Not awaited: the reply must not reveal, by its timing, whether mail was sent.
        mailer
            .sendMail({
                to: user.email,
                subject: 'Reset your FixMaster password',
                text:
                    `Hello ${user.full_name},

` +
                    `Someone asked to reset the password for ${user.reg_or_emp_id}. Open this link to choose a new one ` +
                    `(valid for ${TTL_MINUTES} minutes, works once):

${link}

` +
                    `If this was not you, ignore this message; your password has not changed.
`,
            })
            .catch((err) => console.error(`[mail] reset email for ${user.reg_or_emp_id} failed: ${err.message}`));
        await recordAudit(null, req, { actorUserId: null, action: 'auth.password_reset_requested', targetType: 'user', targetId: user.user_id });
    }
    res.status(202).json({ message: 'If that account exists, a reset link is on its way to the email address on file.' });
});

/** POST /api/auth/reset-password { token, new_password } - completes the flow; signs the user out everywhere. */
exports.resetPassword = asyncHandler(async (req, res) => {
    const parsed = readResetToken(req.body.token);
    if (!parsed) throw new AppError(400, RESET_REFUSED);
    const passwordHash = await hashPassword(req.body.new_password);
    await db.withTransaction(async (client) => {
        const { rows } = await client.query(
            'SELECT user_id, reg_or_emp_id, role, password_hash, is_active FROM users WHERE user_id = $1 FOR UPDATE',
            [parsed.userId]
        );
        const user = rows[0];
        if (!user || !user.is_active || portalForRole(user.role) === 'admin' || !matchesCurrentPassword(parsed.fp, user.password_hash)) {
            throw new AppError(400, RESET_REFUSED);
        }
        await client.query(
            `UPDATE users SET password_hash = $1, credentials_changed_at = CURRENT_TIMESTAMP,
                              failed_login_count = 0, locked_until = NULL
             WHERE user_id = $2`,
            [passwordHash, user.user_id]
        );
        await recordAudit(client, req, {
            actorUserId: user.user_id,
            action: 'auth.password_reset_completed',
            targetType: 'user',
            targetId: user.user_id,
            details: { reg_or_emp_id: user.reg_or_emp_id },
        });
    });
    res.json({ message: 'Password changed. Sign in with your new password.' });
});

/**
 * Builds the login handler for one portal:
 *   POST /api/auth/student/login   STUDENT
 *   POST /api/auth/staff/login     STAFF, SUPERVISOR
 *   POST /api/auth/admin/login     ADMIN
 *
 * Each portal only signs in its own accounts:
 *  - admin accounts do not exist as far as the student/staff portals are
 *    concerned, and student/staff accounts do not exist at /admin - both get
 *    the same "Invalid credentials" as a wrong password;
 *  - a student using the Staff tab (or the reverse) is told which tab to use,
 *    but only after the password has been verified, so this never confirms
 *    an account exists to someone who doesn't know its password.
 */
exports.loginFor = (portal) =>
    asyncHandler(async (req, res) => {
        const { reg_or_emp_id, password } = req.body;

        const result = await db.query(
            `SELECT user_id, reg_or_emp_id, full_name, role, password_hash, is_active, locked_until, credentials_changed_at
             FROM users WHERE UPPER(reg_or_emp_id) = UPPER($1)`,
            [reg_or_emp_id]
        );
        const user = result.rows[0];

        // Always pay for one bcrypt comparison, locked or not, so timing
        // reveals nothing.
        const isMatch = await bcrypt.compare(password, user ? user.password_hash : TIMING_EQUALIZER_HASH);

        if (user && user.locked_until && user.locked_until > new Date()) {
            throw lockedError(user.locked_until, res);
        }

        if (!user || !isMatch) {
            if (user) {
                // Count the failure. A lock that has already expired starts a
                // fresh count instead of re-locking on the very next mistake.
                const updated = await db.query(
                    `UPDATE users
                     SET failed_login_count = CASE WHEN locked_until IS NOT NULL AND locked_until <= NOW() THEN 1 ELSE failed_login_count + 1 END,
                         locked_until = CASE
                             WHEN (CASE WHEN locked_until IS NOT NULL AND locked_until <= NOW() THEN 1 ELSE failed_login_count + 1 END) >= $2
                             THEN NOW() + make_interval(mins => $3)
                             ELSE locked_until
                         END
                     WHERE user_id = $1
                     RETURNING failed_login_count, locked_until`,
                    [user.user_id, LOCKOUT_THRESHOLD, LOCKOUT_MINUTES]
                );
                const row = updated.rows[0];
                if (row && row.failed_login_count === LOCKOUT_THRESHOLD) {
                    await recordAudit(null, req, {
                        actorUserId: null,
                        action: 'auth.account_locked',
                        targetType: 'user',
                        targetId: user.user_id,
                        details: { portal, failed_attempts: row.failed_login_count, locked_minutes: LOCKOUT_MINUTES },
                    });
                }
            }
            throw new AppError(401, 'Invalid credentials.');
        }

        const accountPortal = portalForRole(user.role);
        if (accountPortal !== portal) {
            if (accountPortal === 'admin' || portal === 'admin') {
                throw new AppError(401, 'Invalid credentials.');
            }
            throw new AppError(
                403,
                `This is a ${PORTAL_LABEL[accountPortal].toLowerCase()} account. Please sign in using the ${PORTAL_LABEL[accountPortal]} tab.`
            );
        }

        if (!user.is_active) {
            throw new AppError(403, 'This account has been deactivated. Please contact the hostel office.');
        }

        await db.query(
            'UPDATE users SET failed_login_count = 0, locked_until = NULL, last_login_at = NOW() WHERE user_id = $1',
            [user.user_id]
        );
        if (portal === 'admin') {
            await recordAudit(null, req, { actorUserId: user.user_id, action: 'auth.admin_sign_in', targetType: 'user', targetId: user.user_id });
        }

        res.json({
            token: signToken(user),
            portal,
            user: {
                user_id: user.user_id,
                reg_or_emp_id: user.reg_or_emp_id,
                full_name: user.full_name,
                role: user.role,
            },
        });
    });
