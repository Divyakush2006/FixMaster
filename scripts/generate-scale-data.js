#!/usr/bin/env node
/**
 * DEVELOPMENT ONLY: fills the database with a campus-sized dummy dataset so
 * dashboards, the autopilot, the briefing and the load test have something
 * realistic to work on.
 *
 *   npm run db:scale -- --yes [--days 90] [--tickets-per-student 0.75] [--reset]
 *
 * What it creates (on top of the demo seed, which must already be loaded):
 *   - 24 hostel blocks (A to X), 8 to 10 floors each, half men's and half
 *     ladies' (L-Block is left exactly as the seed has it);
 *   - about 20 rooms per floor, three beds each, ~92% occupied, with a
 *     resident per occupied bed (roughly 11,000 students, each with a
 *     complete profile and a current allotment);
 *   - common areas on every floor;
 *   - housekeeping, electrical, plumbing, carpentry and AC staff for every
 *     block (11 each, two on most trades so the autopilot has a real choice)
 *     plus a campus pool of 11, supervisors for groups of blocks, and a chief
 *     warden;
 *   - `--days` days of ticket history in every state, with assignments by
 *     trade, ratings that differ by technician, and some comments.
 *
 * Deterministic: everything is derived from hashes of ids and positions, so two
 * runs produce the same campus. Every generated account has an email starting
 * "gen." and the shared demo password (Password@123), which is why this
 * refuses to run with NODE_ENV=production. --reset removes generated accounts
 * and their tickets first.
 */
const { Client } = require('pg');
require('dotenv').config({ quiet: true });
const { connectionConfig } = require('../src/config/dbConfig');
const { PRIVACY_NOTICE_VERSION } = require('../src/config/identity');

const arg = (name, fallback) => {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : fallback;
};

const BLOCK_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWX'.split('');
const ROOMS_PER_FLOOR = 20;
const OCCUPANCY_PCT = 92;

const FIRST = ['Aarav', 'Vihaan', 'Aditya', 'Arjun', 'Rohan', 'Karan', 'Ishaan', 'Rahul', 'Siddharth', 'Kabir', 'Ananya', 'Diya', 'Priya', 'Sneha', 'Kavya', 'Meera', 'Isha', 'Riya', 'Nandini', 'Pooja', 'Harsh', 'Vikram', 'Neha', 'Tanvi', 'Manish'];
const LAST = ['Sharma', 'Iyer', 'Reddy', 'Nair', 'Gupta', 'Patel', 'Singh', 'Menon', 'Rao', 'Das', 'Kumar', 'Joshi', 'Pillai', 'Verma', 'Bose', 'Chopra', 'Naidu', 'Shetty', 'Mishra', 'Kulkarni'];
const CITIES = [['Chennai', 'Tamil Nadu', '600001'], ['Bengaluru', 'Karnataka', '560001'], ['Hyderabad', 'Telangana', '500001'], ['Kochi', 'Kerala', '682001'], ['Pune', 'Maharashtra', '411001'], ['Delhi', 'Delhi', '110001'], ['Kolkata', 'West Bengal', '700001'], ['Jaipur', 'Rajasthan', '302001']];
const GOOD = ['Fixed quickly and was polite.', 'Very thorough, cleaned up after the work.', 'Came on time and did a neat job.', 'Prompt and friendly, problem solved.', 'Excellent work, thank you.'];
const BAD = ['Came very late and the problem is still there.', 'Rude and left a mess behind.', 'Not fixed properly, same problem again.', 'Nobody came for two days.', 'Poor work, had to ask again.'];

const sqlArray = (items) => `ARRAY[${items.map((s) => `'${String(s).replace(/'/g, "''")}'`).join(',')}]`;
// A stable pseudo-random integer in [0, n) from any text.
const pick = (seed, n) => `(abs(hashtext(${seed})) % ${n})`;

async function generate({ connectionString, days = 90, perStudent = 0.75, reset = false, log = console.log } = {}) {
    if (process.env.NODE_ENV === 'production') throw new Error('Refusing to generate dummy data with NODE_ENV=production.');
    const client = new Client(connectionConfig(connectionString));
    await client.connect();
    const t0 = Date.now();
    const q = (text, params) => client.query(text, params);
    try {
        const seeded = await q(`SELECT password_hash FROM users WHERE role = 'ADMIN' ORDER BY created_at LIMIT 1`);
        if (!seeded.rows[0]) throw new Error('Load the demo seed first (npm run db:seed): it supplies the catalogue and the demo password hash.');
        const passwordHash = seeded.rows[0].password_hash;

        await q('BEGIN');
        if (reset) {
            await q(`DELETE FROM complaints WHERE raised_by_user_id IN (SELECT user_id FROM users WHERE email LIKE 'gen.%')`);
            await q(`DELETE FROM users WHERE email LIKE 'gen.%'`);
            log('previous generated data removed.');
        }
        const existing = await q(`SELECT COUNT(*)::int AS n FROM users WHERE email LIKE 'gen.%'`);
        if (existing.rows[0].n > 0) {
            await q('ROLLBACK');
            log(`${existing.rows[0].n} generated accounts already exist; use --reset to rebuild.`);
            return false;
        }

        // 1. Blocks: 24, with 8-10 floors, half ladies'.
        const blocks = BLOCK_LETTERS.map((letter, i) => ({ id: `${letter}_BLOCK`, name: `${letter}-Block`, floors: 8 + (i % 3), type: i % 2 === 1 ? 'LADIES' : 'MENS', isNew: i >= 20, letter }));
        for (const b of blocks.filter((x) => x.isNew)) {
            await q(`INSERT INTO hostel_blocks (block_id, block_name, total_floors, hostel_type) VALUES ($1, $2, $3, $4) ON CONFLICT (block_id) DO NOTHING`, [b.id, b.name, b.floors, b.type]);
        }
        for (const b of blocks.filter((x) => !x.isNew && x.id !== 'L_BLOCK')) {
            await q(`UPDATE hostel_blocks SET hostel_type = $2 WHERE block_id = $1`, [b.id, b.type]);
            await q(
                `DELETE FROM block_floors WHERE block_id = $1 AND floor_number > $2
                   AND NOT EXISTS (SELECT 1 FROM rooms r WHERE r.block_id = block_floors.block_id AND r.floor_number = block_floors.floor_number)
                   AND NOT EXISTS (SELECT 1 FROM common_areas a WHERE a.block_id = block_floors.block_id AND a.floor_number = block_floors.floor_number)`,
                [b.id, b.floors]
            );
        }
        const genBlocks = blocks.filter((b) => b.id !== 'L_BLOCK').map((b) => b.id);

        // 2. Rooms and common areas.
        await q(
            `INSERT INTO rooms (room_id, block_id, room_number, floor_number, room_type, bed_capacity)
             SELECT split_part(b.block_id, '_', 1) || '-' || f.floor_number || lpad(r::text, 2, '0'),
                    b.block_id, f.floor_number || lpad(r::text, 2, '0'), f.floor_number,
                    CASE WHEN ${pick(`b.block_id || f.floor_number`, 4)} = 0 THEN 'AC' ELSE 'NON_AC' END, 3
             FROM hostel_blocks b
             JOIN block_floors f ON f.block_id = b.block_id AND f.floor_number BETWEEN 1 AND b.total_floors
             CROSS JOIN generate_series(1, ${ROOMS_PER_FLOOR}) r
             WHERE b.block_id = ANY($1::varchar[])
             ON CONFLICT DO NOTHING`,
            [genBlocks]
        );
        await q(
            `INSERT INTO common_areas (area_id, block_id, floor_number, area_type, description)
             SELECT split_part(b.block_id, '_', 1) || '-F' || lpad(f.floor_number::text, 2, '0') || '-' || a.tag || '-01',
                    b.block_id, f.floor_number, a.area_type, 'Floor ' || f.floor_number || ' ' || a.label
             FROM hostel_blocks b
             JOIN block_floors f ON f.block_id = b.block_id AND f.floor_number BETWEEN 1 AND b.total_floors
             CROSS JOIN (VALUES ('CORRIDOR', 'CORR', 'Corridor'), ('COMMON_WASHROOM', 'WASH', 'Common Washroom'), ('WATER_COOLER', 'COOLER', 'Water Cooler')) AS a(area_type, tag, label)
             WHERE b.block_id = ANY($1::varchar[])
             ON CONFLICT DO NOTHING`,
            [genBlocks]
        );
        await q(
            `INSERT INTO common_areas (area_id, block_id, floor_number, area_type, description)
             SELECT split_part(block_id, '_', 1) || '-F00-LIFT-01', block_id, 0, 'ELEVATOR', 'Ground Floor Lift'
             FROM hostel_blocks WHERE block_id = ANY($1::varchar[]) ON CONFLICT DO NOTHING`,
            [genBlocks]
        );

        // 3. Staff: per block two housekeepers (morning, evening) and one of each other trade, plus a campus pool.
        await q(
            `CREATE TEMP TABLE gen_slots ON COMMIT DROP AS
             SELECT row_number() OVER (ORDER BY b.block_id NULLS LAST, s.trade, s.shift, s.k) AS seq, b.block_id, s.trade, s.shift
             FROM (
                 SELECT block_id FROM hostel_blocks WHERE block_id = ANY($1::varchar[])
                 UNION ALL SELECT NULL::varchar
             ) b
             JOIN LATERAL (VALUES
                 ('CLEANING', 'MORNING', 1), ('CLEANING', 'EVENING', 1), ('ELECTRICIAN', 'MORNING', 1),
                 ('PLUMBER', 'MORNING', 1), ('CARPENTER', 'MORNING', 1), ('AC_TECH', 'MORNING', 1),
                 ('CLEANING', 'MORNING', 2), ('ELECTRICIAN', 'EVENING', 2), ('PLUMBER', 'EVENING', 2), ('CARPENTER', 'EVENING', 2), ('AC_TECH', 'EVENING', 2)
             ) AS s(trade, shift, k) ON TRUE`,
            [genBlocks]
        );
        await q(
            `INSERT INTO users (user_id, reg_or_emp_id, full_name, email, phone_number, password_hash, role, specialization, is_available, home_block_id, shift)
             SELECT md5('gen-staff-' || seq)::uuid::text, 'GENST' || lpad(seq::text, 4, '0'),
                    (${sqlArray(FIRST)})[1 + ${pick(`'sf' || seq`, FIRST.length)}] || ' ' || (${sqlArray(LAST)})[1 + ${pick(`'sl' || seq`, LAST.length)}] || ' (' ||
                      CASE trade WHEN 'CLEANING' THEN 'Housekeeper' WHEN 'ELECTRICIAN' THEN 'Electrician' WHEN 'PLUMBER' THEN 'Plumber' WHEN 'CARPENTER' THEN 'Carpenter' ELSE 'AC Specialist' END || ')',
                    'gen.staff' || seq || '@vit.ac.in', '98' || lpad(seq::text, 8, '0'), $1, 'STAFF', trade, ${pick(`'av' || seq`, 25)} <> 0, block_id, CASE WHEN block_id IS NULL THEN NULL ELSE shift END
             FROM gen_slots`,
            [passwordHash]
        );

        // 4. Supervisors for groups of three blocks, and a chief warden.
        for (let i = 0; i * 3 < genBlocks.length; i += 1) {
            const n = String(i + 1).padStart(2, '0');
            await q(
                `INSERT INTO users (user_id, reg_or_emp_id, full_name, email, phone_number, password_hash, role)
                 VALUES (md5('gen-sup-' || $1::text)::uuid::text, $2, $3, $4, $5, $6, 'SUPERVISOR')`,
                [n, `GENSUP${n}`, `${FIRST[(i * 3) % FIRST.length]} ${LAST[(i * 7) % LAST.length]} (Supervisor)`, `gen.sup${n}@vit.ac.in`, `97${String(i + 1).padStart(8, '0')}`, passwordHash]
            );
            await q(`INSERT INTO supervisor_blocks (supervisor_user_id, block_id) SELECT user_id, unnest($2::varchar[]) FROM users WHERE reg_or_emp_id = $1`, [`GENSUP${n}`, genBlocks.slice(i * 3, i * 3 + 3)]);
        }
        await q(
            `INSERT INTO users (user_id, reg_or_emp_id, full_name, email, phone_number, password_hash, role)
             VALUES (md5('gen-cw-1')::uuid::text, 'GENCW01', 'Meenakshi Raman (Chief Warden)', 'gen.chiefwarden@vit.ac.in', '9600000001', $1, 'CHIEF_WARDEN')`,
            [passwordHash]
        );

        // 5. Residents: one per occupied bed.
        await q(
            `CREATE TEMP TABLE gen_students ON COMMIT DROP AS
             SELECT row_number() OVER (ORDER BY room_id, bed) AS seq, room_id, block_id, floor_number, hostel_type, bed
             FROM (
                 SELECT r.room_id, r.block_id, r.floor_number, b.hostel_type, s AS bed
                 FROM rooms r
                 JOIN hostel_blocks b ON b.block_id = r.block_id
                 CROSS JOIN LATERAL generate_series(1, r.bed_capacity) s
                 WHERE r.block_id = ANY($1::varchar[]) AND r.is_active AND ${pick(`r.room_id || '-' || s`, 100)} < ${OCCUPANCY_PCT}
             ) x`,
            [genBlocks]
        );
        await q(
            `INSERT INTO users (user_id, reg_or_emp_id, full_name, email, phone_number, password_hash, role, account_status, email_verified_at)
             SELECT md5('gen-student-' || seq)::uuid::text,
                    (22 + seq % 4)::text || 'BCE' || lpad(seq::text, 5, '0'),
                    (${sqlArray(FIRST)})[1 + ${pick(`'f' || seq`, FIRST.length)}] || ' ' || (${sqlArray(LAST)})[1 + ${pick(`'l' || seq`, LAST.length)}],
                    'gen.' || lower((22 + seq % 4)::text || 'bce' || lpad(seq::text, 5, '0')) || '@vitstudent.ac.in',
                    '9' || lpad((100000000 + seq)::text, 9, '0'), $1, 'STUDENT', 'ACTIVE', NOW()
             FROM gen_students`,
            [passwordHash]
        );
        await q(
            `INSERT INTO student_room_allotments (student_id, room_id, academic_year, is_current, assigned_date)
             SELECT md5('gen-student-' || seq)::uuid::text, room_id, '2026-2027', TRUE, CURRENT_DATE - 60 FROM gen_students`
        );
        await q(
            `INSERT INTO student_profiles (user_id, school, programme, admission_year, expected_graduation_year, gender, date_of_birth,
                    guardian_name, guardian_relation, guardian_phone, permanent_city, permanent_state, permanent_pincode,
                    preferred_cleaning_slot, preferred_language, privacy_notice_version, privacy_consented_at)
             SELECT md5('gen-student-' || seq)::uuid::text,
                    (${sqlArray(['SCOPE', 'SENSE', 'SELECT', 'SMEC', 'VITBS'])})[1 + ${pick(`'sc' || seq`, 5)}],
                    (${sqlArray(['B.Tech Computer Science and Engineering', 'B.Tech Electronics and Communication', 'B.Tech Mechanical Engineering', 'B.Tech Information Technology', 'B.Tech Civil Engineering'])})[1 + ${pick(`'pr' || seq`, 5)}],
                    2022 + seq % 4, 2026 + seq % 4,
                    CASE hostel_type WHEN 'LADIES' THEN 'FEMALE' ELSE 'MALE' END,
                    DATE '2004-01-01' + ${pick(`'dob' || seq`, 1000)},
                    (${sqlArray(FIRST)})[1 + ${pick(`'gf' || seq`, FIRST.length)}] || ' ' || (${sqlArray(LAST)})[1 + ${pick(`'l' || seq`, LAST.length)}],
                    (${sqlArray(['Mother', 'Father', 'Guardian'])})[1 + ${pick(`'gr' || seq`, 3)}],
                    '98' || lpad((20000000 + seq)::text, 8, '0'),
                    (${sqlArray(CITIES.map((c) => c[0]))})[1 + ${pick(`'ct' || seq`, CITIES.length)}],
                    (${sqlArray(CITIES.map((c) => c[1]))})[1 + ${pick(`'ct' || seq`, CITIES.length)}],
                    (${sqlArray(CITIES.map((c) => c[2]))})[1 + ${pick(`'ct' || seq`, CITIES.length)}],
                    (${sqlArray(['MORNING', 'AFTERNOON', 'EVENING', 'ANY'])})[1 + ${pick(`'cs' || seq`, 4)}],
                    (${sqlArray(['en', 'en', 'en', 'hi', 'ta', 'te'])})[1 + ${pick(`'lg' || seq`, 6)}],
                    $1, NOW() - INTERVAL '60 days'
             FROM gen_students`,
            [PRIVACY_NOTICE_VERSION]
        );
        const studentCount = (await q('SELECT COUNT(*)::int AS n FROM gen_students')).rows[0].n;

        // 6. Ticket history.
        const ticketCount = Math.round(studentCount * perStudent);
        await q(
            `CREATE TEMP TABLE gen_areas ON COMMIT DROP AS
             SELECT area_id, block_id, row_number() OVER (PARTITION BY block_id ORDER BY area_id) AS idx,
                    count(*) OVER (PARTITION BY block_id) AS cnt
             FROM common_areas WHERE block_id = ANY($1::varchar[]) AND is_operational`,
            [genBlocks]
        );
        await q(
            `CREATE TEMP TABLE gen_pool ON COMMIT DROP AS
             SELECT user_id, home_block_id AS block_id, specialization AS trade,
                    row_number() OVER (PARTITION BY home_block_id, specialization ORDER BY user_id) AS idx,
                    count(*) OVER (PARTITION BY home_block_id, specialization) AS cnt
             FROM users WHERE role = 'STAFF' AND email LIKE 'gen.staff%' AND home_block_id IS NOT NULL`
        );
        const roomSubs = (await q(`SELECT subcategory_id FROM complaint_subcategories WHERE category_id <> 6 ORDER BY subcategory_id`)).rows.map((r) => r.subcategory_id);
        const areaSubs = (await q(`SELECT subcategory_id FROM complaint_subcategories WHERE category_id = 6 ORDER BY subcategory_id`)).rows.map((r) => r.subcategory_id);
        await q(
            `CREATE TEMP TABLE gen_t ON COMMIT DROP AS
             SELECT n.n,
                    md5('gen-ticket-' || n.n)::uuid::text AS complaint_id,
                    s.room_id, s.block_id, s.floor_number,
                    md5('gen-student-' || s.seq)::uuid::text AS student_id,
                    ${pick(`'ca' || n.n`, 100)} < 12 AS is_area,
                    NOW() - make_interval(mins => ${pick(`'age' || n.n`, days * 1440)}) AS created_at
             FROM generate_series(1, $1::int) n(n)
             JOIN gen_students s ON s.seq = 1 + ${pick(`'st' || n.n`, studentCount)}`,
            [ticketCount]
        );
        await q(
            `CREATE TEMP TABLE gen_c ON COMMIT DROP AS
             SELECT t.*,
                    CASE WHEN t.is_area THEN (${sqlArray(areaSubs)})[1 + ${pick(`'sa' || t.n`, areaSubs.length)}]::int
                         ELSE (${sqlArray(roomSubs)})[1 + ${pick(`'sr' || t.n`, roomSubs.length)}]::int END AS subcategory_id,
                    a.area_id,
                    CASE WHEN t.created_at < NOW() - INTERVAL '3 days' THEN
                         CASE WHEN ${pick(`'sx' || t.n`, 100)} < 94 THEN 'COMPLETED' WHEN ${pick(`'sx' || t.n`, 100)} < 96 THEN 'ESCALATED'
                              WHEN ${pick(`'sx' || t.n`, 100)} < 97 THEN 'IN_PROGRESS' WHEN ${pick(`'sx' || t.n`, 100)} < 98 THEN 'ASSIGNED' ELSE 'REJECTED' END
                    ELSE
                         CASE WHEN ${pick(`'sx' || t.n`, 100)} < 55 THEN 'COMPLETED' WHEN ${pick(`'sx' || t.n`, 100)} < 65 THEN 'PENDING_VERIFICATION'
                              WHEN ${pick(`'sx' || t.n`, 100)} < 77 THEN 'IN_PROGRESS' WHEN ${pick(`'sx' || t.n`, 100)} < 87 THEN 'ASSIGNED'
                              WHEN ${pick(`'sx' || t.n`, 100)} < 97 THEN 'OPEN' ELSE 'ESCALATED' END
                    END AS status
             FROM gen_t t
             LEFT JOIN gen_areas a ON a.block_id = t.block_id AND a.idx = 1 + ${pick(`'ar' || t.n`, 1000)} % a.cnt AND t.is_area`
        );
        // A place can have only one live ticket per kind of fault: later duplicates in the history are shown as finished.
        await q(
            `UPDATE gen_c SET status = 'COMPLETED' WHERE complaint_id IN (
                 SELECT complaint_id FROM (
                     SELECT complaint_id, row_number() OVER (PARTITION BY CASE WHEN is_area THEN area_id ELSE room_id END, subcategory_id ORDER BY n) AS rn
                     FROM gen_c WHERE status IN ('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'PENDING_VERIFICATION', 'ESCALATED')
                 ) d WHERE rn > 1)`
        );
        await q(
            `INSERT INTO complaints (complaint_id, ticket_scope, room_id, common_area_id, block_id, raised_by_user_id, subcategory_id, description, status, priority, created_at, resolved_at, closed_at, closure_reason)
             SELECT c.complaint_id, CASE WHEN c.is_area THEN 'COMMON_AREA' ELSE 'ROOM' END,
                    CASE WHEN c.is_area THEN NULL ELSE c.room_id END, CASE WHEN c.is_area THEN c.area_id ELSE NULL END,
                    c.block_id, c.student_id, c.subcategory_id, sub.issue_name || ' (generated)', c.status, sub.priority_level, c.created_at,
                    CASE WHEN c.status IN ('COMPLETED', 'PENDING_VERIFICATION') THEN c.created_at + make_interval(mins => 20 + ${pick(`'rs' || c.n`, 600)}) END,
                    CASE WHEN c.status = 'COMPLETED' THEN c.created_at + make_interval(mins => 40 + ${pick(`'rs' || c.n`, 600)}) END,
                    CASE c.status WHEN 'COMPLETED' THEN 'CONFIRMED' WHEN 'REJECTED' THEN 'INVALID' END
             FROM gen_c c JOIN complaint_subcategories sub ON sub.subcategory_id = c.subcategory_id
             WHERE NOT (c.is_area AND c.area_id IS NULL)`
        );

        // Assignments for every ticket a technician has touched.
        await q(
            `INSERT INTO complaint_assignments (complaint_id, staff_user_id, assigned_at, started_at, work_completed_at, current_state, dispatch_source)
             SELECT c.complaint_id, p.user_id,
                    c.created_at + make_interval(mins => 3 + ${pick(`'as' || c.n`, 60)}),
                    CASE WHEN c.status <> 'ASSIGNED' THEN c.created_at + make_interval(mins => 30 + ${pick(`'as' || c.n`, 60)}) END,
                    CASE WHEN c.status IN ('COMPLETED', 'PENDING_VERIFICATION', 'ESCALATED') THEN c.created_at + make_interval(mins => 20 + ${pick(`'rs' || c.n`, 600)}) END,
                    CASE c.status WHEN 'ASSIGNED' THEN 'ASSIGNED' WHEN 'IN_PROGRESS' THEN 'IN_PROGRESS' ELSE 'DONE' END,
                    CASE WHEN ${pick(`'ds' || c.n`, 100)} < 40 THEN 'AUTOPILOT' WHEN ${pick(`'ds' || c.n`, 100)} < 50 THEN 'SUGGESTION' ELSE 'MANUAL' END
             FROM gen_c c
             JOIN complaint_subcategories sub ON sub.subcategory_id = c.subcategory_id
             JOIN gen_pool p ON p.block_id = c.block_id AND p.trade = sub.required_specialization AND p.idx = 1 + ${pick(`'pk' || c.n`, 1000)} % p.cnt
             WHERE c.status IN ('ASSIGNED', 'IN_PROGRESS', 'PENDING_VERIFICATION', 'COMPLETED', 'ESCALATED') AND NOT (c.is_area AND c.area_id IS NULL)`
        );

        // Ratings: each technician has a steady level (a few are poor), with noise per job.
        await q(
            `INSERT INTO complaint_feedback (complaint_id, student_id, is_satisfactorily_resolved, rating, student_comments, verified_at)
             SELECT x.complaint_id, x.student_id, x.ok, x.rating,
                    CASE WHEN ${pick(`'cm' || x.n`, 100)} < 45 THEN
                         CASE WHEN x.rating >= 4 THEN (${sqlArray(GOOD)})[1 + ${pick(`'cg' || x.n`, GOOD.length)}] ELSE (${sqlArray(BAD)})[1 + ${pick(`'cb' || x.n`, BAD.length)}] END END,
                    x.verified_at
             FROM (
                 SELECT c.n, c.complaint_id, c.student_id, (c.status = 'COMPLETED') AS ok,
                        GREATEST(1, LEAST(5, ROUND(
                            CASE WHEN ${pick(`a.staff_user_id`, 25)} = 0 THEN 2.3 ELSE 3.4 + ${pick(`a.staff_user_id`, 16)} / 10.0 END
                            + (${pick(`'nz' || c.n`, 21)} - 10) / 10.0 - CASE WHEN c.status = 'ESCALATED' THEN 2 ELSE 0 END)))::int AS rating,
                        a.work_completed_at + INTERVAL '30 minutes' AS verified_at
                 FROM gen_c c JOIN complaint_assignments a ON a.complaint_id = c.complaint_id
                 WHERE c.status IN ('COMPLETED', 'ESCALATED')
             ) x`
        );

        // A short timeline per ticket.
        await q(
            `INSERT INTO complaint_logs (complaint_id, changed_by_user_id, previous_status, new_status, action_note, timestamp)
             SELECT c.complaint_id, c.student_id, NULL, 'OPEN', 'Ticket raised', c.created_at FROM gen_c c WHERE NOT (c.is_area AND c.area_id IS NULL)
             UNION ALL
             SELECT c.complaint_id, NULL, 'OPEN', c.status, 'Generated history', c.created_at + INTERVAL '10 minutes' FROM gen_c c
             WHERE c.status <> 'OPEN' AND NOT (c.is_area AND c.area_id IS NULL)`
        );

        await q('COMMIT');
        await q('ANALYZE');
        const totals = (await q(`SELECT (SELECT COUNT(*) FROM hostel_blocks)::int AS blocks, (SELECT COUNT(*) FROM rooms)::int AS rooms, (SELECT COUNT(*) FROM users WHERE role = 'STUDENT')::int AS students,
                                        (SELECT COUNT(*) FROM users WHERE role = 'STAFF')::int AS staff, (SELECT COUNT(*) FROM complaints)::int AS tickets,
                                        (SELECT COUNT(*) FROM complaint_feedback)::int AS reviews`)).rows[0];
        log(`generated in ${((Date.now() - t0) / 1000).toFixed(1)}s: ${JSON.stringify(totals)}`);
        return totals;
    } catch (err) {
        await q('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        await client.end();
    }
}

module.exports = { generate };

if (require.main === module) {
    if (!process.argv.includes('--yes')) {
        console.error('This adds a campus-sized dummy dataset (about 11,000 students and their tickets) to the configured database.\nRe-run with --yes to confirm. Add --reset to rebuild a previous run.');
        process.exit(1);
    }
    generate({ days: arg('days', 90), perStudent: arg('tickets-per-student', 0.75), reset: process.argv.includes('--reset') }).catch((err) => {
        console.error(err.message);
        process.exit(1);
    });
}
