const { notifyError } = require('../services/alerts');

/**
 * A known, expected failure (bad input, missing resource, access denied)
 * whose message is safe to show the client. Anything thrown that is NOT an
 * AppError is treated as unexpected and never sent to the client verbatim.
 */
class AppError extends Error {
    /**
     * @param {number} statusCode
     * @param {string} message  safe to show the user
     * @param {{ code?: string, details?: object }} [extra]  `code` is a stable,
     *   machine-readable reason a client can branch on (e.g. OPEN_JOBS);
     *   `details` carries data for that branch.
     */
    constructor(statusCode, message, { code, details } = {}) {
        super(message);
        this.statusCode = statusCode;
        this.isAppError = true;
        this.code = code;
        this.details = details;
    }
}

/** Forwards a rejected promise from an async handler to next(err). */
const asyncHandler = (fn) => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
};

// Standard PostgreSQL error codes -> safe status + message. The raw driver
// message (table/column names, query fragments) is logged server-side only.
const PG_ERROR_MAP = {
    '23505': { status: 409, message: 'A record with that value already exists.' },
    '23503': { status: 400, message: 'This action references a record that does not exist.' },
    '23514': { status: 400, message: 'One or more values violate a data constraint.' },
    '23502': { status: 400, message: 'A required field was missing.' },
    '22P02': { status: 400, message: 'One or more values were in an invalid format.' },
    '22001': { status: 400, message: 'A value is longer than the field allows.' },
    '57014': { status: 503, message: 'The request took too long. Please try again.' }, // statement_timeout
    // Deadlock / serialization failure that survived withTransaction's retries.
    '40P01': { status: 409, message: 'Someone else changed this at the same moment. Please try again.', code: 'CONCURRENT_UPDATE' },
    '40001': { status: 409, message: 'Someone else changed this at the same moment. Please try again.', code: 'CONCURRENT_UPDATE' },
};

// A procedure may attach a machine-readable reason as the exception HINT
// (e.g. STAFF_OFF_DUTY); only simple upper-case tokens are passed through.
const HINT_CODE = /^[A-Z][A-Z_]{2,40}$/;

const body = (message, code, details) => {
    const out = { error: message };
    if (code) out.code = code;
    if (details) out.details = details;
    return out;
};

// Custom SQLSTATEs raised by our stored procedures (see migration 003):
// FM + the HTTP status, with a message written to be shown to the user.
const FM_CODE = /^FM(4\d\d)$/;

// Express 5 error-handling middleware: 4 args required by the signature.
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
    if (err && err.isAppError) {
        return res.status(err.statusCode).json(body(err.message, err.code, err.details));
    }

    // body-parser failures. Previously a malformed JSON body fell through to
    // the generic branch and came back as a 500.
    if (err && err.type === 'entity.parse.failed') {
        return res.status(400).json({ error: 'Request body is not valid JSON.' });
    }
    if (err && err.type === 'entity.too.large') {
        return res.status(413).json({ error: 'Request body is too large.' });
    }

    if (err && typeof err.code === 'string') {
        const fm = err.code.match(FM_CODE);
        if (fm) {
            const code = typeof err.hint === 'string' && HINT_CODE.test(err.hint) ? err.hint : undefined;
            return res.status(parseInt(fm[1], 10)).json(body(err.message, code));
        }
        if (PG_ERROR_MAP[err.code]) {
            console.error(`[db:${err.code}] ${req.method} ${req.originalUrl}:`, err.message);
            const mapped = PG_ERROR_MAP[err.code];
            if (mapped.status >= 500) notifyError(req, err, mapped.status);
            return res.status(mapped.status).json(body(mapped.message, mapped.code));
        }
    }

    console.error(`Unhandled error on ${req.method} ${req.originalUrl}:`, err);
    notifyError(req, err, 500);
    return res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
}

function notFoundHandler(req, res) {
    res.status(404).json({ error: `Cannot ${req.method} ${req.originalUrl}` });
}

module.exports = { AppError, asyncHandler, errorHandler, notFoundHandler };
