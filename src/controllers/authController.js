const bcrypt = require('bcryptjs');
const db = require('../config/db');
const { AppError, asyncHandler } = require('../middleware/errorHandler');
const { signToken } = require('../middleware/auth');
const { createUser } = require('../services/userService');

// A real bcrypt hash (cost 12) of a throwaway string. Login compares against
// it when the ID doesn't exist, so an unknown ID costs the same ~250ms as a
// wrong password. Without this, "no such user" answered instantly and
// response timing alone revealed which IDs are registered.
const TIMING_EQUALIZER_HASH = '$2b$12$Q4WOCyCDbVIq2xjB/N5bR.J//WJP5qWSquq38cubc.YYNRtUyl3RO';

/**
 * POST /api/auth/register - public self-signup, STUDENT accounts only.
 *
 * Any `role` / `specialization` in the body is ignored. Staff, supervisor and
 * admin accounts are created by an administrator via POST /api/admin/users,
 * so this public endpoint can never be used to obtain a privileged account.
 */
exports.register = asyncHandler(async (req, res) => {
    const { reg_or_emp_id, full_name, email, phone_number, password } = req.body;
    const user = await createUser({ reg_or_emp_id, full_name, email, phone_number, password, role: 'STUDENT' });
    res.status(201).json({ message: 'User registered successfully', user });
});

exports.login = asyncHandler(async (req, res) => {
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
    // Checked only after the password, so this message never confirms that an
    // ID exists to someone who doesn't know its password.
    if (!user.is_active) {
        throw new AppError(403, 'This account has been deactivated. Please contact the hostel office.');
    }

    res.json({
        token: signToken(user),
        user: {
            user_id: user.user_id,
            reg_or_emp_id: user.reg_or_emp_id,
            full_name: user.full_name,
            role: user.role,
        },
    });
});
