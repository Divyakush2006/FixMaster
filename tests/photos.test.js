const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { resetDatabase, startApp, SEED } = require('./helpers');
const { uploadDir } = require('../src/services/attachmentService');

// Ticket photos: stored on disk, shown through an authenticated route, rebuilt
// on upload so metadata (GPS!) and hidden payloads never reach other people.

const fixture = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', name));
const JPEG = fixture('photo-with-gps.jpg');
const PNG = fixture('photo-with-text.png');

describe('ticket photos', () => {
    let t;
    let vihaan;
    let karan; // shares L-843 but did not report
    let rahul; // another room
    let sup;
    let ticket;

    before(async () => {
        await resetDatabase();
        fs.rmSync(uploadDir(), { recursive: true, force: true });
        t = await startApp();
        vihaan = await t.login(SEED.student);
        karan = await t.login(SEED.roommate1);
        rahul = await t.login(SEED.student2);
        sup = await t.login(SEED.supervisor);
        const r = await t.api('/complaints', {
            method: 'POST',
            token: vihaan,
            body: { ticket_scope: 'ROOM', block_id: 'L_BLOCK', room_id: 'L-843', subcategory_id: SEED.sub.tubeLight },
        });
        assert.equal(r.status, 201);
        ticket = r.data.complaint.complaint_id;
    });
    after(async () => {
        fs.rmSync(uploadDir(), { recursive: true, force: true });
        if (t) await t.close();
    });

    const put = (token, body, type = 'image/jpeg', id = ticket) =>
        t.api(`/complaints/${id}/photo`, { method: 'PUT', token, raw: body, headers: { 'Content-Type': type } });
    const view = async (token, id = ticket) => {
        const res = await fetch(`${t.base}/complaints/${id}/photo`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
        return { status: res.status, headers: res.headers, body: Buffer.from(await res.arrayBuffer()) };
    };

    it('a reporter attaches a photo; the ticket points at it and the right people can view it', async () => {
        const up = await put(vihaan, JPEG);
        assert.equal(up.status, 200);
        assert.equal(up.data.photo_evidence_url, `/api/complaints/${ticket}/photo`);

        const detail = (await t.api(`/complaints/${ticket}`, { token: vihaan })).data;
        assert.equal(detail.photo_evidence_url, up.data.photo_evidence_url);
        assert.equal(detail.can_attach_photo, true);
        assert.equal((await t.api(`/complaints/${ticket}`, { token: karan })).data.can_attach_photo, false, 'a roommate who did not report cannot change it');

        for (const [who, token] of [['reporter', vihaan], ['roommate', karan], ['supervisor', sup]]) {
            const got = await view(token);
            assert.equal(got.status, 200, who);
            assert.equal(got.headers.get('content-type'), 'image/jpeg');
            assert.equal(got.headers.get('x-content-type-options'), 'nosniff');
            assert.match(got.headers.get('content-security-policy'), /sandbox/);
            assert.equal(got.body[0], 0xff);
        }
    });

    it('strips GPS and other metadata from what it stores and serves', async () => {
        const stored = (await view(vihaan)).body;
        assert.ok(stored.length < JPEG.length, 'smaller than the original');
        assert.ok(!stored.includes('SecretCameraCo'), 'camera make removed');
        assert.ok(!stored.includes('Exif'), 'EXIF block removed');
        assert.ok(!stored.includes('private comment'), 'comment removed');
        assert.deepEqual([...stored.subarray(0, 2)], [0xff, 0xd8]);
        assert.deepEqual([...stored.subarray(-2)], [0xff, 0xd9]);

        assert.equal((await put(vihaan, PNG, 'image/png')).status, 200);
        const png = (await view(vihaan)).body;
        assert.ok(!png.includes('SecretAuthor') && !png.includes('tEXt'));
        assert.equal((await view(vihaan)).headers.get('content-type'), 'image/png');
        const files = fs.readdirSync(uploadDir()).filter((f) => f.startsWith(ticket));
        assert.deepEqual(files, [`${ticket}.png`], 'replacing with another type leaves only one file');
    });

    it('refuses anything that is not a valid JPEG or PNG, whatever it claims to be', async () => {
        assert.equal((await put(vihaan, Buffer.from('<html><script>alert(1)</script></html>'), 'image/jpeg')).status, 415, 'html labelled as jpeg');
        assert.equal((await put(vihaan, PNG, 'image/jpeg')).status, 415, 'png labelled as jpeg');
        assert.equal((await put(vihaan, JPEG, 'image/png')).status, 415, 'jpeg labelled as png');
        assert.equal((await put(vihaan, JPEG.subarray(0, 300))).status, 415, 'truncated jpeg');
        assert.equal((await put(vihaan, JPEG, 'image/svg+xml')).status, 415, 'svg is never accepted');
        assert.equal((await put(vihaan, Buffer.alloc(0))).status, 415, 'empty');
        assert.equal((await put(vihaan, JSON.stringify({ a: 1 }), 'application/json')).status, 415);
    });

    it('drops a payload hidden after the end of the image', async () => {
        const polyglot = Buffer.concat([JPEG, Buffer.from('<script>alert(document.cookie)</script>')]);
        assert.equal((await put(vihaan, polyglot)).status, 200);
        const stored = (await view(vihaan)).body;
        assert.ok(!stored.includes('<script>'));
        assert.deepEqual([...stored.subarray(-2)], [0xff, 0xd9]);
    });

    it('enforces the size limit and authentication before reading anything', async () => {
        const huge = Buffer.concat([JPEG, Buffer.alloc(6 * 1024 * 1024)]);
        assert.equal((await put(vihaan, huge)).status, 413);
        assert.equal((await put(null, JPEG)).status, 401);
        assert.equal((await view(null)).status, 401);
    });

    it('only a reporter may change the photo; viewing follows the ticket’s visibility', async () => {
        assert.equal((await put(karan, JPEG)).status, 403, 'roommate who did not report');
        assert.equal((await put(rahul, JPEG)).status, 403, 'other room');
        assert.equal((await put(sup, JPEG)).status, 403, 'supervisors view, they do not edit the reporter’s photo');
        assert.equal((await view(rahul)).status, 403, 'a student elsewhere cannot see it');
        assert.equal((await t.api(`/complaints/${ticket}/photo`, { method: 'DELETE', token: karan })).status, 403);
    });

    it('rejects malformed ids and never touches the filesystem outside the upload folder', async () => {
        assert.equal((await put(vihaan, JPEG, 'image/jpeg', '..%2F..%2Fetc%2Fpasswd')).status, 400);
        assert.equal((await put(vihaan, JPEG, 'image/jpeg', 'not-a-uuid')).status, 400);
        assert.equal((await view(vihaan, '..%2F..%2Fsecret')).status, 400);
        assert.equal((await put(vihaan, JPEG, 'image/jpeg', '11111111-1111-4111-8111-111111111111')).status, 404);
    });

    it('can be removed by the reporter, and a ticket without a photo says so', async () => {
        const del = await t.api(`/complaints/${ticket}/photo`, { method: 'DELETE', token: vihaan });
        assert.equal(del.status, 204);
        assert.equal((await t.api(`/complaints/${ticket}`, { token: vihaan })).data.photo_evidence_url, null);
        assert.equal((await view(vihaan)).status, 404);
        assert.deepEqual(fs.readdirSync(uploadDir()).filter((f) => f.startsWith(ticket)), []);
    });

    it('closed tickets keep their photo as it was', async () => {
        assert.equal((await put(vihaan, JPEG)).status, 200);
        await t.sql("UPDATE complaints SET status = 'IN_PROGRESS' WHERE complaint_id = $1", [ticket]);
        await t.sql("UPDATE complaints SET status = 'PENDING_VERIFICATION' WHERE complaint_id = $1", [ticket]);
        await t.sql("UPDATE complaints SET status = 'COMPLETED', closure_reason = 'CONFIRMED' WHERE complaint_id = $1", [ticket]);
        assert.equal((await put(vihaan, PNG, 'image/png')).status, 409);
        assert.equal((await t.api(`/complaints/${ticket}/photo`, { method: 'DELETE', token: vihaan })).status, 409);
        assert.equal((await t.api(`/complaints/${ticket}`, { token: vihaan })).data.can_attach_photo, false);
        assert.equal((await view(vihaan)).status, 200);
    });
});
