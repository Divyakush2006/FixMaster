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

const TEST_DB_URL =
    process.env.TEST_DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/fix_master_test';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = TEST_DB_URL;
process.env.JWT_SECRET = 'test-only-secret-0123456789abcdef0123456789abcdef';
// Rate limits are effectively off for the suite (it logs in many times from
// one IP); the limiter itself is exercised by its library's own tests.
process.env.RATE_LIMIT_AUTH_MAX = '1000000';
process.env.RATE_LIMIT_ADMIN_AUTH_MAX = '1000000';
process.env.RATE_LIMIT_REGISTER_MAX = '1000000';
process.env.RATE_LIMIT_MAX = '1000000';
process.env.RATE_LIMIT_ANON_MAX = '1000000';
process.env.RATE_LIMIT_AUTH_IP_MAX = '1000000';
process.env.RATE_LIMIT_ADMIN_AUTH_IP_MAX = '1000000';

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

/** Starts the app on an ephemeral port. Returns { api, login, sql, close }. */
async function startApp() {
    const app = require('../src/app');
    const db = require('../src/config/db');
    const { portalForRole } = require('../src/config/portals');
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

    async function close() {
        await new Promise((resolve) => server.close(resolve));
        await db.pool.end();
    }

    return { api, login, sql, close, clearTokens: () => tokenCache.clear() };
}

/** Seed fixtures used across tests. */
const SEED = {
    student: '21BCE0843', // Vihaan, allotted L-843
    student2: '21BCE1042', // Rahul, allotted L-810
    supervisor: 'SUP_LBLOCK_01',
    admin: 'ADMIN_ESTATES_01',
    electrician: 'EMP_ELEC_01',
    cleaner1: 'EMP_CLN_01',
    cleaner2: 'EMP_CLN_02',
    plumber: 'EMP_PLB_01',
    // subcategory ids from seed_data.sql
    sub: { roomCleaning: 1, dusting: 2, trash: 3, tubeLight: 4, socket: 5, switchBoard: 6, fan: 7, mcb: 8, tap: 17, coolerTemp: 21 },
};

module.exports = { TEST_DB_URL, SEED_PASSWORD, SEED, resetDatabase, startApp, ensureTestDatabase };
