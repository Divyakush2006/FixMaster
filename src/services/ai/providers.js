const keyPool = require('./keyPool');

// Provider adapters. Each takes { model, system, user, maxTokens, signal } and
// returns { text, inputTokens, outputTokens } or throws a ProviderError whose
// `kind` the gateway records: TIMEOUT, RATE_LIMITED, ERROR.
//
// Plain HTTPS with fetch: no vendor SDKs, so every provider is called, timed
// and failed the same way. All three are asked for JSON; the gateway parses
// and validates it against the task's schema regardless of what the provider
// promises.

class ProviderError extends Error {
    constructor(kind, message, status, { rotate = false, retryAfterMs } = {}) {
        super(message);
        this.kind = kind;
        this.status = status;
        // True when the key itself was turned away (rate limited, refused,
        // out of credit): another key may succeed with the identical request.
        this.rotate = rotate;
        this.retryAfterMs = retryAfterMs;
    }
}

// 401 = key refused, 402 = no credit left (OpenRouter), 403 on Gemini = no free tier. A refused key will not
// recover on its own soon, so it is set aside for an hour.
// Tokens left over for gpt-oss thinking (low effort used 27-36 in live tests).
const GPT_OSS_THINKING_HEADROOM = 256;

const KEY_REFUSED_COOLDOWN_MS = 60 * 60 * 1000;

async function postJson(url, headers, body, signal, refusalStatuses = [401, 402]) {
    let res;
    try {
        res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal });
    } catch (err) {
        if (err.name === 'AbortError') throw new ProviderError('TIMEOUT', 'The provider did not answer in time.');
        throw new ProviderError('ERROR', `Network error: ${err.message}`);
    }
    const payload = await res.json().catch(() => null);
    if (res.status === 429) {
        const retryAfterMs = keyPool.parseRetryAfter(res.headers.get('retry-after')) ?? keyPool.DEFAULT_COOLDOWN_MS;
        throw new ProviderError('RATE_LIMITED', 'The provider is rate limiting us.', 429, { rotate: true, retryAfterMs });
    }
    if (!res.ok) {
        const detail = payload && (payload.error?.message || payload.error || payload.message);
        const refused = refusalStatuses.includes(res.status);
        throw new ProviderError('ERROR', `HTTP ${res.status}${detail ? `: ${String(detail).slice(0, 200)}` : ''}`, res.status, {
            rotate: refused,
            retryAfterMs: refused ? KEY_REFUSED_COOLDOWN_MS : undefined,
        });
    }
    return payload;
}

/**
 * Runs `attempt(key)` with the provider's first usable key; if the provider
 * turns that key away, sets it aside and repeats the same call with the next
 * one. Any other failure (timeout, server error, bad output) is not a key
 * problem and is thrown as is. When every key has been turned away, the last
 * refusal is thrown so the gateway records it and moves down its chain.
 */
async function withKeys(provider, attempt) {
    const keys = keyPool.available(provider);
    if (keys.length === 0) {
        throw new ProviderError('RATE_LIMITED', 'Every key for this provider is set aside after hitting a limit.', 429);
    }
    let last;
    for (const key of keys) {
        try {
            return await attempt(key);
        } catch (err) {
            if (!(err instanceof ProviderError) || !err.rotate) throw err;
            keyPool.cooldown(provider, key, err.retryAfterMs);
            last = err;
        }
    }
    throw last;
}

/** Groq and OpenRouter both speak the OpenAI chat-completions dialect. */
const openAiCompatible = (base, extraHeaders = {}) => async (provider, { model, system, user, maxTokens, signal }) => {
    const body = {
        model,
        messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
        ],
        temperature: 0.1,
        max_tokens: maxTokens,
        response_format: { type: 'json_object' },
    };
    // Groq's gpt-oss models think before they answer, and the thinking counts
    // against max_tokens: a small budget is used up before the JSON is complete
    // and Groq answers 400 "Failed to validate JSON". Keep the thinking short and
    // leave room for it (found by running against the live service).
    if (provider === 'groq' && /gpt-oss/.test(model)) {
        body.reasoning_effort = 'low';
        body.max_tokens = maxTokens + GPT_OSS_THINKING_HEADROOM;
    }
    const url = `${typeof base === 'function' ? base() : base}/chat/completions`;
    // A local server may have no key at all; a hosted provider rotates through its keys.
    const payload = keyPool.status(provider).total
        ? await withKeys(provider, (key) => postJson(url, { Authorization: `Bearer ${key}`, ...extraHeaders }, body, signal))
        : await postJson(url, extraHeaders, body, signal);
    const text = payload?.choices?.[0]?.message?.content;
    if (typeof text !== 'string' || !text.trim()) throw new ProviderError('ERROR', 'The provider returned no content.');
    return { text, inputTokens: payload.usage?.prompt_tokens ?? null, outputTokens: payload.usage?.completion_tokens ?? null };
};

// Gemini answers 403 PERMISSION_DENIED when a key's project has no free tier or the key is restricted.
const GEMINI_REFUSALS = [401, 402, 403];

async function gemini(provider, { model, system, user, maxTokens, signal }) {
    const base = (process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '');
    const body = {
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: maxTokens, responseMimeType: 'application/json' },
    };
    const payload = await withKeys(provider, (key) =>
        postJson(`${base}/models/${encodeURIComponent(model)}:generateContent`, { 'x-goog-api-key': key }, body, signal, GEMINI_REFUSALS)
    );
    const text = payload?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('');
    if (!text || !text.trim()) throw new ProviderError('ERROR', 'The provider returned no content.');
    return { text, inputTokens: payload.usageMetadata?.promptTokenCount ?? null, outputTokens: payload.usageMetadata?.candidatesTokenCount ?? null };
}

// ---- Local open-source models (CPU only) --------------------------------------------
// Ollama's native API, because it is the only one that accepts per-request
// runtime options: `num_gpu: 0` keeps every layer on the CPU, so a local model
// never competes with other GPU work on the machine. LOCAL_AI_NUM_GPU can be
// raised deliberately on a dedicated inference server; it defaults to 0.
async function ollama(provider, { model, system, user, maxTokens, signal }) {
    const base = (process.env.OLLAMA_BASE_URL || '').replace(/\/+$/, '');
    const payload = await postJson(
        `${base}/api/chat`,
        {},
        {
            model,
            stream: false,
            format: 'json',
            messages: [
                { role: 'system', content: system },
                { role: 'user', content: user },
            ],
            options: {
                temperature: 0.1,
                num_predict: maxTokens,
                num_gpu: Number.parseInt(process.env.LOCAL_AI_NUM_GPU ?? '0', 10) || 0,
                num_thread: Number.parseInt(process.env.LOCAL_AI_THREADS ?? '', 10) || undefined,
            },
            keep_alive: process.env.LOCAL_AI_KEEP_ALIVE || '10m',
        },
        signal
    );
    const text = payload?.message?.content;
    if (typeof text !== 'string' || !text.trim()) throw new ProviderError('ERROR', 'The local model returned no content.');
    return { text, inputTokens: payload.prompt_eval_count ?? null, outputTokens: payload.eval_count ?? null };
}

// Any other OpenAI-compatible local server (llama.cpp `llama-server`, vLLM,
// LM Studio). Whether it uses a GPU is decided when that server is started:
// start it CPU-only (e.g. llama-server -ngl 0, or CUDA_VISIBLE_DEVICES=-1).
const localOpenAi = async (provider, request) =>
    openAiCompatible(() => (process.env.LOCAL_AI_BASE_URL || '').replace(/\/+$/, ''))(provider, request);

// ---- Test double -----------------------------------------------------------------
// The suite never calls a real provider. A test installs a responder that
// receives the request and returns an object (sent back as JSON text), a raw
// string, or throws a ProviderError to simulate an outage.
let fakeResponder = null;

async function fake(provider, request) {
    if (!fakeResponder) throw new ProviderError('ERROR', 'No fake responder installed.');
    // Honour the gateway's timeout the way fetch does.
    const aborted = new Promise((_, reject) =>
        request.signal.addEventListener('abort', () => reject(new ProviderError('TIMEOUT', 'The provider did not answer in time.')), { once: true })
    );
    const answer = await Promise.race([Promise.resolve(fakeResponder({ provider, ...request })), aborted]);
    return { text: typeof answer === 'string' ? answer : JSON.stringify(answer), inputTokens: 100, outputTokens: 50 };
}

// Each hosted provider's address can be overridden (GROQ_BASE_URL,
// OPENROUTER_BASE_URL, GEMINI_BASE_URL): to go through a company gateway or
// proxy, and so the adapters can be tested against a stand-in server.
const baseUrl = (envName, fallback) => () => (process.env[envName] || fallback).replace(/\/+$/, '');

const ADAPTERS = {
    groq: openAiCompatible(baseUrl('GROQ_BASE_URL', 'https://api.groq.com/openai/v1')),
    openrouter: openAiCompatible(baseUrl('OPENROUTER_BASE_URL', 'https://openrouter.ai/api/v1'), { 'HTTP-Referer': 'https://github.com/Divyakush2006/FixMaster', 'X-Title': 'FixMaster' }),
    gemini,
    ollama,
    local: localOpenAi,
    fake,
};

/** Whether a provider can be called at all here (known adapter and a key, or the test double). */
function isAvailable(provider) {
    if (provider === 'fake') return process.env.NODE_ENV === 'test';
    // Local runtimes are opt-in by address, so nothing calls them by accident.
    if (provider === 'ollama') return !!process.env.OLLAMA_BASE_URL;
    if (provider === 'local') return !!process.env.LOCAL_AI_BASE_URL;
    return !!ADAPTERS[provider] && keyPool.status(provider).total > 0;
}

/** Keys configured and keys usable now (not set aside after a limit); both 0 for keyless providers. */
const keyStatus = (provider) => keyPool.status(provider);

function call(provider, request) {
    return ADAPTERS[provider](provider, request);
}

module.exports = {
    ProviderError,
    isAvailable,
    keyStatus,
    resetKeys: keyPool.reset,
    call,
    setFakeResponder: (fn) => {
        fakeResponder = fn;
    },
};
