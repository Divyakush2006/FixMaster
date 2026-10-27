const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { resetDatabase, startApp, SEED, studentProfile } = require('./helpers');

// Two hostels (migration 016): the men's and the ladies' hostel each have their
// own blocks, supervisors and chief warden. MH is the complete men's hostel and
// PRP an academic block; neither has rooms. Supervisors and chief wardens manage
// the settings of their own blocks.

describe('two hostels: scoped chief wardens and supervisors, block settings, residents', () => {
    let t;
    let admin;
    const tok = {};
    const PW = 'Granite4Owl';
    const LADIES = ['LA', 'LB', 'LC', 'LD', 'LE', 'LF', 'LG', 'LH', 'LJ', 'LS'].map((c) => `${c}_BLOCK`);

    const create = async (body) => {
        const r = await t.api('/admin/users', { method: 'POST', token: admin, body: { phone_number: '9000000400', password: PW, ...body } });
        assert.equal(r.status, 201, JSON.stringify(r.data));
        return r.data.user.user_id;
    };
    const blockIds = async (token) => (await t.api('/infrastructure/blocks', { token })).data.map((b) => b.block_id);

    before(async () => {
        await resetDatabase();
        t = await startApp();
        admin = await t.login(SEED.admin);

        const ids = {};
        for (const [key, body] of [
            ['cwM', { reg_or_emp_id: 'CW_MENS_01', full_name: 'Chief Warden Men', email: 'cw.men@vit.ac.in', role: 'CHIEF_WARDEN', hostel_type: 'MENS' }],
            ['cwL', { reg_or_emp_id: 'CW_LADIES_01', full_name: 'Chief Warden Ladies', email: 'cw.ladies@vit.ac.in', role: 'CHIEF_WARDEN', hostel_type: 'LADIES' }],
            ['supM', { reg_or_emp_id: 'SUP_MENS_01', full_name: 'Men Supervisor', email: 'sup.men@vit.ac.in', role: 'SUPERVISOR', hostel_type: 'MENS' }],
            ['supL', { reg_or_emp_id: 'SUP_LADIES_01', full_name: 'Ladies Supervisor', email: 'sup.ladies@vit.ac.in', role: 'SUPERVISOR', hostel_type: 'LADIES' }],
            ['supA', { reg_or_emp_id: 'SUP_MENS_A', full_name: 'Men A Supervisor', email: 'sup.mena@vit.ac.in', role: 'SUPERVISOR', hostel_type: 'MENS' }],
        ]) {
            ids[key] = await create(body);
            tok[key] = await t.login(body.reg_or_emp_id, PW);
        }
        t.ids = ids;
        assert.equal((await t.api(`/admin/users/${ids.supA}/blocks`, { method: 'PUT', token: admin, body: { block_ids: ['A_BLOCK'] } })).status, 200);
    });
    after(async () => t && t.close());

    it('starts with MH as the complete men\'s hostel and PRP as an academic block, neither with rooms', async () => {
        const { rows } = await t.sql(`SELECT block_id, block_kind, hostel_type FROM hostel_blocks WHERE block_id IN ('MH_BLOCK', 'PRP_BLOCK', 'L_BLOCK') ORDER BY block_id`);
        assert.deepEqual(rows.map((r) => [r.block_id, r.block_kind, r.hostel_type]), [['L_BLOCK', 'RESIDENTIAL', 'MENS'], ['MH_BLOCK', 'HOSTEL_WIDE', 'MENS'], ['PRP_BLOCK', 'ACADEMIC', null]]);
        assert.ok((await t.sql(`SELECT COUNT(*)::int AS n FROM common_areas WHERE block_id IN ('MH_BLOCK', 'PRP_BLOCK')`)).rows[0].n >= 6);
        await assert.rejects(t.sql(`INSERT INTO rooms (room_id, block_id, room_number, floor_number) VALUES ('MH-101', 'MH_BLOCK', '101', 1)`), /residential blocks/);
        const viaApi = await t.api('/infrastructure/blocks/MH_BLOCK/rooms', { method: 'POST', token: admin, body: { floor_number: 1, from: 1, to: 2, room_type: 'NON_AC', bed_capacity: 2 } });
        assert.equal(viaApi.status, 400);
        // A hostel has only one whole-hostel block, and an academic block belongs to no hostel.
        await assert.rejects(t.sql(`INSERT INTO hostel_blocks (block_id, block_name, total_floors, hostel_type, block_kind) VALUES ('MH2_BLOCK', 'Another', 2, 'MENS', 'HOSTEL_WIDE')`));
        await assert.rejects(t.sql(`INSERT INTO hostel_blocks (block_id, block_name, total_floors, hostel_type, block_kind) VALUES ('X_BLOCK', 'X', 2, 'MENS', 'ACADEMIC')`));
    });

    it('has the men\'s hostel A to T without S and the ladies\' hostel A-H, J and S, under separate ids', async () => {
        const { rows } = await t.sql(`SELECT block_id, hostel_type FROM hostel_blocks WHERE block_kind = 'RESIDENTIAL' ORDER BY block_id`);
        assert.deepEqual(rows.filter((r) => r.hostel_type === 'MENS').map((r) => r.block_id[0]), 'ABCDEFGHIJKLMNOPQRT'.split(''));
        assert.deepEqual(rows.filter((r) => r.hostel_type === 'LADIES').map((r) => r.block_id), LADIES);
        assert.ok(!rows.some((r) => r.block_id === 'S_BLOCK'), 'S is not a men\'s block');
        const duplicate = await t.api('/infrastructure/blocks', { method: 'POST', token: admin, body: { block_code: 'A', block_name: 'Again', hostel_type: 'LADIES' } });
        assert.equal(duplicate.status, 409);
    });

    it('limits a chief warden to their own hostel (and the academic blocks)', async () => {
        const men = await blockIds(tok.cwM);
        const ladies = await blockIds(tok.cwL);
        assert.deepEqual(men.filter((b) => /^L[A-Z]_BLOCK$/.test(b)), []);
        assert.ok(['A_BLOCK', 'T_BLOCK', 'L_BLOCK', 'MH_BLOCK', 'PRP_BLOCK'].every((b) => men.includes(b)), men.join());
        assert.deepEqual(ladies.sort(), [...LADIES, 'PRP_BLOCK']);
        assert.equal((await blockIds(admin)).length, (await t.sql('SELECT COUNT(*)::int AS n FROM hostel_blocks')).rows[0].n);

        const me = await t.api('/me', { token: tok.cwL });
        assert.equal(me.data.hostel_type, 'LADIES');
        assert.equal(me.data.campus_wide, false);
        assert.deepEqual(me.data.managed_blocks.sort(), [...LADIES, 'PRP_BLOCK']);
        assert.equal((await t.api('/me', { token: admin })).data.campus_wide, true);
    });

    it('never shows one hostel\'s tickets to the other hostel\'s chief warden', async () => {
        const ladiesTickets = await t.api('/complaints', { token: tok.cwL });
        assert.equal(ladiesTickets.status, 200);
        assert.ok(ladiesTickets.data.every((c) => [...LADIES, 'PRP_BLOCK'].includes(c.block_id)));
        const lTicket = (await t.sql("SELECT complaint_id FROM complaints WHERE block_id = 'L_BLOCK' LIMIT 1")).rows[0];
        const peek = await t.api(`/complaints/${lTicket.complaint_id}`, { token: tok.cwL });
        assert.equal(peek.status, 403);
        assert.equal(peek.data.code, 'OUT_OF_SCOPE');
        assert.equal((await t.api(`/complaints/${lTicket.complaint_id}`, { token: tok.cwM })).status, 200);
    });

    it('gives a supervisor the blocks assigned to them, or else every block of their hostel', async () => {
        assert.deepEqual(await blockIds(tok.supA), ['A_BLOCK']);
        const wideM = await blockIds(tok.supM);
        assert.ok(wideM.includes('L_BLOCK') && wideM.includes('T_BLOCK') && !wideM.includes('LA_BLOCK') && !wideM.includes('PRP_BLOCK'), wideM.join());
        assert.deepEqual((await blockIds(tok.supL)).sort(), LADIES);
    });

    it('refuses to give a supervisor blocks of the other hostel, in the API and in the database', async () => {
        const r = await t.api(`/admin/users/${t.ids.supL}/blocks`, { method: 'PUT', token: admin, body: { block_ids: ['LA_BLOCK', 'A_BLOCK'] } });
        assert.equal(r.status, 400);
        assert.match(r.data.error, /other hostel/);
        await assert.rejects(t.sql('INSERT INTO supervisor_blocks (supervisor_user_id, block_id) VALUES ($1, $2)', [t.ids.supL, 'T_BLOCK']), /other hostel/);
        assert.equal((await t.api(`/admin/users/${t.ids.supL}/blocks`, { method: 'PUT', token: admin, body: { block_ids: ['PRP_BLOCK'] } })).status, 200, 'academic blocks are shared');
        await t.api(`/admin/users/${t.ids.supL}/blocks`, { method: 'PUT', token: admin, body: { block_ids: [] } });
    });

    it('lets a supervisor manage the floors, rooms and shared areas of their blocks', async () => {
        const floor = await t.api('/infrastructure/blocks/A_BLOCK/floors', { method: 'POST', token: tok.supA, body: {} });
        assert.equal(floor.status, 201, JSON.stringify(floor.data));
        const rooms = await t.api('/infrastructure/blocks/A_BLOCK/rooms', { method: 'POST', token: tok.supA, body: { floor_number: 1, from: 1, to: 3, room_type: 'AC', bed_capacity: 3 } });
        assert.equal(rooms.status, 201);
        assert.deepEqual(rooms.data.created, ['A-101', 'A-102', 'A-103']);
        assert.equal((await t.api('/infrastructure/rooms/A-102', { method: 'PATCH', token: tok.supA, body: { is_active: false } })).status, 200);
        assert.equal((await t.api('/infrastructure/blocks/A_BLOCK', { method: 'PATCH', token: tok.supA, body: { block_name: 'Alpha Block' } })).data.block_name, 'Alpha Block');

        const area = await t.api('/infrastructure/blocks/A_BLOCK/common-areas', { method: 'POST', token: tok.supA, body: { floor_number: 1, area_type: 'WATER_COOLER', description: 'Floor 1 cooler' } });
        assert.equal(area.status, 201, JSON.stringify(area.data));
        assert.equal(area.data.area_id, 'A-F01-COOLER-01');
        const second = await t.api('/infrastructure/blocks/A_BLOCK/common-areas', { method: 'POST', token: tok.supA, body: { floor_number: 1, area_type: 'WATER_COOLER', description: 'Second cooler' } });
        assert.equal(second.data.area_id, 'A-F01-COOLER-02');
        const closed = await t.api(`/infrastructure/common-areas/${second.data.area_id}`, { method: 'PATCH', token: tok.supA, body: { is_operational: false } });
        assert.equal(closed.data.is_operational, false);
        const listed = await t.api('/infrastructure/blocks/A_BLOCK/common-areas', { token: tok.supA });
        assert.equal(listed.data.length, 2);
        const offered = await t.api('/meta/blocks/A_BLOCK/common-areas', { token: tok.supA });
        assert.deepEqual(offered.data.map((a) => a.area_id), ['A-F01-COOLER-01'], 'a closed area is not offered to residents');

        const audit = await t.api('/admin/audit?limit=50', { token: admin });
        const actions = audit.data.map((a) => a.action);
        for (const a of ['floor.add', 'room.create', 'room.close', 'block.rename', 'area.create', 'area.close']) assert.ok(actions.includes(a), `${a} audited`);
    });

    it('stops a supervisor changing blocks they do not run, adding blocks, or moving a block between hostels', async () => {
        for (const [method, path, body] of [
            ['GET', '/infrastructure/blocks/T_BLOCK/floors'],
            ['POST', '/infrastructure/blocks/T_BLOCK/floors', {}],
            ['GET', '/infrastructure/blocks/LA_BLOCK/rooms'],
            ['POST', '/infrastructure/blocks/T_BLOCK/rooms', { floor_number: 1, from: 1, room_type: 'AC', bed_capacity: 2 }],
            ['PATCH', '/infrastructure/blocks/T_BLOCK', { block_name: 'Mine now' }],
            ['PATCH', '/infrastructure/rooms/L-810', { is_active: false }],
            ['POST', '/infrastructure/blocks/T_BLOCK/common-areas', { floor_number: 1, area_type: 'CORRIDOR', description: 'x' }],
            ['PATCH', '/infrastructure/common-areas/L-F01-CORR-01', { is_operational: false }],
        ]) {
            const r = await t.api(path, { method, token: tok.supA, body });
            assert.ok([403, 404].includes(r.status) && (r.status === 404 || r.data.code === 'OUT_OF_SCOPE'), `${method} ${path} -> ${r.status} ${JSON.stringify(r.data)}`);
        }
        assert.equal((await t.api('/infrastructure/blocks', { method: 'POST', token: tok.supA, body: { block_code: 'Z', block_name: 'Z', hostel_type: 'MENS' } })).status, 403);
        const move = await t.api('/infrastructure/blocks/A_BLOCK', { method: 'PATCH', token: tok.supA, body: { block_name: 'Alpha Block', hostel_type: 'LADIES' } });
        assert.equal(move.status, 403);
        assert.equal((await t.api('/admin/blocks', { token: tok.supA })).status, 403, 'the administrator\'s own routes stay administrator-only');
    });

    it('lets a chief warden add blocks to their own hostel only', async () => {
        const made = await t.api('/infrastructure/blocks', { method: 'POST', token: tok.cwL, body: { block_code: 'U', block_name: 'U-Block (Ladies)', top_floor: 4 } });
        assert.equal(made.status, 201, JSON.stringify(made.data));
        assert.equal(made.data.block_id, 'LU_BLOCK');
        assert.equal(made.data.hostel_type, 'LADIES');
        assert.ok((await blockIds(tok.cwL)).includes('LU_BLOCK'), 'the new block is theirs at once');
        const other = await t.api('/infrastructure/blocks', { method: 'POST', token: tok.cwL, body: { block_code: 'K', block_name: 'K', hostel_type: 'MENS' } });
        assert.equal(other.status, 403);
        const academic = await t.api('/infrastructure/blocks', { method: 'POST', token: tok.cwL, body: { block_code: 'LIB', block_name: 'Library', block_kind: 'ACADEMIC' } });
        assert.equal(academic.status, 403);
        const adminAcademic = await t.api('/infrastructure/blocks', { method: 'POST', token: admin, body: { block_code: 'LIB', block_name: 'Library', block_kind: 'ACADEMIC', top_floor: 2 } });
        assert.equal(adminAcademic.status, 201);
        assert.equal(adminAcademic.data.hostel_type, null);
        assert.ok((await blockIds(tok.cwM)).includes('LIB_BLOCK') && (await blockIds(tok.cwL)).includes('LIB_BLOCK'), 'both chief wardens run academic blocks');
    });

    it('lets an administrator move a user between hostels and keeps one chief warden per hostel', async () => {
        const dup = await create({ reg_or_emp_id: 'CW_MENS_02', full_name: 'Second Men Chief', email: 'cw.men2@vit.ac.in', role: 'CHIEF_WARDEN' });
        const clash = await t.api(`/admin/users/${dup}/hostel`, { method: 'PUT', token: admin, body: { hostel_type: 'MENS' } });
        assert.equal(clash.status, 409);
        assert.equal((await t.api(`/admin/users/${dup}/hostel`, { method: 'PUT', token: admin, body: { hostel_type: 'SIDEWAYS' } })).status, 400);
        // A chief warden with no hostel keeps the pre-016 behaviour: every block.
        assert.equal((await blockIds(await t.login('CW_MENS_02', PW))).length, (await blockIds(admin)).length);

        const moved = await t.api(`/admin/users/${t.ids.supA}/hostel`, { method: 'PUT', token: admin, body: { hostel_type: 'LADIES' } });
        assert.equal(moved.status, 200);
        assert.deepEqual(moved.data.unassigned_blocks, ['A_BLOCK'], 'the men\'s block they ran is taken away');
        assert.deepEqual((await blockIds(tok.supA)).sort(), [...LADIES, 'LU_BLOCK']);
        assert.equal((await t.api(`/admin/users/${SEED.student}/hostel`, { method: 'PUT', token: admin, body: { hostel_type: 'MENS' } })).status, 404);
        const student = (await t.sql('SELECT user_id FROM users WHERE reg_or_emp_id = $1', [SEED.student])).rows[0].user_id;
        assert.equal((await t.api(`/admin/users/${student}/hostel`, { method: 'PUT', token: admin, body: { hostel_type: 'MENS' } })).status, 400);
    });

    it('refuses to change a block\'s hostel while the other hostel\'s supervisors run it', async () => {
        const r = await t.api('/infrastructure/blocks/T_BLOCK', { method: 'PATCH', token: admin, body: { block_name: 'T-Block', hostel_type: 'LADIES' } });
        assert.equal(r.status, 200, 'nobody runs T-Block by name, so it may move');
        const back = await t.api('/infrastructure/blocks/T_BLOCK', { method: 'PATCH', token: admin, body: { block_name: 'T-Block', hostel_type: 'MENS' } });
        assert.equal(back.status, 200);
        const withRooms = await t.api('/infrastructure/blocks/L_BLOCK', { method: 'PATCH', token: admin, body: { block_name: 'L-Block', block_kind: 'ACADEMIC' } });
        assert.equal(withRooms.status, 409, 'a block with rooms cannot become academic');
        await t.sql(`INSERT INTO supervisor_blocks (supervisor_user_id, block_id) VALUES ($1, 'T_BLOCK')`, [t.ids.supM]);
        const blocked = await t.api('/infrastructure/blocks/T_BLOCK', { method: 'PATCH', token: admin, body: { block_name: 'T-Block', hostel_type: 'LADIES' } });
        assert.equal(blocked.status, 409);
        await t.sql(`DELETE FROM supervisor_blocks WHERE supervisor_user_id = $1`, [t.ids.supM]);
    });

    describe('residents', () => {
        let ladyToken;
        let manToken;

        before(async () => {
            // A ladies area to report in.
            const area = await t.api('/infrastructure/blocks/LA_BLOCK/common-areas', { method: 'POST', token: admin, body: { floor_number: 1, area_type: 'CORRIDOR', description: 'Ladies A corridor' } });
            assert.equal(area.status, 201, JSON.stringify(area.data));
            await t.api('/infrastructure/blocks/LA_BLOCK/rooms', { method: 'POST', token: admin, body: { floor_number: 1, from: 1, to: 2, room_type: 'NON_AC', bed_capacity: 2 } });
            await t.registerStudent({ reg_or_emp_id: '25BCE1001', full_name: 'Lakshmi Iyer', email: 'lakshmi.iyer2025@vitstudent.ac.in', phone_number: '9000000411', password: PW }, { profile: false });
            ladyToken = await t.login('25BCE1001', PW);
            assert.equal((await t.api('/me/profile', { method: 'PUT', token: ladyToken, body: studentProfile({ gender: 'FEMALE' }) })).status, 201);
            manToken = await t.login(SEED.student);
        });

        it('offers a resident their own hostel\'s blocks and the academic blocks, not the other hostel\'s', async () => {
            const ladyRes = await t.api('/meta/blocks', { token: ladyToken }); assert.equal(ladyRes.status, 200, JSON.stringify(ladyRes.data)); const lady = ladyRes.data.map((b) => b.block_id);
            assert.ok(lady.includes('LA_BLOCK') && lady.includes('PRP_BLOCK') && !lady.includes('L_BLOCK') && !lady.includes('MH_BLOCK'), lady.join());
            const man = (await t.api('/meta/blocks', { token: manToken })).data.map((b) => b.block_id);
            assert.ok(man.includes('L_BLOCK') && man.includes('MH_BLOCK') && man.includes('PRP_BLOCK') && !man.includes('LA_BLOCK'), man.join());
        });

        it('keeps a resident to their gender\'s hostel when they ask for a room, and when the office allots one', async () => {
            const wrong = await t.api('/me/room-request', { method: 'POST', token: ladyToken, body: { block_id: 'L_BLOCK', floor_number: 1, room_id: 'L-101' } });
            assert.equal(wrong.status, 400);
            assert.match(wrong.data.error, /men's hostel/);
            const right = await t.api('/me/room-request', { method: 'POST', token: ladyToken, body: { block_id: 'LA_BLOCK', floor_number: 1, room_id: 'LA-101' } });
            assert.equal(right.status, 201, JSON.stringify(right.data));
            const id = (await t.sql("SELECT user_id FROM users WHERE reg_or_emp_id = '25BCE1001'")).rows[0].user_id;
            const office = await t.api('/admin/allotments', { method: 'POST', token: admin, body: { student_id: id, room_id: 'L-101', academic_year: '2026-2027' } });
            assert.equal(office.status, 400);
            assert.equal((await t.api('/admin/allotments', { method: 'POST', token: admin, body: { student_id: id, room_id: 'LA-101', academic_year: '2026-2027' } })).status, 201);
        });

        it('lets a resident report a fault in their hostel\'s shared areas and in an academic block, not in the other hostel', async () => {
            const sub = SEED.sub.corridorLight;
            const ladiesArea = (await t.sql("SELECT area_id FROM common_areas WHERE block_id = 'LA_BLOCK' LIMIT 1")).rows[0].area_id;
            const mhArea = (await t.sql("SELECT area_id FROM common_areas WHERE block_id = 'MH_BLOCK' ORDER BY area_id LIMIT 1")).rows[0].area_id;
            const prpArea = (await t.sql("SELECT area_id FROM common_areas WHERE block_id = 'PRP_BLOCK' AND area_type = 'CORRIDOR' LIMIT 1")).rows[0].area_id;
            const file = (token, block_id, common_area_id) =>
                t.api('/complaints', { method: 'POST', token, body: { ticket_scope: 'COMMON_AREA', block_id, common_area_id, subcategory_id: sub, description: 'Light is out' } });

            const wrongHostel = await file(manToken, 'LA_BLOCK', ladiesArea);
            assert.equal(wrongHostel.status, 403);
            assert.equal(wrongHostel.data.code, 'OTHER_HOSTEL');
            assert.equal((await file(manToken, 'MH_BLOCK', mhArea)).status, 201, 'MH is the men\'s whole hostel');
            assert.equal((await file(manToken, 'PRP_BLOCK', prpArea)).status, 201, 'PRP is academic: open to both');
            assert.equal((await file(ladyToken, 'LA_BLOCK', ladiesArea)).status, 201);
            const mhAsLady = await file(ladyToken, 'MH_BLOCK', mhArea);
            assert.equal(mhAsLady.status, 403);
            // The tickets land with the right people.
            assert.ok((await t.api('/complaints', { token: tok.cwM })).data.some((c) => c.block_id === 'MH_BLOCK'));
            assert.ok(!(await t.api('/complaints', { token: tok.cwL })).data.some((c) => c.block_id === 'MH_BLOCK'));
            assert.ok((await t.api('/complaints', { token: tok.cwL })).data.some((c) => c.block_id === 'PRP_BLOCK'));
        });
    });
});
