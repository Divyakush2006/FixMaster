const crypto = require('crypto');
const net = require('net');

// When the web app is served by Cloudflare Pages, its /api function forwards
// each request here. The API then only sees the function's address, so every
// user would share one rate-limit bucket. The function therefore sends the real
// visitor address in X-Edge-Client-Ip, together with the shared secret
// EDGE_PROXY_SECRET. The address is believed only when the secret matches, so
// nobody else can pick the address they are rate limited under.
// Off (a no-op) until EDGE_PROXY_SECRET is set.

const sameValue = (a, b) => {
    const x = Buffer.from(String(a));
    const y = Buffer.from(String(b));
    return x.length === y.length && crypto.timingSafeEqual(x, y);
};

function edgeClientIp(req, res, next) {
    const secret = process.env.EDGE_PROXY_SECRET;
    if (!secret) return next();
    const given = req.headers['x-edge-secret'];
    const ip = req.headers['x-edge-client-ip'];
    if (typeof given === 'string' && typeof ip === 'string' && sameValue(given, secret) && net.isIP(ip.trim())) {
        Object.defineProperty(req, 'ip', { value: ip.trim(), configurable: true });
    }
    next();
}

module.exports = edgeClientIp;
