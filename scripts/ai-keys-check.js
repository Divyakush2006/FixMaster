/**
 * Live check of every configured AI API key: npm run ai:keys
 *
 * Sends one tiny request (about 20 tokens) per key to its provider and prints
 * whether that key works, is rate limited, or is refused. Keys are identified
 * by their position in the list (groq #1, groq #2 ...), never printed.
 * Exit code 1 if any configured key does not work.
 */
require('dotenv').config({ quiet: true });
const { apiKeys } = require('../src/config/ai');

const OPENAI_STYLE = {
    groq: { url: `${(process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1').replace(/\/+$/, '')}/chat/completions`, model: 'openai/gpt-oss-20b' },
    openrouter: { url: `${(process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/+$/, '')}/chat/completions`, model: 'openai/gpt-oss-20b:free' },
};
const GEMINI_BASE = (process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '');
const GEMINI_MODEL = 'gemini-flash-lite-latest';

async function check(provider, key) {
    const signal = AbortSignal.timeout(15000);
    let res;
    if (provider === 'gemini') {
        res = await fetch(`${GEMINI_BASE}/models/${GEMINI_MODEL}:generateContent`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
            body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Reply with the word ok.' }] }], generationConfig: { maxOutputTokens: 8 } }),
            signal,
        });
    } else {
        const { url, model } = OPENAI_STYLE[provider];
        res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
            body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Reply with the word ok.' }], max_tokens: 8 }),
            signal,
        });
    }
    if (res.ok) return 'works';
    if (res.status === 429) return `rate limited now (retry-after ${res.headers.get('retry-after') ?? 'not given'}) - valid, will rotate`;
    if (res.status === 401 || res.status === 403) return 'REFUSED - wrong, revoked or mistyped key';
    if (res.status === 402) return 'NO CREDIT on this account';
    return `HTTP ${res.status}`;
}

(async () => {
    let bad = 0;
    let total = 0;
    for (const provider of ['groq', 'openrouter', 'gemini']) {
        const keys = apiKeys(provider);
        if (!keys.length) {
            console.log(`${provider.padEnd(10)} no key set`);
            continue;
        }
        for (const [i, key] of keys.entries()) {
            total += 1;
            let verdict;
            try {
                verdict = await check(provider, key);
            } catch (err) {
                verdict = `unreachable (${err.name === 'TimeoutError' ? 'timed out' : err.message})`;
            }
            if (!/^works|^rate limited/.test(verdict)) bad += 1;
            console.log(`${provider.padEnd(10)} key #${i + 1}  ${verdict}`);
        }
    }
    console.log(total ? `\n${total - bad} of ${total} keys usable.` : '\nNo keys configured: AI features use their non-AI paths.');
    process.exit(bad ? 1 : 0);
})();
