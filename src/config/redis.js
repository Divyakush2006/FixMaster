// An optional shared Redis, used so rate limits count across every API server
// instead of per process. Off unless REDIS_URL is set; the service then works
// exactly as before, with each server counting for itself.
//
// If Redis is configured but unreachable, the API keeps serving and rate
// limiting is skipped (fail open) until it returns: an outage of a helper must
// not take the hostel office offline. The failure is logged once a minute.

let client = null;
let lastWarning = 0;

function getClient() {
    if (!process.env.REDIS_URL) return null;
    if (!client) {
        const { createClient } = require('redis');
        client = createClient({
            url: process.env.REDIS_URL,
            // Commands fail at once while disconnected, instead of queueing behind a dead socket.
            disableOfflineQueue: true,
            socket: { connectTimeout: 3000, reconnectStrategy: (retries) => Math.min(200 * 2 ** Math.min(retries, 5), 5000) },
        });
        client.on('error', (err) => {
            if (Date.now() - lastWarning > 60_000) {
                lastWarning = Date.now();
                console.warn(`[redis] ${err.message}; rate limiting is per server until it is back.`);
            }
        });
        client.connect().catch(() => {});
    }
    return client;
}

/** Closes the connection (shutdown, tests). */
async function closeRedis() {
    if (client) {
        const c = client;
        client = null;
        // A connected client says goodbye; one that is still trying to connect is simply dropped.
        if (c.isReady) await c.quit().catch(() => c.destroy());
        else c.destroy();
    }
}

const redisConfigured = () => !!process.env.REDIS_URL;

module.exports = { getClient, closeRedis, redisConfigured };
