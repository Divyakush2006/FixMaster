const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const { photoJourney, JPEG } = require('./support/photo_journey');
const objects = require('../src/services/objectStorage');

// Ticket photos in an S3-compatible bucket. Three kinds of check:
//  - the request signing against a published AWS test vector;
//  - the whole photo journey against an in-process stand-in bucket that checks
//    the signature structure, the payload hash and the clock;
//  - the same journey against a real S3-compatible server when TEST_S3_ENDPOINT is
//    set (SeaweedFS or MinIO; see docs/OPERATIONS.md), which verifies signatures itself.

const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');

describe('AWS Signature Version 4', () => {
    it('matches the published "get-vanilla" test vector', () => {
        const signed = objects.sigv4({
            method: 'GET',
            url: 'https://example.amazonaws.com/',
            region: 'us-east-1',
            service: 'service',
            accessKeyId: 'AKIDEXAMPLE',
            secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
            now: new Date('2015-08-30T12:36:00Z'),
        });
        assert.equal(
            signed.Authorization,
            'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31'
        );
    });

    it('sorts and encodes query parameters like AWS does (get-vanilla-query-order-key-case)', () => {
        const signed = objects.sigv4({
            method: 'GET',
            url: 'https://example.amazonaws.com/?Param2=value2&Param1=value1',
            region: 'us-east-1',
            service: 'service',
            accessKeyId: 'AKIDEXAMPLE',
            secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
            now: new Date('2015-08-30T12:36:00Z'),
        });
        assert.match(signed.Authorization, /Signature=b97d918cfa904a5beff61c982a1b6f458b799221646efd99d3219ec94cdf2500$/);
    });
});

/** A bucket in a few lines of Node: remembers objects, and refuses anything signed wrongly. */
async function startFakeBucket({ accessKeyId, secretAccessKey, bucket }) {
    const store = new Map();
    const log = [];
    const state = { failWrites: false };
    const server = http.createServer(async (req, res) => {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        const body = Buffer.concat(chunks);
        const url = new URL(req.url, 'http://x');
        const entry = { method: req.method, path: url.pathname };
        log.push(entry);
        const deny = (status, code) => res.writeHead(status, { 'Content-Type': 'application/xml' }).end(`<Error><Code>${code}</Code></Error>`);

        const auth = req.headers.authorization || '';
        const m = auth.match(/^AWS4-HMAC-SHA256 Credential=([^/]+)\/(\d{8})\/([^/]+)\/s3\/aws4_request, SignedHeaders=([^,]+), Signature=([0-9a-f]{64})$/);
        if (!m || m[1] !== accessKeyId) return deny(403, 'InvalidAccessKeyId');
        const signedNames = m[4].split(';');
        for (const need of ['host', 'x-amz-content-sha256', 'x-amz-date']) if (!signedNames.includes(need)) return deny(403, 'SignatureDoesNotMatch');
        if (req.headers['x-amz-content-sha256'] !== sha256(body)) return deny(400, 'XAmzContentSHA256Mismatch');
        const amzDate = req.headers['x-amz-date'];
        const skew = Math.abs(Date.parse(amzDate.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z')) - Date.now());
        if (!(skew < 5 * 60 * 1000)) return deny(403, 'RequestTimeTooSkewed');
        // Recompute the signature independently of the code under test.
        const canonical = [
            req.method,
            url.pathname,
            '',
            ...signedNames.map((n) => `${n}:${String(req.headers[n]).trim()}`),
            '',
            m[4],
            req.headers['x-amz-content-sha256'],
        ].join('\n');
        const scope = `${m[2]}/${m[3]}/s3/aws4_request`;
        const toSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256(canonical)}`;
        const h = (k, d) => crypto.createHmac('sha256', k).update(d).digest();
        const key = h(h(h(h(`AWS4${secretAccessKey}`, m[2]), m[3]), 's3'), 'aws4_request');
        if (crypto.createHmac('sha256', key).update(toSign).digest('hex') !== m[5]) return deny(403, 'SignatureDoesNotMatch');

        if (!url.pathname.startsWith(`/${bucket}/`)) return deny(404, 'NoSuchBucket');
        const objectKey = decodeURIComponent(url.pathname.slice(bucket.length + 2));
        entry.key = objectKey;
        entry.sse = req.headers['x-amz-server-side-encryption'];
        if (req.method === 'PUT') {
            if (state.failWrites) return deny(500, 'InternalError');
            store.set(objectKey, { body, type: req.headers['content-type'] });
            return res.writeHead(200).end();
        }
        if (req.method === 'GET') {
            const found = store.get(objectKey);
            if (!found) return deny(404, 'NoSuchKey');
            return res.writeHead(200, { 'Content-Type': found.type, 'Content-Length': found.body.length }).end(found.body);
        }
        if (req.method === 'DELETE') {
            store.delete(objectKey);
            return res.writeHead(204).end();
        }
        return deny(405, 'MethodNotAllowed');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    return {
        url: `http://127.0.0.1:${server.address().port}`,
        store,
        log,
        state,
        close: () => new Promise((resolve) => {
            server.closeAllConnections();
            server.close(resolve);
        }),
    };
}

describe('ticket photos in an S3-compatible bucket (stand-in bucket)', () => {
    const creds = { accessKeyId: 'AKIAEXAMPLEKEY', secretAccessKey: 'a/long+secret/key-for-the-tests', bucket: 'fixmaster-test' };
    let bucket;
    const saved = {};
    const ENV = ['S3_BUCKET', 'S3_ENDPOINT', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_REGION', 'S3_SSE'];

    photoJourney({
        configure: async () => {
            bucket = await startFakeBucket(creds);
            for (const k of ENV) saved[k] = process.env[k];
            Object.assign(process.env, { S3_BUCKET: creds.bucket, S3_ENDPOINT: bucket.url, S3_ACCESS_KEY_ID: creds.accessKeyId, S3_SECRET_ACCESS_KEY: creds.secretAccessKey, S3_REGION: 'ap-south-1', S3_SSE: 'true' });
        },
        teardown: async () => {
            for (const k of ENV) {
                if (saved[k] === undefined) delete process.env[k];
                else process.env[k] = saved[k];
            }
            await bucket.close();
        },
        keys: async () => [...bucket.store.keys()].filter((k) => k.startsWith('ticket-photos/')).map((k) => k.slice('ticket-photos/'.length)),
        extra: (ctx) => {
            it('a bucket that refuses the write fails the upload and leaves the ticket without a photo', async () => {
                const { t, vihaan, ticket, put } = ctx();
                bucket.state.failWrites = true;
                try {
                    const r = await put(vihaan, JPEG);
                    assert.ok(r.status >= 500, `status ${r.status}`);
                    assert.equal((await t.api(`/complaints/${ticket}`, { token: vihaan })).data.photo_evidence_url, null, 'nothing points at a file that was not stored');
                } finally {
                    bucket.state.failWrites = false;
                }
            });

            it('writes under the configured bucket and prefix, and asks for encryption at rest', async () => {
                const { vihaan, put } = ctx();
                bucket.log.length = 0;
                assert.equal((await put(vihaan, JPEG)).status, 200);
                const write = bucket.log.find((e) => e.method === 'PUT');
                assert.ok(write.path.startsWith('/fixmaster-test/ticket-photos/'), write.path);
                assert.equal(write.sse, 'AES256');
            });

            it('stops with a clear message if the bucket is named but the keys are missing', () => {
                const keep = process.env.S3_SECRET_ACCESS_KEY;
                delete process.env.S3_SECRET_ACCESS_KEY;
                try {
                    assert.throws(() => objects.config(), /S3_ACCESS_KEY_ID \/ S3_SECRET_ACCESS_KEY/);
                } finally {
                    process.env.S3_SECRET_ACCESS_KEY = keep;
                }
            });
        },
    });
});
