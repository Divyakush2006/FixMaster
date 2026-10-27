const crypto = require('crypto');
const tracing = require('./tracing');

/**
 * S3-compatible object storage (Amazon S3, Cloudflare R2, MinIO, SeaweedFS ...)
 * with no SDK: requests are signed with AWS Signature Version 4 using Node's
 * own crypto, so there is nothing extra to install, audit or keep patched.
 *
 *   S3_BUCKET             turns object storage on (ticket photos then live here, not on disk)
 *   S3_ENDPOINT           e.g. https://<account>.r2.cloudflarestorage.com or http://minio:9000.
 *                         Omit for Amazon S3 (https://s3.<region>.amazonaws.com).
 *   S3_REGION             default "us-east-1" ("auto" for R2)
 *   S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY
 *   S3_FORCE_PATH_STYLE   "true" (default with S3_ENDPOINT): <endpoint>/<bucket>/<key>;
 *                         "false" (default for Amazon): <bucket>.<host>/<key>
 *   S3_PREFIX             key prefix, default "ticket-photos/"
 *   S3_SSE                "true" asks the store to encrypt at rest (AES256)
 *
 * Use a bucket that is private: photos are only ever served through the API,
 * after it has checked who may see the ticket.
 */

const TIMEOUT_MS = 15000;
const sha256Hex = (data) => crypto.createHash('sha256').update(data).digest('hex');
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();

/** RFC 3986 encoding, as AWS requires (encodeURIComponent leaves !'()* alone). */
const encode = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/**
 * AWS Signature Version 4. Signs `method url` with every header in `headers` (plus host and
 * x-amz-date) and returns the headers to send, Authorization included.
 * `url` is a URL whose path is already percent-encoded; S3 signs the path as is.
 */
function sigv4({ method, url, headers = {}, payloadHash, body = '', region, service = 's3', accessKeyId, secretAccessKey, now = new Date() }) {
    const u = new URL(url);
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const day = amzDate.slice(0, 8);
    const all = { ...Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v).trim().replace(/\s+/g, ' ')])), host: u.host, 'x-amz-date': amzDate };
    const names = Object.keys(all).sort();
    const query = [...u.searchParams].map(([k, v]) => [encode(k), encode(v)]).sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('&');
    const canonical = [method, u.pathname || '/', query, ...names.map((n) => `${n}:${all[n]}`), '', names.join(';'), payloadHash || sha256Hex(body)].join('\n');
    const scope = `${day}/${region}/${service}/aws4_request`;
    const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonical)].join('\n');
    const key = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, day), region), service), 'aws4_request');
    const signature = crypto.createHmac('sha256', key).update(toSign).digest('hex');
    return { ...all, Authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}` };
}

function config() {
    const { S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY } = process.env;
    if (!S3_BUCKET) return null;
    if (!S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY) throw new Error('S3_BUCKET is set but S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY are not');
    const region = process.env.S3_REGION || 'us-east-1';
    const custom = (process.env.S3_ENDPOINT || '').trim().replace(/\/+$/, '');
    const pathStyle = process.env.S3_FORCE_PATH_STYLE ? process.env.S3_FORCE_PATH_STYLE === 'true' : !!custom;
    return {
        bucket: S3_BUCKET,
        region,
        endpoint: custom || `https://s3.${region}.amazonaws.com`,
        pathStyle,
        prefix: process.env.S3_PREFIX === undefined ? 'ticket-photos/' : process.env.S3_PREFIX,
        sse: process.env.S3_SSE === 'true',
        accessKeyId: S3_ACCESS_KEY_ID,
        secretAccessKey: S3_SECRET_ACCESS_KEY,
    };
}

const isEnabled = () => !!process.env.S3_BUCKET;

function urlFor(cfg, key) {
    const path = key.split('/').map(encode).join('/');
    const base = new URL(cfg.endpoint);
    if (cfg.pathStyle) return `${base.protocol}//${base.host}/${encode(cfg.bucket)}/${path}`;
    return `${base.protocol}//${cfg.bucket}.${base.host}/${path}`;
}

async function send(method, key, { body, contentType } = {}) {
    const cfg = config();
    const url = urlFor(cfg, cfg.prefix + key);
    const payload = body || Buffer.alloc(0);
    const payloadHash = sha256Hex(payload);
    const headers = { 'x-amz-content-sha256': payloadHash };
    if (contentType) headers['content-type'] = contentType;
    if (cfg.sse && method === 'PUT') headers['x-amz-server-side-encryption'] = 'AES256';
    const signed = sigv4({ method, url, headers, payloadHash, region: cfg.region, accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey });
    delete signed.host; // the HTTP client sends it from the address
    return tracing.withSpan(
        `object_storage.${method.toLowerCase()}`,
        { 'http.request.method': method },
        () => fetch(url, { method, headers: signed, body: method === 'PUT' ? payload : undefined, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'error' }),
        'client'
    );
}

async function put(key, buffer, contentType) {
    const res = await send('PUT', key, { body: buffer, contentType });
    if (!res.ok) throw new Error(`object storage refused the upload (${res.status})`);
}

/** { buffer, contentType } or null when there is no such object. */
async function get(key) {
    const res = await send('GET', key);
    if (res.status === 404) {
        await res.arrayBuffer();
        return null;
    }
    if (!res.ok) throw new Error(`object storage could not read the file (${res.status})`);
    return { buffer: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get('content-type') };
}

async function remove(key) {
    const res = await send('DELETE', key);
    await res.arrayBuffer();
    if (!res.ok && res.status !== 404) throw new Error(`object storage could not delete the file (${res.status})`);
}

module.exports = { isEnabled, config, sigv4, put, get, remove };
