const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const { ALL_AUDIENCES } = require('../config/portals');
const { credentialsOf } = require('../utils/sessionCookies');

const int = (value, fallback) => {
    const n = parseInt(value, 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
};

// NOTE: counters live in this process's memory. With more than one API
// instance behind a load balancer each instance counts separately; use a
// shared store (e.g. rate-limit-redis) if the API is scaled horizontally.
// Behind a reverse proxy, TRUST_PROXY must be set (see app.js) or every
// client is counted as the proxy's single IP.
//
// Keys are chosen with shared networks in mind: a hostel campus reaches the
// API through a handful of NAT addresses, so "one IP" can be thousands of
// students. Limits are therefore keyed per ACCOUNT wherever an account is
// known, and the per-IP limits are only coarse ceilings.

const loginId = (req) =>
    req.body && typeof req.body.reg_or_emp_id === 'string' ? req.body.reg_or_emp_id.trim().toUpperCase().slice(0, 30) : '';

const common = { standardHeaders: 'draft-7', legacyHeaders: false };

// Login: only FAILED attempts count, so normal use never trips them.
//  - per account + IP: stops one source guessing one account's password
//    without letting one mistyping student lock the whole campus out;
//  - per IP, all accounts: a ceiling on password spraying from one source.
// (Guessing one account from many IPs is stopped by the per-account lockout
// in authController.)
const loginLimitersFor = (perAccount, perIp, scope) => {
    const window = int(process.env.RATE_LIMIT_AUTH_WINDOW_MS, 15 * 60 * 1000);
    return [
        rateLimit({
            ...common,
            windowMs: window,
            limit: perIp,
            skipSuccessfulRequests: true,
            keyGenerator: (req) => `${scope}:ip:${req.ip}`,
            message: { error: 'Too many failed sign-in attempts from this network. Please try again later.' },
        }),
        rateLimit({
            ...common,
            windowMs: window,
            limit: perAccount,
            skipSuccessfulRequests: true,
            keyGenerator: (req) => `${scope}:acct:${loginId(req)}:${req.ip}`,
            message: { error: 'Too many failed attempts for this account. Please wait a few minutes and try again.' },
        }),
    ];
};

const loginLimiters = {
    student: loginLimitersFor(int(process.env.RATE_LIMIT_AUTH_MAX, 20), int(process.env.RATE_LIMIT_AUTH_IP_MAX, 200), 'student'),
    staff: loginLimitersFor(int(process.env.RATE_LIMIT_AUTH_MAX, 20), int(process.env.RATE_LIMIT_AUTH_IP_MAX, 200), 'staff'),
    admin: loginLimitersFor(int(process.env.RATE_LIMIT_ADMIN_AUTH_MAX, 10), int(process.env.RATE_LIMIT_ADMIN_AUTH_IP_MAX, 30), 'admin'),
};

// POST /api/auth/student/register: every attempt counts, successful or not -
// here the abuse is automated account creation, which succeeds.
const registerLimiter = rateLimit({
    ...common,
    windowMs: int(process.env.RATE_LIMIT_REGISTER_WINDOW_MS, 60 * 60 * 1000),
    limit: int(process.env.RATE_LIMIT_REGISTER_MAX, 10),
    message: { error: 'Too many registrations from this network. Please try again later.' },
});

// POST /api/auth/forgot-password: every request counts. Per account, so nobody
// can flood one person's inbox; per IP as a coarse ceiling for the campus NAT.
const forgotPasswordLimiters = [
    rateLimit({
        ...common,
        windowMs: int(process.env.RATE_LIMIT_FORGOT_WINDOW_MS, 60 * 60 * 1000),
        limit: int(process.env.RATE_LIMIT_FORGOT_IP_MAX, 60),
        keyGenerator: (req) => `forgot:ip:${req.ip}`,
        message: { error: 'Too many reset requests from this network. Please try again later.' },
    }),
    rateLimit({
        ...common,
        windowMs: int(process.env.RATE_LIMIT_FORGOT_WINDOW_MS, 60 * 60 * 1000),
        limit: int(process.env.RATE_LIMIT_FORGOT_MAX, 3),
        keyGenerator: (req) => `forgot:acct:${loginId(req)}`,
        message: { error: 'A reset link was already requested for this account recently. Check your email, or try again later.' },
    }),
];

// POST /api/auth/reset-password: a ceiling on guessing/replaying tokens.
const resetPasswordLimiter = rateLimit({
    ...common,
    windowMs: int(process.env.RATE_LIMIT_FORGOT_WINDOW_MS, 60 * 60 * 1000),
    limit: int(process.env.RATE_LIMIT_RESET_IP_MAX, 60),
    keyGenerator: (req) => `reset:ip:${req.ip}`,
    message: { error: 'Too many attempts. Please try again later.' },
});

// POST /api/auth/student/verify-email: each code also dies after a few wrong
// guesses (migration 010); these are ceilings on guessing across codes.
const verifyEmailLimiters = [
    rateLimit({
        ...common,
        windowMs: int(process.env.RATE_LIMIT_VERIFY_WINDOW_MS, 15 * 60 * 1000),
        limit: int(process.env.RATE_LIMIT_VERIFY_IP_MAX, 100),
        keyGenerator: (req) => `verify:ip:${req.ip}`,
        message: { error: 'Too many attempts from this network. Please try again later.' },
    }),
    rateLimit({
        ...common,
        windowMs: int(process.env.RATE_LIMIT_VERIFY_WINDOW_MS, 15 * 60 * 1000),
        limit: int(process.env.RATE_LIMIT_VERIFY_MAX, 10),
        keyGenerator: (req) => `verify:acct:${loginId(req)}`,
        message: { error: 'Too many attempts for this account. Ask for a new code and try again later.' },
    }),
];

// POST /api/auth/student/resend-code: the code itself can be resent once a
// minute per account; this stops one network flooding many inboxes.
const resendCodeLimiter = rateLimit({
    ...common,
    windowMs: int(process.env.RATE_LIMIT_VERIFY_WINDOW_MS, 15 * 60 * 1000),
    limit: int(process.env.RATE_LIMIT_RESEND_IP_MAX, 30),
    keyGenerator: (req) => `resend:ip:${req.ip}`,
    message: { error: 'Too many code requests from this network. Please try again later.' },
});

// POST /api/assistant/draft: each use calls a model. A per-day allowance per
// student is enforced by the AI gateway; this stops bursts.
const assistantLimiter = rateLimit({
    ...common,
    windowMs: 60 * 1000,
    limit: int(process.env.RATE_LIMIT_ASSISTANT_MAX, 10),
    keyGenerator: (req) => `assistant:${req.user ? req.user.userId : req.ip}`,
    message: { error: 'Too many requests to the assistant. Wait a minute, or fill in the form yourself.' },
});

// PUT /api/complaints/:id/photo: uploads are the heaviest requests the API takes.
const photoUploadLimiter = rateLimit({
    ...common,
    windowMs: int(process.env.RATE_LIMIT_UPLOAD_WINDOW_MS, 10 * 60 * 1000),
    limit: int(process.env.RATE_LIMIT_UPLOAD_MAX, 20),
    keyGenerator: (req) => `upload:${req.user ? req.user.userId : req.ip}`,
    message: { error: 'Too many photo uploads. Please wait a few minutes and try again.' },
});

// GET /api/me/data-export and POST /api/me/erasure-request: bulk reads and a
// consequential request, so a few per hour per person is plenty.
const privacyLimiter = rateLimit({
    ...common,
    windowMs: int(process.env.RATE_LIMIT_PRIVACY_WINDOW_MS, 60 * 60 * 1000),
    limit: int(process.env.RATE_LIMIT_PRIVACY_MAX, 10),
    keyGenerator: (req) => `privacy:${req.user ? req.user.userId : req.ip}`,
    message: { error: 'Too many data requests. Please try again in a while.' },
});

/**
 * The general limiter counts signed-in users per user, and only anonymous
 * traffic per IP. The token is verified (cheap HMAC) rather than merely
 * decoded, so forging user ids can't be used to dodge the per-IP bucket.
 */
function generalKey(req) {
    const { token } = credentialsOf(req);
    if (token) {
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET, {
                algorithms: ['HS256'],
                audience: ALL_AUDIENCES,
            });
            if (decoded && typeof decoded.userId === 'string') return `user:${decoded.userId}`;
        } catch {
            // fall through to the IP bucket
        }
    }
    return `ip:${req.ip}`;
}

const generalLimiter = rateLimit({
    ...common,
    windowMs: int(process.env.RATE_LIMIT_WINDOW_MS, 60 * 1000),
    limit: (req) =>
        generalKey(req).startsWith('user:') ? int(process.env.RATE_LIMIT_MAX, 300) : int(process.env.RATE_LIMIT_ANON_MAX, 1200),
    keyGenerator: generalKey,
    message: { error: 'Too many requests. Please slow down.' },
});

module.exports = {
    loginLimiters,
    registerLimiter,
    verifyEmailLimiters,
    resendCodeLimiter,
    forgotPasswordLimiters,
    resetPasswordLimiter,
    photoUploadLimiter,
    assistantLimiter,
    privacyLimiter,
    generalLimiter,
};
