#!/usr/bin/env node
/**
 * A small load test for the API: no dependencies, no browser, CPU only.
 *
 *   npm run load:test -- --base http://127.0.0.1:5000/api --duration 20 --concurrency 20
 *
 * Signs in once as a chief warden and once as a student (the accounts that
 * `npm run db:scale` creates, with the shared demo password), then keeps
 * `--concurrency` requests in flight for `--duration` seconds, mixing the
 * calls people make most: the manager dashboards and insights, the ticket
 * list, and a student's own tickets. Prints throughput, the latency
 * percentiles per endpoint and the status codes seen, and exits 1 when the
 * error rate or the 95th percentile is over budget (--max-error-pct,
 * --max-p95-ms), so it can sit in a pipeline.
 *
 * The API's rate limits apply. To measure the server rather than the limiter,
 * start it with RATE_LIMIT_MAX and RATE_LIMIT_ANON_MAX raised (a 429 is
 * reported separately and counted as an error).
 *
 * Point it at a development or staging server, never at production.
 */
const arg = (name, fallback) => {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const BASE = arg('base', 'http://127.0.0.1:5000/api').replace(/\/$/, '');
const DURATION_S = Number(arg('duration', 20));
const CONCURRENCY = Number(arg('concurrency', 20));
const MAX_ERROR_PCT = Number(arg('max-error-pct', 1));
const MAX_P95_MS = Number(arg('max-p95-ms', 300)); // the target in docs/ROADMAP.md
const PASSWORD = arg('password', 'Password@123');
const MANAGER = arg('manager', 'GENCW01');
const STUDENT = arg('student', '23BCE00001');

async function login(id, portal) {
    const res = await fetch(`${BASE}/auth/${portal}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reg_or_emp_id: id, password: PASSWORD }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status !== 200 || !data.token) throw new Error(`sign-in as ${id} failed (${res.status}). Run "npm run db:scale -- --yes" first, or pass --manager/--student.`);
    return data.token;
}

// [weight, name, who, path]
const MIX = [
    [20, 'manager: ticket list', 'm', '/complaints?limit=50'],
    [15, 'manager: block KPIs', 'm', '/analytics/kpi'],
    [10, 'manager: overview', 'm', '/insights/overview'],
    [10, 'manager: at-risk tickets', 'm', '/insights/breach-risk'],
    [5, 'manager: repeat faults', 'm', '/insights/recurring'],
    [5, 'manager: briefing', 'm', '/insights/briefing'],
    [5, 'manager: staff performance', 'm', '/autopilot/performance'],
    [25, 'student: my tickets', 's', '/complaints'],
    [5, 'student: profile', 's', '/me'],
];
const TOTAL_WEIGHT = MIX.reduce((s, m) => s + m[0], 0);
const choose = () => {
    let r = Math.random() * TOTAL_WEIGHT;
    for (const m of MIX) if ((r -= m[0]) < 0) return m;
    return MIX[0];
};

const percentile = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : 0);

async function main() {
    const tokens = { m: await login(MANAGER, 'staff'), s: await login(STUDENT, 'student') };
    const stats = new Map(MIX.map((m) => [m[1], { ms: [], codes: {} }]));
    const deadline = Date.now() + DURATION_S * 1000;
    let sent = 0;

    async function worker() {
        while (Date.now() < deadline) {
            const [, name, who, path] = choose();
            const started = performance.now();
            let code;
            try {
                const res = await fetch(BASE + path, { headers: { Authorization: `Bearer ${tokens[who]}` } });
                await res.arrayBuffer();
                code = res.status;
            } catch {
                code = 'network';
            }
            const s = stats.get(name);
            s.ms.push(performance.now() - started);
            s.codes[code] = (s.codes[code] || 0) + 1;
            sent += 1;
        }
    }

    const t0 = Date.now();
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    const elapsed = (Date.now() - t0) / 1000;

    const all = [];
    let errors = 0;
    console.log(`\n${sent} requests in ${elapsed.toFixed(1)}s (${(sent / elapsed).toFixed(0)} req/s), concurrency ${CONCURRENCY}\n`);
    console.log('endpoint'.padEnd(30), 'n'.padStart(6), 'p50'.padStart(7), 'p95'.padStart(7), 'p99'.padStart(7), ' status codes');
    for (const [name, s] of stats) {
        if (!s.ms.length) continue;
        const sorted = [...s.ms].sort((a, b) => a - b);
        all.push(...s.ms);
        for (const [code, n] of Object.entries(s.codes)) if (!/^2/.test(code)) errors += n;
        console.log(name.padEnd(30), String(sorted.length).padStart(6), percentile(sorted, 50).toFixed(0).padStart(7), percentile(sorted, 95).toFixed(0).padStart(7), percentile(sorted, 99).toFixed(0).padStart(7), ' ', JSON.stringify(s.codes));
    }
    all.sort((a, b) => a - b);
    const p95 = percentile(all, 95);
    const errorPct = sent ? (100 * errors) / sent : 0;
    console.log(`\nall: p50 ${percentile(all, 50).toFixed(0)} ms, p95 ${p95.toFixed(0)} ms, p99 ${percentile(all, 99).toFixed(0)} ms, errors ${errorPct.toFixed(2)}%`);

    const failed = [];
    if (errorPct > MAX_ERROR_PCT) failed.push(`error rate ${errorPct.toFixed(2)}% is over ${MAX_ERROR_PCT}%`);
    if (p95 > MAX_P95_MS) failed.push(`p95 ${p95.toFixed(0)} ms is over ${MAX_P95_MS} ms`);
    if (failed.length) {
        console.error(`\nFAILED: ${failed.join('; ')}`);
        process.exit(1);
    }
    console.log('\nPASSED');
}

main().catch((err) => {
    console.error(err.message);
    process.exit(1);
});
