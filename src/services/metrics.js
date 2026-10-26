const db = require('../config/db');
const cache = require('./cache');

// Operational metrics in the Prometheus text format, served at GET /api/metrics
// for whatever the deployment scrapes with (Prometheus, Grafana Agent, a cloud
// monitor). Request counts and latencies are kept in memory per process; the
// rest is read when scraped. Labels are route PATTERNS (/api/complaints/:id),
// never raw URLs, so a scraper cannot be flooded with distinct series and no
// identifier ever appears in a metric.

const BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
const requests = new Map(); // "method|route|status" -> count
const latency = new Map(); // route -> { buckets: number[], sum, count }
const errors = { server: 0 };
const startedAt = Date.now();

/** Express middleware: records every finished request. */
function middleware(req, res, next) {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
        const seconds = Number(process.hrtime.bigint() - start) / 1e9;
        const route = req.route ? `${req.baseUrl}${req.route.path === '/' ? '' : req.route.path}` : 'unmatched';
        const key = `${req.method}|${route}|${res.statusCode}`;
        requests.set(key, (requests.get(key) || 0) + 1);
        if (res.statusCode >= 500) errors.server += 1;
        let h = latency.get(route);
        if (!h) latency.set(route, (h = { buckets: new Array(BUCKETS.length).fill(0), sum: 0, count: 0 }));
        h.sum += seconds;
        h.count += 1;
        for (let i = 0; i < BUCKETS.length; i += 1) if (seconds <= BUCKETS[i]) h.buckets[i] += 1;
    });
    next();
}

const esc = (v) => String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
const labels = (o) => `{${Object.entries(o).map(([k, v]) => `${k}="${esc(v)}"`).join(',')}}`;

async function render() {
    const out = [];
    const metric = (name, help, type, lines) => {
        out.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`, ...lines);
    };

    metric('fixmaster_http_requests_total', 'Requests handled, by method, route pattern and status.', 'counter',
        [...requests].map(([k, n]) => {
            const [method, route, status] = k.split('|');
            return `fixmaster_http_requests_total${labels({ method, route, status })} ${n}`;
        }));
    metric('fixmaster_http_server_errors_total', 'Responses with a 5xx status.', 'counter', [`fixmaster_http_server_errors_total ${errors.server}`]);

    const hist = [];
    for (const [route, h] of latency) {
        BUCKETS.forEach((le, i) => hist.push(`fixmaster_http_request_duration_seconds_bucket${labels({ route, le })} ${h.buckets[i]}`));
        hist.push(`fixmaster_http_request_duration_seconds_bucket${labels({ route, le: '+Inf' })} ${h.count}`);
        hist.push(`fixmaster_http_request_duration_seconds_sum${labels({ route })} ${h.sum.toFixed(6)}`);
        hist.push(`fixmaster_http_request_duration_seconds_count${labels({ route })} ${h.count}`);
    }
    metric('fixmaster_http_request_duration_seconds', 'Request latency by route pattern.', 'histogram', hist);

    const mem = process.memoryUsage();
    metric('fixmaster_process_uptime_seconds', 'Seconds since the process started.', 'gauge', [`fixmaster_process_uptime_seconds ${Math.round((Date.now() - startedAt) / 1000)}`]);
    metric('fixmaster_process_memory_bytes', 'Process memory.', 'gauge', [
        `fixmaster_process_memory_bytes${labels({ kind: 'rss' })} ${mem.rss}`,
        `fixmaster_process_memory_bytes${labels({ kind: 'heap_used' })} ${mem.heapUsed}`,
    ]);

    const pool = db.pool;
    metric('fixmaster_db_pool_connections', 'Database pool connections by state.', 'gauge', [
        `fixmaster_db_pool_connections${labels({ state: 'total' })} ${pool.totalCount}`,
        `fixmaster_db_pool_connections${labels({ state: 'idle' })} ${pool.idleCount}`,
        `fixmaster_db_pool_connections${labels({ state: 'waiting' })} ${pool.waitingCount}`,
    ]);

    const c = cache.stats();
    metric('fixmaster_dashboard_cache_total', 'Dashboard cache lookups by result.', 'counter', [
        `fixmaster_dashboard_cache_total${labels({ result: 'hit' })} ${c.hits}`,
        `fixmaster_dashboard_cache_total${labels({ result: 'miss' })} ${c.misses}`,
        `fixmaster_dashboard_cache_total${labels({ result: 'shared' })} ${c.shared}`,
    ]);

    // Read from the database when scraped, so every server reports the same shared figures.
    let up = 1;
    const dbLines = [];
    const aiLines = [];
    try {
        await db.query('SELECT 1');
        const ai = await db.query(
            `SELECT task, provider, outcome, COUNT(*)::int AS n FROM ai_calls WHERE created_at >= NOW() - INTERVAL '1 hour' AND outcome <> 'SKIPPED' GROUP BY 1, 2, 3`
        );
        for (const r of ai.rows) aiLines.push(`fixmaster_ai_calls_hour${labels({ task: r.task, provider: r.provider, outcome: r.outcome })} ${r.n}`);
        const total = ai.rows.reduce((s, r) => s + r.n, 0);
        const ok = ai.rows.filter((r) => r.outcome === 'OK').reduce((s, r) => s + r.n, 0);
        aiLines.push(`fixmaster_ai_success_ratio_hour ${total ? (ok / total).toFixed(4) : 1}`);
        const queue = await db.query(`SELECT COUNT(*) FILTER (WHERE status IN ('OPEN','ASSIGNED','IN_PROGRESS','PENDING_VERIFICATION','ESCALATED'))::int AS open FROM complaints`);
        dbLines.push(`fixmaster_open_tickets ${queue.rows[0].open}`);
    } catch {
        up = 0;
    }
    metric('fixmaster_db_up', '1 when the database answers.', 'gauge', [`fixmaster_db_up ${up}`]);
    if (aiLines.length) {
        metric('fixmaster_ai_calls_hour', 'Model calls in the last hour by task, provider and outcome (shared by every server).', 'gauge', aiLines.filter((l) => l.startsWith('fixmaster_ai_calls_hour')));
        metric('fixmaster_ai_success_ratio_hour', 'Share of model calls in the last hour that returned valid output; alert when it falls.', 'gauge', aiLines.filter((l) => l.startsWith('fixmaster_ai_success_ratio_hour')));
    }
    if (dbLines.length) metric('fixmaster_open_tickets', 'Tickets that are not finished.', 'gauge', dbLines);

    return `${out.join('\n')}\n`;
}

function reset() {
    requests.clear();
    latency.clear();
    errors.server = 0;
}

module.exports = { middleware, render, reset };
