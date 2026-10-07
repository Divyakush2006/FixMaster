const jwt = require('jsonwebtoken');
const db = require('../config/db');
const { asyncHandler } = require('./errorHandler');

const JWT_ALGORITHM = 'HS256';

/** null = no token supplied, undefined = token present but invalid/expired. */
function verifyToken(authHeader) {
    if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
    const token = authHeader.slice('Bearer '.length).trim();
    try {
        // Pin the algorithm so a token can't choose how it is verified.
        return jwt.verify(token, process.env.JWT_SECRET, { algorithms: [JWT_ALGORITHM] });
    } catch (err) {
        return undefined;
    }
}

/**
 * Loads the token's user from the database. A signed token alone is not
 * enough: it stays cryptographically valid for its whole lifetime, so without
 * this check a deactivated account (or a user whose role was changed) would
 * keep working until the token expired. The role used for authorization is
 * always the CURRENT role from the database, never the one baked into the
 * token.
 */
async function loadActiveUser(decoded) {
    if (!decoded || typeof decoded.userId !== 'string') return null;
    const { rows } = await db.query(
        'SELECT user_id, role, reg_or_emp_id, is_active, credentials_changed_at FROM users WHERE user_id = $1',
        [decoded.userId]
    );
    const user = rows[0];
    if (!user || !user.is_active) return null;
    // Tokens issued before the last password change/reset are revoked.
    // `iat` has one-second resolution, hence the comparison in whole seconds.
    if (user.credentials_changed_at && decoded.iat < Math.floor(user.credentials_changed_at.getTime() / 1000)) {
        return null;
    }
    return { userId: user.user_id, role: user.role, regOrEmpId: user.reg_or_emp_id };
}

// 401 = "authenticate (again)": no token, a bad/expired one, or an account
// that no longer exists or was deactivated. Clients log the user out on 401.
// 403 (authorize below, and ownership checks in controllers) = authenticated
// but not allowed to do this one thing; clients must NOT log out on 403.
const authenticate = asyncHandler(async (req, res, next) => {
    const decoded = verifyToken(req.headers.authorization);
    if (decoded === null) {
        return res.status(401).json({ error: 'Access denied. No token provided.' });
    }
    if (decoded === undefined) {
        return res.status(401).json({ error: 'Invalid or expired token.' });
    }
    const user = await loadActiveUser(decoded);
    if (!user) {
        return res.status(401).json({ error: 'This account is no longer active. Please contact the hostel office.' });
    }
    req.user = user;
    next();
});

const authorize = (...roles) => {
    return (req, res, next) => {
        if (!req.user || !roles.includes(req.user.role)) {
            return res.status(403).json({ error: 'Forbidden: Insufficient privileges.' });
        }
        next();
    };
};

function signToken(user) {
    return jwt.sign(
        { userId: user.user_id, role: user.role, regOrEmpId: user.reg_or_emp_id },
        process.env.JWT_SECRET,
        { algorithm: JWT_ALGORITHM, expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
    );
}

module.exports = { authenticate, authorize, signToken };
