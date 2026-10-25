const { GoogleGenAI } = require('@google/genai');

const apiKey = process.env.GEMINI_API_KEY ? process.env.GEMINI_API_KEY.trim() : null;
const modelName = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
const timeoutMs = parseInt(process.env.GEMINI_TIMEOUT_MS, 10) || 5000;

let aiClient = null;

if (apiKey) {
    try {
        aiClient = new GoogleGenAI({ apiKey });
    } catch (err) {
        console.warn(`[GEMINI] Warning: Failed to initialize GoogleGenAI client: ${err.message}. Falling back to rule-based engine.`);
    }
} else {
    console.warn('[GEMINI] Note: GEMINI_API_KEY is not set in environment. Running in heuristic/rule-based fallback mode.');
}

function isGeminiEnabled() {
    return !!aiClient;
}

/**
 * Checks whether an error is a permanent quota exhaustion (e.g. daily free-tier limit).
 */
function isQuotaExhaustedError(err) {
    if (!err) return false;
    const msg = String(err.message || '');
    return (
        err.status === 429 &&
        (msg.includes('RESOURCE_EXHAUSTED') || msg.includes('quota') || msg.includes('limit exceeded') || msg.includes('Retry in'))
    );
}

/**
 * Executes a structured JSON prompt against the Gemini API with strict timeout,
 * disabled thinking budget (for low latency), and automatic single retry on transient errors.
 *
 * @param {Object} options
 * @param {string} options.systemInstruction
 * @param {string} options.prompt
 * @param {Object} options.responseSchema
 * @returns {Promise<Object>} parsed JSON object
 */
async function generateStructured({ systemInstruction, prompt, responseSchema }) {
    if (!aiClient) {
        throw new Error('Gemini client is not enabled or API key is missing.');
    }

    const executeCall = async () => {
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => {
                const err = new Error(`Gemini request timed out after ${timeoutMs}ms`);
                err.code = 'TIMEOUT';
                reject(err);
            }, timeoutMs);
        });

        const apiPromise = aiClient.models.generateContent({
            model: modelName,
            contents: prompt,
            config: {
                systemInstruction,
                responseMimeType: 'application/json',
                responseSchema,
                thinkingConfig: {
                    thinkingBudget: 0,
                },
            },
        });

        const response = await Promise.race([apiPromise, timeoutPromise]);
        const text = response.text ? response.text.trim() : '';
        if (!text) {
            throw new Error('Gemini returned an empty response.');
        }

        try {
            return JSON.parse(text);
        } catch (jsonErr) {
            throw new Error(`Failed to parse Gemini response JSON: ${jsonErr.message}`);
        }
    };

    try {
        return await executeCall();
    } catch (firstErr) {
        // Do NOT retry on quota exhaustion (e.g. daily limit exceeded; retry delay is hours)
        if (isQuotaExhaustedError(firstErr)) {
            const quotaErr = new Error(`Gemini API Quota Exceeded (Free Tier limit reached). Service is operating in fallback mode.`);
            quotaErr.code = 'QUOTA_EXHAUSTED';
            quotaErr.original = firstErr;
            throw quotaErr;
        }

        // Retry once on transient failures (5xx server errors, or transient timeout)
        const isTransient =
            firstErr.code === 'TIMEOUT' ||
            (firstErr.status && (firstErr.status === 429 || firstErr.status >= 500)) ||
            (firstErr.message && /500|503|timeout/i.test(firstErr.message));

        if (isTransient) {
            return await executeCall();
        }
        throw firstErr;
    }
}

module.exports = {
    isGeminiEnabled,
    generateStructured,
    modelName,
};
