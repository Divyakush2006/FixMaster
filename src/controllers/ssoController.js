const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../config/db');
const { AppError, asyncHandler } = require('../middleware/errorHandler');
const { signToken } = require('../middleware/auth');
const { recordAudit } = require('../services/auditService');
const { parseCookies, setSessionCookies } = require('../utils/sessionCookies');
const { appBaseUrl } = require('../config/identity');
const oidc = require('../services/oidc');

// University single sign-on (see services/oidc.js for the settings).
//
//   GET /api/auth/sso/start      sends the browser to the university's sign-in page
//   GET /api/auth/sso/callback   where it comes back; opens a session for the
//                                student whose university mailbox it proved
//   GET /api/auth/session        what the web app asks right after, to learn who signed in
//
// Single sign-on signs an EXISTING student in; it never creates an account
// (a registration number and room request come from the sign-up form). It does
// stand in for the emailed code: the university has just vouched for the
// mailbox, so a student still waiting for a code is confirmed too.
// Whatever goes wrong, the browser is sent back to the sign-in page with a
// short reason code and nothing about the account is revealed.

const SSO_COOKIE = 'fm_sso';
const ATTEMPT_SECONDS = 600;
const ATTEMPT_AUDIENCE = 'fixmaster-sso';

const backToLogin = (reason) => `${appBaseUrl()}/login?sso=${reason}`;

const sameValue = (a, b) => {
    const x = Buffer.from(String(a || ''));
    const y = Buffer.from(String(b || ''));
    return x.length === y.length && crypto.timingSafeEqual(x, y);
};

const cookieOptions = (req) => ({ httpOnly: true, secure: req.secure, sameSite: 'lax', path: '/api/auth/sso' });

exports.start = asyncHandler(async (req, res) => {
    if (!oidc.isEnabled()) throw new AppError(404, 'Single sign-on is not set up here.');
    const attempt = oidc.newAttempt();
    let url;
    try {
        url = await oidc.authorizationUrl(attempt);
    } catch (err) {
        console.error(`[sso] cannot reach the sign-in provider: ${err.message}`);
        return res.redirect(302, backToLogin('unavailable'));
    }
    // Remembered in a signed cookie, not on the server, so any API instance can finish the sign-in.
    // SameSite=Lax: the browser comes back from another site and the cookie must travel with it.
    const memo = jwt.sign({ s: attempt.state, n: attempt.nonce, v: attempt.verifier }, process.env.JWT_SECRET, {
        algorithm: 'HS256',
        expiresIn: ATTEMPT_SECONDS,
        audience: ATTEMPT_AUDIENCE,
    });
    res.cookie(SSO_COOKIE, memo, { ...cookieOptions(req), maxAge: ATTEMPT_SECONDS * 1000 });
    res.set('Cache-Control', 'no-store').redirect(302, url);
});

exports.callback = asyncHandler(async (req, res) => {
    res.clearCookie(SSO_COOKIE, cookieOptions(req));
    res.set('Cache-Control', 'no-store');
    const refuse = (reason, why) => {
        console.warn(`[sso] sign-in refused (${reason})${why ? `: ${why}` : ''}`);
        return res.redirect(302, backToLogin(reason));
    };

    if (!oidc.isEnabled()) return refuse('unavailable');
    if (req.query.error) return refuse('denied', String(req.query.error).slice(0, 60)); // the person cancelled, or the provider said no

    let attempt;
    try {
        attempt = jwt.verify(parseCookies(req.headers.cookie)[SSO_COOKIE] || '', process.env.JWT_SECRET, { algorithms: ['HS256'], audience: ATTEMPT_AUDIENCE });
    } catch {
        return refuse('expired', 'no valid sign-in in progress');
    }
    const { code, state } = req.query;
    if (typeof code !== 'string' || !code || code.length > 4096 || !sameValue(state, attempt.s)) return refuse('failed', 'state did not match');

    let claims;
    try {
        claims = await oidc.verifyIdToken(await oidc.exchangeCode(code, attempt.v), { nonce: attempt.n });
    } catch (err) {
        return refuse('failed', err.message);
    }
    const email = oidc.mailboxOf(claims);
    if (!email) return refuse('domain', 'the mailbox is not a university address, or is unverified');

    const outcome = await db.withTransaction(async (client) => {
        const { rows } = await client.query(
            `SELECT u.user_id, u.reg_or_emp_id, u.full_name, u.role, u.is_active, u.account_status, u.credentials_changed_at,
                    EXISTS (SELECT 1 FROM student_profiles p WHERE p.user_id = u.user_id) AS has_profile
             FROM users u WHERE LOWER(u.email) = $1 FOR UPDATE OF u`,
            [email]
        );
        const user = rows[0];
        if (!user || user.role !== 'STUDENT') return { reason: 'no_account' };
        if (!user.is_active) return { reason: 'disabled' };
        let status = user.account_status;
        if (status === 'PENDING_VERIFICATION') status = user.has_profile ? 'ACTIVE' : 'PENDING_PROFILE';
        await client.query(
            `UPDATE users SET account_status = $2, email_verified_at = COALESCE(email_verified_at, NOW()), last_login_at = NOW(),
                              failed_login_count = 0, locked_until = NULL
             WHERE user_id = $1`,
            [user.user_id, status]
        );
        await recordAudit(client, req, {
            actorUserId: user.user_id,
            action: 'auth.sso_sign_in',
            targetType: 'user',
            targetId: user.user_id,
            details: { provider: oidc.config().issuer, confirmed_email: user.account_status === 'PENDING_VERIFICATION' },
        });
        return { user: { ...user, account_status: status } };
    });
    if (outcome.reason) return refuse(outcome.reason);

    const token = signToken(outcome.user);
    setSessionCookies(req, res, token, jwt.decode(token).exp);
    res.redirect(302, `${appBaseUrl()}/auth/sso/done`);
});

// The session the cookie holds, in the shape sign-in returns it, so the web app can start from it.
exports.session = asyncHandler(async (req, res) => {
    const { rows } = await db.query('SELECT user_id, reg_or_emp_id, full_name, role, account_status FROM users WHERE user_id = $1', [req.user.userId]);
    res.set('Cache-Control', 'no-store').json({ user: rows[0], expires_at: new Date(req.auth.exp * 1000).toISOString() });
});
