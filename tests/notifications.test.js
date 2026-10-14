const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { resetDatabase, startApp, SEED } = require('./helpers');

// In-app notifications derived from ticket history, assignments and SLA
// deadlines (no notification table). Unread = items newer than `since`.

describe('notifications', () => {
    let t;
    let tokens;
    const feed = async (who, query = '') => t.api(`/notifications${query}`, { token: tokens[who] });
    const kinds = async (who) => (await feed(who)).data.map((n) => n.kind);
    const latestTicket = async (room, sub) =>
        (
            await t.sql('SELECT complaint_id FROM complaints WHERE room_id = $1 AND subcategory_id = $2 ORDER BY created_at DESC LIMIT 1', [
                room,
                sub,
            ])
        ).rows[0].complaint_id;
    const userId = async (empId) => (await t.sql('SELECT user_id FROM users WHERE reg_or_emp_id = $1', [empId])).rows[0].user_id;

    before(async () => {
        await resetDatabase();
        t = await startApp();
        tokens = {
            vihaan: await t.login(SEED.student),
            karan: await t.login(SEED.roommate1),
            rahul: await t.login(SEED.student2),
            priya: await t.login(SEED.student4),
            sup: await t.login(SEED.supervisor),
            admin: await t.login(SEED.admin),
            elec2: await t.login(SEED.electrician2),
        };
    });
    after(async () => t && t.close());

    it('requires sign-in and validates its parameters', async () => {
        assert.equal((await t.api('/notifications')).status, 401);
        assert.equal((await feed('sup', '?limit=1000')).status, 400);
        assert.equal((await feed('sup', '?since=yesterday')).status, 400);
    });

    it('a new high-priority ticket alerts supervisors, not the student who raised it', async () => {
        const r = await t.api('/complaints', {
            method: 'POST',
            token: tokens.rahul,
            body: { ticket_scope: 'ROOM', block_id: 'L_BLOCK', room_id: 'L-810', subcategory_id: SEED.sub.socket }, // HIGH
        });
        assert.equal(r.status, 201);
        assert.ok((await kinds('sup')).includes('ticket.urgent'));
        assert.ok((await kinds('admin')).includes('ticket.urgent'));
        assert.ok(!(await kinds('rahul')).includes('ticket.urgent'));
    });

    it('dispatch tells the technician and the student; the dispatcher gets nothing for it', async () => {
        const ticket = await latestTicket('L-810', SEED.sub.socket);
        const before = (await feed('sup')).data.length;
        const a = await t.api('/dispatch/assign', {
            method: 'POST',
            token: tokens.sup,
            body: { complaint_id: ticket, staff_user_id: await userId('EMP_ELEC_02') },
        });
        assert.equal(a.status, 200);

        const job = (await feed('elec2')).data.find((n) => n.kind === 'job.assigned' && n.complaint_id === ticket);
        assert.ok(job, 'the technician is told about the job');
        assert.match(job.body, /L-810/);
        assert.ok((await kinds('rahul')).includes('ticket.assigned'));
        assert.equal((await feed('sup')).data.length, before, 'the supervisor is not notified of their own dispatch');
    });

    it('finished work asks every current roommate to confirm; students elsewhere hear nothing', async () => {
        const ticket = await latestTicket('L-843', SEED.sub.socket);
        await t.sql("UPDATE complaints SET status = 'IN_PROGRESS' WHERE complaint_id = $1", [ticket]);
        await t.sql("UPDATE complaints SET status = 'PENDING_VERIFICATION' WHERE complaint_id = $1", [ticket]);
        for (const who of ['vihaan', 'karan']) {
            assert.ok((await kinds(who)).includes('ticket.done'), `${who} should be asked to confirm`);
        }
        assert.ok(!(await kinds('priya')).includes('ticket.done'), 'a student in another room hears nothing');
        assert.deepEqual(await kinds('priya'), []);
    });

    it('a rejected fix alerts supervisors and the technician; confirming tells the technician', async () => {
        const ticket = await latestTicket('L-843', SEED.sub.socket);
        const no = await t.api('/feedback', {
            method: 'POST',
            token: tokens.karan,
            body: { complaint_id: ticket, is_satisfied: false, comments: 'Still sparking' },
        });
        assert.equal(no.status, 200);
        assert.ok((await kinds('sup')).includes('ticket.escalated'));
        const suresh = await t.login(SEED.electrician);
        const tech = (await t.api('/notifications', { token: suresh })).data.map((n) => n.kind);
        assert.ok(tech.includes('job.rejected'));

        await t.sql("UPDATE complaints SET status = 'PENDING_VERIFICATION' WHERE complaint_id = $1", [ticket]);
        const yes = await t.api('/feedback', {
            method: 'POST',
            token: tokens.vihaan,
            body: { complaint_id: ticket, is_satisfied: true, rating: 5 },
        });
        assert.equal(yes.status, 200);
        assert.ok((await t.api('/notifications', { token: suresh })).data.some((n) => n.kind === 'job.confirmed'));
        assert.ok((await kinds('karan')).includes('ticket.closed'), 'the roommate who did not confirm is told it closed');
    });

    it('overdue tickets appear for supervisors', async () => {
        const ticket = await latestTicket('L-810', SEED.sub.socket);
        await t.sql("UPDATE complaints SET created_at = NOW() - INTERVAL '30 hours' WHERE complaint_id = $1", [ticket]);
        const item = (await feed('sup')).data.find((n) => n.kind === 'ticket.overdue' && n.complaint_id === ticket);
        assert.ok(item);
    });

    it('unread counts only items newer than `since`, and paging works', async () => {
        const all = await feed('sup');
        const total = Number(all.headers.get('x-unread-count'));
        assert.equal(total, all.data.length);
        assert.ok(total >= 3);

        const future = new Date(Date.now() + 60_000).toISOString();
        assert.equal(Number((await feed('sup', `?since=${encodeURIComponent(future)}`)).headers.get('x-unread-count')), 0);

        const newest = new Date(all.data[0].created_at);
        const justBefore = new Date(newest.getTime() - 1).toISOString();
        const some = Number((await feed('sup', `?since=${encodeURIComponent(justBefore)}`)).headers.get('x-unread-count'));
        assert.ok(some >= 1 && some <= total);

        const page = await feed('sup', '?limit=2&offset=1');
        assert.equal(page.data.length, 2);
        assert.equal(page.data[0].id, all.data[1].id);
    });

    it('a student sees only notifications about tickets they may see', async () => {
        const ids = new Set((await t.api('/complaints', { token: tokens.priya })).data.map((c) => c.complaint_id));
        const mine = (await feed('priya')).data;
        assert.ok(mine.every((n) => ids.has(n.complaint_id)));
    });
});
