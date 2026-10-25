require('dotenv').config();
const { isGeminiEnabled, generateStructured, modelName } = require('../src/config/gemini');
const { Type } = require('@google/genai');

async function runSmokeTest() {
    console.log(`[Smoke Test] Gemini Enabled: ${isGeminiEnabled()}, Target Model: ${modelName}`);

    if (!isGeminiEnabled()) {
        console.log('[Smoke Test] PASS: Graceful degradation active (no key or client disabled).');
        process.exit(0);
    }

    try {
        const schema = {
            type: Type.OBJECT,
            properties: {
                status: { type: Type.STRING },
                message: { type: Type.STRING },
            },
            required: ['status', 'message'],
        };

        const result = await generateStructured({
            systemInstruction: 'You are a test assistant. Always output structured JSON as requested.',
            prompt: 'Return a JSON with status "ok" and message "FixMaster Gemini connection verified".',
            responseSchema: schema,
        });

        console.log('[Smoke Test] Gemini API Response:', result);
        if (result && result.status === 'ok') {
            console.log('[Smoke Test] PASS: Live Gemini structured output verified successfully.');
            process.exit(0);
        } else {
            console.error('[Smoke Test] FAIL: Unexpected response shape', result);
            process.exit(1);
        }
    } catch (err) {
        console.error('[Smoke Test] Error executing Gemini call:', err.message);
        process.exit(1);
    }
}

runSmokeTest();
