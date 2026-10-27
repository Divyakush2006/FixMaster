const crypto = require('crypto');
const Ajv = require('ajv');
const db = require('../../config/db');
const { TASKS, routeFor, dailyLimit, timeoutMs, userDailyLimit } = require('../../config/ai');
const providers = require('./providers');
const tracing = require('../tracing');

// The one way the API talks to a language model.
//
//   run({ task, promptVersion, system, user, schema, userId?, flaggedInjection?, maxTokens? })
//     -> { ok: true, data, provider, model }
//     -> { ok: false, reason }    reason: DRILL | USER_LIMIT | UNAVAILABLE
//
// For each provider:model in the task's route it checks, in order: the
// provider is configured, its circuit breaker is closed, today's shared quota
// has room; then calls it with a timeout, parses JSON and validates it against
// `schema`. The first valid answer wins. Every attempt is written to ai_calls
// (no prompt or response text), which also makes those rows the quota
// counters shared by every API server.
//
// Callers must treat { ok: false } as normal: every AI feature has a non-AI
// path, and quota exhaustion on a free tier is an expected daily event.

const ajv = new Ajv({ allErrors: false, removeAdditional: 'all', useDefaults: true, coerceTypes: false });
const compiled = new WeakMap();
const validatorFor = (schema) => {
    if (!compiled.has(schema)) {
        compiled.set(schema, ajv.compile(schema));
        // Ajv keeps compiled schemas in its own cache; the validator works
        // without it, and dropping it keeps memory bounded for per-block schemas.
        ajv.removeSchema(schema);
    }
    return compiled.get(schema);
};

// ---- Circuit breakers (per process) ------------------------------------------
// After BREAKER_THRESHOLD consecutive failures a provider is skipped for
// BREAKER_COOLDOWN_MS, so an outage costs one timeout, not one per request.
const BREAKER_THRESHOLD = 3;
const BREAKER_COOLDOWN_MS = 60_000;
const breakers = new Map(); // provider -> { failures, openUntil }

const breakerOpen = (provider) => (breakers.get(provider)?.openUntil ?? 0) > Date.now();
function recordResult(provider, ok) {
    const b = breakers.get(provider) || { failures: 0, openUntil: 0 };
    if (ok) {
        b.failures = 0;
        b.openUntil = 0;
    } else {
        b.failures += 1;
        if (b.failures >= BREAKER_THRESHOLD) b.openUntil = Date.now() + BREAKER_COOLDOWN_MS;
    }
    breakers.set(provider, b);
}

// ---- Outage drill (shared by every server, via app_settings) ----------------------
const DRILL_KEY = 'ai.drill';
let drillCache = { at: 0, value: null };
async function drill() {
    if (Date.now() - drillCache.at < 5000) return drillCache.value;
    const { rows } = await db.query('SELECT setting_value FROM app_settings WHERE setting_key = $1', [DRILL_KEY]);
    const value = rows[0] && rows[0].setting_value.active ? rows[0].setting_value : null;
    drillCache = { at: Date.now(), value };
    return value;
}

async function setDrill(active, reason, userId) {
    await db.query(
        `INSERT INTO app_settings (setting_key, setting_value, updated_by_user_id, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value,
             updated_by_user_id = EXCLUDED.updated_by_user_id, updated_at = NOW()`,
        [DRILL_KEY, { active, reason: active ? reason || 'Manual dispatch drill' : null, since: active ? new Date().toISOString() : null }, userId]
    );
    drillCache = { at: 0, value: null };
}

// ---- Logging and quotas ------------------------------------------------------------
async function logCall(entry) {
    await db.query(
        `INSERT INTO ai_calls (run_id, task, provider, model, prompt_version, user_id, outcome, latency_ms, input_tokens, output_tokens, error_code, flagged_injection)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
            entry.runId,
            entry.task,
            entry.provider,
            entry.model,
            entry.promptVersion,
            entry.userId || null,
            entry.outcome,
            entry.latencyMs ?? null,
            entry.inputTokens ?? null,
            entry.outputTokens ?? null,
            entry.errorCode ? String(entry.errorCode).slice(0, 60) : null,
            !!entry.flaggedInjection,
        ]
    );
}

// Attempts that reached the provider (or were refused by it) count against
// its allowance; skips do not. "Today" is the provider's day, UTC.
async function usedToday(provider) {
    const { rows } = await db.query(
        `SELECT COUNT(*)::int AS n FROM ai_calls
         WHERE provider = $1 AND outcome <> 'SKIPPED' AND created_at >= date_trunc('day', NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`,
        [provider]
    );
    return rows[0].n;
}

async function userUsesToday(userId, task) {
    const { rows } = await db.query(
        `SELECT COUNT(DISTINCT run_id)::int AS n FROM ai_calls
         WHERE user_id = $1 AND task = $2 AND created_at >= date_trunc('day', NOW())`,
        [userId, task]
    );
    return rows[0].n;
}

/** Pulls the JSON object out of a model reply (some wrap it in a code fence or prose). */
function parseJson(text) {
    const trimmed = String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
    try {
        return JSON.parse(trimmed);
    } catch {
        const start = trimmed.indexOf('{');
        const end = trimmed.lastIndexOf('}');
        if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
        throw new Error('not JSON');
    }
}

async function run({ task, promptVersion, system, user, schema, userId = null, flaggedInjection = false, maxTokens = 800 }) {
    if (await drill()) return { ok: false, reason: 'DRILL' };
    if (userId && (await userUsesToday(userId, task)) >= userDailyLimit()) return { ok: false, reason: 'USER_LIMIT' };

    const validate = validatorFor(schema);
    const runId = crypto.randomUUID();
    for (const { provider, model } of routeFor(task)) {
        if (!providers.isAvailable(provider) || breakerOpen(provider)) continue;
        // Every key of this provider was turned away a moment ago: skip it without a call.
        const keys = providers.keyStatus(provider);
        if (keys.total > 0 && keys.available === 0) continue;
        const base = { runId, task, provider, model, promptVersion, userId, flaggedInjection };
        if ((await usedToday(provider)) >= dailyLimit(provider)) {
            await logCall({ ...base, outcome: 'QUOTA', errorCode: 'daily limit reached' });
            continue;
        }

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs(provider));
        const started = Date.now();
        try {
            const reply = await tracing.withSpan(
                'ai.call',
                { 'fixmaster.ai.task': task, 'fixmaster.ai.provider': provider, 'fixmaster.ai.model': model },
                () => providers.call(provider, { model, system, user, maxTokens, signal: controller.signal }),
                'client'
            );
            const latencyMs = Date.now() - started;
            let data;
            try {
                data = parseJson(reply.text);
            } catch {
                data = undefined;
            }
            if (data === undefined || !validate(data)) {
                recordResult(provider, false);
                const why = data === undefined ? 'not JSON' : ajv.errorsText(validate.errors, { separator: '; ' });
                await logCall({ ...base, outcome: 'INVALID_OUTPUT', latencyMs, inputTokens: reply.inputTokens, outputTokens: reply.outputTokens, errorCode: why });
                continue;
            }
            recordResult(provider, true);
            await logCall({ ...base, outcome: 'OK', latencyMs, inputTokens: reply.inputTokens, outputTokens: reply.outputTokens });
            return { ok: true, data, provider, model };
        } catch (err) {
            recordResult(provider, false);
            const kind = err instanceof providers.ProviderError ? err.kind : 'ERROR';
            await logCall({ ...base, outcome: kind, latencyMs: Date.now() - started, errorCode: err.status ? `HTTP ${err.status}` : err.message });
        } finally {
            clearTimeout(timer);
        }
    }
    return { ok: false, reason: 'UNAVAILABLE' };
}

// ---- Health -----------------------------------------------------------------------
/**
 * What supervisors and administrators see: per provider whether it is
 * configured, its breaker, today's use against its allowance, and the last
 * hour's success rate; overall HEALTHY / DEGRADED / DOWN / DISABLED.
 */
async function health() {
    const providersInUse = [...new Set(TASKS.flatMap((t) => routeFor(t).map((r) => r.provider)))];
    const { rows } = await db.query(
        `SELECT provider,
                COUNT(*) FILTER (WHERE outcome <> 'SKIPPED' AND created_at >= date_trunc('day', NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')::int AS used_today,
                COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '1 hour' AND outcome = 'OK')::int AS ok_hour,
                COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '1 hour' AND outcome NOT IN ('OK', 'SKIPPED'))::int AS failed_hour,
                MAX(created_at) FILTER (WHERE outcome = 'OK') AS last_ok_at,
                (ARRAY_AGG(error_code ORDER BY created_at DESC) FILTER (WHERE outcome NOT IN ('OK', 'SKIPPED')))[1] AS last_error
         FROM ai_calls WHERE created_at >= NOW() - INTERVAL '2 days'
         GROUP BY provider`
    );
    const byProvider = Object.fromEntries(rows.map((r) => [r.provider, r]));
    const list = providersInUse.map((provider) => {
        const r = byProvider[provider] || { used_today: 0, ok_hour: 0, failed_hour: 0, last_ok_at: null, last_error: null };
        return {
            provider,
            configured: providers.isAvailable(provider),
            keys_total: providers.keyStatus(provider).total,
            keys_available: providers.keyStatus(provider).available,
            breaker_open: breakerOpen(provider),
            used_today: r.used_today,
            daily_limit: dailyLimit(provider),
            ok_last_hour: r.ok_hour,
            failed_last_hour: r.failed_hour,
            last_ok_at: r.last_ok_at,
            last_error: r.last_error,
        };
    });
    const drillState = await drill();
    const usable = list.filter((p) => p.configured && !p.breaker_open && p.used_today < p.daily_limit && (p.keys_total === 0 || p.keys_available > 0));
    let status;
    if (drillState) status = 'DOWN';
    else if (!list.some((p) => p.configured)) status = 'DISABLED';
    else if (usable.length === 0) status = 'DOWN';
    else if (usable.length < list.filter((p) => p.configured).length || list.some((p) => p.failed_last_hour > p.ok_last_hour)) status = 'DEGRADED';
    else status = 'HEALTHY';
    return { status, drill: drillState, providers: list, routes: Object.fromEntries(TASKS.map((t) => [t, routeFor(t)])) };
}

module.exports = { run, health, setDrill, _resetBreakers: () => {
        breakers.clear();
        providers.resetKeys();
    } };
