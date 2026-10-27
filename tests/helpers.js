/**
 * Shared test harness.
 *
 * Tests run against a real PostgreSQL database (stored procedures, triggers
 * and constraints are a large part of what is being tested, so mocking the
 * database would test nothing). The database is rebuilt from the migrations
 * + seed before each test file.
 *
 * TEST_DATABASE_URL defaults to a local fix_master_test database. As a guard
 * against wiping real data, its name must contain "test".
 *
 * IMPORTANT: this module must be required before anything that loads
 * src/app.js or src/config/db.js, because it sets the environment they read
 * at load time.
 */
const { Client } = require('pg');
require('dotenv').config({ quiet: true });

/**
 * TEST_DATABASE_URL, or else the developer's own DATABASE_URL (from .env)
 * pointed at a fix_master_test database - so no credentials live in the repo.
 */
function testDatabaseUrl() {
    if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
    if (process.env.DATABASE_URL) {
        const url = new URL(process.env.DATABASE_URL);
        url.pathname = '/fix_master_test';
        return url.toString();
    }
    return 'postgresql://localhost:5432/fix_master_test';
}
const TEST_DB_URL = testDatabaseUrl();

process.env.NODE_ENV = 'test';
// Uploaded photos go to a throwaway folder, never the working tree.
process.env.UPLOAD_DIR = require('path').join(require('os').tmpdir(), `fixmaster-test-uploads-${process.pid}`);
process.env.DATABASE_URL = TEST_DB_URL;
process.env.JWT_SECRET = require('crypto').randomBytes(32).toString('hex'); // fresh for every run
// Rate limits are effectively off for the suite (it logs in many times from
// one IP); the limiter itself is exercised by its library's own tests.
process.env.RATE_LIMIT_AUTH_MAX = '1000000';
process.env.RATE_LIMIT_ADMIN_AUTH_MAX = '1000000';
process.env.RATE_LIMIT_REGISTER_MAX = '1000000';
process.env.RATE_LIMIT_MAX = '1000000';
process.env.RATE_LIMIT_ANON_MAX = '1000000';
process.env.RATE_LIMIT_AUTH_IP_MAX = '1000000';
process.env.RATE_LIMIT_ADMIN_AUTH_IP_MAX = '1000000';
process.env.RATE_LIMIT_FORGOT_IP_MAX = '1000000';
process.env.RATE_LIMIT_RESET_IP_MAX = '1000000';
process.env.RATE_LIMIT_VERIFY_IP_MAX = '1000000';
process.env.RATE_LIMIT_VERIFY_MAX = '1000000';
process.env.RATE_LIMIT_RESEND_IP_MAX = '1000000';
process.env.RATE_LIMIT_ASSISTANT_MAX = '1000000';
process.env.RATE_LIMIT_PRIVACY_MAX = '1000000';

const SEED_PASSWORD = 'Password@123';

function dbNameOf(url) {
    return decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
}

async function ensureTestDatabase() {
    const name = dbNameOf(TEST_DB_URL);
    if (!/test/i.test(name)) {
        throw new Error(`Refusing to run tests against "${name}": the test database name must contain "test".`);
    }
    const adminUrl = new URL(TEST_DB_URL);
    adminUrl.pathname = '/postgres';
    const client = new Client({ connectionString: adminUrl.toString() });
    await client.connect();
    try {
        const exists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
        if (exists.rows.length === 0) {
            await client.query(`CREATE DATABASE "${name.replace(/"/g, '""')}"`);
        }
    } finally {
        await client.end();
    }
}

/** Drops everything and rebuilds from migrations + demo seed. */
async function resetDatabase() {
    await ensureTestDatabase();
    const { resetDevDb } = require('../scripts/reset-dev-db');
    await resetDevDb({ connectionString: TEST_DB_URL, log: () => {} });
}

/** A complete, valid onboarding profile; override fields per test. */
function studentProfile(extra = {}) {
    return {
        school: 'SCOPE',
        programme: 'B.Tech Computer Science and Engineering',
        admission_year: new Date().getFullYear() - 1,
        expected_graduation_year: new Date().getFullYear() + 3,
        // The seed's blocks are the men's hostel (a resident lives in the hostel of their gender).
        gender: 'MALE',
        date_of_birth: '2006-04-12',
        guardian_name: 'R. Iyer',
        guardian_relation: 'Mother',
        guardian_phone: '9876500011',
        permanent_city: 'Coimbatore',
        permanent_state: 'Tamil Nadu',
        permanent_pincode: '641001',
        preferred_cleaning_slot: 'MORNING',
        preferred_language: 'en',
        privacy_consent: true,
        privacy_notice_version: require('../src/config/identity').PRIVACY_NOTICE_VERSION,
        ...extra,
    };
}

/** Starts the app on an ephemeral port. Returns { api, login, sql, close }. */
async function startApp() {
    const app = require('../src/app');
    const db = require('../src/config/db');
    const { portalForRole } = require('../src/config/portals');
    // Every email the API sends lands here instead of leaving the machine.
    const outbox = [];
    require('../src/services/mailer').setTransportForTests({ sendMail: async (msg) => outbox.push(msg) });
    const server = await new Promise((resolve) => {
        const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const base = `http://127.0.0.1:${server.address().port}/api`;

    async function api(path, { method = 'GET', token, body, raw, headers = {} } = {}) {
        const h = { 'Content-Type': 'application/json', ...headers };
        if (token) h.Authorization = `Bearer ${token}`;
        const res = await fetch(base + path, {
            method,
            headers: h,
            body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined,
        });
        const ct = res.headers.get('content-type') || '';
        const data = ct.includes('application/json') ? await res.json() : await res.text();
        return { status: res.status, data, headers: res.headers };
    }

    const tokenCache = new Map();
    async function login(id, password = SEED_PASSWORD, { fresh = false } = {}) {
        const key = `${id}\u0000${password}`;
        if (!fresh && tokenCache.has(key)) return tokenCache.get(key);
        // Sign in through the portal this account belongs to.
        const found = await db.query('SELECT role FROM users WHERE UPPER(reg_or_emp_id) = UPPER($1)', [id]);
        const portal = found.rows[0] ? portalForRole(found.rows[0].role) : 'student';
        const r = await api(`/auth/${portal}/login`, { method: 'POST', body: { reg_or_emp_id: id, password } });
        if (r.status !== 200) throw new Error(`login ${id} failed: ${r.status} ${JSON.stringify(r.data)}`);
        tokenCache.set(key, r.data.token);
        return r.data.token;
    }

    const sql = (text, params) => db.query(text, params);

    /** The newest verification code emailed to `email`. */
    function lastCodeFor(email) {
        const mail = [...outbox].reverse().find((m) => m.to.toLowerCase() === email.toLowerCase() && /verification code/.test(m.subject));
        if (!mail) throw new Error(`no verification email to ${email}`);
        return mail.text.match(/code is (\d{6})/)[1];
    }

    /**
     * Registers a student the way a person does: sign up, enter the emailed
     * code (which signs them in), then complete the profile. Stop early with
     * { verify: false } or { profile: false }. Returns the registration
     * response plus the session token once there is one.
     */
    async function registerStudent(body, { verify = true, profile = true } = {}) {
        const reg = await api('/auth/student/register', { method: 'POST', body });
        if (reg.status !== 201 || !verify) return reg;
        const v = await api('/auth/student/verify-email', {
            method: 'POST',
            body: { reg_or_emp_id: body.reg_or_emp_id, code: lastCodeFor(body.email) },
        });
        if (v.status !== 200) throw new Error(`verify ${body.reg_or_emp_id} failed: ${v.status} ${JSON.stringify(v.data)}`);
        reg.token = v.data.token;
        if (profile) {
            const p = await api('/me/profile', { method: 'PUT', token: reg.token, body: studentProfile() });
            if (p.status !== 201) throw new Error(`profile ${body.reg_or_emp_id} failed: ${p.status} ${JSON.stringify(p.data)}`);
        }
        return reg;
    }

    async function close() {
        require('../src/services/mailer').setTransportForTests(null);
        await new Promise((resolve) => server.close(resolve));
        await db.pool.end();
    }

    return { base, api, login, sql, close, outbox, lastCodeFor, registerStudent, clearTokens: () => tokenCache.clear() };
}

/** Seed fixtures used across tests. */
const SEED = {
    student: '21BCE0843', // Vihaan, allotted L-843
    student2: '21BCE1042', // Rahul, allotted L-810
    student3: '21BCE1523', // Aditya, allotted L-825
    student4: '22BCE0190', // Priya, allotted L-305
    roommate1: '22BCE1187', // Karan, shares L-843 with Vihaan
    roommate2: '23BCE0456', // Rohan, shares L-843 with Vihaan
    supervisor: 'SUP_LBLOCK_01',
    admin: 'ADMIN_ESTATES_01',
    electrician: 'EMP_ELEC_01',
    electrician2: 'EMP_ELEC_02',
    electrician3: 'EMP_ELEC_03',
    cleaner1: 'EMP_CLN_01',
    cleaner2: 'EMP_CLN_02',
    plumber: 'EMP_PLB_01',
    plumber2: 'EMP_PLB_02',
    // subcategory ids from seed_data.sql
    sub: { roomCleaning: 1, dusting: 2, trash: 3, tubeLight: 4, socket: 5, switchBoard: 6, fan: 7, mcb: 8, tap: 17, coolerTemp: 21, corridorLight: 25 },
};

module.exports = { TEST_DB_URL, SEED_PASSWORD, SEED, resetDatabase, startApp, ensureTestDatabase, studentProfile };
