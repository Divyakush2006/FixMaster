#!/usr/bin/env node
/**
 * Model benchmark: which free model is best for each AI use case?
 *
 *   npm run ai:bench -- --models "groq:openai/gpt-oss-20b,gemini:gemini-3.1-flash-lite" \
 *                       [--tasks intake,ask,feedback,briefing] [--sample 12] [--concurrency 2] [--name run1]
 *
 * It takes the REAL prompts and output schemas the app sends (it calls the
 * services with the gateway stubbed, against a throwaway database filled with
 * campus-sized data), replays them against every candidate through the same
 * provider adapters production uses (key rotation included), and scores each
 * answer against labelled cases (cases.js / score.js): schema-valid output,
 * correct issue / report / tags, numbers grounded in the facts given.
 * It also records latency and tokens per request, and turns those into how
 * many requests one free account can serve per day (limits.js).
 *
 * Uses your real API keys (.env) and spends free-tier requests. Writes
 * .bench/<name>.json (every answer) and .bench/<name>.md (the summary).
 */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..', '..');
process.chdir(root);
const arg = (name, fallback) => {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const MODELS = arg('models', '').split(',').map((s) => s.trim()).filter(Boolean).map((s) => ({ provider: s.slice(0, s.indexOf(':')), model: s.slice(s.indexOf(':') + 1) }));
const TASKS = arg('tasks', 'intake,ask,feedback,briefing').split(',');
const SAMPLE = Number(arg('sample', 0)); // 0 = every case
const CONCURRENCY = Number(arg('concurrency', 2));
const NAME = arg('name', `run-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`);
const MAX_RETRIES = Number(arg('max-retries', 6)); // waits for a resting key before giving up on a call
const TUNING = arg('tuning', ''); // JSON, replaces the built-in tuning for every model of this run
const REPORT = arg('report', ''); // summarise an earlier run's .bench/<name>.jsonl instead of calling anything
if (!MODELS.length && !REPORT) {
    console.error('Give --models "provider:model,provider:model". Providers: groq, openrouter, gemini.');
    process.exit(1);
}

process.env.NODE_ENV = 'test'; // the throwaway-database helper refuses anything else
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- Real prompts ------------------------------------------------------------------
async function buildPrompts(cases) {
    const helpers = require(path.join(root, 'tests', 'helpers'));
    process.env.DATABASE_URL = helpers.TEST_DB_URL; // every service below reads this database, never the development one
    await helpers.resetDatabase();
    await require(path.join(root, 'scripts', 'generate-scale-data')).generate({ connectionString: helpers.TEST_DB_URL, reset: true, log: () => {} });
    const gateway = require(path.join(root, 'src/services/ai/gateway'));
    const db = require(path.join(root, 'src/config/db'));
    const STOP = new Error('captured');
    let captured = null;
    const realRun = gateway.run;
    gateway.run = async (p) => {
        captured = p;
        throw STOP;
    };
    const capture = async (fn) => {
        captured = null;
        try {
            await fn();
        } catch (e) {
            if (e !== STOP) throw e;
        }
        return captured; // null when the app never asks a model (e.g. a question flagged as an injection attempt)
    };
    const prompts = { intake: [], ask: [], feedback: [], briefing: [] };
    try {
        const userId = (await db.query(`SELECT user_id FROM users WHERE reg_or_emp_id = '23BCE00001'`)).rows[0].user_id; // room A-101, floor 1
        const { draftTickets } = require(path.join(root, 'src/services/assistant/intake'));
        for (const [i, c] of cases.intake.entries()) prompts.intake.push({ id: `intake-${i + 1}`, case: c, call: await capture(() => draftTickets({ userId, text: c[0] })) });

        const { ask } = require(path.join(root, 'src/services/insights/ask'));
        const blockIds = (await db.query('SELECT block_id FROM hostel_blocks ORDER BY block_id')).rows.map((r) => r.block_id);
        for (const [i, c] of cases.ask.entries()) {
            const call = await capture(() => ask({ question: c[0], scope: null, userId, allBlockIds: blockIds }));
            if (call) prompts.ask.push({ id: `ask-${i + 1}`, case: c, call });
        }

        const tagger = require(path.join(root, 'src/services/autopilot/feedbackTagger'));
        for (let b = 0; b * cases.FEEDBACK_BATCH < cases.feedback.length; b += 1) {
            const batch = cases.feedback.slice(b * cases.FEEDBACK_BATCH, (b + 1) * cases.FEEDBACK_BATCH);
            const ids = batch.map((_, i) => String(i + 1));
            prompts.feedback.push({
                id: `feedback-batch-${b + 1}`,
                case: batch,
                call: { system: tagger._SYSTEM, user: JSON.stringify(batch.map((r, i) => ({ id: String(i + 1), rating: r[1], text: r[0] }))), schema: tagger._schemaFor(ids), maxTokens: 1500 },
            });
        }

        const brief = require(path.join(root, 'src/services/insights/briefing'));
        for (const [label, scope] of [['campus', null], ['blocks A+B', new Set(['A_BLOCK', 'B_BLOCK'])], ['block O', new Set(['O_BLOCK'])]]) {
            const facts = await brief.gatherFacts(scope);
            const user = JSON.stringify({ facts });
            prompts.briefing.push({ id: `briefing-${label}`, case: user, call: { system: brief._SYSTEM, user, schema: brief._SCHEMA, maxTokens: 700 } });
        }
    } finally {
        gateway.run = realRun;
    }
    return prompts;
}

// ---- Calling and scoring -------------------------------------------------------------
const Ajv = require('ajv');
const ajv = new Ajv({ allErrors: false, removeAdditional: 'all', useDefaults: true, coerceTypes: false });

async function attempt(providers, ProviderError, m, call) {
    let retries = 0;
    let rateLimited = 0;
    for (;;) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 90_000);
        const started = Date.now();
        try {
            const reply = await providers.call(m.provider, { model: m.model, system: call.system, user: call.user, maxTokens: call.maxTokens, signal: controller.signal, tuning: TUNING ? JSON.parse(TUNING) : undefined });
            return { reply, latencyMs: Date.now() - started, retries, rateLimited };
        } catch (err) {
            const kind = err instanceof ProviderError ? err.kind : 'ERROR';
            if (kind === 'RATE_LIMITED' && retries < MAX_RETRIES) {
                rateLimited += 1;
                retries += 1;
                await sleep(Math.min(err.retryAfterMs || 20_000, 65_000));
                continue;
            }
            if (kind === 'ERROR' && (!err.status || err.status >= 500) && retries < 2) {
                retries += 1;
                await sleep(3000);
                continue;
            }
            return { error: { kind, message: String(err.message).slice(0, 160) }, latencyMs: Date.now() - started, retries, rateLimited };
        } finally {
            clearTimeout(timer);
        }
    }
}

async function evaluate(task, item, m, providers, ProviderError, gateway, score) {
    const out = await attempt(providers, ProviderError, m, item.call);
    const base = { task, id: item.id, provider: m.provider, model: m.model, latencyMs: out.latencyMs, retries: out.retries, rateLimited: out.rateLimited };
    if (out.error) return { ...base, status: out.error.kind === 'TIMEOUT' ? 'timeout' : out.error.kind === 'RATE_LIMITED' ? 'rate_limited' : 'error', detail: out.error.message };
    const { reply } = out;
    base.inTok = reply.inputTokens;
    base.outTok = reply.outputTokens;
    let data;
    try {
        data = gateway._parseJson(reply.text);
    } catch {
        return { ...base, status: 'invalid_json', sample: reply.text.slice(0, 120) };
    }
    const validate = ajv.compile(item.call.schema);
    if (!validate(data)) return { ...base, status: 'schema_invalid', detail: ajv.errorsText(validate.errors).slice(0, 160), sample: reply.text.slice(0, 160) };
    const s = task === 'intake' ? score.intake(item.case, data) : task === 'ask' ? score.ask(item.case, data) : task === 'feedback' ? score.feedback(item.case, data) : score.briefing(item.case, data);
    return { ...base, status: 'ok', score: s, output: data };
}

const pct = (x) => `${Math.round(x * 100)}%`;
const pick = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : null);
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

function summarise(rows, task) {
    const ok = rows.filter((r) => r.status === 'ok');
    const lat = rows.filter((r) => r.latencyMs && !r.rateLimited).map((r) => r.latencyMs).sort((a, b) => a - b);
    const s = { n: rows.length, valid: ok.length / rows.length, perfect: rows.filter((r) => r.status === 'ok' && r.score.perfect).length / rows.length, p50: pick(lat, 50), p95: pick(lat, 95), inTok: avg(rows.map((r) => r.inTok).filter((x) => x != null)), outTok: avg(rows.map((r) => r.outTok).filter((x) => x != null)), rl: rows.reduce((a, r) => a + r.rateLimited, 0) };
    if (task === 'intake') s.quality = avg(rows.map((r) => (r.status === 'ok' ? r.score.codeF1 : 0)));
    if (task === 'ask') s.quality = rows.filter((r) => r.status === 'ok' && r.score.reportOk).length / rows.length;
    if (task === 'feedback') {
        const k = ok.reduce((a, r) => ({ tp: a.tp + r.score.tp, fp: a.fp + r.score.fp, fn: a.fn + r.score.fn, sent: a.sent + r.score.sentimentOk, n: a.n + r.score.n }), { tp: 0, fp: 0, fn: 0, sent: 0, n: 0 });
        const total = rows.reduce((a, r) => a + (r.score ? r.score.n : 10), 0);
        const fnMissing = rows.filter((r) => r.status !== 'ok').length * 0; // a failed batch is already counted by 'valid'
        s.quality = k.tp + k.fp + k.fn + fnMissing ? (2 * k.tp) / (2 * k.tp + k.fp + k.fn) : 0;
        s.sentiment = total ? k.sent / total : 0;
    }
    if (task === 'briefing') s.quality = rows.filter((r) => r.status === 'ok' && r.score.ungrounded === 0 && r.score.inventedBlocks === 0).length / rows.length;
    return s;
}

(async () => {
    const cases = require('./cases');
    const score = require('./score');
    const { dailyCapacity } = require('./limits');
    if (!REPORT) console.log(`Preparing real prompts (throwaway database) ...`);
    // The real prompts are built once (the database is rebuilt for that) and saved, so further runs can start at once and in parallel.
    const promptFile = path.join(root, '.bench', 'prompts.json');
    const prompts = REPORT ? null : process.argv.includes('--reuse-prompts') && fs.existsSync(promptFile) ? JSON.parse(fs.readFileSync(promptFile, 'utf8')) : await buildPrompts(cases);
    if (!REPORT && !process.argv.includes('--reuse-prompts')) {
        fs.mkdirSync(path.dirname(promptFile), { recursive: true });
        fs.writeFileSync(promptFile, JSON.stringify(prompts));
    }
    // Required only now: loading them earlier would open the database connection before buildPrompts points it at the throwaway one.
    const providers = REPORT ? null : require(path.join(root, 'src/services/ai/providers'));
    const gateway = REPORT ? null : require(path.join(root, 'src/services/ai/gateway'));
    const stride = (list) => (SAMPLE > 0 && list.length > SAMPLE ? Array.from({ length: SAMPLE }, (_, i) => list[Math.floor((i * list.length) / SAMPLE)]) : list);
    const key = { intake: 'intake', ask: 'ask', feedback: 'feedback', briefing: 'briefing' };

    let results = [];
    let models = MODELS;
    const byProvider = {};
    for (const m of MODELS) (byProvider[m.provider] ||= []).push(m);
    fs.mkdirSync(path.join(root, '.bench'), { recursive: true });
    const jsonl = REPORT ? null : fs.createWriteStream(path.join(root, '.bench', `${NAME}.jsonl`));
    if (REPORT) {
        results = fs.readFileSync(path.join(root, '.bench', `${REPORT}.jsonl`), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
        const seen = new Set();
        models = results.map((r) => ({ provider: r.provider, model: r.model })).filter((m) => !seen.has(`${m.provider}:${m.model}`) && seen.add(`${m.provider}:${m.model}`));
        for (const k of Object.keys(byProvider)) delete byProvider[k];
    }

    // Providers run side by side; within a provider the models run one after another.
    await Promise.all(
        Object.entries(byProvider).map(async ([provider, models]) => {
            for (const m of models) {
                for (const task of TASKS) {
                    const items = stride(prompts[key[task]]);
                    let next = 0;
                    await Promise.all(
                        Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
                            while (next < items.length) {
                                const item = items[next++];
                                const r = await evaluate(task, item, m, providers, providers.ProviderError, gateway, score);
                                results.push(r);
                                jsonl.write(`${JSON.stringify(r)}\n`);
                            }
                        })
                    );
                }
                console.log(`  done ${m.provider}:${m.model}`);
            }
        })
    );
    if (jsonl) jsonl.end();

    // ---- Report ----
    const lines = [];
    const out = (s = '') => lines.push(s);
    out(`# Model benchmark ${REPORT || NAME}\n`);
    out(`Models: ${models.map((m) => `${m.provider}:${m.model}`).join(', ')}  |  requests per model and use case: ${TASKS.map((t) => `${t} ${results.filter((r) => r.task === t && r.provider === models[0].provider && r.model === models[0].model).length}`).join(', ')}\n`);
    for (const task of TASKS) {
        out(`## ${task}\n`);
        const metric = { intake: 'issue F1', ask: 'right report', feedback: 'tag F1 / sentiment', briefing: 'fully grounded' }[task];
        out(`| model | valid JSON+schema | perfect | ${metric} | p50 ms | p95 ms | in tok | out tok | req/day/account | rate-limit hits |`);
        out(`|---|---|---|---|---|---|---|---|---|---|`);
        for (const m of models) {
            const rows = results.filter((r) => r.task === task && r.provider === m.provider && r.model === m.model);
            if (!rows.length) continue;
            const s = summarise(rows, task);
            const cap = s.inTok != null ? dailyCapacity(m.provider, m.model, Math.round(s.inTok + (s.outTok || 0))) : null;
            const q = task === 'feedback' ? `${pct(s.quality)} / ${pct(s.sentiment)}` : pct(s.quality);
            out(`| ${m.provider}:${m.model} | ${pct(s.valid)} | ${pct(s.perfect)} | ${q} | ${s.p50 ?? '-'} | ${s.p95 ?? '-'} | ${s.inTok != null ? Math.round(s.inTok) : '-'} | ${s.outTok != null ? Math.round(s.outTok) : '-'} | ${cap ? `${cap.perDay} (${cap.binding}${cap.limits.assumed ? ', assumed limit' : ''})` : '-'} | ${s.rl} |`);
        }
        out();
        const failures = results.filter((r) => r.task === task && r.status !== 'ok');
        if (failures.length) {
            const g = {};
            for (const f of failures) (g[`${f.provider}:${f.model} ${f.status}`] ||= []).push(f.detail || f.sample || '');
            for (const [k, v] of Object.entries(g)) out(`- ${k} x${v.length}: ${[...new Set(v)].slice(0, 2).join(' | ').slice(0, 200)}`);
            out();
        }
    }
    const md = lines.join('\n');
    fs.writeFileSync(path.join(root, '.bench', `${REPORT || NAME}.md`), md);
    console.log(`\n${md}\nSaved .bench/${REPORT || NAME}.md`);
    process.exit(0);
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
