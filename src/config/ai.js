/**
 * AI configuration. Every model call goes through src/services/ai/gateway.js,
 * which walks a task's ROUTE (a chain of provider:model pairs) until one
 * returns valid output. Providers without an API key are skipped, so the
 * same configuration works with one key, three keys, or none (every feature
 * then uses its non-AI path).
 *
 *   GROQ_API_KEY, GEMINI_API_KEY, OPENROUTER_API_KEY   (never committed)
 *
 *   AI_ROUTE_<TASK>   comma-separated provider:model chain, e.g.
 *                     AI_ROUTE_INTAKE="groq:openai/gpt-oss-20b,gemini:gemini-flash-lite-latest"
 *   AI_TIMEOUT_MS     per attempt (default 8000)
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

// Defaults chosen per task (docs/ROADMAP.md section 7): the high-volume,
// latency-sensitive student assistant starts on Groq's small models; the
// low-volume writing tasks start on Gemini; OpenRouter's free models are the
// last resort because their daily allowance is the smallest.
const DEFAULT_ROUTES = {
    INTAKE: 'groq:openai/gpt-oss-20b,gemini:gemini-flash-lite-latest,openrouter:openai/gpt-oss-20b:free',
    FEEDBACK_TAGS: 'gemini:gemini-flash-lite-latest,groq:openai/gpt-oss-20b',
    BRIEFING: 'gemini:gemini-flash-latest,groq:openai/gpt-oss-120b,openrouter:openai/gpt-oss-20b:free',
    ASK: 'groq:openai/gpt-oss-120b,gemini:gemini-flash-latest',
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
const DEFAULT_DAILY_LIMITS = { groq: 12000, gemini: 400, openrouter: 45, ollama: 200000, local: 200000, fake: 1000000 };

const dailyLimit = (provider) => int(process.env[`AI_DAILY_LIMIT_${provider.toUpperCase()}`], DEFAULT_DAILY_LIMITS[provider] || 100);

const apiKey = (provider) =>
    ({
        groq: process.env.GROQ_API_KEY,
        gemini: process.env.GEMINI_API_KEY,
        openrouter: process.env.OPENROUTER_API_KEY,
        local: process.env.LOCAL_AI_API_KEY,
    })[provider];

// A model on a CPU answers far slower than a hosted API.
const LOCAL_PROVIDERS = new Set(['ollama', 'local']);

module.exports = {
    TASKS,
    routeFor,
    parseRoute,
    dailyLimit,
    apiKey,
    timeoutMs: (provider) =>
        LOCAL_PROVIDERS.has(provider) ? int(process.env.LOCAL_AI_TIMEOUT_MS, 45000) : int(process.env.AI_TIMEOUT_MS, 8000),
    userDailyLimit: () => int(process.env.AI_USER_DAILY_LIMIT, 40),
};
