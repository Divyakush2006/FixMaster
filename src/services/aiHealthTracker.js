/**
 * In-memory AI health tracker.
 *
 * Records every Gemini success/failure/fallback event and exposes an
 * aggregate health status for the supervisor dashboard.  A sliding window
 * of the last N events (default 20) is used so a single transient blip
 * doesn't permanently mark the system as degraded.
 */

const { isGeminiEnabled } = require('../config/gemini');

const WINDOW_SIZE = 20;            // Rolling window of recent calls
const DEGRADED_THRESHOLD = 0.5;    // >= 50% fallback → DEGRADED
const DOWN_THRESHOLD = 0.8;        // >= 80% fallback → DOWN

const events = [];                 // { ts: Date, source: 'gemini' | 'fallback', service: string, error?: string }
let consecutiveFailures = 0;
let hardDown = false;
let lastErrorMessage = null;
let downSince = null;

function record(service, source, error = null) {
    events.push({ ts: new Date(), source, service, error: error ? String(error.message || error) : null });
    if (events.length > WINDOW_SIZE) events.shift();
}

/** Called after a successful Gemini call completes. */
function recordSuccess(service = 'triage') {
    consecutiveFailures = 0;
    hardDown = false;
    downSince = null;
    lastErrorMessage = null;
    record(service, 'gemini');
}

/** Called whenever a service falls back to heuristic rules. */
function recordFallback(service = 'triage', error = null) {
    consecutiveFailures += 1;
    const msg = error ? String(error.message || error) : 'Fallback rule invoked';

    // Check if error is a definitive outage / quota exhaustion / network failure
    const isDefinitiveOutage =
        /quota|RESOURCE_EXHAUSTED|limit exceeded|ENOTFOUND|ECONNREFUSED|invalid api key|401/i.test(msg) ||
        consecutiveFailures >= 2;

    if (isDefinitiveOutage) {
        hardDown = true;
        if (!downSince) downSince = new Date().toISOString();
        lastErrorMessage = msg.includes('Quota Exceeded')
            ? 'Gemini API Daily Quota Exceeded (Free Tier limit). Automatic allocation offline.'
            : msg;
    }

    record(service, 'fallback', error);
}

/**
 * Returns a snapshot of AI health for supervisor dashboards and monitoring.
 *
 * @returns {{ status: 'HEALTHY' | 'DEGRADED' | 'DOWN' | 'DISABLED',
 *             gemini_enabled: boolean,
 *             recent_calls: number,
 *             fallback_count: number,
 *             fallback_rate: number,
 *             consecutive_failures: number,
 *             down_since: string|null,
 *             last_fallback_at: string|null,
 *             last_success_at: string|null,
 *             message: string }}
 */
function getHealth() {
    const geminiEnabled = isGeminiEnabled();

    if (!geminiEnabled) {
        return {
            status: 'DISABLED',
            gemini_enabled: false,
            recent_calls: 0,
            fallback_count: 0,
            fallback_rate: 1,
            consecutive_failures: 0,
            down_since: null,
            last_fallback_at: null,
            last_success_at: null,
            message: 'Gemini API key is not configured. All complaints use rule-based heuristics. Manual allocation by supervisors is active.',
        };
    }

    if (events.length === 0 && !hardDown) {
        return {
            status: 'HEALTHY',
            gemini_enabled: true,
            recent_calls: 0,
            fallback_count: 0,
            fallback_rate: 0,
            consecutive_failures: 0,
            down_since: null,
            last_fallback_at: null,
            last_success_at: null,
            message: 'AI service is enabled and standby. Ready for student requests.',
        };
    }

    const fallbacks = events.filter((e) => e.source === 'fallback');
    const successes = events.filter((e) => e.source === 'gemini');
    const total = events.length;
    const fallbackRate = total > 0 ? fallbacks.length / total : 1;

    const lastFallback = fallbacks.length > 0 ? fallbacks[fallbacks.length - 1].ts.toISOString() : null;
    const lastSuccess = successes.length > 0 ? successes[successes.length - 1].ts.toISOString() : null;

    let status;
    let message;

    if (hardDown || consecutiveFailures >= 2 || (total >= 2 && fallbackRate >= DOWN_THRESHOLD)) {
        status = 'DOWN';
        message = `AI service is DOWN — ${lastErrorMessage || `recent requests failed (${fallbacks.length}/${total} used fallback)`}. Automatic allocation is offline. Supervisors must handle triage and allocation manually.`;
    } else if (fallbackRate >= DEGRADED_THRESHOLD) {
        status = 'DEGRADED';
        message = `AI service is DEGRADED — ${fallbacks.length} of ${total} recent requests fell back to heuristic rules. Some complaints may need manual review.`;
    } else {
        status = 'HEALTHY';
        message = `AI service is operating normally. ${fallbacks.length} of ${total} recent requests used fallback.`;
    }

    return {
        status,
        gemini_enabled: true,
        recent_calls: total,
        fallback_count: fallbacks.length,
        fallback_rate: Math.round(fallbackRate * 100) / 100,
        consecutive_failures: consecutiveFailures,
        down_since: downSince,
        last_fallback_at: lastFallback,
        last_success_at: lastSuccess,
        message,
    };
}

/** Helper to simulate AI down condition for testing and supervisor drills */
function setSimulatedDown(isDown, reason = 'Simulated AI Outage') {
    if (isDown) {
        hardDown = true;
        downSince = new Date().toISOString();
        lastErrorMessage = reason;
        record('simulation', 'fallback', reason);
    } else {
        hardDown = false;
        consecutiveFailures = 0;
        downSince = null;
        lastErrorMessage = null;
        // Remove simulation events
        for (let i = events.length - 1; i >= 0; i--) {
            if (events[i].service === 'simulation') events.splice(i, 1);
        }
        recordSuccess('simulation');
    }
}

/** Resets tracker state (useful for tests) */
function resetHealth() {
    events.length = 0;
    consecutiveFailures = 0;
    hardDown = false;
    lastErrorMessage = null;
    downSince = null;
}

module.exports = {
    recordSuccess,
    recordFallback,
    getHealth,
    setSimulatedDown,
    resetHealth,
};
