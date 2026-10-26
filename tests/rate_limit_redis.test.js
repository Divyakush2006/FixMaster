const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

// Rate limits shared through Redis (several API servers count as one), and the
// API carrying on when Redis is down. The Redis tests run when TEST_REDIS_URL
// points at a Redis (CI provides one; locally:
//   docker run --rm -d -p 6390:6379 redis:7-alpine
//   TEST_REDIS_URL=redis://127.0.0.1:6390 npm test).

const REDIS = process.env.TEST_REDIS_URL;
const opened = [];

// A stand-in for one API server: a real Express app with the limiter in front.
const serverWith = (mw) =>
    new Promise((resolve) => {
        const app = express();
        app.use(mw);
        app.get('/', (req, res) => res.send('ok'));
        const s = app.listen(0, '127.0.0.1', () => {
            opened.push(s);
            resolve(s);
        });
    });
const hit = async (s) => (await fetch(`http://127.0.0.1:${s.address().port}/`)).status;
const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const options = (extra) => ({ windowMs: 60_000, limit: 4, standardHeaders: false, legacyHeaders: false, ...extra });

describe('rate limits across servers (Redis)', { skip: REDIS ? false : 'TEST_REDIS_URL is not set' }, () => {
    const redis = () => require('../src/config/redis');
    let limiter;

    const connect = async () => {
        process.env.REDIS_URL = REDIS;
        const client = redis().getClient();
        for (let i = 0; i < 50 && !client.isReady; i += 1) await new Promise((r) => setTimeout(r, 100));
        assert.ok(client.isReady, 'Redis did not connect');
    };

    it('counts requests to either server against one allowance', async () => {
        process.env.REDIS_URL = REDIS;
        ({ limiter } = require('../src/middleware/rateLimiters'));
        await connect();
        const key = unique();
        // Two servers running the same code build the same limiter in the same position, so they share a prefix.
        const make = () => limiter(options({ keyGenerator: () => key }), 'shared-test');
        const [a, b] = [await serverWith(make()), await serverWith(make())];
        assert.deepEqual([await hit(a), await hit(b), await hit(a), await hit(b)], [200, 200, 200, 200]);
        assert.equal(await hit(a), 429, 'the fifth request is refused whichever server it reaches');
        assert.equal(await hit(b), 429);
    });

    it('keeps different keys apart', async () => {
        await connect();
        const [x, y] = [await serverWith(limiter(options({ limit: 1, keyGenerator: () => unique() }))), await serverWith(limiter(options({ limit: 1, keyGenerator: () => unique() })))];
        assert.equal(await hit(x), 200);
        assert.equal(await hit(y), 200);
    });

    it('lets requests through, and does not crash, when Redis is unreachable', async () => {
        await redis().closeRedis();
        process.env.REDIS_URL = 'redis://127.0.0.1:1'; // nothing listens here
        const s = await serverWith(limiter(options({ limit: 1, keyGenerator: () => unique() })));
        assert.deepEqual([await hit(s), await hit(s), await hit(s)], [200, 200, 200], 'fail open: the limit is skipped while Redis is down');
        await redis().closeRedis();
        process.env.REDIS_URL = REDIS;
    });

    after(async () => {
        await redis().closeRedis();
        delete process.env.REDIS_URL;
    });
});

describe('rate limits without Redis', () => {
    it('use the process memory, as before, when REDIS_URL is not set', async () => {
        const saved = process.env.REDIS_URL;
        delete process.env.REDIS_URL;
        try {
            const { limiter } = require('../src/middleware/rateLimiters');
            const s = await serverWith(limiter(options({ limit: 2, keyGenerator: () => 'solo' })));
            assert.deepEqual([await hit(s), await hit(s), await hit(s)], [200, 200, 429]);
        } finally {
            if (saved !== undefined) process.env.REDIS_URL = saved;
        }
    });
});

after(async () => {
    // fetch keeps connections alive; close() would otherwise wait for them.
    await Promise.all(opened.map((s) => new Promise((r) => (s.closeAllConnections(), s.close(r)))));
});
