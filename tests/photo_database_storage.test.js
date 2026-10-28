const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { photoJourney, JPEG } = require('./support/photo_journey');
const db = require('../src/config/db');

// Ticket photos kept in the database (PHOTO_STORAGE=database): the same journey every
// storage backend passes, plus what is specific to rows.
describe('ticket photos in the database', () => {
    let saved;

    photoJourney({
        configure: async () => {
            saved = process.env.PHOTO_STORAGE;
            process.env.PHOTO_STORAGE = 'database';
        },
        teardown: async () => {
            if (saved === undefined) delete process.env.PHOTO_STORAGE;
            else process.env.PHOTO_STORAGE = saved;
        },
        keys: async (ticket) => (await db.query('SELECT content_type FROM ticket_photos WHERE complaint_id = $1', [ticket])).rows.map((r) => `${ticket}.${r.content_type === 'image/png' ? 'png' : 'jpg'}`),
        extra: (ctx) => {
            it('keeps one row per ticket however many times the photo is replaced, and deletes it with the ticket', async () => {
                const { vihaan, ticket, put } = ctx();
                assert.equal((await put(vihaan, JPEG)).status, 200);
                assert.equal((await put(vihaan, JPEG)).status, 200);
                const rows = (await db.query('SELECT size_bytes, length(data) AS n FROM ticket_photos WHERE complaint_id = $1', [ticket])).rows;
                assert.equal(rows.length, 1);
                assert.equal(rows[0].size_bytes, rows[0].n);
                await db.query('DELETE FROM complaints WHERE complaint_id = $1', [ticket]);
                assert.equal((await db.query('SELECT 1 FROM ticket_photos WHERE complaint_id = $1', [ticket])).rows.length, 0);
            });
        },
    });
});
