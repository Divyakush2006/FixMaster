const crypto = require('crypto');

const JSON_LOGS = process.env.LOG_FORMAT === 'json' || process.env.NODE_ENV === 'production';
const QUIET = process.env.NODE_ENV === 'test' && process.env.LOG_REQUESTS !== 'true';

/**
 * Gives every request an id (echoed back as X-Request-Id, and reused if the
 * caller or a proxy already set one) and writes one log line when it ends:
 * JSON in production for log aggregation, a compact line in development.
 * Health checks are not logged - orchestrators poll them constantly.
 */
function requestLogger(req, res, next) {
    const incoming = req.get('X-Request-Id');
    req.id = incoming && /^[\w.-]{1,64}$/.test(incoming) ? incoming : crypto.randomUUID();
    res.set('X-Request-Id', req.id);

    if (QUIET || req.path.startsWith('/api/health')) return next();

    const start = process.hrtime.bigint();
    res.on('finish', () => {
        const ms = Number(process.hrtime.bigint() - start) / 1e6;
        const entry = {
            time: new Date().toISOString(),
            request_id: req.id,
            method: req.method,
            path: req.originalUrl.split('?')[0],
            status: res.statusCode,
            duration_ms: Math.round(ms),
            user_id: req.user ? req.user.userId : undefined,
        };
        if (JSON_LOGS) {
            console.log(JSON.stringify(entry));
        } else {
            console.log(`${entry.method} ${entry.path} ${entry.status} ${entry.duration_ms}ms`);
        }
    });
    next();
}

module.exports = { requestLogger };
