const crypto = require('crypto');
const { AsyncLocalStorage } = require('async_hooks');

/**
 * Distributed tracing, no SDK: W3C Trace Context in and out, spans exported as
 * OTLP/HTTP JSON to any OpenTelemetry-compatible collector (Grafana Tempo, Jaeger,
 * Honeycomb, Datadog, the OpenTelemetry Collector ...).
 *
 *   OTEL_EXPORTER_OTLP_ENDPOINT   collector base address, e.g. http://otel-collector:4318
 *                                 (spans go to <it>/v1/traces). Tracing is off, and costs
 *                                 nothing, until this is set. OTEL_EXPORTER_OTLP_TRACES_ENDPOINT
 *                                 gives the full address instead.
 *   OTEL_EXPORTER_OTLP_HEADERS    "key=value,key2=value2", e.g. an API key
 *   OTEL_SERVICE_NAME             default "fixmaster-api"
 *   OTEL_TRACES_SAMPLER_ARG       share of new traces recorded, 0..1 (default 1). A request that
 *                                 arrives with a traceparent follows the caller's decision.
 *
 * Every request gets a trace id whether or not spans are exported: it is returned as
 * X-Trace-Id, written to the request log and put in error alerts, so a report
 * "it failed around 3pm" can be followed from the alert to the exact request.
 *
 * What a span carries: the method, the route pattern (never the raw address, which holds
 * ticket ids), the status, durations, and for children the kind of work (database
 * operation, AI task and provider, object-storage verb). Never SQL text, parameters,
 * prompts, request or response bodies, or anyone's name. Exporting is fire-and-forget
 * with a bounded queue; a collector that is down costs nothing but the spans.
 */

const storage = new AsyncLocalStorage();
const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;
const MAX_QUEUE = 2048;
const BATCH = 256;

let queue = [];
let timer = null;
let lastWarning = 0;
const stats = { exported: 0, dropped: 0, failed: 0 };

const nowNs = () => BigInt(Date.now()) * 1000000n;
const hex = (bytes) => crypto.randomBytes(bytes).toString('hex');

function config() {
    const base = (process.env.OTEL_EXPORTER_OTLP_ENDPOINT || '').trim().replace(/\/+$/, '');
    const full = (process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT || '').trim();
    if (!base && !full) return null;
    const headers = {};
    for (const pair of (process.env.OTEL_EXPORTER_OTLP_HEADERS || '').split(',')) {
        const i = pair.indexOf('=');
        if (i > 0) headers[pair.slice(0, i).trim()] = decodeURIComponent(pair.slice(i + 1).trim());
    }
    const ratio = Number.parseFloat(process.env.OTEL_TRACES_SAMPLER_ARG);
    return {
        url: full || `${base}/v1/traces`,
        headers,
        service: process.env.OTEL_SERVICE_NAME || 'fixmaster-api',
        ratio: Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : 1,
        delayMs: Math.max(100, Number.parseInt(process.env.OTEL_BSP_SCHEDULE_DELAY, 10) || 5000),
    };
}

const isEnabled = () => config() !== null;

/** The trace context of the code running now, or undefined. */
const current = () => storage.getStore();

function parseTraceparent(header) {
    const m = TRACEPARENT.exec(String(header || '').trim()); // the format is lowercase hex only
    if (!m || /^0+$/.test(m[1]) || /^0+$/.test(m[2])) return null;
    return { traceId: m[1], parentSpanId: m[2], sampled: (parseInt(m[3], 16) & 1) === 1 };
}

/** `traceparent` header value for a call made from inside the current span. */
function traceparentHeader() {
    const ctx = current();
    return ctx ? `00-${ctx.traceId}-${ctx.spanId}-${ctx.sampled ? '01' : '00'}` : undefined;
}

// ---- Recording and export ---------------------------------------------------------------

function attrValue(v) {
    if (typeof v === 'boolean') return { boolValue: v };
    if (typeof v === 'number') return Number.isInteger(v) ? { intValue: String(v) } : { doubleValue: v };
    return { stringValue: String(v) };
}
const attrList = (attrs) => Object.entries(attrs || {}).filter(([, v]) => v !== undefined && v !== null).map(([key, value]) => ({ key, value: attrValue(value) }));

function record(span) {
    if (!isEnabled()) return;
    if (queue.length >= MAX_QUEUE) {
        stats.dropped += 1;
        return;
    }
    queue.push(span);
    if (queue.length >= BATCH) flush().catch(() => {});
    else schedule();
}

function schedule() {
    if (timer) return;
    const cfg = config();
    timer = setTimeout(() => {
        timer = null;
        flush().catch(() => {});
    }, cfg ? cfg.delayMs : 5000);
    timer.unref();
}

/** Sends everything queued. Never throws: tracing must not be able to hurt a request. */
async function flush() {
    const cfg = config();
    if (!cfg || queue.length === 0) return;
    const spans = queue.splice(0, BATCH);
    const body = {
        resourceSpans: [
            {
                resource: {
                    attributes: attrList({
                        'service.name': cfg.service,
                        'service.version': process.env.npm_package_version || undefined,
                        'deployment.environment.name': process.env.NODE_ENV || 'development',
                    }),
                },
                scopeSpans: [
                    {
                        scope: { name: 'fixmaster', version: '1' },
                        spans: spans.map((s) => ({
                            traceId: s.traceId,
                            spanId: s.spanId,
                            ...(s.parentSpanId ? { parentSpanId: s.parentSpanId } : {}),
                            name: s.name,
                            kind: s.kind,
                            startTimeUnixNano: String(s.start),
                            endTimeUnixNano: String(s.end),
                            attributes: attrList(s.attributes),
                            status: s.error ? { code: 2 } : { code: 1 },
                        })),
                    },
                ],
            },
        ],
    };
    try {
        const res = await fetch(cfg.url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...cfg.headers },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(5000),
        });
        await res.arrayBuffer();
        if (res.ok) stats.exported += spans.length;
        else throw new Error(`collector answered ${res.status}`);
    } catch (err) {
        stats.failed += spans.length;
        if (Date.now() - lastWarning > 60000) {
            lastWarning = Date.now();
            console.warn(`[tracing] could not send spans (${err.message}); they are dropped`);
        }
    }
    if (queue.length) schedule();
}

// ---- Spans ------------------------------------------------------------------------------

/**
 * Express middleware: opens the request's span (continuing the caller's trace if it sent
 * a traceparent), runs the rest of the request inside it, and records it when the response ends.
 */
function middleware(req, res, next) {
    const incoming = parseTraceparent(req.get('traceparent'));
    const cfg = config();
    const traceId = incoming ? incoming.traceId : hex(16);
    const sampled = incoming ? incoming.sampled : !!cfg && Math.random() < cfg.ratio;
    const ctx = { traceId, spanId: hex(8), parentSpanId: incoming ? incoming.parentSpanId : undefined, sampled };
    req.traceId = traceId;
    res.set('X-Trace-Id', traceId);
    if (cfg && sampled) {
        const start = nowNs();
        const t0 = process.hrtime.bigint();
        res.on('finish', () => {
            const route = req.route ? `${req.baseUrl}${req.route.path === '/' ? '' : req.route.path}` : null;
            record({
                ...ctx,
                name: route ? `${req.method} ${route}` : req.method,
                kind: 2,
                start,
                end: start + (process.hrtime.bigint() - t0),
                error: res.statusCode >= 500,
                attributes: {
                    'http.request.method': req.method,
                    'http.route': route || undefined,
                    'http.response.status_code': res.statusCode,
                    'fixmaster.request_id': req.id,
                },
            });
        });
    }
    storage.run(ctx, next);
}

/**
 * Runs `fn` inside a child span of the current request (kind: 'client' for calls out to
 * another system, 'internal' otherwise). Without an active, sampled trace it just runs `fn`.
 */
async function withSpan(name, attributes, fn, kind = 'internal') {
    const parent = current();
    if (!parent || !parent.sampled || !isEnabled()) return fn();
    const ctx = { traceId: parent.traceId, spanId: hex(8), parentSpanId: parent.spanId, sampled: true };
    const start = nowNs();
    const t0 = process.hrtime.bigint();
    let error = false;
    try {
        return await storage.run(ctx, fn);
    } catch (err) {
        error = true;
        throw err;
    } finally {
        record({ ...ctx, name, kind: kind === 'client' ? 3 : 1, start, end: start + (process.hrtime.bigint() - t0), error, attributes });
    }
}

/** Flushes what is queued and stops the timer (graceful shutdown). */
async function shutdown() {
    if (timer) clearTimeout(timer);
    timer = null;
    while (queue.length) {
        const before = queue.length;
        await flush();
        if (queue.length >= before) break; // the collector is not taking them
    }
}

module.exports = { isEnabled, middleware, withSpan, current, traceparentHeader, parseTraceparent, flush, shutdown, stats, _reset: () => { queue = []; if (timer) clearTimeout(timer); timer = null; stats.exported = stats.dropped = stats.failed = 0; } };
