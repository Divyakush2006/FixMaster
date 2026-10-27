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

    it('creates a campus: two hostels of 8-10 floor blocks, thousands of residents, a year of tickets', async () => {
        assert.ok(totals.students >= 10000, `students: ${totals.students}`);
        assert.ok(totals.tickets >= 7000, `tickets: ${totals.tickets}`);
        assert.ok(totals.reviews >= 5000);
        const { rows } = await t.sql(`SELECT block_id, total_floors, hostel_type FROM hostel_blocks WHERE block_kind = 'RESIDENTIAL' AND block_id <> 'L_BLOCK' ORDER BY block_id`);
        assert.ok(rows.every((b) => b.total_floors >= 8 && b.total_floors <= 10));
        // Men's hostel: A to T without S (L-Block is the seed's); ladies' hostel: A-H, J and S under ids LA ... LS.
        assert.deepEqual(rows.filter((b) => b.hostel_type === 'MENS').map((b) => b.block_id[0]), 'ABCDEFGHIJKMNOPQRT'.split(''));
        assert.deepEqual(rows.filter((b) => b.hostel_type === 'LADIES').map((b) => b.block_id), ['LA', 'LB', 'LC', 'LD', 'LE', 'LF', 'LG', 'LH', 'LJ', 'LS'].map((c) => `${c}_BLOCK`));
        assert.equal((await t.sql(`SELECT hostel_type FROM hostel_blocks WHERE block_id = 'S_BLOCK'`)).rows.length, 0, 'S is a ladies block only');
    });

    it('keeps MH (the whole men\'s hostel) and PRP (academic) as blocks with shared areas and tickets only', async () => {
        const { rows } = await t.sql(
            `SELECT b.block_id, b.block_kind, b.hostel_type,
                    (SELECT COUNT(*) FROM rooms r WHERE r.block_id = b.block_id)::int AS rooms,
                    (SELECT COUNT(*) FROM common_areas a WHERE a.block_id = b.block_id)::int AS areas,
                    (SELECT COUNT(*) FROM complaints c WHERE c.block_id = b.block_id)::int AS tickets
             FROM hostel_blocks b WHERE b.block_id IN ('MH_BLOCK', 'PRP_BLOCK') ORDER BY b.block_id`
        );
        assert.deepEqual(rows.map((r) => [r.block_id, r.block_kind, r.hostel_type, r.rooms]), [['MH_BLOCK', 'HOSTEL_WIDE', 'MENS', 0], ['PRP_BLOCK', 'ACADEMIC', null, 0]]);
        assert.ok(rows.every((r) => r.areas > 0 && r.tickets > 0));
    });

    it('gives each hostel its own chief warden and supervisors', async () => {
        const { rows } = await t.sql(`SELECT reg_or_emp_id, role, hostel_type FROM users WHERE reg_or_emp_id LIKE 'GEN%' AND role IN ('CHIEF_WARDEN', 'SUPERVISOR') ORDER BY reg_or_emp_id`);
        assert.deepEqual(rows.filter((r) => r.role === 'CHIEF_WARDEN').map((r) => [r.reg_or_emp_id, r.hostel_type]), [['GENCW01', 'MENS'], ['GENCW02', 'LADIES']]);
        assert.ok(rows.filter((r) => r.role === 'SUPERVISOR').every((r) => r.hostel_type === (r.reg_or_emp_id.startsWith('GENSUPL') ? 'LADIES' : 'MENS')));
        assert.equal((await t.sql(`SELECT COUNT(*)::int AS n FROM supervisor_blocks sb JOIN users u ON u.user_id = sb.supervisor_user_id JOIN hostel_blocks b ON b.block_id = sb.block_id WHERE b.hostel_type <> u.hostel_type`)).rows[0].n, 0);
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
            const r = await timed('/insights/overview', await t.login('GENSUP02'));
            assert.equal(r.status, 200);
            assert.equal(r.data.blocks.length, 3);
            assert.ok(r.ms < BUDGET_MS, `${r.ms.toFixed(0)} ms`);
        });

        it('the chief warden sees every block of their hostel, quickly, and none of the other', async () => {
            for (const path of ['/insights/overview', '/insights/breach-risk', '/insights/recurring', '/analytics/kpi', '/analytics/hotspots', '/autopilot/performance', '/complaints?limit=50']) {
                const r = await timed(path, chief);
                assert.equal(r.status, 200, `${path}: ${JSON.stringify(r.data).slice(0, 200)}`);
                assert.ok(r.ms < BUDGET_MS, `${path} took ${r.ms.toFixed(0)} ms`);
            }
            const overview = await t.api('/insights/overview', { token: chief });
            const ids = overview.data.blocks.map((b) => b.block_id);
            assert.ok(ids.length >= 19 && ids.includes('MH_BLOCK') && ids.includes('PRP_BLOCK'), ids.join(','));
            assert.ok(!ids.some((id) => /^L[A-Z]_BLOCK$/.test(id)), 'no ladies blocks in the men\'s chief warden\'s view');
            const ladies = await t.api('/insights/overview', { token: await t.login('GENCW02') });
            const ladyIds = ladies.data.blocks.map((b) => b.block_id);
            assert.ok(ladyIds.includes('LA_BLOCK') && ladyIds.includes('PRP_BLOCK') && !ladyIds.includes('A_BLOCK') && !ladyIds.includes('MH_BLOCK'), ladyIds.join(','));
        });

        it('a student sees only their own tickets, quickly', async () => {
            const r = await timed('/complaints', student);
            assert.equal(r.status, 200);
            assert.ok(r.ms < BUDGET_MS, `${r.ms.toFixed(0)} ms`);
            const me = (await t.sql(`SELECT user_id FROM users WHERE reg_or_emp_id = '23BCE00001'`)).rows[0].user_id;
            // Their own reports, and the tickets of the room they live in (a roommate may have reported a fault there).
            const mine = new Set(
                (
                    await t.sql(
                        `SELECT complaint_id FROM complaint_reporters WHERE user_id = $1
                         UNION SELECT c.complaint_id FROM complaints c JOIN student_room_allotments a ON a.room_id = c.room_id AND a.is_current
                         WHERE a.student_id = $1 AND c.ticket_scope = 'ROOM'`,
                        [me]
                    )
                ).rows.map((x) => x.complaint_id)
            );
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
            assert.ok(r.data.length >= 18);
            assert.ok(r.data.filter((x) => x.rated_jobs >= 8).length > 5, `enough rated jobs for the board to have real figures: ${JSON.stringify(r.data.slice(0, 2))}`);
        });
    });
});
