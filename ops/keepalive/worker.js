// Runs on a schedule (see wrangler.toml). Not reachable from the internet (workers_dev is off, no route).
export default {
    async scheduled(event, env, ctx) {
        ctx.waitUntil(ping(env.TARGET));
    },
};

async function ping(target) {
    // A sleeping Render service needs about a minute to wake; allow for it, and try once more if it did not answer.
    for (let attempt = 1; attempt <= 2; attempt += 1) {
        try {
            const res = await fetch(target, { signal: AbortSignal.timeout(90000), headers: { 'user-agent': 'fixmaster-keepalive' } });
            console.log(`keepalive ${res.status} (attempt ${attempt})`);
            if (res.ok) return;
        } catch (err) {
            console.log(`keepalive failed (attempt ${attempt}): ${err.message}`);
        }
    }
}
