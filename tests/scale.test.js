const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { resetDatabase, startApp, TEST_DB_URL } = require('./helpers');

// The campus-sized dummy dataset (scripts/generate-scale-data.js) and the read
// paths people use all day, on top of it: the shape of the data, the tickets
// each role sees, and a time budget per endpoint so a missing index shows up
// here rather than in front of the wardens.

describe('scale dataset', () => {
    let t;
    let chief;
    let student;
    let supervisor;
    let totals;

    const timed = async (path, token) => {
        const started = performance.now();
        const r = await t.api(path, { token });
        return { ...r, ms: performance.now() - started };
    };

    before(async () => {
        await resetDatabase();
        const { generate } = require('../scripts/generate-scale-data');
        totals = await generate({ connectionString: TEST_DB_URL, log: () => {} });
        t = await startApp();
        chief = await t.login('GENCW01');
        student = await t.login('23BCE00001');
        supervisor = await t.login('GENSUP01');
    });

    after(async () => {
        await t.close();
    });

    it('creates a campus: 24 generated blocks of 8-10 floors, thousands of residents, a year of tickets', async () => {
        assert.ok(totals.students >= 10000, `students: ${totals.students}`);
        assert.ok(totals.tickets >= 7000, `tickets: ${totals.tickets}`);
        assert.ok(totals.reviews >= 5000);
        const { rows } = await t.sql(`SELECT total_floors, hostel_type FROM hostel_blocks WHERE block_id ~ '^[A-X]_BLOCK$' AND block_id <> 'L_BLOCK'`);
        assert.equal(rows.length, 23);
        assert.ok(rows.every((b) => b.total_floors >= 8 && b.total_floors <= 10));
        assert.ok(rows.some((b) => b.hostel_type === 'LADIES') && rows.some((b) => b.hostel_type === 'MENS'));
    });

    it('gives every resident a room, a complete profile and the right hostel', async () => {
        const { rows } = await t.sql(
            `SELECT COUNT(*)::int AS students,
                    COUNT(*) FILTER (WHERE a.room_id IS NULL)::int AS without_room,
                    COUNT(*) FILTER (WHERE p.user_id IS NULL)::int AS without_profile,
                    COUNT(*) FILTER (WHERE (b.hostel_type = 'LADIES') <> (p.gender = 'FEMALE'))::int AS wrong_hostel
             FROM users u
             LEFT JOIN student_room_allotments a ON a.student_id = u.user_id AND a.is_current
             LEFT JOIN student_profiles p ON p.user_id = u.user_id
             LEFT JOIN rooms r ON r.room_id = a.room_id
             LEFT JOIN hostel_blocks b ON b.block_id = r.block_id
             WHERE u.email LIKE 'gen.%' AND u.role = 'STUDENT'`
        );
        assert.deepEqual({ ...rows[0], students: rows[0].students > 10000 }, { students: true, without_room: 0, without_profile: 0, wrong_hostel: 0 });
    });

    it('keeps every ticket on the catalogue priority', async () => {
        const { rows } = await t.sql(
            `SELECT COUNT(*)::int AS n FROM complaints c JOIN complaint_subcategories s ON s.subcategory_id = c.subcategory_id
             WHERE c.priority <> s.priority_level AND c.raised_by_user_id IN (SELECT user_id FROM users WHERE email LIKE 'gen.%')`
        );
        assert.equal(rows[0].n, 0);
    });

    it('puts every assignment on a technician of the right trade in the ticket\'s own block', async () => {
        const { rows } = await t.sql(
            `SELECT COUNT(*)::int AS n
             FROM complaint_assignments a
             JOIN complaints c ON c.complaint_id = a.complaint_id
             JOIN complaint_subcategories s ON s.subcategory_id = c.subcategory_id
             JOIN users u ON u.user_id = a.staff_user_id
             WHERE u.email LIKE 'gen.staff%' AND (u.specialization <> s.required_specialization OR u.home_block_id <> c.block_id)`
        );
        assert.equal(rows[0].n, 0);
    });

    it('is the same campus on every run', async () => {
        const first = (await t.sql(`SELECT md5(string_agg(complaint_id || status || subcategory_id, ',' ORDER BY complaint_id)) AS h FROM complaints WHERE raised_by_user_id IN (SELECT user_id FROM users WHERE email LIKE 'gen.%')`)).rows[0].h;
        const { generate } = require('../scripts/generate-scale-data');
        await generate({ connectionString: TEST_DB_URL, reset: true, log: () => {} });
        const second = (await t.sql(`SELECT md5(string_agg(complaint_id || status || subcategory_id, ',' ORDER BY complaint_id)) AS h FROM complaints WHERE raised_by_user_id IN (SELECT user_id FROM users WHERE email LIKE 'gen.%')`)).rows[0].h;
        assert.equal(second, first);
        t.clearTokens();
        chief = await t.login('GENCW01');
        student = await t.login('23BCE00001');
        supervisor = await t.login('GENSUP01');
    });

    it('refuses to run twice without --reset, and never in production', async () => {
        const { generate } = require('../scripts/generate-scale-data');
        assert.equal(await generate({ connectionString: TEST_DB_URL, log: () => {} }), false);
        const env = process.env.NODE_ENV;
        process.env.NODE_ENV = 'production';
        try {
            await assert.rejects(() => generate({ connectionString: TEST_DB_URL, log: () => {} }), /production/);
        } finally {
            process.env.NODE_ENV = env;
        }
    });

    describe('read paths on the full campus', () => {
        const BUDGET_MS = 3000;

        it('a supervisor sees only their three blocks', async () => {
            const r = await timed('/insights/overview', supervisor);
            assert.equal(r.status, 200);
            assert.equal(r.data.blocks.length, 3);
            assert.ok(r.ms < BUDGET_MS, `${r.ms.toFixed(0)} ms`);
        });

        it('the chief warden sees every block, quickly', async () => {
            for (const path of ['/insights/overview', '/insights/breach-risk', '/insights/recurring', '/analytics/kpi', '/analytics/hotspots', '/autopilot/performance', '/complaints?limit=50']) {
                const r = await timed(path, chief);
                assert.equal(r.status, 200, `${path}: ${JSON.stringify(r.data).slice(0, 200)}`);
                assert.ok(r.ms < BUDGET_MS, `${path} took ${r.ms.toFixed(0)} ms`);
            }
            const overview = await t.api('/insights/overview', { token: chief });
            assert.ok(overview.data.blocks.length >= 24);
        });

        it('a student sees only their own tickets, quickly', async () => {
            const r = await timed('/complaints', student);
            assert.equal(r.status, 200);
            assert.ok(r.ms < BUDGET_MS, `${r.ms.toFixed(0)} ms`);
            const me = (await t.sql(`SELECT user_id FROM users WHERE reg_or_emp_id = '23BCE00001'`)).rows[0].user_id;
            const mine = new Set((await t.sql(`SELECT complaint_id FROM complaint_reporters WHERE user_id = $1`, [me])).rows.map((x) => x.complaint_id));
            const rows = Array.isArray(r.data) ? r.data : r.data.complaints || r.data.items || [];
            assert.ok(rows.every((x) => mine.has(x.complaint_id)));
        });

        it('builds a daily briefing from the whole campus', async () => {
            const r = await timed('/insights/briefing', chief);
            assert.equal(r.status, 200);
            assert.ok(r.data.facts.totals.open_tickets > 0);
            assert.ok(r.ms < 10000, `${r.ms.toFixed(0)} ms`);
        });

        it('ranks technicians by their 60-day record', async () => {
            const r = await t.api('/autopilot/performance?specialization=ELECTRICIAN', { token: chief });
            assert.equal(r.status, 200);
            assert.ok(r.data.length >= 24);
            assert.ok(r.data.filter((x) => x.rated_jobs >= 8).length > 5, `enough rated jobs for the board to have real figures: ${JSON.stringify(r.data.slice(0, 2))}`);
        });
    });
});
