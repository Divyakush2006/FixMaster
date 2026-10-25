require('dotenv').config();
const { GoogleGenAI } = require('@google/genai');

async function testTiming() {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const t0 = Date.now();
    try {
        const res = await ai.models.generateContent({
            model: 'gemini-3.8-flash',
            contents: 'Return JSON: {"status": "ok"}',
            config: {
                responseMimeType: 'application/json',
            }
        });
        console.log(`Success in ${Date.now() - t0}ms:`, res.text);
    } catch (err) {
        console.error(`Failed after ${Date.now() - t0}ms:`, err.message);
    }
}

testTiming();
