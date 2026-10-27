/**
 * A stand-in university identity provider for the browser tests: OpenID Connect
 * discovery, a sign-in page where the person types their university address, a
 * token endpoint that checks the PKCE verifier and client secret, and a key set.
 * It signs real RS256 ID tokens. Nothing here is a real login - it lets the
 * browser tests walk the whole single sign-on journey without an app registration.
 */
const crypto = require('crypto');
const http = require('http');

const b64u = (v) => Buffer.from(v).toString('base64url');

function startMockIdp({ port = 0, clientId, clientSecret } = {}) {
    const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwk = { ...pair.publicKey.export({ format: 'jwk' }), kid: 'mock-1', alg: 'RS256', use: 'sig' };
    const codes = new Map();
    let origin = '';

    const sign = (claims) => {
        const head = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'mock-1' }));
        const body = b64u(JSON.stringify(claims));
        return `${head}.${body}.${crypto.sign('sha256', Buffer.from(`${head}.${body}`), pair.privateKey).toString('base64url')}`;
    };
    const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

    const server = http.createServer(async (req, res) => {
        const url = new URL(req.url, origin);
        const json = (status, body) => res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
        if (url.pathname === '/.well-known/openid-configuration') {
            return json(200, { issuer: origin, authorization_endpoint: `${origin}/authorize`, token_endpoint: `${origin}/token`, jwks_uri: `${origin}/jwks` });
        }
        if (url.pathname === '/jwks') return json(200, { keys: [jwk] });
        if (url.pathname === '/authorize' && req.method === 'GET') {
            const hidden = [...url.searchParams].map(([k, v]) => `<input type="hidden" name="${escapeHtml(k)}" value="${escapeHtml(v)}">`).join('');
            return res.writeHead(200, { 'Content-Type': 'text/html' }).end(
                `<!doctype html><meta charset="utf-8"><title>University sign-in</title><h1>University sign-in</h1>
                 <form method="post" action="/authorize">${hidden}<label>University email <input name="login_email" type="email" autofocus></label>
                 <button type="submit">Continue</button></form>`
            );
        }
        if (url.pathname === '/authorize' && req.method === 'POST') {
            let raw = '';
            for await (const chunk of req) raw += chunk;
            const f = Object.fromEntries(new URLSearchParams(raw));
            const code = b64u(crypto.randomBytes(16));
            codes.set(code, { email: f.login_email, nonce: f.nonce, challenge: f.code_challenge, redirectUri: f.redirect_uri, used: false });
            const back = new URL(f.redirect_uri);
            back.searchParams.set('code', code);
            back.searchParams.set('state', f.state);
            return res.writeHead(303, { Location: back.toString() }).end();
        }
        if (url.pathname === '/token' && req.method === 'POST') {
            let raw = '';
            for await (const chunk of req) raw += chunk;
            const f = Object.fromEntries(new URLSearchParams(raw));
            const entry = codes.get(f.code);
            const challenge = f.code_verifier ? crypto.createHash('sha256').update(f.code_verifier).digest('base64url') : null;
            if (!entry || entry.used || f.client_id !== clientId || f.client_secret !== clientSecret || f.redirect_uri !== entry.redirectUri || challenge !== entry.challenge) {
                return json(400, { error: 'invalid_grant' });
            }
            entry.used = true;
            const now = Math.floor(Date.now() / 1000);
            return json(200, {
                token_type: 'Bearer',
                access_token: 'unused',
                id_token: sign({ iss: origin, aud: clientId, sub: entry.email, email: entry.email, email_verified: true, nonce: entry.nonce, iat: now, exp: now + 300 }),
            });
        }
        return json(404, {});
    });

    return new Promise((resolve) =>
        server.listen(port, '127.0.0.1', () => {
            origin = `http://127.0.0.1:${server.address().port}`;
            resolve({ url: origin, close: () => { server.closeAllConnections(); server.close(); } });
        })
    );
}

module.exports = { startMockIdp };

// Run on its own: node mock-idp.js  (MOCK_IDP_PORT, MOCK_IDP_CLIENT_ID, MOCK_IDP_CLIENT_SECRET)
if (require.main === module) {
    startMockIdp({ port: Number(process.env.MOCK_IDP_PORT) || 0, clientId: process.env.MOCK_IDP_CLIENT_ID, clientSecret: process.env.MOCK_IDP_CLIENT_SECRET }).then((idp) =>
        console.log(`mock identity provider: ${idp.url}`)
    );
}
