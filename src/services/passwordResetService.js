const crypto = require('crypto');
const jwt = require('jsonwebtoken');

// Self-service password reset without a token table: the link carries a signed,
// short-lived token that is bound to the account's CURRENT password hash.
// Using it changes the hash, so the same link can never be used twice, and any
// other password change (by the user or an administrator) kills older links.
//
// It is signed with a key derived from JWT_SECRET, so it can never be
// accepted as a session token (and a session token is not a reset token).

const AUDIENCE = 'fixmaster:password-reset';
const TTL_MINUTES = 30;

const signingKey = () => crypto.createHmac('sha256', process.env.JWT_SECRET).update('fixmaster:password-reset:v1').digest();
const fingerprint = (passwordHash) => crypto.createHash('sha256').update(passwordHash).digest('hex').slice(0, 24);

function issueResetToken(user) {
    return jwt.sign({ sub: user.user_id, fp: fingerprint(user.password_hash) }, signingKey(), {
        algorithm: 'HS256',
        audience: AUDIENCE,
        expiresIn: `${TTL_MINUTES}m`,
        jwtid: crypto.randomUUID(),
    });
}

/** The user id inside a valid, unexpired token, plus the fingerprint to compare. Null if not valid. */
function readResetToken(token) {
    try {
        const d = jwt.verify(token, signingKey(), { algorithms: ['HS256'], audience: AUDIENCE });
        return typeof d.sub === 'string' && typeof d.fp === 'string' ? { userId: d.sub, fp: d.fp } : null;
    } catch {
        return null;
    }
}

const matchesCurrentPassword = (fp, passwordHash) => {
    const want = Buffer.from(fingerprint(passwordHash));
    const got = Buffer.from(fp);
    return want.length === got.length && crypto.timingSafeEqual(want, got);
};

module.exports = { issueResetToken, readResetToken, matchesCurrentPassword, TTL_MINUTES };
