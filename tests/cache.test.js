const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

// The dashboard cache (src/services/cache.js): one computation per window,
// shared by everyone who asks while it runs, off by default under test.

describe('dashboard cache', () => {
    const cache = require('../src/services/cache');
    const saved = process.env.DASHBOARD_CACHE_MS;
    beforeEach(() => {
        process.env.DASHBOARD_CACHE_MS = '60000';
        cache.invalidate();
    });
    afterEach(() => {
        if (saved === undefined) delete process.env.DASHBOARD_CACHE_MS;
        else process.env.DASHBOARD_CACHE_MS = saved;
        cache.invalidate();
    });

    it('is off under test unless switched on, so tests see their own writes', async () => {
        delete process.env.DASHBOARD_CACHE_MS;
        const env = process.env.NODE_ENV;
        process.env.NODE_ENV = 'test';
        try {
            let runs = 0;
            await cache.memo('k', async () => ++runs);
            await cache.memo('k', async () => ++runs);
            assert.equal(runs, 2);
        } finally {
            if (env === undefined) delete process.env.NODE_ENV;
            else process.env.NODE_ENV = env;
        }
    });

    it('computes once per window and serves the stored answer after that', async () => {
        let runs = 0;
        const a = await cache.memo('kpi', async () => ++runs);
        const b = await cache.memo('kpi', async () => ++runs);
        assert.deepEqual([a, b, runs], [1, 1, 1]);
        assert.equal(await cache.memo('other', async () => 'x'), 'x', 'keys are independent');
    });

    it('shares one computation between requests that arrive while it runs', async () => {
        let runs = 0;
        const slow = async () => {
            runs += 1;
            await new Promise((r) => setTimeout(r, 40));
            return 'done';
        };
        const answers = await Promise.all(Array.from({ length: 25 }, () => cache.memo('rush', slow)));
        assert.equal(runs, 1);
        assert.ok(answers.every((x) => x === 'done'));
        assert.ok(cache.stats().shared >= 24);
    });

    it('does not keep a failure, so the next request tries again', async () => {
        let runs = 0;
        await assert.rejects(() => cache.memo('flaky', async () => { runs += 1; throw new Error('db down'); }), /db down/);
        assert.equal(await cache.memo('flaky', async () => { runs += 1; return 'ok'; }), 'ok');
        assert.equal(runs, 2);
    });

    it('forgets entries on demand, by prefix', async () => {
        let runs = 0;
        await cache.memo('perf:a', async () => ++runs);
        await cache.memo('kpi:a', async () => ++runs);
        cache.invalidate('perf:');
        await cache.memo('perf:a', async () => ++runs);
        await cache.memo('kpi:a', async () => ++runs);
        assert.equal(runs, 3, 'only perf: was recomputed');
    });

    it('expires entries after the window', async () => {
        process.env.DASHBOARD_CACHE_MS = '30';
        let runs = 0;
        await cache.memo('short', async () => ++runs);
        await new Promise((r) => setTimeout(r, 60));
        await cache.memo('short', async () => ++runs);
        assert.equal(runs, 2);
    });

    it('keeps scope keys stable whatever the order of the blocks', () => {
        assert.equal(cache.scopeKey(null), '*');
        assert.equal(cache.scopeKey(['B_BLOCK', 'A_BLOCK']), cache.scopeKey(['A_BLOCK', 'B_BLOCK']));
    });
});
