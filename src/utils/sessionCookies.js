const crypto = require('crypto');

// Browser sessions travel in cookies the page's JavaScript cannot read, so a
// script injected into the page cannot steal the session.
//
//   fm_session  the signed token. HttpOnly, SameSite=Strict, Secure on HTTPS,
//               sent to /api only.
//   fm_csrf     a random value the web app copies into the X-CSRF-Token header
//               of every state-changing request (double-submit). Readable by
//               script by design; useless without the session cookie.
//
// API clients and tests keep using `Authorization: Bearer <token>`; a request
// carrying that header never uses cookies and is not subject to CSRF checks.
// A client opts in to cookies by sending `X-Session-Transport: cookie` when it
// signs in (the web app does).

const SESSION_COOKIE = 'fm_session';
const CSRF_COOKIE = 'fm_csrf';
const TRANSPORT_HEADER = 'x-session-transport';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function parseCookies(header) {
    const out = {};
    if (!header) return out;
    for (const part of header.split(';')) {
        const i = part.indexOf('=');
        if (i < 0) continue;
        const name = part.slice(0, i).trim();
        if (!name || name in out) continue; // first one wins
        try {
            out[name] = decodeURIComponent(part.slice(i + 1).trim());
        } catch {
            // an undecodable cookie is ignored, not trusted
        }
    }
    return out;
}

const wantsCookies = (req) => String(req.headers[TRANSPORT_HEADER] || '').toLowerCase() === 'cookie';

const sameValue = (a, b) => {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    const x = Buffer.from(a);
    const y = Buffer.from(b);
    return x.length === y.length && crypto.timingSafeEqual(x, y);
};

/** Starts a cookie session for `token` (expiring at `expSeconds`, a JWT `exp`). */
function setSessionCookies(req, res, token, expSeconds) {
    const secure = req.secure; // honours X-Forwarded-Proto when TRUST_PROXY is set
    const maxAge = Math.max(0, expSeconds * 1000 - Date.now());
    res.cookie(SESSION_COOKIE, token, { httpOnly: true, secure, sameSite: 'strict', path: '/api', maxAge });
    res.cookie(CSRF_COOKIE, crypto.randomBytes(24).toString('base64url'), { httpOnly: false, secure, sameSite: 'strict', path: '/', maxAge });
}

function clearSessionCookies(req, res) {
    const secure = req.secure;
    res.clearCookie(SESSION_COOKIE, { httpOnly: true, secure, sameSite: 'strict', path: '/api' });
    res.clearCookie(CSRF_COOKIE, { httpOnly: false, secure, sameSite: 'strict', path: '/' });
}

/**
 * Where a request's credentials came from: the Authorization header wins;
 * otherwise the session cookie. `csrfOk` is only meaningful for cookies.
 */
function credentialsOf(req) {
    const header = req.headers.authorization;
    if (header && header.startsWith('Bearer ')) {
        return { via: 'bearer', token: header.slice('Bearer '.length).trim(), csrfOk: true };
    }
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies[SESSION_COOKIE];
    if (!token) return { via: null, token: null, csrfOk: true };
    const safe = SAFE_METHODS.has(req.method);
    return { via: 'cookie', token, csrfOk: safe || sameValue(cookies[CSRF_COOKIE], req.headers['x-csrf-token']) };
}

module.exports = { SESSION_COOKIE, CSRF_COOKIE, parseCookies, wantsCookies, setSessionCookies, clearSessionCookies, credentialsOf };
