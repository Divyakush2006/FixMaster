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
// without a restart. State is per process; each API server learns on its own.
//
// With a single key there is nothing to rotate to, so it is never set aside:
// the gateway's circuit breaker handles an unhealthy provider.

const MIN_COOLDOWN_MS = 1_000;
const DEFAULT_COOLDOWN_MS = 60_000;
const MAX_COOLDOWN_MS = 24 * 60 * 60 * 1000;

const coolingUntil = new Map(); // `${provider}\n${key}` -> epoch ms
const slot = (provider, key) => `${provider}\n${key}`;

/** The provider's keys that are not set aside right now, in configured order. */
function available(provider) {
    const now = Date.now();
    return apiKeys(provider).filter((key) => (coolingUntil.get(slot(provider, key)) ?? 0) <= now);
}

/** How many keys the provider has and how many can be used now. */
function status(provider) {
    const total = apiKeys(provider).length;
    return { total, available: total ? available(provider).length : 0 };
}

/** Sets a key aside; ignored when it is the provider's only key. */
function cooldown(provider, key, ms) {
    if (apiKeys(provider).length < 2) return;
    const wait = Math.min(MAX_COOLDOWN_MS, Math.max(MIN_COOLDOWN_MS, Number.isFinite(ms) ? ms : DEFAULT_COOLDOWN_MS));
    coolingUntil.set(slot(provider, key), Date.now() + wait);
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
