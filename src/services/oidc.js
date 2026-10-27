const crypto = require('crypto');

/**
 * University single sign-on over OpenID Connect (authorization code + PKCE).
 * Works with any standards-following provider - Google Workspace, Microsoft
 * Entra ID, Keycloak - using only the discovery document and the keys it names.
 *
 *   OIDC_ISSUER         the provider's issuer URL (its discovery document is at
 *                       <issuer>/.well-known/openid-configuration). SSO is off
 *                       until this, the client id and the secret are all set.
 *                       Google: https://accounts.google.com
 *                       Microsoft: https://login.microsoftonline.com/<tenant-id>/v2.0
 *   OIDC_CLIENT_ID / OIDC_CLIENT_SECRET   the app registration
 *   OIDC_REDIRECT_URI   registered callback; default <APP_URL>/api/auth/sso/callback
 *   OIDC_SCOPES         default "openid email profile"
 *   OIDC_LABEL          button wording, default "your university account"
 *   OIDC_ALLOWED_DOMAINS  mail domains accepted (default: the student domains)
 *   OIDC_DOMAIN_HINT    optional "hd"/"domain_hint" sent to the provider
 *
 * Nothing here reads a token's claims before its signature has been checked
 * against the provider's published keys, and the ID token is only believed for
 * this app (audience), this sign-in (nonce) and this provider (issuer).
 */

const TIMEOUT_MS = 10000;
const CLOCK_SKEW_SECONDS = 60;
const CACHE_MS = 60 * 60 * 1000;

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const sha256 = (s) => crypto.createHash('sha256').update(s).digest();

const trimSlash = (s) => String(s || '').replace(/\/+$/, '');

function config() {
    const { OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET } = process.env;
    if (!OIDC_ISSUER || !OIDC_CLIENT_ID || !OIDC_CLIENT_SECRET) return null;
    const appUrl = (process.env.APP_URL || (process.env.CORS_ORIGIN || '').split(',')[0] || 'http://localhost:3000').trim();
    return {
        issuer: trimSlash(OIDC_ISSUER.trim()),
        clientId: OIDC_CLIENT_ID.trim(),
        clientSecret: OIDC_CLIENT_SECRET,
        redirectUri: (process.env.OIDC_REDIRECT_URI || `${trimSlash(appUrl)}/api/auth/sso/callback`).trim(),
        scopes: (process.env.OIDC_SCOPES || 'openid email profile').trim(),
        label: (process.env.OIDC_LABEL || 'your university account').trim(),
        domainHint: (process.env.OIDC_DOMAIN_HINT || '').trim() || null,
        allowedDomains: process.env.OIDC_ALLOWED_DOMAINS
            ? process.env.OIDC_ALLOWED_DOMAINS.split(',').map((d) => d.trim().toLowerCase().replace(/^@/, '')).filter(Boolean)
            : require('../config/identity').studentEmailDomains(),
    };
}

const isEnabled = () => config() !== null;

/** A provider address must be https; plain http is allowed only for a provider on this same machine (tests, local Keycloak). */
function assertSecureUrl(value, what) {
    let url;
    try {
        url = new URL(value);
    } catch {
        throw new Error(`${what} is not a valid address`);
    }
    const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local && process.env.NODE_ENV !== 'production')) {
        throw new Error(`${what} must use https`);
    }
    return url;
}

async function fetchJson(url, init = {}) {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'error' });
    const text = await res.text();
    let body = null;
    try {
        body = JSON.parse(text);
    } catch {
        /* not JSON */
    }
    return { ok: res.ok, status: res.status, body };
}

// ---- Discovery and keys (cached) ------------------------------------------------------

let discoveryCache = { key: null, at: 0, doc: null };
let jwksCache = { uri: null, at: 0, keys: null };

async function discover(cfg = config()) {
    if (discoveryCache.key === cfg.issuer && Date.now() - discoveryCache.at < CACHE_MS) return discoveryCache.doc;
    assertSecureUrl(cfg.issuer, 'The sign-in provider address');
    const { ok, body } = await fetchJson(`${cfg.issuer}/.well-known/openid-configuration`);
    if (!ok || !body) throw new Error('the sign-in provider did not return its configuration');
    if (trimSlash(body.issuer) !== cfg.issuer) throw new Error('the provider names a different issuer than the one configured');
    for (const field of ['authorization_endpoint', 'token_endpoint', 'jwks_uri']) {
        assertSecureUrl(body[field], `the provider's ${field}`);
    }
    discoveryCache = { key: cfg.issuer, at: Date.now(), doc: body };
    return body;
}

async function signingKeys(doc, { refresh = false } = {}) {
    if (!refresh && jwksCache.uri === doc.jwks_uri && Date.now() - jwksCache.at < CACHE_MS) return jwksCache.keys;
    const { ok, body } = await fetchJson(doc.jwks_uri);
    if (!ok || !body || !Array.isArray(body.keys)) throw new Error('the provider did not return its signing keys');
    jwksCache = { uri: doc.jwks_uri, at: Date.now(), keys: body.keys };
    return body.keys;
}

/** Forgets cached discovery and keys (tests). */
function _reset() {
    discoveryCache = { key: null, at: 0, doc: null };
    jwksCache = { uri: null, at: 0, keys: null };
}

// ---- Starting a sign-in -------------------------------------------------------------

/** The values one sign-in attempt needs to remember between leaving for the provider and coming back. */
function newAttempt() {
    const verifier = b64u(crypto.randomBytes(48));
    return { state: b64u(crypto.randomBytes(24)), nonce: b64u(crypto.randomBytes(24)), verifier };
}

async function authorizationUrl(attempt) {
    const cfg = config();
    const doc = await discover(cfg);
    const url = new URL(doc.authorization_endpoint);
    const params = {
        response_type: 'code',
        client_id: cfg.clientId,
        redirect_uri: cfg.redirectUri,
        scope: cfg.scopes,
        state: attempt.state,
        nonce: attempt.nonce,
        code_challenge: b64u(sha256(attempt.verifier)),
        code_challenge_method: 'S256',
    };
    if (cfg.domainHint) {
        params.hd = cfg.domainHint;
        params.domain_hint = cfg.domainHint;
    }
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    return url.toString();
}

// ---- Finishing it ---------------------------------------------------------------------

async function exchangeCode(code, verifier) {
    const cfg = config();
    const doc = await discover(cfg);
    const { ok, body } = await fetchJson(doc.token_endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            redirect_uri: cfg.redirectUri,
            client_id: cfg.clientId,
            client_secret: cfg.clientSecret,
            code_verifier: verifier,
        }).toString(),
    });
    if (!ok || !body || typeof body.id_token !== 'string') throw new Error('the provider refused the sign-in code');
    return body.id_token;
}

const ALGORITHMS = { RS256: { hash: 'sha256' }, ES256: { hash: 'sha256', ieee: true } };

function decodePart(part) {
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}

/**
 * Checks an ID token and returns its claims. Throws on anything doubtful:
 * unknown algorithm (including "none"), unknown key, bad signature, wrong
 * issuer, audience or nonce, or a token outside its validity window.
 */
async function verifyIdToken(idToken, { nonce }) {
    const cfg = config();
    const parts = String(idToken).split('.');
    if (parts.length !== 3) throw new Error('malformed ID token');
    const header = decodePart(parts[0]);
    const alg = ALGORITHMS[header.alg];
    if (!alg) throw new Error('unsupported ID token algorithm');
    const doc = await discover(cfg);

    const pick = (keys) => keys.find((k) => k.kid === header.kid && (!k.use || k.use === 'sig') && (!k.alg || k.alg === header.alg));
    let jwk = pick(await signingKeys(doc));
    if (!jwk) jwk = pick(await signingKeys(doc, { refresh: true })); // the provider may have rotated its keys
    if (!jwk) throw new Error('the ID token is signed with an unknown key');

    const valid = crypto.verify(
        alg.hash,
        Buffer.from(`${parts[0]}.${parts[1]}`),
        { key: crypto.createPublicKey({ key: jwk, format: 'jwk' }), ...(alg.ieee ? { dsaEncoding: 'ieee-p1363' } : {}) },
        Buffer.from(parts[2], 'base64url')
    );
    if (!valid) throw new Error('the ID token signature is not valid');

    const claims = decodePart(parts[1]);
    const now = Math.floor(Date.now() / 1000);
    if (trimSlash(claims.iss) !== cfg.issuer && trimSlash(claims.iss) !== trimSlash(doc.issuer)) throw new Error('the ID token is from a different issuer');
    const audiences = [].concat(claims.aud || []);
    if (!audiences.includes(cfg.clientId)) throw new Error('the ID token is for a different application');
    if (audiences.length > 1 && claims.azp !== cfg.clientId) throw new Error('the ID token was issued to a different party');
    if (typeof claims.exp !== 'number' || claims.exp + CLOCK_SKEW_SECONDS < now) throw new Error('the ID token has expired');
    if (typeof claims.iat === 'number' && claims.iat - CLOCK_SKEW_SECONDS > now) throw new Error('the ID token is dated in the future');
    if (typeof claims.nbf === 'number' && claims.nbf - CLOCK_SKEW_SECONDS > now) throw new Error('the ID token is not valid yet');
    const given = Buffer.from(String(claims.nonce || ''));
    const wanted = Buffer.from(nonce);
    if (given.length !== wanted.length || !crypto.timingSafeEqual(given, wanted)) throw new Error('the ID token belongs to a different sign-in');
    return claims;
}

/**
 * The university mailbox a verified token vouches for, or null. A provider that
 * reports the address as unverified is not believed; one that says nothing
 * (Microsoft) is, because it only issues addresses from its own directory.
 */
function mailboxOf(claims) {
    const cfg = config();
    const raw = claims.email || (String(claims.preferred_username || '').includes('@') ? claims.preferred_username : null);
    if (typeof raw !== 'string') return null;
    if (claims.email_verified === false || claims.email_verified === 'false') return null;
    const email = raw.trim().toLowerCase();
    const at = email.lastIndexOf('@');
    if (at < 1 || !cfg.allowedDomains.includes(email.slice(at + 1))) return null;
    return email;
}

module.exports = { config, isEnabled, newAttempt, authorizationUrl, exchangeCode, verifyIdToken, mailboxOf, _reset };
