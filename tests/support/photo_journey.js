const { it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { resetDatabase, startApp, SEED } = require('../helpers');
const { uploadDir } = require('../../src/services/attachmentService');

const fixture = (name) => fs.readFileSync(path.join(__dirname, '..', 'fixtures', name));
const JPEG = fixture('photo-with-gps.jpg');
const PNG = fixture('photo-with-text.png');

/** The journey every storage backend must pass. `keys()` lists which photo files exist for the ticket. */
function photoJourney({ configure, teardown, keys, extra }) {
    let t;
    let vihaan;
    let karan;
    let ticket;
    const put = (token, body, type = 'image/jpeg', id = ticket) => t.api(`/complaints/${id}/photo`, { method: 'PUT', token, raw: body, headers: { 'Content-Type': type } });
    const view = async (token, id = ticket) => {
        const res = await fetch(`${t.base}/complaints/${id}/photo`, { headers: { Authorization: `Bearer ${token}` } });
        return { status: res.status, headers: res.headers, body: Buffer.from(await res.arrayBuffer()) };
    };

    before(async () => {
        await resetDatabase();
        fs.rmSync(uploadDir(), { recursive: true, force: true });
        await configure();
        t = await startApp();
        vihaan = await t.login(SEED.student);
        karan = await t.login(SEED.roommate1);
        const r = await t.api('/complaints', { method: 'POST', token: vihaan, body: { ticket_scope: 'ROOM', block_id: 'L_BLOCK', room_id: 'L-843', subcategory_id: SEED.sub.tubeLight } });
        assert.equal(r.status, 201);
        ticket = r.data.complaint.complaint_id;
    });
    after(async () => {
        if (t) await t.close();
        await teardown();
    });

    it('stores an uploaded photo in the bucket, rebuilt, and serves it only through the API', async () => {
        const up = await put(vihaan, JPEG);
        assert.equal(up.status, 200, JSON.stringify(up.data));
        assert.deepEqual(await keys(ticket), [`${ticket}.jpg`]);
        assert.ok(!fs.existsSync(uploadDir()) || fs.readdirSync(uploadDir()).length === 0, 'nothing is written to local disk');

        for (const token of [vihaan, karan]) {
            const got = await view(token);
            assert.equal(got.status, 200);
            assert.equal(got.headers.get('content-type'), 'image/jpeg');
            assert.equal(got.headers.get('x-content-type-options'), 'nosniff');
            assert.match(got.headers.get('content-security-policy'), /sandbox/);
            assert.ok(got.body.length < JPEG.length && !got.body.includes('SecretCameraCo') && !got.body.includes('Exif'), 'metadata was stripped before it was stored');
        }
        const stranger = await t.login(SEED.student2);
        assert.equal((await view(stranger)).status, 403, 'the bucket does not change who may look');
    });

    it('replacing the photo with another type leaves only one file', async () => {
        assert.equal((await put(vihaan, PNG, 'image/png')).status, 200);
        assert.deepEqual(await keys(ticket), [`${ticket}.png`]);
        const got = await view(vihaan);
        assert.equal(got.headers.get('content-type'), 'image/png');
        assert.equal(got.body.subarray(0, 4).toString('hex'), '89504e47');
    });

    it('deleting removes it, and a ticket with no photo says so', async () => {
        assert.equal((await t.api(`/complaints/${ticket}/photo`, { method: 'DELETE', token: vihaan })).status, 204);
        assert.deepEqual(await keys(ticket), []);
        assert.equal((await view(vihaan)).status, 404);
        assert.equal((await t.api(`/complaints/${ticket}`, { token: vihaan })).data.photo_evidence_url, null);
    });

    if (extra) extra(() => ({ t, vihaan, ticket, put }));
}

module.exports = { photoJourney, JPEG };
