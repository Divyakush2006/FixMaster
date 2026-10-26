const { apiKey } = require('../../config/ai');

// Provider adapters. Each takes { model, system, user, maxTokens, signal } and
// returns { text, inputTokens, outputTokens } or throws a ProviderError whose
// `kind` the gateway records: TIMEOUT, RATE_LIMITED, ERROR.
//
// Plain HTTPS with fetch: no vendor SDKs, so every provider is called, timed
// and failed the same way. All three are asked for JSON; the gateway parses
// and validates it against the task's schema regardless of what the provider
// promises.

class ProviderError extends Error {
    constructor(kind, message, status) {
        super(message);
        this.kind = kind;
        this.status = status;
    }
}

async function postJson(url, headers, body, signal) {
    let res;
    try {
        res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal });
    } catch (err) {
        if (err.name === 'AbortError') throw new ProviderError('TIMEOUT', 'The provider did not answer in time.');
        throw new ProviderError('ERROR', `Network error: ${err.message}`);
    }
    const payload = await res.json().catch(() => null);
    if (res.status === 429) throw new ProviderError('RATE_LIMITED', 'The provider is rate limiting us.', 429);
    if (!res.ok) {
        const detail = payload && (payload.error?.message || payload.error || payload.message);
        throw new ProviderError('ERROR', `HTTP ${res.status}${detail ? `: ${String(detail).slice(0, 200)}` : ''}`, res.status);
    }
    return payload;
}

/** Groq and OpenRouter both speak the OpenAI chat-completions dialect. */
const openAiCompatible = (baseUrl, extraHeaders = {}) => async (provider, { model, system, user, maxTokens, signal }) => {
    const key = apiKey(provider);
    const payload = await postJson(
        `${baseUrl}/chat/completions`,
        { ...(key ? { Authorization: `Bearer ${key}` } : {}), ...extraHeaders },
        {
            model,
            messages: [
                { role: 'system', content: system },
                { role: 'user', content: user },
            ],
            temperature: 0.1,
            max_tokens: maxTokens,
            response_format: { type: 'json_object' },
        },
        signal
    );
    const text = payload?.choices?.[0]?.message?.content;
    if (typeof text !== 'string' || !text.trim()) throw new ProviderError('ERROR', 'The provider returned no content.');
    return { text, inputTokens: payload.usage?.prompt_tokens ?? null, outputTokens: payload.usage?.completion_tokens ?? null };
};

async function gemini(provider, { model, system, user, maxTokens, signal }) {
    const payload = await postJson(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        { 'x-goog-api-key': apiKey(provider) },
        {
            systemInstruction: { parts: [{ text: system }] },
            contents: [{ role: 'user', parts: [{ text: user }] }],
            generationConfig: { temperature: 0.1, maxOutputTokens: maxTokens, responseMimeType: 'application/json' },
        },
        signal
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
    openAiCompatible((process.env.LOCAL_AI_BASE_URL || '').replace(/\/+$/, ''))(provider, request);

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

const ADAPTERS = {
    groq: openAiCompatible('https://api.groq.com/openai/v1'),
    openrouter: openAiCompatible('https://openrouter.ai/api/v1', { 'HTTP-Referer': 'https://github.com/Divyakush2006/FixMaster', 'X-Title': 'FixMaster' }),
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
    return !!ADAPTERS[provider] && !!apiKey(provider);
}

function call(provider, request) {
    return ADAPTERS[provider](provider, request);
}

module.exports = {
    ProviderError,
    isAvailable,
    call,
    setFakeResponder: (fn) => {
        fakeResponder = fn;
    },
};
