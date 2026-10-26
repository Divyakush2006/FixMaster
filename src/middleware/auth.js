const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const db = require('../config/db');
const { asyncHandler } = require('./errorHandler');
const { portalForRole, audienceFor, ALL_AUDIENCES } = require('../config/portals');
const { credentialsOf } = require('../utils/sessionCookies');

const JWT_ALGORITHM = 'HS256';

/** null = no token supplied, undefined = token present but invalid/expired. */
function verifyToken(token) {
    if (!token) return null;
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
    // Every token we issue has a unique id (jti); one without it is not ours
    // or predates server-side sign-out, and is refused.
    if (!decoded || typeof decoded.userId !== 'string' || typeof decoded.jti !== 'string') return null;
    const { rows } = await db.query(
        `SELECT user_id, role, reg_or_emp_id, is_active, credentials_changed_at, account_status,
                EXISTS (SELECT 1 FROM revoked_tokens WHERE jti = $2) AS revoked
         FROM users WHERE user_id = $1`,
        [decoded.userId, decoded.jti]
    );
    const user = rows[0];
    if (!user || !user.is_active || user.revoked) return null;
    // JWT iat is in whole seconds: a token issued in the same second as the
    // change counts as issued before it. (signToken stamps tokens created
    // right after a change one second later, so those stay valid.)
    if (user.credentials_changed_at && decoded.iat <= Math.floor(user.credentials_changed_at.getTime() / 1000)) {
        return null;
    }
    const portal = portalForRole(user.role);
    if (!portal || decoded.portal !== portal || decoded.aud !== audienceFor(portal)) {
        return null;
    }
    return { userId: user.user_id, role: user.role, regOrEmpId: user.reg_or_emp_id, portal, accountStatus: user.account_status };
}

// 401 = "sign in (again)": no token, a bad/expired/revoked one, a token from
// the wrong portal, or a deactivated account. Clients sign the user out on 401.
// 403 (authorize below, and ownership checks in controllers) = signed in but
// not allowed to do this one thing; clients must NOT sign out on 403.
//
// A student who has not finished onboarding (migration 010) holds a valid
// session but may only use the onboarding endpoints - their profile, room
// request, reference data and sign-out. Every other route refuses with 403
// PROFILE_INCOMPLETE, so the default is closed: a route opts in to incomplete
// accounts by using authenticateOnboarding.
const makeAuthenticate = ({ allowIncompleteProfile }) =>
    asyncHandler(async (req, res, next) => {
        const credentials = credentialsOf(req);
        const decoded = verifyToken(credentials.token);
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
        // A cookie is sent by the browser on its own, so a state-changing request
        // that rides on one must prove it came from our page (double-submit token).
        // Checked after the session itself so a missing session is still a 401.
        if (!credentials.csrfOk) {
            return res.status(403).json({ error: 'Request blocked: the security token is missing or wrong. Reload the page and try again.', code: 'CSRF' });
        }
        if (user.accountStatus === 'PENDING_VERIFICATION') {
            // Sessions are only issued after verification; this is defence in depth.
            return res.status(403).json({ error: 'Confirm your email address first.', code: 'EMAIL_NOT_VERIFIED' });
        }
        if (user.accountStatus !== 'ACTIVE' && !allowIncompleteProfile) {
            return res.status(403).json({ error: 'Finish your profile to start using FixMaster.', code: 'PROFILE_INCOMPLETE' });
        }
        req.user = user;
        req.auth = { jti: decoded.jti, exp: decoded.exp, via: credentials.via };
        next();
    });

const authenticate = makeAuthenticate({ allowIncompleteProfile: false });
const authenticateOnboarding = makeAuthenticate({ allowIncompleteProfile: true });

const authorize = (...roles) => {
    return (req, res, next) => {
        if (!req.user || !roles.includes(req.user.role)) {
            return res.status(403).json({ error: 'Forbidden: Insufficient privileges.' });
        }
        next();
    };
};

/**
 * Signs a session token for the portal the user's role belongs to.
 * Pass the user's credentials_changed_at when known: a token issued within
 * the same second as a password change is stamped one second later so the
 * revocation rule (iat <= change second) never kills a brand-new session.
 */
function signToken(user) {
    const now = Math.floor(Date.now() / 1000);
    const changed = user.credentials_changed_at ? Math.floor(new Date(user.credentials_changed_at).getTime() / 1000) : 0;
    const iat = Math.max(now, changed + 1);
    const portal = portalForRole(user.role);
    // Administrator sessions are shorter-lived.
    const expiresIn =
        portal === 'admin'
            ? process.env.JWT_ADMIN_EXPIRES_IN || '8h'
            : process.env.JWT_EXPIRES_IN || '24h';
    return jwt.sign(
        { userId: user.user_id, role: user.role, regOrEmpId: user.reg_or_emp_id, portal, iat },
        process.env.JWT_SECRET,
        { algorithm: JWT_ALGORITHM, expiresIn, audience: audienceFor(portal), jwtid: crypto.randomUUID() }
    );
}

module.exports = { authenticate, authenticateOnboarding, authorize, signToken };
