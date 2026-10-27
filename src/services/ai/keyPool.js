const { apiKeys } = require('../../config/ai');

// Key rotation for the hosted providers. A provider may have several keys
// (one per free account). Calls use the first key until the provider says it
// has had enough - rate limited (429) or refused (401 / 402) - and then the
// very same request is sent with the next key. Nothing about the request
// changes, so the prompt, schema and model are exactly what the caller built.
//
// A key that was turned away is set aside for the time the provider asked
// for (Retry-After), one minute when it did not say, and tried again after
// that, so an exhausted daily allowance is picked up again the next day
// without a restart. A rate limit belongs to one MODEL (Groq and Gemini count
// each model's allowance separately), so a key resting for one model still
// serves the others; a refused key (401 / 402 / 403) rests for every model.
// State is per process; each API server learns on its own.
//
// With a single key there is nothing to rotate to, so it is never set aside:
// the gateway's circuit breaker handles an unhealthy provider.

const MIN_COOLDOWN_MS = 1_000;
const DEFAULT_COOLDOWN_MS = 60_000;
const MAX_COOLDOWN_MS = 24 * 60 * 60 * 1000;

const ALL_MODELS = '*';
const coolingUntil = new Map(); // provider, model (or *) and key -> epoch ms
const slot = (provider, model, key) => [provider, model, key].join('\n');

/** The provider's keys that can serve `model` right now, in configured order. */
function available(provider, model) {
    const now = Date.now();
    const resting = (m, key) => (coolingUntil.get(slot(provider, m, key)) ?? 0) > now;
    return apiKeys(provider).filter((key) => !resting(ALL_MODELS, key) && !resting(model, key));
}

/** How many keys the provider has and how many can serve `model` now. */
function status(provider, model) {
    const total = apiKeys(provider).length;
    return { total, available: total ? available(provider, model).length : 0 };
}

/** Sets a key aside for one model (or, with keyWide, for every model); ignored when it is the provider's only key. */
function cooldown(provider, model, key, ms, keyWide = false) {
    if (apiKeys(provider).length < 2) return;
    const wait = Math.min(MAX_COOLDOWN_MS, Math.max(MIN_COOLDOWN_MS, Number.isFinite(ms) ? ms : DEFAULT_COOLDOWN_MS));
    coolingUntil.set(slot(provider, keyWide ? ALL_MODELS : model, key), Date.now() + wait);
}

/** Retry-After as milliseconds: delta-seconds or an HTTP date; undefined when absent or unreadable. */
function parseRetryAfter(value) {
    if (value === null || value === undefined || value === '') return undefined;
    const seconds = Number(value);
    if (Number.isFinite(seconds)) return Math.max(0, seconds) * 1000;
    const date = Date.parse(value);
    return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

module.exports = {
    available,
    status,
    cooldown,
    parseRetryAfter,
    DEFAULT_COOLDOWN_MS,
    reset: () => coolingUntil.clear(),
};
