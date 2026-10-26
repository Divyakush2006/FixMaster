// Tells someone when the API fails unexpectedly: a message to a chat webhook
// (Slack, Microsoft Teams, Google Chat and Mattermost all accept {"text": ...})
// the first time each distinct failure happens, then at most every few
// minutes while it keeps happening. Off unless ERROR_WEBHOOK_URL is set.
//
// What is sent: the method, the route PATTERN, the status, the error's message
// and the request id (to find the log line). Never a request body, a query
// string, a user, or a token.

const REPEAT_MS = () => (Number.parseInt(process.env.ERROR_ALERT_REPEAT_MINUTES, 10) || 5) * 60_000;
const MAX_PER_HOUR = 20;
const lastSent = new Map(); // signature -> time
let hourStart = Date.now();
let sentThisHour = 0;
const stats = { sent: 0, suppressed: 0, failed: 0 };

function shouldSend(signature, now) {
    if (now - hourStart > 3_600_000) {
        hourStart = now;
        sentThisHour = 0;
    }
    if (sentThisHour >= MAX_PER_HOUR) return false;
    const prev = lastSent.get(signature);
    if (prev && now - prev < REPEAT_MS()) return false;
    if (lastSent.size > 500) lastSent.clear();
    lastSent.set(signature, now);
    sentThisHour += 1;
    return true;
}

/** Fire and forget: never throws, never delays the response. */
function notifyError(req, err, status = 500) {
    const url = process.env.ERROR_WEBHOOK_URL;
    if (!url) return;
    const route = req.route ? `${req.baseUrl}${req.route.path === '/' ? '' : req.route.path}` : 'unmatched route';
    const message = String((err && err.message) || err || 'unknown error').slice(0, 300);
    const signature = `${req.method} ${route} ${status} ${message}`;
    if (!shouldSend(signature, Date.now())) {
        stats.suppressed += 1;
        return;
    }
    const env = process.env.NODE_ENV || 'development';
    const text = `FixMaster API error (${env}): ${req.method} ${route} returned ${status}\n${message}\nrequest ${req.id || '-'}`;
    fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
        signal: AbortSignal.timeout(3000),
    })
        .then((r) => {
            if (r.ok) stats.sent += 1;
            else stats.failed += 1;
        })
        .catch(() => {
            stats.failed += 1;
        });
}

module.exports = { notifyError, stats, _reset: () => { lastSent.clear(); sentThisHour = 0; hourStart = Date.now(); stats.sent = stats.suppressed = stats.failed = 0; } };
