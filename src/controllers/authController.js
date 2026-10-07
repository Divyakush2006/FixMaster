const bcrypt = require('bcryptjs');
const db = require('../config/db');
const { AppError, asyncHandler } = require('../middleware/errorHandler');
const { signToken } = require('../middleware/auth');
const { createUser } = require('../services/userService');
const { portalForRole } = require('../config/portals');

// A real bcrypt hash (cost 12) of a throwaway string. Login compares against
// it when the ID doesn't exist, so an unknown ID costs the same ~250ms as a
// wrong password and response timing can't reveal which IDs are registered.
const TIMING_EQUALIZER_HASH = '$2b$12$Q4WOCyCDbVIq2xjB/N5bR.J//WJP5qWSquq38cubc.YYNRtUyl3RO';

const PORTAL_LABEL = { student: 'Student', staff: 'Staff' };

/**
 * POST /api/auth/student/register - public self-signup, STUDENT accounts only.
 * Staff, supervisor and admin accounts are created by an administrator.
 */
exports.registerStudent = asyncHandler(async (req, res) => {
    const { reg_or_emp_id, full_name, email, phone_number, password } = req.body;
    const user = await createUser({ reg_or_emp_id, full_name, email, phone_number, password, role: 'STUDENT' });
    res.status(201).json({ message: 'User registered successfully', user });
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
            'SELECT user_id, reg_or_emp_id, full_name, role, password_hash, is_active FROM users WHERE UPPER(reg_or_emp_id) = UPPER($1)',
            [reg_or_emp_id]
        );
        const user = result.rows[0];

        const isMatch = await bcrypt.compare(password, user ? user.password_hash : TIMING_EQUALIZER_HASH);
        if (!user || !isMatch) {
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
