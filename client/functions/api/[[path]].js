// Cloudflare Pages Function: forwards every /api request to the API on Render.
//
// The browser only ever talks to the site's own origin (divyakush.info), so the
// session cookies, the CSRF cookie and CORS behave exactly as they do behind the
// nginx proxy in docker-compose. Nothing here inspects or stores a request.
//
// Pages settings (Settings > Variables and Secrets):
//   API_ORIGIN         https://<service>.onrender.com   (no trailing slash)
//   EDGE_PROXY_SECRET  same value as on the Render service; lets the API trust
//                      the visitor address sent below for rate limiting.

const DROP_REQUEST_HEADERS = ['host', 'connection', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'x-real-ip', 'x-edge-secret', 'x-edge-client-ip'];

const unavailable = (status, message) =>
    new Response(JSON.stringify({ error: message, code: 'API_UNAVAILABLE' }), {
        status,
        headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });

export async function onRequest(context) {
    const { request, env } = context;
    const origin = (env.API_ORIGIN || '').trim().replace(/\/+$/, '');
    if (!/^https?:\/\//.test(origin)) return unavailable(503, 'The API address is not configured.');

    const incoming = new URL(request.url);
    const target = origin + incoming.pathname + incoming.search;

    const headers = new Headers(request.headers);
    for (const name of DROP_REQUEST_HEADERS) headers.delete(name);
    for (const name of [...headers.keys()]) if (name.startsWith('cf-')) headers.delete(name);

    const visitor = request.headers.get('cf-connecting-ip');
    if (visitor && env.EDGE_PROXY_SECRET) {
        headers.set('x-edge-secret', env.EDGE_PROXY_SECRET);
        headers.set('x-edge-client-ip', visitor);
    }

    const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
    try {
        const upstream = await fetch(target, {
            method: request.method,
            headers,
            body: hasBody ? request.body : undefined,
            redirect: 'manual', // pass redirects on to the browser untouched
        });
        return new Response(upstream.body, upstream);
    } catch {
        return unavailable(502, 'The service could not be reached. Please try again in a moment.');
    }
}
