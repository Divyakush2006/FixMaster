const bcrypt = require('bcryptjs');
const db = require('../config/db');
const { AppError } = require('../middleware/errorHandler');

const BCRYPT_COST = 12;

// Columns that are safe to return to any client. password_hash never leaves
// the database layer.
const PUBLIC_USER_COLUMNS =
    'user_id, reg_or_emp_id, full_name, email, phone_number, role, specialization, is_available, is_active, created_at';

const hashPassword = (password) => bcrypt.hash(password, BCRYPT_COST);

/**
 * Creates a user. Shared by public student signup and admin user creation so
 * both enforce the same rules. The caller decides the role; this function
 * only checks that role and specialization are consistent (the database
 * enforces the same thing via chk_staff_specialization).
 */
async function createUser({ reg_or_emp_id, full_name, email, phone_number, password, role, specialization }) {
    const spec = role === 'STAFF' ? specialization || null : null;
    if (role === 'STAFF' && !spec) {
        throw new AppError(400, 'specialization is required for STAFF accounts.');
    }

    const existing = await db.query(
        'SELECT UPPER(reg_or_emp_id) = UPPER($1) AS same_id FROM users WHERE UPPER(reg_or_emp_id) = UPPER($1) OR LOWER(email) = LOWER($2)',
        [reg_or_emp_id, email]
    );
    if (existing.rows.length > 0) {
        throw new AppError(
            409,
            existing.rows.some((r) => r.same_id)
                ? 'An account with this Register/Employee ID already exists.'
                : 'An account with this email already exists.'
        );
    }

    const password_hash = await hashPassword(password);
    const result = await db.query(
        `INSERT INTO users (reg_or_emp_id, full_name, email, phone_number, password_hash, role, specialization)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING ${PUBLIC_USER_COLUMNS}`,
        [reg_or_emp_id, full_name, email, phone_number, password_hash, role, spec]
    );
    return result.rows[0];
}

module.exports = { createUser, hashPassword, PUBLIC_USER_COLUMNS };
