/**
 * Free-tier allowances, as published by third-party trackers in October 2026
 * (the providers' own pages were not retrievable). They change without notice
 * and differ between sources, so treat them as planning figures and confirm
 * them in each console before relying on them:
 *   Groq        console.groq.com/docs/rate-limits   (per ORGANISATION: extra keys on one account share the pool)
 *   OpenRouter  openrouter.ai/docs/api-reference/limits  (per account; 1000/day after a one-off $10 purchase)
 *   Gemini      aistudio.google.com/rate-limit      (per PROJECT; resets midnight Pacific)
 *
 * rpm/rpd = requests per minute/day, tpm/tpd = tokens per minute/day (null = not published).
 */
const LIMITS = {
    groq: { default: { rpm: 30, rpd: 1000, tpm: 8000, tpd: 200000 }, note: 'per organisation' },
    openrouter: { default: { rpm: 20, rpd: 50, tpm: null, tpd: null }, note: 'per account, shared by every :free model' },
    gemini: {
        default: { rpm: 15, rpd: 500, tpm: 250000, tpd: null },
        'gemini-3.5-flash': { rpm: 5, rpd: 20, tpm: 250000, tpd: null, assumed: true }, // typical Flash allowance: not confirmed for this model
        'gemma-4-31b-it': { rpm: 15, rpd: 1500, tpm: 15000, tpd: null, assumed: true }, // from Gemma 3 and a developer report: no source gives Gemma 4's own
        note: 'per project',
    },
};

const limitFor = (provider, model) => {
    const p = LIMITS[provider];
    if (!p) return null;
    const key = Object.keys(p).find((k) => k !== 'default' && k !== 'note' && model.includes(k));
    return p[key] || p.default;
};

/** Requests per day one account can serve for a given average request size. */
function dailyCapacity(provider, model, tokensPerRequest) {
    const l = limitFor(provider, model);
    if (!l) return null;
    const byTokens = l.tpd && tokensPerRequest ? Math.floor(l.tpd / tokensPerRequest) : Infinity;
    const byMinute = l.tpm && tokensPerRequest ? Math.floor(l.tpm / tokensPerRequest) : Infinity; // requests that fit in one minute
    return { perDay: Math.min(l.rpd, byTokens), perMinute: Math.min(l.rpm, byMinute), binding: byTokens < l.rpd ? 'tokens/day' : 'requests/day', limits: l };
}

module.exports = { LIMITS, limitFor, dailyCapacity };
