const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Browsers attach an Origin header to every cross-site POST/PUT/PATCH/DELETE.
// When the deployment lists its web origins (CORS_ORIGIN, mandatory in
// production), a state-changing request from any other origin is refused
// before it reaches a route. This also covers "login CSRF" (forcing a victim's
// browser to sign in as the attacker), which the session cookie alone cannot.
// Requests without an Origin (curl, server-to-server, tests) are not browsers
// and are unaffected - they have no ambient cookies to abuse.
function originGuard(req, res, next) {
    const configured = process.env.CORS_ORIGIN;
    if (!configured || SAFE_METHODS.has(req.method)) return next();
    const origin = req.headers.origin;
    if (!origin) return next();
    const allowed = configured.split(',').map((o) => o.trim().replace(/\/+$/, ''));
    if (allowed.includes(origin) || origin === `${req.protocol}://${req.get('host')}`) return next();
    return res.status(403).json({ error: 'Request blocked: it did not come from this application.', code: 'ORIGIN' });
}

module.exports = originGuard;
