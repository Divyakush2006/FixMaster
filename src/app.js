require('dotenv').config({ quiet: true });
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const db = require('./config/db');
const { requestLogger } = require('./middleware/requestLogger');
const { generalLimiter } = require('./middleware/rateLimiters');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');

// ---- Configuration checks (fail at startup, not on the first request) --------

const isProduction = process.env.NODE_ENV === 'production';

// SHA-256 of signing secrets that have been published (earlier versions of
// this repository shipped one as an "example" value). Anyone can forge a
// token for any user - including ADMIN - with a published secret, so they are
// refused in production. Only the hashes are kept, never the secrets.
const PUBLISHED_JWT_SECRET_HASHES = new Set(['595f9a3dfd65ec7992d8dafbfbc0fb2b751110268d0d4a230a35a074f81c3da2']);
const sha256 = (value) => require('crypto').createHash('sha256').update(value).digest('hex');

if (!process.env.JWT_SECRET) {
    if (isProduction || process.env.NODE_ENV === 'test') {
        throw new Error('JWT_SECRET is not set. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"');
    }
    // Local development without a configured secret: use a random one for
    // this process only, so no secret ever needs to be committed. Sessions
    // end when the API restarts; set JWT_SECRET in .env to keep them.
    process.env.JWT_SECRET = require('crypto').randomBytes(48).toString('hex');
    console.warn('[WARN] JWT_SECRET is not set; using a random per-process secret (development only). Sessions end on restart.');
}
const publishedSecret = PUBLISHED_JWT_SECRET_HASHES.has(sha256(process.env.JWT_SECRET));
if (isProduction) {
    if (publishedSecret) {
        throw new Error('JWT_SECRET has been published and must not be used. Set a unique secret for production.');
    }
    if (process.env.JWT_SECRET.length < 32) {
        throw new Error('JWT_SECRET must be at least 32 characters in production.');
    }
    if (!process.env.CORS_ORIGIN) {
        throw new Error('CORS_ORIGIN must be set in production (comma-separated list of allowed frontend origins).');
    }
} else if (publishedSecret && process.env.NODE_ENV !== 'test') {
    console.warn('[WARN] JWT_SECRET is a published value. Replace it in .env; never deploy with it.');
}

// Behind a reverse proxy / load balancer, req.ip is the proxy's address
// unless Express is told to trust it - and then every user shares one rate
// limit bucket. TRUST_PROXY = number of proxy hops (e.g. 1), or "true".
function trustProxySetting(value) {
    if (!value || value === 'false') return false;
    if (value === 'true') return true;
    const hops = parseInt(value, 10);
    return Number.isFinite(hops) ? hops : value; // also accepts 'loopback', CIDRs, ...
}

// ---- App ----------------------------------------------------------------------

const app = express();
app.set('trust proxy', trustProxySetting(process.env.TRUST_PROXY));

app.use(requestLogger);
app.use(helmet());
app.use(
    cors({
        origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim()) : true,
        exposedHeaders: ['X-Total-Count', 'X-Request-Id'],
        credentials: true, // the web app's session cookie, from the listed origins only
    })
);
app.use(require('./middleware/originGuard'));
app.use(express.json({ limit: '100kb' }));

// Liveness: the process is up. Never touches the database, so a database
// outage doesn't make an orchestrator kill and restart healthy API pods.
app.get('/api/health/live', (req, res) => res.json({ status: 'ok' }));

// Readiness: the API can actually serve requests (database reachable).
app.get('/api/health', async (req, res) => {
    try {
        const result = await db.query('SELECT NOW() AS now');
        res.json({ status: 'ok', server_time: result.rows[0].now });
    } catch (err) {
        console.error('Health check: database unreachable:', err.message);
        res.status(503).json({ status: 'error', message: 'Database connection error' });
    }
});

app.use('/api', generalLimiter);
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/complaints', require('./routes/complaintRoutes'));
app.use('/api/dispatch', require('./routes/dispatchRoutes'));
app.use('/api/feedback', require('./routes/feedbackRoutes'));
app.use('/api/analytics', require('./routes/analyticsRoutes'));
app.use('/api/meta', require('./routes/metaRoutes'));
app.use('/api/me', require('./routes/meRoutes'));
app.use('/api/notifications', require('./routes/notificationRoutes'));
app.use('/api/residents', require('./routes/residentRoutes'));
app.use('/api/admin', require('./routes/adminRoutes'));
app.use('/api/ai', require('./routes/aiRoutes'));
app.use('/api/assistant', require('./routes/assistantRoutes'));

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
