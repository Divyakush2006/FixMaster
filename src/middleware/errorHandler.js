/**
 * A known, expected failure (bad input, missing resource, access denied)
 * whose message is safe to show the client. Anything thrown that is NOT an
 * AppError is treated as unexpected and never sent to the client verbatim.
 */
class AppError extends Error {
    constructor(statusCode, message) {
        super(message);
        this.statusCode = statusCode;
        this.isAppError = true;
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
};

// Custom SQLSTATEs raised by our stored procedures (see migration 003):
// FM + the HTTP status, with a message written to be shown to the user.
const FM_CODE = /^FM(4\d\d)$/;

// Express 5 error-handling middleware: 4 args required by the signature.
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
    if (err && err.isAppError) {
        return res.status(err.statusCode).json({ error: err.message });
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
            return res.status(parseInt(fm[1], 10)).json({ error: err.message });
        }
        if (PG_ERROR_MAP[err.code]) {
            console.error(`[db:${err.code}] ${req.method} ${req.originalUrl}:`, err.message);
            const mapped = PG_ERROR_MAP[err.code];
            return res.status(mapped.status).json({ error: mapped.message });
        }
    }

    console.error(`Unhandled error on ${req.method} ${req.originalUrl}:`, err);
    return res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
}

function notFoundHandler(req, res) {
    res.status(404).json({ error: `Cannot ${req.method} ${req.originalUrl}` });
}

module.exports = { AppError, asyncHandler, errorHandler, notFoundHandler };
