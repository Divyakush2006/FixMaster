const jwt = require('jsonwebtoken');
const db = require('../config/db');
const { asyncHandler } = require('./errorHandler');
const { portalForRole, audienceFor, ALL_AUDIENCES } = require('../config/portals');

const JWT_ALGORITHM = 'HS256';

/** null = no token supplied, undefined = token present but invalid/expired. */
function verifyToken(authHeader) {
    if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
    const token = authHeader.slice('Bearer '.length).trim();
    try {
        // Pin the algorithm so a token can't choose how it is verified, and
        // require one of our portal audiences.
        return jwt.verify(token, process.env.JWT_SECRET, { algorithms: [JWT_ALGORITHM], audience: ALL_AUDIENCES });
    } catch (err) {
        return undefined;
    }
}

/**
 * Loads the token's user from the database and checks the token is still
 * acceptable for them:
 *  - the account exists and is active;
 *  - the token was issued after the last password change/reset;
 *  - the token was issued by the portal the account belongs to. A student
 *    token can never act as a staff or admin session, even if signed with
 *    the right secret, and a role change invalidates old tokens.
 * Authorization always uses the CURRENT role from the database.
 */
async function loadActiveUser(decoded) {
    if (!decoded || typeof decoded.userId !== 'string') return null;
    const { rows } = await db.query(
        'SELECT user_id, role, reg_or_emp_id, is_active, credentials_changed_at FROM users WHERE user_id = $1',
        [decoded.userId]
    );
    const user = rows[0];
    if (!user || !user.is_active) return null;
    if (user.credentials_changed_at && decoded.iat < Math.floor(user.credentials_changed_at.getTime() / 1000)) {
        return null;
    }
    const portal = portalForRole(user.role);
    if (!portal || decoded.portal !== portal || decoded.aud !== audienceFor(portal)) {
        return null;
    }
    return { userId: user.user_id, role: user.role, regOrEmpId: user.reg_or_emp_id, portal };
}

// 401 = "sign in (again)": no token, a bad/expired/revoked one, a token from
// the wrong portal, or a deactivated account. Clients sign the user out on 401.
// 403 (authorize below, and ownership checks in controllers) = signed in but
// not allowed to do this one thing; clients must NOT sign out on 403.
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
        return res.status(401).json({ error: 'Your session is no longer valid. Please sign in again.' });
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

/** Signs a session token for the portal the user's role belongs to. */
function signToken(user) {
    const portal = portalForRole(user.role);
    // Administrator sessions are shorter-lived.
    const expiresIn =
        portal === 'admin'
            ? process.env.JWT_ADMIN_EXPIRES_IN || '8h'
            : process.env.JWT_EXPIRES_IN || '24h';
    return jwt.sign(
        { userId: user.user_id, role: user.role, regOrEmpId: user.reg_or_emp_id, portal },
        process.env.JWT_SECRET,
        { algorithm: JWT_ALGORITHM, expiresIn, audience: audienceFor(portal) }
    );
}

module.exports = { authenticate, authorize, signToken };
