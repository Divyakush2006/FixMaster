#!/usr/bin/env node
/**
 * Creates the accounts of a deployment, each with its own random password, and
 * writes them to a credentials file.
 *
 *   node scripts/provision-accounts.js --yes                       a full sample roster (see below)
 *   node scripts/provision-accounts.js --yes --admin-only           just the first administrator(s): what a real
 *                                                                   deployment starts with
 *
 * Options
 *   --yes                  required: this writes to the database in DATABASE_URL
 *   --out <file>           credentials file (default credentials/fixmaster-credentials-<time>.txt, git-ignored)
 *   --admins <n>           administrators (default 2; 1 with --admin-only)
 *   --students <n>         residents, half men and half women (default 200; 0 for none)
 *   --no-campus            do not add rooms and shared areas to the blocks (default: add a sample set)
 *   --require-change       every account must choose its own password at first sign-in
 *                          (default when NODE_ENV=production; the file then says so)
 *   --rotate               give accounts of this roster that already exist a new password too
 *   --email-domain <d>     placeholder email domain (default fixmaster.example: a reserved name that
 *                          can never be somebody's mailbox). Replace the addresses before relying on email.
 *   --admin-email <addr>   a real address for ADMIN_01, so "Forgot password" reaches them (others keep placeholders)
 *   --from-file <file>     use the passwords already written in an earlier credentials file for the accounts it lists
 *                          (the same roster in another database, e.g. to give a deployed site the accounts a staging
 *                          file promised). Accounts that already exist are left alone. Keeps accounts usable as
 *                          written: no forced password change unless --require-change is also given.
 *   --web-url <url>        shown in the credentials file
 *
 * The roster is fixed by the code, so running it again creates only what is missing.
 * Passwords are 14 random characters (letters, digits, symbols), shown only in the file.
 * Only bcrypt hashes are stored.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Client } = require('pg');
require('dotenv').config({ quiet: true });
const { connectionConfig } = require('../src/config/dbConfig');
const { hashPassword } = require('../src/services/userService');
const { PRIVACY_NOTICE_VERSION } = require('../src/config/identity');

const flag = (name) => process.argv.includes(`--${name}`);
const arg = (name, fallback) => {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback;
};

// ---- the campus: the same layout the migrations create -------------------------------------------------------
const MENS_LETTERS = 'ABCDEFGHIJKLMNOPQRT'.split('');
const LADIES_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J', 'S'];
const MENS_BLOCKS = MENS_LETTERS.map((l) => `${l}_BLOCK`);
const LADIES_BLOCKS = LADIES_LETTERS.map((l) => `L${l}_BLOCK`);
const SAMPLE_FLOORS = [0, 1, 2, 3, 4, 5]; // ground and five floors
const SAMPLE_ROOMS_PER_FLOOR = 10;

// Which supervisor runs which blocks. Men's: eight supervisors, the first also runs MH; ladies': four.
const chunk = (list, sizes) => {
    const out = [];
    let at = 0;
    for (const n of sizes) {
        out.push(list.slice(at, at + n));
        at += n;
    }
    return out;
};
const MENS_GROUPS = chunk(MENS_BLOCKS, [3, 2, 2, 3, 2, 2, 2, 3]); // A B C | D E | F G | H I J | K L | M N | O P | Q R T
const LADIES_GROUPS = chunk(LADIES_BLOCKS, [3, 2, 2, 3]);
MENS_GROUPS[0].push('MH_BLOCK');

const TRADES = [
    ['CLEANING', 'CLN', 'Housekeeping'],
    ['ELECTRICIAN', 'ELEC', 'Electrician'],
    ['PLUMBER', 'PLB', 'Plumber'],
    ['AC_TECH', 'AC', 'AC technician'],
    ['CARPENTER', 'CARP', 'Carpenter'],
];

const MALE_FIRST = ['Aarav', 'Vihaan', 'Aditya', 'Arjun', 'Rohan', 'Karan', 'Ishaan', 'Rahul', 'Siddharth', 'Kabir', 'Harsh', 'Vikram', 'Manish', 'Nikhil', 'Pranav', 'Dev', 'Yash', 'Rishi', 'Tejas', 'Kunal'];
const FEMALE_FIRST = ['Ananya', 'Diya', 'Priya', 'Sneha', 'Kavya', 'Meera', 'Isha', 'Riya', 'Nandini', 'Pooja', 'Neha', 'Tanvi', 'Aditi', 'Shruti', 'Lakshmi', 'Divya', 'Swati', 'Anika', 'Mansi', 'Trisha'];
const LAST = ['Sharma', 'Iyer', 'Reddy', 'Nair', 'Gupta', 'Patel', 'Singh', 'Menon', 'Rao', 'Das', 'Kumar', 'Joshi', 'Pillai', 'Verma', 'Bose', 'Chopra', 'Naidu', 'Shetty', 'Mishra', 'Kulkarni', 'Banerjee', 'Desai', 'Hegde', 'Kapoor', 'Mukherjee', 'Subramanian', 'Thakur', 'Varma', 'Yadav', 'Zachariah'];
const BRANCHES = ['BCE', 'BCI', 'BEC', 'BME', 'BIT', 'BCB'];
const SCHOOLS = ['SCOPE', 'SENSE', 'SELECT', 'SMEC', 'VITBS'];
const PROGRAMMES = ['B.Tech Computer Science and Engineering', 'B.Tech Electronics and Communication', 'B.Tech Mechanical Engineering', 'B.Tech Information Technology', 'B.Tech Civil Engineering'];
const CITIES = [['Chennai', 'Tamil Nadu', '600001'], ['Bengaluru', 'Karnataka', '560001'], ['Hyderabad', 'Telangana', '500001'], ['Kochi', 'Kerala', '682001'], ['Pune', 'Maharashtra', '411001'], ['Delhi', 'Delhi', '110001']];

// ---- passwords ----------------------------------------------------------------------------------------------
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const LOWER = 'abcdefghijkmnopqrstuvwxyz';
const DIGIT = '23456789';
const SYMBOL = '@#$%&*+=?';
const pickFrom = (set) => set[crypto.randomInt(set.length)];

/** 14 characters with at least two of each kind, nothing easily confused (no 0/O, 1/l/I). */
function newPassword() {
    const chars = [pickFrom(UPPER), pickFrom(UPPER), pickFrom(LOWER), pickFrom(LOWER), pickFrom(DIGIT), pickFrom(DIGIT), pickFrom(SYMBOL), pickFrom(SYMBOL)];
    const all = UPPER + LOWER + DIGIT + SYMBOL;
    while (chars.length < 14) chars.push(pickFrom(all));
    for (let i = chars.length - 1; i > 0; i--) {
        const j = crypto.randomInt(i + 1);
        [chars[i], chars[j]] = [chars[j], chars[i]];
    }
    return chars.join('');
}

// ---- the roster ------------------------------------------------------------------------------------------------
const two = (n) => String(n).padStart(2, '0');

function buildRoster({ admins, students }) {
    const people = [];
    let phone = 9000100000;
    const add = (p) => people.push({ phone: String(phone++), ...p });

    for (let i = 1; i <= admins; i++) add({ id: `ADMIN_${two(i)}`, name: i === 1 ? 'Estates Administrator' : `Estates Administrator ${i}`, role: 'ADMIN', group: 'ADMINISTRATORS', portal: '/admin' });
    return { people, add, phone: () => phone };
}

function fullRoster({ admins, students }) {
    const { people, add } = buildRoster({ admins, students });
    add({ id: 'CW_MENS_01', name: 'Chief Warden (Men)', role: 'CHIEF_WARDEN', hostel: 'MENS', group: 'CHIEF WARDENS', portal: '/login → Staff' });
    add({ id: 'CW_LADIES_01', name: 'Chief Warden (Ladies)', role: 'CHIEF_WARDEN', hostel: 'LADIES', group: 'CHIEF WARDENS', portal: '/login → Staff' });

    const groups = [
        ...MENS_GROUPS.map((blocks, i) => ({ id: `SUP_M${two(i + 1)}`, hostel: 'MENS', blocks, label: `Men's supervisor` })),
        ...LADIES_GROUPS.map((blocks, i) => ({ id: `SUP_L${two(i + 1)}`, hostel: 'LADIES', blocks, label: `Ladies' supervisor` })),
    ];
    groups.forEach((g, i) => add({ id: g.id, name: `${g.label} ${i < MENS_GROUPS.length ? i + 1 : i + 1 - MENS_GROUPS.length}`, role: 'SUPERVISOR', hostel: g.hostel, blocks: g.blocks, group: 'SUPERVISORS', portal: '/login → Staff' }));

    // Technicians: each group of blocks gets one of every trade (two housekeepers: morning and evening),
    // based in the group's first block; plus two of every trade for the whole campus.
    let tech = 0;
    for (const [trade, tag, label] of TRADES) {
        let n = 0;
        const make = (home, shift) => {
            n += 1;
            tech += 1;
            add({ id: `TECH_${tag}_${two(n)}`, name: `${label} ${n}`, role: 'STAFF', specialization: trade, home, shift, group: 'TECHNICIANS', portal: '/login → Staff' });
        };
        for (const g of groups) {
            make(g.blocks[0], trade === 'CLEANING' ? 'MORNING' : null);
            if (trade === 'CLEANING') make(g.blocks[0], 'EVENING');
        }
        make(null, null);
        make(null, null);
    }

    const men = Math.ceil(students / 2);
    const women = students - men;
    let seq = 0;
    const makeStudent = (k, gender) => {
        seq += 1;
        const first = (gender === 'MALE' ? MALE_FIRST : FEMALE_FIRST)[k % MALE_FIRST.length];
        const last = LAST[(k * 7 + Math.floor(k / MALE_FIRST.length) * 3) % LAST.length];
        const year = 22 + (k % 4);
        add({ id: `${year}${BRANCHES[k % BRANCHES.length]}${String(1000 + seq).padStart(4, '0')}`, name: `${first} ${last}`, role: 'STUDENT', gender, k, group: 'RESIDENTS', portal: '/login → Student' });
    };
    for (let k = 0; k < men; k++) makeStudent(k, 'MALE');
    for (let k = 0; k < women; k++) makeStudent(k, 'FEMALE');
    return people;
}

// ---- writing it -------------------------------------------------------------------------------------------------
/** id -> password for every line of a credentials file that looks like `ID   PASSWORD   NAME ...`. */
function passwordsFromFile(text) {
    const found = new Map();
    for (const line of String(text).split(/\r?\n/)) {
        const m = /^([A-Za-z0-9_]+)\s{2,}(\S+)\s{2,}/.exec(line);
        if (m && m[1] !== 'ID') found.set(m[1].toUpperCase(), m[2]);
    }
    return found;
}

async function provision({ connectionString, admins = 2, students = 200, campus = true, adminOnly = false, requireChange = false, rotate = false, emailDomain = 'fixmaster.example', adminEmail = null, givenPasswords = null, log = console.log } = {}) {
    const client = new Client(connectionConfig(connectionString));
    await client.connect();
    const q = (text, params) => client.query(text, params);
    const created = [];
    const existing = [];
    try {
        const catalogue = await q('SELECT COUNT(*)::int AS n FROM complaint_subcategories');
        if (catalogue.rows[0].n === 0) throw new Error('The database has no issue catalogue: run `npm run db:migrate` first.');

        const roster = adminOnly ? buildRoster({ admins, students: 0 }).people : fullRoster({ admins, students });
        const emailFor = (p) => `${p.id.toLowerCase().replace(/_/g, '.')}@${p.role === 'STUDENT' ? 'students.' : ''}${emailDomain}`;

        await q('BEGIN');
        if (campus && !adminOnly) await addSampleCampus(q, log);

        // Rooms for the residents, two to a room, spread over the blocks of their hostel.
        const rooms = new Map();
        for (const hostel of ['MENS', 'LADIES']) {
            const { rows } = await q(
                `SELECT r.room_id, r.block_id FROM rooms r JOIN hostel_blocks b ON b.block_id = r.block_id
                 WHERE b.hostel_type = $1 AND b.block_kind = 'RESIDENTIAL' AND r.is_active ORDER BY r.block_id, r.room_id`,
                [hostel]
            );
            const byBlock = new Map();
            for (const r of rows) byBlock.set(r.block_id, [...(byBlock.get(r.block_id) || []), r.room_id]);
            rooms.set(hostel, [...byBlock.values()]);
        }
        const used = new Map();

        // bcrypt is slow by design: hash for everyone who needs a password, several at a time.
        const known = new Map(
            (await q('SELECT UPPER(reg_or_emp_id) AS id, user_id FROM users WHERE UPPER(reg_or_emp_id) = ANY($1::text[])', [roster.map((p) => p.id.toUpperCase())])).rows.map((r) => [r.id, r.user_id])
        );
        const needs = roster.filter((p) => !known.has(p.id.toUpperCase()) || rotate);
        for (const p of needs) p.password = (givenPasswords && givenPasswords.get(p.id.toUpperCase())) || newPassword();
        for (let i = 0; i < needs.length; i += 8) await Promise.all(needs.slice(i, i + 8).map(async (p) => (p.hash = await hashPassword(p.password))));

        const insertedStudents = [];
        for (const p of roster) {
            p.email = adminEmail && p.id === 'ADMIN_01' ? adminEmail : emailFor(p);
            const knownId = known.get(p.id.toUpperCase());
            const must = requireChange;
            if (knownId) {
                if (rotate) {
                    await q('UPDATE users SET password_hash = $2, credentials_changed_at = NOW(), failed_login_count = 0, locked_until = NULL, must_change_password = $3 WHERE user_id = $1', [knownId, p.hash, must]);
                    created.push(p);
                } else existing.push(p);
                continue;
            }
            const { rows } = await q(
                `INSERT INTO users (reg_or_emp_id, full_name, email, phone_number, password_hash, role, specialization, account_status, email_verified_at,
                                    hostel_type, home_block_id, shift, must_change_password)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, 'ACTIVE', NOW(), $8, $9, $10, $11) RETURNING user_id`,
                [p.id, p.name, p.email, p.phone, p.hash, p.role, p.specialization || null, p.hostel || null, p.home || null, p.shift || null, must]
            );
            const userId = rows[0].user_id;
            if (p.role === 'SUPERVISOR') {
                await q('INSERT INTO supervisor_blocks (supervisor_user_id, block_id) SELECT $1, unnest($2::varchar[])', [userId, p.blocks]);
            }
            if (p.role === 'STUDENT') insertedStudents.push({ ...p, userId });
            created.push(p);
        }

        for (const s of insertedStudents) {
            const hostel = s.gender === 'MALE' ? 'MENS' : 'LADIES';
            const blocks = rooms.get(hostel);
            if (!blocks || blocks.length === 0) continue; // --no-campus: nobody to put them in
            const slot = used.get(hostel) || 0;
            used.set(hostel, slot + 1);
            const list = blocks[slot % blocks.length];
            const room = list[Math.floor(slot / blocks.length / 2) % list.length];
            await q(`INSERT INTO student_room_allotments (student_id, room_id, academic_year, is_current, assigned_date) VALUES ($1, $2, '2026-2027', TRUE, CURRENT_DATE)`, [s.userId, room]);
            const city = CITIES[s.k % CITIES.length];
            await q(
                `INSERT INTO student_profiles (user_id, school, programme, admission_year, expected_graduation_year, gender, date_of_birth,
                        guardian_name, guardian_relation, guardian_phone, permanent_city, permanent_state, permanent_pincode,
                        preferred_cleaning_slot, preferred_language, privacy_notice_version, privacy_consented_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'ANY', 'en', $14, NOW())`,
                [s.userId, SCHOOLS[s.k % SCHOOLS.length], PROGRAMMES[s.k % PROGRAMMES.length], 2000 + Number(s.id.slice(0, 2)), 2004 + Number(s.id.slice(0, 2)), s.gender,
                    `200${3 + (s.k % 3)}-0${1 + (s.k % 9)}-1${s.k % 9}`, `${s.name.split(' ')[1]} (guardian)`, s.k % 2 ? 'Father' : 'Mother', `98${String(20000000 + s.k * 7 + (s.gender === 'MALE' ? 0 : 5000)).slice(-8)}`,
                    city[0], city[1], city[2], PRIVACY_NOTICE_VERSION]
            );
        }
        await q('COMMIT');
        return { created, existing };
    } catch (err) {
        await q('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        await client.end();
    }
}

/** A sample set of rooms and shared areas, so the hostel is usable at once. A real hostel replaces it in Block settings. */
async function addSampleCampus(q, log) {
    const rooms = await q(
        `INSERT INTO rooms (room_id, block_id, room_number, floor_number, room_type, bed_capacity)
         SELECT split_part(b.block_id, '_', 1) || '-' || CASE WHEN f.floor_number = 0 THEN 'G' ELSE f.floor_number::text END || lpad(r::text, 2, '0'),
                b.block_id, CASE WHEN f.floor_number = 0 THEN 'G' ELSE f.floor_number::text END || lpad(r::text, 2, '0'), f.floor_number,
                CASE WHEN r % 4 = 0 THEN 'AC' ELSE 'NON_AC' END, 3
         FROM hostel_blocks b
         JOIN block_floors f ON f.block_id = b.block_id AND f.floor_number = ANY($1::int[])
         CROSS JOIN generate_series(1, $2::int) r
         WHERE b.block_id = ANY($3::varchar[]) AND b.block_kind = 'RESIDENTIAL'
         ON CONFLICT DO NOTHING`,
        [SAMPLE_FLOORS, SAMPLE_ROOMS_PER_FLOOR, [...MENS_BLOCKS, ...LADIES_BLOCKS]]
    );
    const areas = await q(
        `INSERT INTO common_areas (area_id, block_id, floor_number, area_type, description)
         SELECT split_part(b.block_id, '_', 1) || '-F' || lpad(f.floor_number::text, 2, '0') || '-' || a.tag || '-01',
                b.block_id, f.floor_number, a.area_type, CASE WHEN f.floor_number = 0 THEN 'Ground floor ' ELSE 'Floor ' || f.floor_number || ' ' END || a.label
         FROM hostel_blocks b
         JOIN block_floors f ON f.block_id = b.block_id AND f.floor_number = ANY($1::int[])
         CROSS JOIN (VALUES ('CORRIDOR', 'CORR', 'Corridor'), ('COMMON_WASHROOM', 'WASH', 'Common Washroom'), ('WATER_COOLER', 'COOLER', 'Water Cooler')) AS a(area_type, tag, label)
         WHERE b.block_id = ANY($2::varchar[]) AND b.block_kind = 'RESIDENTIAL' AND f.floor_number > 0
         ON CONFLICT DO NOTHING`,
        [SAMPLE_FLOORS, [...MENS_BLOCKS, ...LADIES_BLOCKS]]
    );
    const lifts = await q(
        `INSERT INTO common_areas (area_id, block_id, floor_number, area_type, description)
         SELECT split_part(block_id, '_', 1) || '-F00-LIFT-01', block_id, 0, 'ELEVATOR', 'Ground floor lift'
         FROM hostel_blocks WHERE block_id = ANY($1::varchar[]) AND block_kind = 'RESIDENTIAL' ON CONFLICT DO NOTHING`,
        [[...MENS_BLOCKS, ...LADIES_BLOCKS]]
    );
    log(`sample campus: ${rooms.rowCount} rooms, ${areas.rowCount + lifts.rowCount} shared areas added.`);
}

// ---- the file ---------------------------------------------------------------------------------------------------
function describe(p) {
    if (p.role === 'SUPERVISOR') return `${p.hostel === 'MENS' ? "Men's" : "Ladies'"} hostel · blocks ${p.blocks.map((b) => b.replace('_BLOCK', '')).join(', ')}`;
    if (p.role === 'CHIEF_WARDEN') return `${p.hostel === 'MENS' ? "Men's" : "Ladies'"} hostel · every block`;
    if (p.role === 'STAFF') return `${p.home ? `home ${p.home.replace('_BLOCK', '')}` : 'whole campus'}${p.shift ? ` · ${p.shift.toLowerCase()} shift` : ''}`;
    if (p.role === 'STUDENT') return p.gender === 'MALE' ? "Men's hostel" : "Ladies' hostel";
    return '';
}

function render({ created, existing, dbLabel, webUrl, requireChange, emailDomain }) {
    const lines = [];
    const stamp = new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: process.env.APP_TIMEZONE || 'Asia/Kolkata' });
    lines.push('FIXMASTER ACCOUNT CREDENTIALS', `Generated ${stamp} for ${dbLabel}`, '');
    lines.push('KEEP THIS FILE PRIVATE. It holds passwords in plain text; the database holds only hashes.', 'Share each person their own line only, then delete this file. It is git-ignored; never commit it.', '');
    lines.push(`Sign in:   students, supervisors, chief wardens and technicians   ${webUrl}/login   (Student or Staff tab)`);
    lines.push(`           administrators                                          ${webUrl}/admin`);
    lines.push(requireChange ? 'Every account must choose its own password the first time it signs in.' : 'These passwords stay valid until changed (My account > Change password).');
    lines.push(`Email addresses are placeholders @${emailDomain} (nobody's real mailbox); set real ones before using email features.`, '');

    const groups = [...new Set(created.map((p) => p.group))];
    for (const g of groups) {
        const rows = created.filter((p) => p.group === g);
        lines.push('='.repeat(100), `${g}  (${rows.length})`, '='.repeat(100));
        const idW = Math.max(...rows.map((r) => r.id.length), 2);
        const nameW = Math.max(...rows.map((r) => r.name.length), 4);
        lines.push(`${'ID'.padEnd(idW)}  ${'PASSWORD'.padEnd(14)}  ${'NAME'.padEnd(nameW)}  DETAILS`);
        for (const r of rows) lines.push(`${r.id.padEnd(idW)}  ${r.password.padEnd(14)}  ${r.name.padEnd(nameW)}  ${describe(r)}`);
        lines.push('');
    }
    if (existing.length > 0) {
        lines.push('-'.repeat(100), `ALREADY EXISTED, password unchanged and not shown (${existing.length}): ${existing.map((p) => p.id).join(', ')}`, 'Run again with --rotate to give them new passwords.', '');
    }
    lines.push(`Total: ${created.length} account(s) in this file.`, '');
    return lines.join('\r\n');
}

async function main() {
    if (!flag('yes')) {
        console.error(
            'This creates accounts in the database named by DATABASE_URL, each with a random password written to a file.\n' +
                'Re-run with --yes to confirm. --admin-only creates just the administrator(s); see the header of this script.'
        );
        process.exit(1);
    }
    const adminOnly = flag('admin-only');
    const url = process.env.DATABASE_URL || '';
    const dbLabel = (() => {
        try {
            const u = new URL(url);
            return `${decodeURIComponent(u.pathname.slice(1))} on ${u.hostname}`;
        } catch {
            return 'the configured database';
        }
    })();
    const fromFile = arg('from-file', null);
    const givenPasswords = fromFile ? passwordsFromFile(fs.readFileSync(path.resolve(fromFile), 'utf8')) : null;
    if (fromFile && givenPasswords.size === 0) throw new Error(`No accounts found in ${fromFile}.`);
    const requireChange = flag('require-change') || (process.env.NODE_ENV === 'production' && !fromFile);
    const emailDomain = arg('email-domain', 'fixmaster.example');
    const result = await provision({
        admins: Number(arg('admins', adminOnly ? 1 : 2)),
        students: adminOnly ? 0 : Number(arg('students', 200)),
        campus: !flag('no-campus'),
        adminOnly,
        requireChange,
        rotate: flag('rotate'),
        emailDomain,
        adminEmail: arg('admin-email', null),
        givenPasswords,
    });
    if (result.created.length === 0) {
        console.log(`Nothing to create: all ${result.existing.length} roster accounts already exist (use --rotate for new passwords).`);
        return;
    }
    const out = path.resolve(arg('out', path.join(__dirname, '..', 'credentials', `fixmaster-credentials-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.txt`)));
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, render({ ...result, dbLabel, webUrl: arg('web-url', 'http://localhost:3000'), requireChange, emailDomain }), { encoding: 'utf8', mode: 0o600 });
    console.log(`${result.created.length} account(s) created${result.existing.length ? `, ${result.existing.length} already existed` : ''} in ${dbLabel}.\nCredentials written to ${out}`);
}

if (require.main === module) {
    main().catch((err) => {
        console.error(err.message);
        process.exit(1);
    });
}

module.exports = { provision, newPassword, fullRoster, render, passwordsFromFile };
