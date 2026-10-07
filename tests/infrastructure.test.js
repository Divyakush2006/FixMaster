const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { resetDatabase, startApp, SEED } = require('./helpers');

describe('hostel infrastructure: blocks, floors, room numbering', () => {
    let t;
    let admin;
    before(async () => {
        await resetDatabase();
        t = await startApp();
        admin = await t.login(SEED.admin);
    });
    after(async () => t && t.close());

    const LETTERS = 'ABCDEFGHIJKLMNOPQRST'.split('');

    it('blocks A to T all exist, each with Ground + floors 1-10', async () => {
        const blocks = (await t.api('/meta/blocks')).data.map((b) => b.block_id);
        for (const letter of LETTERS) assert.ok(blocks.includes(`${letter}_BLOCK`), `${letter}_BLOCK missing`);

        const { rows } = await t.sql(
            `SELECT block_id, string_agg(floor_code, ',' ORDER BY floor_number) AS floors
             FROM block_floors WHERE block_id = ANY($1) GROUP BY block_id`,
            [LETTERS.map((l) => `${l}_BLOCK`)]
        );
        assert.equal(rows.length, 20);
        for (const r of rows) assert.equal(r.floors, 'G,1,2,3,4,5,6,7,8,9,10', r.block_id);
    });

    it('the existing demo L-Block row and its rooms are unchanged', async () => {
        const { rows } = await t.sql("SELECT block_name, total_floors FROM hostel_blocks WHERE block_id = 'L_BLOCK'");
        assert.deepEqual(rows[0], { block_name: 'L-Block (Ladies/Mens Hostel)', total_floors: 10 });
        const rooms = await t.sql("SELECT COUNT(*)::int AS n FROM rooms WHERE block_id = 'L_BLOCK'");
        assert.equal(rooms.rows[0].n, 18);
    });

    it('creates rooms numbered from the floor: ground G01.., floor 4 401.., floor 10 1001..', async () => {
        const create = (floor_number, from, to) =>
            t.api('/admin/blocks/A_BLOCK/rooms', {
                method: 'POST',
                token: admin,
                body: { floor_number, from, to, room_type: 'NON_AC', bed_capacity: 3 },
            });

        const ground = await create(0, 1, 3);
        assert.equal(ground.status, 201);
        assert.deepEqual(ground.data.created, ['A-G01', 'A-G02', 'A-G03']);

        const fourth = await create(4, 27, 28);
        assert.deepEqual(fourth.data.created, ['A-427', 'A-428']);

        const tenth = await create(10, 7, 7);
        assert.deepEqual(tenth.data.created, ['A-1007']);

        // Re-submitting the same range is safe: existing rooms are skipped.
        const again = await create(4, 27, 29);
        assert.deepEqual(again.data.created, ['A-429']);
        assert.deepEqual(again.data.skipped, ['A-427', 'A-428']);

        const listed = (await t.api('/meta/blocks/A_BLOCK/rooms')).data.map((r) => `${r.room_number}@${r.floor_number}`);
        assert.deepEqual(listed, ['G01@0', 'G02@0', 'G03@0', '427@4', '428@4', '429@4', '1007@10']);
    });

    it('the database refuses room numbers that do not match their floor', async () => {
        const bad = [
            ["'A-428'", "'428'", 3], // 428 belongs on floor 4
            ["'A-G1'", "'G1'", 0], // must be two digits
            ["'A-400'", "'400'", 4], // room 00 does not exist
            ["'A-028'", "'028'", 0], // ground floor is G, not 0
        ];
        for (const [id, num, floor] of bad) {
            await assert.rejects(
                t.sql(`INSERT INTO rooms (room_id, block_id, room_number, floor_number) VALUES (${id}, 'A_BLOCK', ${num}, ${floor})`),
                /chk_room_number_format/,
                `${num} on floor ${floor}`
            );
        }
        await assert.rejects(
            t.sql("INSERT INTO rooms (room_id, block_id, room_number, floor_number) VALUES ('B-501', 'A_BLOCK', '501', 5)"),
            /chk_room_id_format/
        );
    });

    it('rooms can only be added to floors that exist; floors can be added', async () => {
        const noFloor = await t.api('/admin/blocks/A_BLOCK/rooms', {
            method: 'POST',
            token: admin,
            body: { floor_number: 11, from: 1, room_type: 'AC', bed_capacity: 2 },
        });
        assert.equal(noFloor.status, 404);

        const added = await t.api('/admin/blocks/A_BLOCK/floors', { method: 'POST', token: admin, body: {} });
        assert.equal(added.status, 201);
        assert.deepEqual(added.data, { floor_number: 11, floor_code: '11' });
        const { rows } = await t.sql("SELECT total_floors FROM hostel_blocks WHERE block_id = 'A_BLOCK'");
        assert.equal(rows[0].total_floors, 11, 'total_floors follows the floors');

        const room = await t.api('/admin/blocks/A_BLOCK/rooms', {
            method: 'POST',
            token: admin,
            body: { floor_number: 11, from: 1, room_type: 'AC', bed_capacity: 2 },
        });
        assert.deepEqual(room.data.created, ['A-1101']);

        assert.equal((await t.api('/admin/blocks/A_BLOCK/floors', { method: 'POST', token: admin, body: { floor_number: 4 } })).status, 409);
    });

    it('a floor can only be removed when it is empty', async () => {
        assert.equal((await t.api('/admin/blocks/A_BLOCK/floors/4', { method: 'DELETE', token: admin })).status, 409);
        assert.equal((await t.api('/admin/blocks/A_BLOCK/floors/9', { method: 'DELETE', token: admin })).status, 200);
        const floors = (await t.api('/admin/blocks/A_BLOCK/floors', { token: admin })).data.map((f) => f.floor_code);
        assert.ok(!floors.includes('9'));
    });

    it('a new block gets its floors automatically and starts with no rooms', async () => {
        const r = await t.api('/admin/blocks', { method: 'POST', token: admin, body: { block_code: 'u', block_name: 'U-Block', top_floor: 5 } });
        assert.equal(r.status, 201);
        assert.equal(r.data.block_id, 'U_BLOCK');
        const floors = (await t.api('/admin/blocks/U_BLOCK/floors', { token: admin })).data.map((f) => f.floor_code);
        assert.deepEqual(floors, ['G', '1', '2', '3', '4', '5']);
        assert.equal((await t.api('/admin/blocks', { method: 'POST', token: admin, body: { block_code: 'U', block_name: 'Dup' } })).status, 409);
        assert.equal((await t.api('/admin/blocks', { method: 'POST', token: admin, body: { block_code: 'TOOLONG', block_name: 'x' } })).status, 400);
    });

    it('protects occupied rooms: no closing them or shrinking below occupancy', async () => {
        // L-843 has one current occupant (seed: Vihaan) and 3 beds.
        assert.equal((await t.api('/admin/rooms/L-843', { method: 'PATCH', token: admin, body: { is_active: false } })).status, 409);
        assert.equal((await t.api('/admin/rooms/L-843', { method: 'PATCH', token: admin, body: { bed_capacity: 1 } })).status, 200);
        const closed = await t.api('/admin/rooms/A-G03', { method: 'PATCH', token: admin, body: { is_active: false } });
        assert.equal(closed.status, 200);
        assert.equal(closed.data.is_active, false);
        const visible = (await t.api('/meta/blocks/A_BLOCK/rooms')).data.map((r) => r.room_id);
        assert.ok(!visible.includes('A-G03'), 'closed rooms are hidden from students');
    });

    it('a student allotted to a new-block room can raise a ticket for it', async () => {
        const reg = await t.api('/auth/student/register', {
            method: 'POST',
            body: { reg_or_emp_id: 'INFRA01', full_name: 'Infra Student', email: 'infra01@example.com', phone_number: '9000000000', password: 'Test@12345' },
        });
        await t.api('/admin/allotments', { method: 'POST', token: admin, body: { student_id: reg.data.user.user_id, room_id: 'A-428', academic_year: '2026-2027' } });
        const token = await t.login('INFRA01', 'Test@12345');
        const ticket = await t.api('/complaints', {
            method: 'POST',
            token,
            body: { ticket_scope: 'ROOM', block_id: 'A_BLOCK', room_id: 'A-428', subcategory_id: SEED.sub.tubeLight },
        });
        assert.equal(ticket.status, 201);
    });

    it('only admins can manage infrastructure', async () => {
        const sup = await t.login(SEED.supervisor);
        assert.equal((await t.api('/admin/blocks', { token: sup })).status, 403);
        assert.equal((await t.api('/admin/blocks/A_BLOCK/floors', { method: 'POST', token: sup, body: {} })).status, 403);
    });
});
