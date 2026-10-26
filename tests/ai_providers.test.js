const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { resetDatabase, startApp } = require('./helpers');

// The hosted-provider adapters (Groq, OpenRouter, Gemini) against stand-in
// servers that speak each provider's documented wire format: what is sent
// (address, authentication, body), how replies are read, and how failures are
// told apart. No real provider is called. The adapters have not yet been run
// against the live services - this is the contract they are written to.

describe('AI providers: wire formats', () => {
    let t;
    let server;
    let requests;
    let behave;
    const gateway = () => require('../src/services/ai/gateway');
    const schema = { type: 'object', additionalProperties: false, required: ['answer'], properties: { answer: { type: 'string' } } };
    const run = (task = 'ASK') => gateway().run({ task, promptVersion: 'wire-v1', system: 'Be brief.', user: '{"q":"hi"}', schema, maxTokens: 50 });

    const openAiReply = (content, usage = { prompt_tokens: 11, completion_tokens: 5 }) => ({ choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }], usage });
    const geminiReply = (text) => ({ candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 13, candidatesTokenCount: 6 } });

    before(async () => {
        await resetDatabase();
        t = await startApp();
        server = http.createServer((req, res) => {
            let body = '';
            req.on('data', (c) => (body += c));
            req.on('end', () => {
                const record = { method: req.method, url: req.url, headers: req.headers, body: body ? JSON.parse(body) : null };
                requests.push(record);
                const out = behave(record);
                res.statusCode = out.status || 200;
                res.setHeader('Content-Type', 'application/json');
                if (out.delay) return setTimeout(() => res.end(JSON.stringify(out.body)), out.delay);
                res.end(typeof out.body === 'string' ? out.body : JSON.stringify(out.body));
            });
        });
        await new Promise((r) => server.listen(0, '127.0.0.1', r));
        const base = `http://127.0.0.1:${server.address().port}`;
        Object.assign(process.env, {
            GROQ_API_KEY: 'groq-key-123',
            OPENROUTER_API_KEY: 'or-key-456',
            GEMINI_API_KEY: 'gem-key-789',
            GROQ_BASE_URL: `${base}/groq/openai/v1/`,
            OPENROUTER_BASE_URL: `${base}/openrouter/api/v1`,
            GEMINI_BASE_URL: `${base}/gemini/v1beta`,
            AI_TIMEOUT_MS: '400',
        });
    });
    beforeEach(() => {
        requests = [];
        gateway()._resetBreakers();
        behave = () => ({ body: {} });
    });
    after(async () => {
        for (const k of ['GROQ_API_KEY', 'OPENROUTER_API_KEY', 'GEMINI_API_KEY', 'GROQ_BASE_URL', 'OPENROUTER_BASE_URL', 'GEMINI_BASE_URL', 'AI_TIMEOUT_MS', 'AI_ROUTE_ASK']) delete process.env[k];
        await new Promise((r) => server.close(r));
        await t.close();
    });

    describe('Groq', () => {
        beforeEach(() => {
            process.env.AI_ROUTE_ASK = 'groq:openai/gpt-oss-20b';
        });

        it('sends an OpenAI-style chat request with a bearer key and JSON mode, and reads content and usage', async () => {
            behave = () => ({ body: openAiReply('{"answer":"hello"}') });
            const r = await run();
            assert.deepEqual(r, { ok: true, data: { answer: 'hello' }, provider: 'groq', model: 'openai/gpt-oss-20b' });
            const [req] = requests;
            assert.equal(req.method, 'POST');
            assert.equal(req.url, '/groq/openai/v1/chat/completions');
            assert.equal(req.headers.authorization, 'Bearer groq-key-123');
            assert.equal(req.headers['content-type'], 'application/json');
            assert.equal(req.body.model, 'openai/gpt-oss-20b');
            assert.deepEqual(req.body.messages, [{ role: 'system', content: 'Be brief.' }, { role: 'user', content: '{"q":"hi"}' }]);
            assert.deepEqual(req.body.response_format, { type: 'json_object' });
            assert.equal(req.body.max_tokens, 50);
            assert.ok(req.body.temperature <= 0.2, 'low temperature for structured answers');
            const row = (await t.sql(`SELECT input_tokens, output_tokens, outcome FROM ai_calls WHERE provider = 'groq' ORDER BY call_id DESC LIMIT 1`)).rows[0];
            assert.deepEqual(row, { input_tokens: 11, output_tokens: 5, outcome: 'OK' });
        });

        it('accepts JSON wrapped in a code fence, as some models return it', async () => {
            behave = () => ({ body: openAiReply('```json\n{"answer":"fenced"}\n```') });
            assert.equal((await run()).data.answer, 'fenced');
        });

        it('treats 429 as rate limiting, other failures as errors, and moves on', async () => {
            behave = () => ({ status: 429, body: { error: { message: 'Rate limit reached' } } });
            assert.equal((await run()).ok, false);
            behave = () => ({ status: 503, body: { error: { message: 'over capacity' } } });
            assert.equal((await run()).ok, false);
            const rows = (await t.sql(`SELECT outcome, error_code FROM ai_calls WHERE provider = 'groq' ORDER BY call_id DESC LIMIT 2`)).rows;
            assert.deepEqual(rows.map((r) => r.outcome).sort(), ['ERROR', 'RATE_LIMITED']);
            assert.ok(rows.find((r) => r.outcome === 'ERROR').error_code.includes('503'));
        });

        it('rejects replies with no content, with text that is not JSON, and with the wrong shape', async () => {
            for (const body of [{ choices: [] }, openAiReply(''), openAiReply('I cannot help with that.'), openAiReply('{"answer": 42}'), openAiReply('{"answer":"ok","extra":true}')]) {
                behave = () => ({ body });
                assert.equal((await run()).ok, false, JSON.stringify(body));
            }
            const outcomes = (await t.sql(`SELECT DISTINCT outcome FROM ai_calls WHERE provider = 'groq'`)).rows.map((r) => r.outcome);
            assert.ok(outcomes.includes('INVALID_OUTPUT') && outcomes.includes('ERROR'));
        });

        it('gives up on a slow provider at the timeout', async () => {
            behave = () => ({ delay: 1500, body: openAiReply('{"answer":"late"}') });
            const started = Date.now();
            const r = await run();
            assert.equal(r.ok, false);
            assert.ok(Date.now() - started < 1200, 'did not wait for the slow answer');
            assert.equal((await t.sql(`SELECT outcome FROM ai_calls WHERE provider = 'groq' ORDER BY call_id DESC LIMIT 1`)).rows[0].outcome, 'TIMEOUT');
        });
    });

    describe('OpenRouter', () => {
        it('uses the same dialect at its own address, and says who is asking', async () => {
            process.env.AI_ROUTE_ASK = 'openrouter:openai/gpt-oss-20b:free';
            behave = () => ({ body: openAiReply('{"answer":"routed"}') });
            const r = await run();
            assert.equal(r.provider, 'openrouter');
            assert.equal(r.model, 'openai/gpt-oss-20b:free', 'a model name with a colon survives');
            const [req] = requests;
            assert.equal(req.url, '/openrouter/api/v1/chat/completions');
            assert.equal(req.headers.authorization, 'Bearer or-key-456');
            assert.equal(req.headers['x-title'], 'FixMaster');
            assert.match(req.headers['http-referer'], /^https:\/\//);
            assert.equal(req.body.model, 'openai/gpt-oss-20b:free');
        });
    });

    describe('Gemini', () => {
        beforeEach(() => {
            process.env.AI_ROUTE_ASK = 'gemini:gemini-flash-lite-latest';
        });

        it('sends generateContent with the key in a header (never in the address) and JSON output', async () => {
            behave = () => ({ body: geminiReply('{"answer":"gem"}') });
            const r = await run();
            assert.deepEqual(r, { ok: true, data: { answer: 'gem' }, provider: 'gemini', model: 'gemini-flash-lite-latest' });
            const [req] = requests;
            assert.equal(req.url, '/gemini/v1beta/models/gemini-flash-lite-latest:generateContent');
            assert.ok(!req.url.includes('key=') && !req.url.includes('gem-key-789'), 'the key is not in the URL');
            assert.equal(req.headers['x-goog-api-key'], 'gem-key-789');
            assert.deepEqual(req.body.systemInstruction, { parts: [{ text: 'Be brief.' }] });
            assert.deepEqual(req.body.contents, [{ role: 'user', parts: [{ text: '{"q":"hi"}' }] }]);
            assert.equal(req.body.generationConfig.responseMimeType, 'application/json');
            assert.equal(req.body.generationConfig.maxOutputTokens, 50);
            const row = (await t.sql(`SELECT input_tokens, output_tokens FROM ai_calls WHERE provider = 'gemini' ORDER BY call_id DESC LIMIT 1`)).rows[0];
            assert.deepEqual(row, { input_tokens: 13, output_tokens: 6 });
        });

        it('joins a reply that arrives in several parts', async () => {
            behave = () => ({ body: { candidates: [{ content: { parts: [{ text: '{"answer":' }, { text: '"two parts"}' }] } }] } });
            assert.equal((await run()).data.answer, 'two parts');
        });

        it('treats a blocked or empty reply as a failure, and 429 as rate limiting', async () => {
            behave = () => ({ body: { promptFeedback: { blockReason: 'SAFETY' } } });
            assert.equal((await run()).ok, false);
            behave = () => ({ status: 429, body: { error: { code: 429, message: 'Resource has been exhausted', status: 'RESOURCE_EXHAUSTED' } } });
            assert.equal((await run()).ok, false);
            assert.equal((await t.sql(`SELECT outcome FROM ai_calls WHERE provider = 'gemini' ORDER BY call_id DESC LIMIT 1`)).rows[0].outcome, 'RATE_LIMITED');
        });
    });

    describe('a chain of providers', () => {
        it('falls from one provider to the next, each tried once, and returns the first valid answer', async () => {
            process.env.AI_ROUTE_ASK = 'groq:m1,openrouter:m2:free,gemini:m3';
            behave = (req) => {
                if (req.url.startsWith('/groq')) return { status: 500, body: { error: 'boom' } };
                if (req.url.startsWith('/openrouter')) return { body: openAiReply('not json at all') };
                return { body: geminiReply('{"answer":"third time lucky"}') };
            };
            const r = await run();
            assert.deepEqual(r, { ok: true, data: { answer: 'third time lucky' }, provider: 'gemini', model: 'm3' });
            assert.deepEqual(requests.map((q) => q.url.split('/')[1]), ['groq', 'openrouter', 'gemini']);
            const rows = (await t.sql(`SELECT provider, outcome FROM ai_calls ORDER BY call_id DESC LIMIT 3`)).rows.reverse();
            assert.deepEqual(rows, [{ provider: 'groq', outcome: 'ERROR' }, { provider: 'openrouter', outcome: 'INVALID_OUTPUT' }, { provider: 'gemini', outcome: 'OK' }]);
        });

        it('skips a provider whose key is not set, without calling it', async () => {
            process.env.AI_ROUTE_ASK = 'groq:m1,gemini:m3';
            const saved = process.env.GROQ_API_KEY;
            delete process.env.GROQ_API_KEY;
            try {
                behave = () => ({ body: geminiReply('{"answer":"only gemini"}') });
                const r = await run();
                assert.equal(r.provider, 'gemini');
                assert.ok(requests.every((q) => !q.url.startsWith('/groq')));
            } finally {
                process.env.GROQ_API_KEY = saved;
            }
        });

        it('never writes a key into the call log', async () => {
            const rows = (await t.sql(`SELECT row_to_json(c)::text AS j FROM ai_calls c`)).rows;
            assert.ok(rows.length > 5);
            assert.ok(rows.every((r) => !/groq-key-123|or-key-456|gem-key-789/.test(r.j)));
        });
    });
});
