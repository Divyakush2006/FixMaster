require('dotenv').config({ quiet: true });
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const db = require('./config/db');
const { requestLogger } = require('./middleware/requestLogger');
const { generalLimiter } = require('./middleware/rateLimiters');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');

// ---- Configuration checks (fail at startup, not on the first request) --------

const EXAMPLE_JWT_SECRET = 'fixmaster_super_secure_jwt_secret_2026_vit_deepika_j';
const isProduction = process.env.NODE_ENV === 'production';

if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET is not set. Copy .env.example to .env and set a real secret.');
}
if (isProduction) {
    // Anyone who can read the repo knows the example secret and could forge a
    // token for any user, including ADMIN.
    if (process.env.JWT_SECRET === EXAMPLE_JWT_SECRET) {
        throw new Error('JWT_SECRET is still the committed example value. Set a unique secret for production.');
    }
    if (process.env.JWT_SECRET.length < 32) {
        throw new Error('JWT_SECRET must be at least 32 characters in production.');
    }
    if (!process.env.CORS_ORIGIN) {
        throw new Error('CORS_ORIGIN must be set in production (comma-separated list of allowed frontend origins).');
    }
} else if (process.env.JWT_SECRET === EXAMPLE_JWT_SECRET && process.env.NODE_ENV !== 'test') {
    console.warn('[WARN] JWT_SECRET is the committed example value. Fine for local dev, never deploy like this.');
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
    })
);
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
app.use('/api/admin', require('./routes/adminRoutes'));

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
