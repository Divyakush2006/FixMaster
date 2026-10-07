const rateLimit = require('express-rate-limit');

const int = (value, fallback) => {
    const n = parseInt(value, 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
};

// NOTE: counters live in this process's memory. With more than one API
// instance behind a load balancer each instance counts separately; use a
// shared store (e.g. rate-limit-redis) if the API is scaled horizontally.
// Behind a reverse proxy, TRUST_PROXY must be set (see app.js) or every
// client is counted as the proxy's single IP and they all share one limit.

// Login endpoints: credential guessing. Only FAILED attempts count, so a user
// who signs in successfully a few times is never locked out by normal use.
// Each portal gets its own counter, and the admin portal a stricter limit.
const loginLimiterFor = (max) =>
    rateLimit({
        windowMs: int(process.env.RATE_LIMIT_AUTH_WINDOW_MS, 15 * 60 * 1000),
        limit: max,
        skipSuccessfulRequests: true,
        standardHeaders: 'draft-7',
        legacyHeaders: false,
        message: { error: 'Too many failed attempts from this IP. Please try again later.' },
    });

const loginLimiters = {
    student: loginLimiterFor(int(process.env.RATE_LIMIT_AUTH_MAX, 20)),
    staff: loginLimiterFor(int(process.env.RATE_LIMIT_AUTH_MAX, 20)),
    admin: loginLimiterFor(int(process.env.RATE_LIMIT_ADMIN_AUTH_MAX, 10)),
};

// POST /api/auth/student/register: every attempt counts, successful or not - here the
// abuse is automated account creation, which succeeds.
const registerLimiter = rateLimit({
    windowMs: int(process.env.RATE_LIMIT_REGISTER_WINDOW_MS, 60 * 60 * 1000),
    limit: int(process.env.RATE_LIMIT_REGISTER_MAX, 10),
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many registrations from this IP. Please try again later.' },
});

const generalLimiter = rateLimit({
    windowMs: int(process.env.RATE_LIMIT_WINDOW_MS, 60 * 1000),
    limit: int(process.env.RATE_LIMIT_MAX, 300),
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many requests. Please slow down.' },
});

module.exports = { loginLimiters, registerLimiter, generalLimiter };
