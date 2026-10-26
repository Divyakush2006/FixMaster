const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { resetDatabase, startApp, SEED } = require('./helpers');

// With the dashboard cache switched on, a change made through the API shows on
// the dashboards at once: the cache is for repeated reading, not for hiding writes.

describe('dashboard cache and writes', () => {
    let t;
    let sup;
    let student;
    before(async () => {
        process.env.DASHBOARD_CACHE_MS = '60000';
        await resetDatabase();
        t = await startApp();
        sup = await t.login(SEED.supervisor);
        student = await t.login(SEED.student2);
    });
    after(async () => {
        delete process.env.DASHBOARD_CACHE_MS;
        await t.close();
    });

    const open = async () => (await t.api('/insights/overview', { token: sup })).data.totals.open_tickets;

    it('repeated reads are served from the cache', async () => {
        const cache = require('../src/services/cache');
        const before = cache.stats();
        await open();
        await open();
        await open();
        const after = cache.stats();
        assert.equal(after.misses - before.misses, 1);
        assert.equal(after.hits - before.hits, 2);
    });

    it('a new ticket is counted on the very next read', async () => {
        const was = await open();
        await open(); // cached
        const r = await t.api('/complaints', { method: 'POST', token: student, body: { ticket_scope: 'ROOM', block_id: 'L_BLOCK', room_id: 'L-810', subcategory_id: SEED.sub.dusting } });
        assert.equal(r.status, 201, JSON.stringify(r.data));
        assert.equal(await open(), was + 1);
    });

    it('a failed write does not throw the cache away', async () => {
        const cache = require('../src/services/cache');
        await open();
        const before = cache.stats().misses;
        const bad = await t.api('/complaints', { method: 'POST', token: student, body: { ticket_scope: 'ROOM' } });
        assert.equal(bad.status, 400);
        await open();
        assert.equal(cache.stats().misses, before, 'still cached');
    });

    it('a change made elsewhere shows within the window, not never', async () => {
        const cache = require('../src/services/cache');
        const n = await open();
        await t.sql(`UPDATE complaints SET status = 'CANCELLED' WHERE status = 'OPEN' AND room_id = 'L-810'`);
        assert.equal(await open(), n, 'direct database change: stale until the window ends');
        cache.invalidate(); // what the window ending does
        assert.equal(await open(), n - 1);
    });
});
