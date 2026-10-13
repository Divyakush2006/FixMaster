const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { resetDatabase, startApp, SEED } = require('./helpers');

// In-app notifications (migrations 012-013): written by triggers in the same
// transaction as the change; the person who acted is never told about it.

describe('notifications', () => {
    let t;
    let tokens;
    const feed = async (who, query = '') => (await t.api(`/notifications${query}`, { token: tokens[who] })).data;
    const kinds = async (who) => (await feed(who)).map((n) => n.kind);
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
            sup: await t.login(SEED.supervisor),
            elec2: await t.login(SEED.electrician2),
        };
    });
    after(async () => t && t.close());

    it('starts empty for the seed users and requires sign-in', async () => {
        assert.equal((await t.api('/notifications')).status, 401);
        assert.equal((await t.api('/notifications/unread-count', { token: tokens.vihaan })).data.unread, 0);
    });

    it('a high-priority ticket alerts the block supervisor, not the person who raised it', async () => {
        const r = await t.api('/complaints', {
            method: 'POST',
            token: tokens.rahul,
            body: { ticket_scope: 'ROOM', block_id: 'L_BLOCK', room_id: 'L-810', subcategory_id: SEED.sub.socket }, // HIGH
        });
        assert.equal(r.status, 201);
        assert.ok((await kinds('sup')).includes('ticket.urgent'));
        assert.deepEqual(await kinds('rahul'), []);
    });

    it('dispatch tells the technician and the ticket followers; the dispatcher gets nothing', async () => {
        const before = (await feed('sup')).length;
        const ticket = await latestTicket('L-810', SEED.sub.socket);
        const a = await t.api('/dispatch/assign', {
            method: 'POST',
            token: tokens.sup,
            body: { complaint_id: ticket, staff_user_id: await userId('EMP_ELEC_02') },
        });
        assert.equal(a.status, 200);

        const job = (await feed('elec2')).find((n) => n.kind === 'job.assigned');
        assert.ok(job);
        assert.equal(job.complaint_id, ticket);
        assert.equal(job.read_at, null);
        assert.ok((await kinds('rahul')).includes('ticket.assigned'));
        assert.equal((await feed('sup')).length, before, 'the supervisor is not notified of their own action');
    });

    it('finished work asks every current roommate to confirm', async () => {
        const ticket = await latestTicket('L-843', SEED.sub.socket);
        await t.sql("UPDATE complaints SET status = 'IN_PROGRESS' WHERE complaint_id = $1", [ticket]);
        await t.sql("UPDATE complaints SET status = 'PENDING_VERIFICATION' WHERE complaint_id = $1", [ticket]);
        for (const who of ['vihaan', 'karan']) {
            assert.ok((await kinds(who)).includes('ticket.done'), `${who} should be asked to confirm`);
        }
        assert.ok(!(await kinds('rahul')).includes('ticket.done'), 'a student in another room is not');
    });

    it('a rejected fix alerts supervisors; confirming closes it for followers and the technician', async () => {
        const ticket = await latestTicket('L-843', SEED.sub.socket);
        const no = await t.api('/feedback', {
            method: 'POST',
            token: tokens.karan,
            body: { complaint_id: ticket, is_satisfied: false, comments: 'Still sparking' },
        });
        assert.equal(no.status, 200);
        assert.ok((await kinds('sup')).includes('ticket.escalated'));

        await t.sql("UPDATE complaints SET status = 'PENDING_VERIFICATION' WHERE complaint_id = $1", [ticket]);
        const yes = await t.api('/feedback', {
            method: 'POST',
            token: tokens.vihaan,
            body: { complaint_id: ticket, is_satisfied: true, rating: 5 },
        });
        assert.equal(yes.status, 200);
        assert.ok((await kinds('karan')).includes('ticket.closed'), 'the roommate who did not confirm is told it closed');
        const tech = await t.sql('SELECT kind FROM notifications WHERE user_id = $1', [await userId('EMP_ELEC_01')]);
        assert.ok(tech.rows.some((n) => n.kind === 'job.confirmed'));
    });

    it('reassigning tells the previous technician their job was taken off', async () => {
        const ticket = await latestTicket('L-810', SEED.sub.socket);
        const r = await t.api('/dispatch/assign', {
            method: 'POST',
            token: tokens.sup,
            body: { complaint_id: ticket, staff_user_id: await userId('EMP_ELEC_03') },
        });
        assert.equal(r.status, 200);
        assert.ok((await kinds('elec2')).includes('job.withdrawn'));
    });

    it('the overdue sweep warns supervisors and the technician once per ticket', async () => {
        const ticket = await latestTicket('L-810', SEED.sub.socket);
        await t.sql("UPDATE complaints SET sla_due_at = NOW() - INTERVAL '1 hour' WHERE complaint_id = $1", [ticket]);
        const { sweepOnce } = require('../src/services/verificationSweeper');
        await sweepOnce();
        await sweepOnce();
        const n = await t.sql(
            "SELECT kind, COUNT(*)::int AS n FROM notifications WHERE complaint_id = $1 AND kind IN ('ticket.overdue','job.overdue') GROUP BY kind",
            [ticket]
        );
        const byKind = Object.fromEntries(n.rows.map((r) => [r.kind, r.n]));
        assert.equal(byKind['ticket.overdue'], 1);
        assert.equal(byKind['job.overdue'], 1);
    });

    it('people read, mark and count only their own', async () => {
        const list = await t.api('/notifications?limit=2', { token: tokens.sup });
        assert.equal(list.status, 200);
        assert.ok(list.data.length <= 2);
        assert.ok(Number(list.headers.get('x-unread-count')) > 0);

        const mine = (await feed('sup'))[0];
        assert.equal((await t.api(`/notifications/${mine.notification_id}/read`, { method: 'POST', token: tokens.vihaan })).status, 404, 'not yours');
        assert.equal((await t.api(`/notifications/${mine.notification_id}/read`, { method: 'POST', token: tokens.sup })).status, 200);

        const unread = await feed('sup', '?unread=true');
        assert.ok(unread.every((n) => n.read_at === null));
        assert.ok(!unread.some((n) => n.notification_id === mine.notification_id));

        assert.equal((await t.api('/notifications/read-all', { method: 'POST', token: tokens.sup })).status, 200);
        assert.equal((await t.api('/notifications/unread-count', { token: tokens.sup })).data.unread, 0);
        assert.equal((await t.api('/notifications/abc/read', { method: 'POST', token: tokens.sup })).status, 400);
        assert.equal((await t.api('/notifications?limit=1000', { token: tokens.sup })).status, 400);
    });
});
