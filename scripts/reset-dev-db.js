#!/usr/bin/env node
/**
 * DEVELOPMENT ONLY: wipes the database named in DATABASE_URL and rebuilds it
 * from migrations + demo seed.
 *
 *   npm run db:reset -- --yes
 *
 * Refuses to run with NODE_ENV=production, and refuses without --yes.
 */
const { Client } = require('pg');
require('dotenv').config({ quiet: true });
const { connectionConfig } = require('../src/config/dbConfig');
const { migrate } = require('./migrate');
const { seed } = require('./seed');

async function resetDevDb({ connectionString, log = console.log } = {}) {
    if (process.env.NODE_ENV === 'production') {
        throw new Error('Refusing to reset a database with NODE_ENV=production.');
    }
    const client = new Client(connectionConfig(connectionString));
    await client.connect();
    try {
        // Dropping the schema removes every table, view, function and
        // procedure in one step, including schema_migrations.
        await client.query('DROP SCHEMA public CASCADE');
        await client.query('CREATE SCHEMA public');
    } finally {
        await client.end();
    }
    await migrate({ connectionString, log });
    await seed({ connectionString, log });
}

module.exports = { resetDevDb };

if (require.main === module) {
    if (!process.argv.includes('--yes')) {
        console.error('This deletes ALL data in the configured database. Re-run with --yes to confirm.');
        process.exit(1);
    }
    resetDevDb().catch((err) => {
        console.error(err.message);
        process.exit(1);
    });
}
