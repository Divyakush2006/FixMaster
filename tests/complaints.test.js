const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { resetDatabase, startApp, SEED } = require('./helpers');

describe('complaint creation & visibility', () => {
    let t;
    before(async () => {
        await resetDatabase();
        t = await startApp();
    });
    after(async () => t && t.close());

    const roomTicket = (extra = {}) => ({ ticket_scope: 'ROOM', block_id: 'L_BLOCK', room_id: 'L-843', subcategory_id: 12, ...extra });

    it('a student can only raise room tickets for their own allotted room', async () => {
        const student = await t.login(SEED.student);
        assert.equal((await t.api('/complaints', { method: 'POST', token: student, body: roomTicket({ room_id: 'L-810' }) })).status, 403);
        assert.equal((await t.api('/complaints', { method: 'POST', token: student, body: roomTicket() })).status, 201);
    });

    it('rejects a room or area that does not belong to the stated block', async () => {
        const student = await t.login(SEED.student);
        const r = await t.api('/complaints', { method: 'POST', token: student, body: roomTicket({ block_id: 'PRP_BLOCK', subcategory_id: 9 }) });
        assert.equal(r.status, 400);
        const area = await t.api('/complaints', {
            method: 'POST',
            token: student,
            body: { ticket_scope: 'COMMON_AREA', block_id: 'PRP_BLOCK', common_area_id: 'L-F08-COOLER-01', subcategory_id: 21 },
        });
        assert.equal(area.status, 400);
    });

    it('never stores a contradictory location', async () => {
        const student = await t.login(SEED.student);
        const r = await t.api('/complaints', {
            method: 'POST',
            token: student,
            body: { ticket_scope: 'COMMON_AREA', block_id: 'L_BLOCK', common_area_id: 'L-F04-COOLER-01', room_id: 'L-843', subcategory_id: 22 },
        });
        assert.equal(r.status, 201);
        assert.equal(r.data.complaint.room_id, null);
        await assert.rejects(
            t.sql(
                `INSERT INTO complaints (ticket_scope, room_id, common_area_id, block_id, raised_by_user_id, subcategory_id)
                 SELECT 'COMMON_AREA', 'L-843', 'L-F04-COOLER-01', 'L_BLOCK', user_id, 22 FROM users LIMIT 1`
            ),
            /chk_complaint_location/
        );
    });

    it('only accepts http(s) photo links', async () => {
        const student = await t.login(SEED.student);
        for (const url of ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'ftp://x.example/a.jpg']) {
            const r = await t.api('/complaints', { method: 'POST', token: student, body: roomTicket({ subcategory_id: 10, photo_evidence_url: url }) });
            assert.equal(r.status, 400, url);
        }
        const ok = await t.api('/complaints', { method: 'POST', token: student, body: roomTicket({ subcategory_id: 10, photo_evidence_url: 'https://example.com/ac.jpg' }) });
        assert.equal(ok.status, 201);
    });

    it('refuses a duplicate of an issue that is still open, including concurrent double-taps', async () => {
        const student = await t.login(SEED.student);
        const results = await Promise.all(
            [1, 2, 3].map(() => t.api('/complaints', { method: 'POST', token: student, body: roomTicket({ subcategory_id: 2 }) }))
        );
        assert.deepEqual(results.map((r) => r.status).sort(), [201, 409, 409]);
    });

    it('records ticket creation in the audit trail', async () => {
        const student = await t.login(SEED.student);
        const r = await t.api('/complaints', { method: 'POST', token: student, body: roomTicket({ subcategory_id: 13 }) });
        const logs = (await t.api(`/complaints/${r.data.complaint.complaint_id}/logs`, { token: student })).data;
        assert.equal(logs.length, 1);
        assert.equal(logs[0].new_status, 'OPEN');
        assert.equal(logs[0].changed_by_name, 'Vihaan Sharma');
    });

    it('scopes the list by role: students see their own, staff see only their assignments', async () => {
        const student = await t.login(SEED.student);
        const elec = await t.login(SEED.electrician);
        const sup = await t.login(SEED.supervisor);

        const mine = (await t.api('/complaints', { token: student })).data;
        assert.ok(mine.length > 0 && mine.every((c) => c.raised_by_user_id === mine[0].raised_by_user_id));

        const staffList = (await t.api('/complaints', { token: elec })).data;
        const { rows } = await t.sql(
            `SELECT DISTINCT ca.complaint_id FROM complaint_assignments ca JOIN users u ON u.user_id = ca.staff_user_id WHERE u.reg_or_emp_id = $1`,
            [SEED.electrician]
        );
        assert.deepEqual(staffList.map((c) => c.complaint_id).sort(), rows.map((r) => r.complaint_id).sort());

        const all = await t.api('/complaints', { token: sup });
        const { rows: total } = await t.sql('SELECT COUNT(*)::int AS n FROM complaints');
        assert.equal(all.data.length, total[0].n);
    });

    it('a student cannot read someone else\'s complaint or its audit log', async () => {
        const other = await t.login(SEED.student2);
        const { rows } = await t.sql("SELECT complaint_id FROM complaints WHERE raised_by_user_id = 'u009-stud-0843-uuid-000000000009' LIMIT 1");
        assert.equal((await t.api(`/complaints/${rows[0].complaint_id}`, { token: other })).status, 403);
        assert.equal((await t.api(`/complaints/${rows[0].complaint_id}/logs`, { token: other })).status, 403);
    });

    it('paginates with limit/offset and reports the true total in X-Total-Count', async () => {
        const sup = await t.login(SEED.supervisor);
        const page1 = await t.api('/complaints?limit=2&offset=0', { token: sup });
        const page2 = await t.api('/complaints?limit=2&offset=2', { token: sup });
        const { rows } = await t.sql('SELECT COUNT(*)::int AS n FROM complaints');
        assert.equal(page1.data.length, 2);
        assert.equal(Number(page1.headers.get('x-total-count')), rows[0].n);
        assert.notDeepEqual(page1.data.map((c) => c.complaint_id), page2.data.map((c) => c.complaint_id));
        assert.equal((await t.api('/complaints?limit=100000', { token: sup })).status, 400);
    });

    it('returns categories in a stable order with no null subcategories', async () => {
        const r = await t.api('/meta/categories');
        assert.deepEqual(r.data.map((c) => c.category_id), [1, 2, 3, 4, 5, 6]);
        assert.ok(r.data.every((c) => c.subcategories.every((s) => s !== null)));
    });

    it('new categories can be added after seeding (sequences are in sync)', async () => {
        await t.sql("INSERT INTO complaint_categories (category_code, category_name) VALUES ('PEST_CONTROL', 'Pest Control')");
        await t.sql("INSERT INTO complaint_subcategories (category_id, subcategory_code, issue_name, required_specialization) SELECT category_id, 'PEST_ROOM', 'Pests in room', 'CLEANING' FROM complaint_categories WHERE category_code = 'PEST_CONTROL'");
    });
});
