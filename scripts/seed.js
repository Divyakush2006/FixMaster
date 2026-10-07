#!/usr/bin/env node
/**
 * Loads the VIT L-Block demo dataset (database/seed_data.sql).
 *
 *   npm run db:seed
 *
 * Demo data only: every seed account shares the password Password@123, so
 * this refuses to run when NODE_ENV=production.
 *
 * Runs once per database. The seed is not safe to apply twice - its
 * assignment and audit-log rows have no natural key, so a second run would
 * duplicate them - so it is skipped whenever any user already exists.
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
require('dotenv').config({ quiet: true });
const { connectionConfig } = require('../src/config/dbConfig');

const SEED_FILE = path.join(__dirname, '..', 'database', 'seed_data.sql');

async function seed({ connectionString, log = console.log } = {}) {
    if (process.env.NODE_ENV === 'production') {
        throw new Error('Refusing to load demo seed data with NODE_ENV=production (shared demo passwords).');
    }
    const client = new Client(connectionConfig(connectionString));
    await client.connect();
    try {
        const { rows } = await client.query('SELECT COUNT(*)::int AS n FROM users');
        if (rows[0].n > 0) {
            log(`users table already has ${rows[0].n} row(s); skipping seed.`);
            return false;
        }
        await client.query('BEGIN');
        await client.query(fs.readFileSync(SEED_FILE, 'utf8'));
        await client.query('COMMIT');
        log('demo dataset loaded.');
        return true;
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        await client.end();
    }
}

module.exports = { seed };

if (require.main === module) {
    seed().catch((err) => {
        console.error(err.message);
        process.exit(1);
    });
}
