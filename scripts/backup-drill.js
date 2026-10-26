#!/usr/bin/env node
/**
 * The backup-restore drill: proves a backup can actually be restored.
 *
 *   npm run db:drill                 uses DATABASE_URL
 *   npm run db:drill -- --source <connection string>
 *
 * Dumps the source database with pg_dump, restores the dump into a scratch
 * database (named "<source>_drill", created and dropped here), then compares
 * the two: the same tables, the same number of rows in each, the same content
 * checksum for every table of up to 200,000 rows, and the same migration
 * history. Prints a table and exits 1 on any difference. The source is only
 * ever read. Run it on a schedule (see .github/workflows/backup-drill.yml) and
 * after any change to how backups are taken.
 *
 * Needs pg_dump and pg_restore of at least the server's major version, found on
 * PATH, in PG_BIN, or in the usual PostgreSQL install folders.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Client } = require('pg');
require('dotenv').config({ quiet: true });

const SMALL_TABLE_ROWS = 200_000;
const exe = (name) => (process.platform === 'win32' ? `${name}.exe` : name);

function findPgBin() {
    const candidates = [process.env.PG_BIN];
    if (process.platform === 'win32') {
        const root = 'C:\\Program Files\\PostgreSQL';
        if (fs.existsSync(root)) {
            for (const v of fs.readdirSync(root).sort((a, b) => Number(b) - Number(a))) candidates.push(path.join(root, v, 'bin'));
        }
    }
    candidates.push(''); // PATH
    for (const dir of candidates) {
        if (dir === undefined) continue;
        const probe = spawnSync(path.join(dir, exe('pg_dump')), ['--version'], { encoding: 'utf8' });
        if (probe.status === 0) return { dir, version: probe.stdout.trim() };
    }
    return null;
}

const withDb = (url, name) => {
    const u = new URL(url);
    u.pathname = `/${name}`;
    return u.toString();
};
const dbNameOf = (url) => decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
const quoteIdent = (s) => `"${String(s).replace(/"/g, '""')}"`;

async function describeDb(url) {
    const client = new Client({ connectionString: url });
    await client.connect();
    try {
        const tables = (await client.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`)).rows.map((r) => r.table_name);
        const out = {};
        for (const t of tables) {
            const n = Number((await client.query(`SELECT COUNT(*) AS n FROM public.${quoteIdent(t)}`)).rows[0].n);
            let checksum = null;
            if (n <= SMALL_TABLE_ROWS) {
                checksum = (await client.query(`SELECT md5(COALESCE(string_agg(x::text, '' ORDER BY x::text), '')) AS h FROM public.${quoteIdent(t)} x`)).rows[0].h;
            }
            out[t] = { rows: n, checksum };
        }
        const migrations = tables.includes('schema_migrations') ? (await client.query(`SELECT COUNT(*)::int AS n FROM schema_migrations`)).rows[0].n : null;
        return { tables: out, migrations };
    } finally {
        await client.end();
    }
}

/** Runs the drill. Returns { ok, skipped?, reason?, rows, differences }. */
async function runDrill({ source = process.env.DATABASE_URL, log = console.log } = {}) {
    if (!source) throw new Error('No source database: pass --source or set DATABASE_URL.');
    const pg = findPgBin();
    if (!pg) return { ok: false, skipped: true, reason: 'pg_dump was not found (set PG_BIN to the folder that has it).', differences: [] };

    const sourceName = dbNameOf(source);
    const scratchName = `${sourceName}_drill`;
    const scratchUrl = withDb(source, scratchName);
    const adminUrl = withDb(source, 'postgres');
    const dump = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fixmaster-drill-')), 'drill.dump');
    const admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    try {
        log(`using ${pg.version}; dumping ${sourceName} ...`);
        const d = spawnSync(path.join(pg.dir, exe('pg_dump')), ['--format=custom', '--no-owner', '--no-privileges', `--dbname=${source}`, `--file=${dump}`], { encoding: 'utf8' });
        if (d.status !== 0) {
            const mismatch = /server version mismatch|aborting because of server version/i.test(d.stderr);
            return { ok: false, skipped: mismatch, reason: mismatch ? `The available pg_dump is older than the server: ${d.stderr.trim().split('\n')[0]}` : `pg_dump failed: ${d.stderr.trim()}`, differences: [] };
        }
        const size = fs.statSync(dump).size;
        log(`dump written (${(size / 1024 / 1024).toFixed(1)} MB); restoring into ${scratchName} ...`);

        await admin.query(`DROP DATABASE IF EXISTS ${quoteIdent(scratchName)}`);
        await admin.query(`CREATE DATABASE ${quoteIdent(scratchName)}`);
        const r = spawnSync(path.join(pg.dir, exe('pg_restore')), ['--no-owner', '--no-privileges', '--exit-on-error', `--dbname=${scratchUrl}`, dump], { encoding: 'utf8' });
        if (r.status !== 0) return { ok: false, reason: `pg_restore failed: ${r.stderr.trim()}`, differences: [] };

        log('comparing ...');
        const [a, b] = [await describeDb(source), await describeDb(scratchUrl)];
        const differences = [];
        const names = [...new Set([...Object.keys(a.tables), ...Object.keys(b.tables)])].sort();
        const rows = names.map((t) => {
            const x = a.tables[t];
            const y = b.tables[t];
            if (!x) differences.push(`${t}: only in the restored copy`);
            else if (!y) differences.push(`${t}: missing after restore`);
            else if (x.rows !== y.rows) differences.push(`${t}: ${x.rows} rows, ${y.rows} after restore`);
            else if (x.checksum !== y.checksum) differences.push(`${t}: same row count, different content`);
            return { table: t, rows: x ? x.rows : 0, restored: y ? y.rows : 0, checked: Boolean(x && x.checksum) };
        });
        if (a.migrations !== b.migrations) differences.push(`migration history: ${a.migrations} versions, ${b.migrations} after restore`);
        return { ok: differences.length === 0, rows, differences, bytes: size };
    } finally {
        await admin.query(`DROP DATABASE IF EXISTS ${quoteIdent(scratchName)}`).catch(() => {});
        await admin.end();
        fs.rmSync(path.dirname(dump), { recursive: true, force: true });
    }
}

module.exports = { runDrill };

if (require.main === module) {
    const i = process.argv.indexOf('--source');
    runDrill({ source: i >= 0 ? process.argv[i + 1] : undefined })
        .then((r) => {
            if (r.skipped) {
                console.error(`SKIPPED: ${r.reason}`);
                process.exit(2);
            }
            if (r.rows) {
                console.log('\ntable'.padEnd(32), 'rows'.padStart(9), 'restored'.padStart(9), ' content checked');
                for (const t of r.rows) console.log(t.table.padEnd(31), String(t.rows).padStart(9), String(t.restored).padStart(9), t.checked ? ' yes' : ' (rows only)');
            }
            if (!r.ok) {
                console.error(`\nDRILL FAILED:\n  ${r.reason || r.differences.join('\n  ')}`);
                process.exit(1);
            }
            console.log(`\nDRILL PASSED: ${r.rows.length} tables restored identically from a ${(r.bytes / 1024 / 1024).toFixed(1)} MB backup.`);
        })
        .catch((err) => {
            console.error(err.message);
            process.exit(1);
        });
}
