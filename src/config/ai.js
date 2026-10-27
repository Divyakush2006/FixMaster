/**
 * AI configuration. Every model call goes through src/services/ai/gateway.js,
 * which walks a task's ROUTE (a chain of provider:model pairs) until one
 * returns valid output. Providers without an API key are skipped, so the
 * same configuration works with one key, three keys, or none (every feature
 * then uses its non-AI path).
 *
 *   GROQ_API_KEY, GEMINI_API_KEY, OPENROUTER_API_KEY   (never committed)
 *                     Each takes one key or several, comma-separated
 *                     (GROQ_API_KEY="gsk_a,gsk_b,gsk_c"); a *_API_KEYS name works too.
 *                     Keys are used in order; when one is rate limited or
 *                     refused, the same request goes to the next (see
 *                     src/services/ai/keyPool.js).
 *
 *   AI_ROUTE_<TASK>   comma-separated provider:model chain, e.g.
 *                     AI_ROUTE_INTAKE="groq:openai/gpt-oss-20b,gemini:gemini-flash-lite-latest"
 *   AI_TIMEOUT_MS     per attempt (default 8000; the daily briefing, which nobody
 *                     waits on live, gets 20000)
 *   AI_TIMEOUT_<TASK>_MS  the same for one task, e.g. AI_TIMEOUT_BRIEFING_MS
 *   AI_DAILY_LIMIT_GROQ / _GEMINI / _OPENROUTER
 *                     attempts per provider per day across all servers,
 *                     kept below the provider's free allowance
 *   AI_USER_DAILY_LIMIT  assistant uses per student per day (default 40)
 *
 * Local open-source models (CPU only; see scripts/local-ai/README.md):
 *   OLLAMA_BASE_URL      e.g. http://127.0.0.1:11434 - enables provider "ollama"
 *   LOCAL_AI_BASE_URL    any OpenAI-compatible server (llama.cpp, vLLM, LM
 *                        Studio), e.g. http://127.0.0.1:8080/v1 - provider "local"
 *   LOCAL_AI_NUM_GPU     layers Ollama may put on a GPU (default 0 = CPU only)
 *   LOCAL_AI_TIMEOUT_MS  per attempt (default 45000; CPUs are slow)
 *   e.g. AI_ROUTE_INTAKE="ollama:qwen2.5:3b-instruct,groq:openai/gpt-oss-20b"
 *
 * Free-tier limits and model names change often: confirm both in each
 * provider's console and set them here rather than in code.
 */

const int = (value, fallback) => {
    const n = parseInt(value, 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
};

// Defaults chosen from a benchmark of the free models on each platform against
// the app's own prompts (docs/AI_MODELS.md; repeat it with `npm run ai:bench`).
// Groq answers in under a second and was exact on every classification case, and
// each of its models has its own daily allowance, so the chain walks Groq's
// models before leaving Groq. The briefing, which is written once a day and
// must quote only the facts it is given, starts on Gemini (the only family that
// never invented a number). OpenRouter's free models come after Groq and Gemini
// because their daily allowance is the smallest; the free roster changes often.
const OR = 'openrouter:poolside/laguna-s-2.1:free';
const DEFAULT_ROUTES = {
    INTAKE: `groq:qwen/qwen3.8-27b,groq:openai/gpt-oss-20b,groq:openai/gpt-oss-120b,gemini:gemini-3.1-flash-lite,${OR}`,
    // Reads each new ticket once (urgency, safety). Same chain as INTAKE: it sees the resident's own words, so Groq first.
    TRIAGE: `groq:qwen/qwen3.8-27b,groq:openai/gpt-oss-20b,groq:openai/gpt-oss-120b,gemini:gemini-3.1-flash-lite,${OR}`,
    FEEDBACK_TAGS: 'groq:qwen/qwen3.8-27b,groq:openai/gpt-oss-120b,gemini:gemini-3.1-flash-lite',
    BRIEFING: `gemini:gemini-3.1-flash-lite,${OR},groq:openai/gpt-oss-120b,groq:qwen/qwen3.8-27b`,
    ASK: `groq:qwen/qwen3.8-27b,groq:openai/gpt-oss-120b,gemini:gemini-3.1-flash-lite,${OR}`,
};

const TASKS = Object.keys(DEFAULT_ROUTES);

function parseRoute(text) {
    return String(text)
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => {
            const i = part.indexOf(':');
            return { provider: part.slice(0, i).toLowerCase(), model: part.slice(i + 1) };
        })
        .filter((r) => r.provider && r.model);
}

/** The provider chain for a task. Read on each call so tests and operators can change it. */
function routeFor(task) {
    // Tests run every task against the in-process fake provider.
    if (process.env.NODE_ENV === 'test' && !process.env[`AI_ROUTE_${task}`]) {
        return [{ provider: 'fake', model: 'fake-primary' }, { provider: 'fake', model: 'fake-backup' }];
    }
    return parseRoute(process.env[`AI_ROUTE_${task}`] || DEFAULT_ROUTES[task] || '');
}

// Local runtimes have no allowance; the limit only guards against a runaway loop.
const DEFAULT_DAILY_LIMITS = { groq: 3000, gemini: 500, openrouter: 50, ollama: 200000, local: 200000, fake: 1000000 };

/**
 * Every key of a provider, in the order written. <PROVIDER>_API_KEYS and
 * <PROVIDER>_API_KEY both accept one key or several separated by commas (or
 * spaces / new lines); the two lists are joined and repeats dropped.
 */
function apiKeys(provider) {
    const name = provider === 'local' ? 'LOCAL_AI' : provider.toUpperCase();
    const text = [process.env[`${name}_API_KEYS`], process.env[`${name}_API_KEY`]].filter(Boolean).join(',');
    const keys = text
        .split(/[\s,]+/)
        .map((k) => k.replace(/^["']|["']$/g, ''))
        .filter(Boolean);
    return [...new Set(keys)];
}

const apiKey = (provider) => apiKeys(provider)[0];

// AI_DAILY_LIMIT_<PROVIDER> is the allowance of one key (one account); with
// several keys the provider as a whole may be used that many times over.
const dailyLimit = (provider) =>
    int(process.env[`AI_DAILY_LIMIT_${provider.toUpperCase()}`], DEFAULT_DAILY_LIMITS[provider] || 100) * Math.max(1, apiKeys(provider).length);

// The free Gemini tier sometimes takes over 8 s on the longer briefing prompt (measured: 2-4 s normally, two
// timeouts at 8 s in one morning); the briefing is generated once per scope per day, so it may wait longer.
const TASK_TIMEOUT_MS = { BRIEFING: 20000 };

// A model on a CPU answers far slower than a hosted API.
const LOCAL_PROVIDERS = new Set(['ollama', 'local']);

module.exports = {
    TASKS,
    routeFor,
    parseRoute,
    dailyLimit,
    apiKey,
    apiKeys,
    timeoutMs: (provider, task) =>
        LOCAL_PROVIDERS.has(provider)
            ? int(process.env.LOCAL_AI_TIMEOUT_MS, 45000)
            : int(process.env[`AI_TIMEOUT_${task}_MS`], int(process.env.AI_TIMEOUT_MS, TASK_TIMEOUT_MS[task] || 8000)),
    userDailyLimit: () => int(process.env.AI_USER_DAILY_LIMIT, 40),
};
