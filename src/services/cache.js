// A small in-process cache for dashboard figures that many managers open all
// day and that change slowly: block KPIs, the campus overview, the performance
// board. Each distinct question is computed once per window, and requests that
// arrive while it is being computed share that one computation, so a rush of
// supervisors refreshing their dashboards costs the database one query, not
// one each.
//
// Figures can be up to DASHBOARD_CACHE_MS (default 15 s) old. Nothing a person
// acts on is cached this way (ticket lists, assignments, anything a student
// sees). Each API server keeps its own cache, so no shared store is needed.
// Off under test, so tests see their own writes at once.

const MAX_ENTRIES = 500;
const entries = new Map(); // key -> { at, value }
const inflight = new Map(); // key -> Promise
const counters = { hits: 0, misses: 0, shared: 0 };

const ttlMs = () => {
    const configured = process.env.DASHBOARD_CACHE_MS;
    if (configured !== undefined && configured !== '') return Math.max(0, Number.parseInt(configured, 10) || 0);
    return process.env.NODE_ENV === 'test' ? 0 : 15000;
};

/** The cached value for `key`, or the result of `compute()` (once, however many callers ask at the same time). */
async function memo(key, compute) {
    const ttl = ttlMs();
    if (ttl === 0) return compute();

    const hit = entries.get(key);
    if (hit && Date.now() - hit.at < ttl) {
        counters.hits += 1;
        return hit.value;
    }
    if (inflight.has(key)) {
        counters.shared += 1;
        return inflight.get(key);
    }
    counters.misses += 1;
    const pending = (async () => {
        try {
            const value = await compute();
            if (entries.size >= MAX_ENTRIES) entries.delete(entries.keys().next().value);
            entries.set(key, { at: Date.now(), value });
            return value;
        } finally {
            inflight.delete(key);
        }
    })();
    inflight.set(key, pending);
    return pending;
}

/** Forget everything whose key starts with `prefix` (or everything). */
function invalidate(prefix = '') {
    for (const key of [...entries.keys()]) if (key.startsWith(prefix)) entries.delete(key);
}

const stats = () => ({ ...counters, entries: entries.size, ttl_ms: ttlMs() });

/** A stable key part for a block scope (null = campus). */
const scopeKey = (scope) => (scope === null ? '*' : [...scope].sort().join(','));

module.exports = { memo, invalidate, stats, scopeKey };
