#!/usr/bin/env node
/**
 * Checks a live deployment from the outside, the way a browser sees it.
 *
 *   npm run deploy:check -- --site https://divyakush.info
 *   npm run deploy:check -- --site https://divyakush.info --api https://fixmaster-api.onrender.com
 *
 * --site  the address people open (Cloudflare Pages)
 * --api   the API's own address (Render); optional, also checks it directly
 *
 * It only reads, and signs in once with a made-up account to see that the API answers
 * through the site. Exit code 0 when nothing failed (warnings do not fail), 1 otherwise.
 * A free Render service may need a minute to wake up: the first request waits for it.
 */

const arg = (name) => {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1].replace(/\/+$/, '') : null;
};

const PASS = 'pass';
const WARN = 'warn';
const FAIL = 'fail';

async function runChecks({ site, api = null, fetchImpl = fetch, timeoutMs = 90000 }) {
    const results = [];
    const add = (status, name, detail = '') => results.push({ status, name, detail });

    const get = async (url, init = {}) => {
        const res = await fetchImpl(url, { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs), ...init });
        const type = res.headers.get('content-type') || '';
        let body = null;
        if (type.includes('json')) body = await res.json().catch(() => null);
        else body = await res.text().catch(() => '');
        return { status: res.status, headers: res.headers, body };
    };
    const attempt = async (name, fn) => {
        try {
            await fn();
        } catch (err) {
            add(FAIL, name, `${err.name === 'TimeoutError' ? 'no answer in time' : err.message}`);
        }
    };

    if (api) {
        await attempt('The API answers at its own address', async () => {
            const r = await get(`${api}/api/health/live`);
            if (r.status === 200 && r.body && r.body.status === 'ok') add(PASS, 'The API answers at its own address');
            else add(FAIL, 'The API answers at its own address', `HTTP ${r.status}; is the Render service live?`);
        });
    }

    await attempt('The web app loads', async () => {
        const r = await get(`${site}/`);
        if (r.status === 200 && typeof r.body === 'string' && r.body.includes('<div id="root">')) add(PASS, 'The web app loads');
        else add(FAIL, 'The web app loads', `HTTP ${r.status}; has the Pages build finished and is the domain attached?`);
        const missing = ['content-security-policy', 'x-frame-options', 'x-content-type-options'].filter((h) => !r.headers.get(h));
        if (missing.length === 0) add(PASS, 'Security headers are sent');
        else add(WARN, 'Security headers are sent', `missing: ${missing.join(', ')} (client/public/_headers)`);
        if (site.startsWith('https://')) {
            if (r.headers.get('strict-transport-security')) add(PASS, 'HTTPS is enforced (HSTS)');
            else add(WARN, 'HTTPS is enforced (HSTS)', 'no Strict-Transport-Security header');
        }
    });

    await attempt('Deep links open the app', async () => {
        const r = await get(`${site}/some/deep/link`);
        if (r.status === 200 && typeof r.body === 'string' && r.body.includes('<div id="root">')) add(PASS, 'Deep links open the app');
        else add(FAIL, 'Deep links open the app', `HTTP ${r.status}`);
    });

    await attempt('/api reaches the API through the site', async () => {
        const r = await get(`${site}/api/health/live`);
        if (r.status === 200 && r.body && r.body.status === 'ok') add(PASS, '/api reaches the API through the site');
        else if (r.body && r.body.code === 'API_UNAVAILABLE') add(FAIL, '/api reaches the API through the site', `${r.status}: ${r.body.error} (Pages variable API_ORIGIN)`);
        else add(FAIL, '/api reaches the API through the site', `HTTP ${r.status}: the Pages function is not running (Functions tab, root directory "client")`);
    });

    await attempt('The API can reach its database', async () => {
        const r = await get(`${site}/api/health`);
        if (r.status === 200 && r.body && r.body.status === 'ok') add(PASS, 'The API can reach its database');
        else add(FAIL, 'The API can reach its database', `HTTP ${r.status}; check DATABASE_URL and the Render logs`);
    });

    await attempt('Email features', async () => {
        const r = await get(`${site}/api/auth/capabilities`);
        if (r.status !== 200 || !r.body) return add(FAIL, 'Email features', `HTTP ${r.status}`);
        if (r.body.password_reset && r.body.student_signup) add(PASS, 'Sign-up and password reset are enabled');
        else add(WARN, 'Sign-up and password reset are enabled', 'off: the SMTP_* and MAIL_FROM settings are missing on the API');
    });

    await attempt('Other websites cannot act for a visitor', async () => {
        const r = await get(`${site}/api/auth/student/login`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', origin: 'https://not-this-site.example' },
            body: JSON.stringify({ reg_or_emp_id: 'x', password: 'x' }),
        });
        if (r.status === 403 && r.body && r.body.code === 'ORIGIN') add(PASS, 'Other websites cannot act for a visitor');
        else add(FAIL, 'Other websites cannot act for a visitor', `expected 403 ORIGIN, got HTTP ${r.status}; CORS_ORIGIN is not set on the API`);
    });

    await attempt('Sign-in works from the site', async () => {
        const r = await get(`${site}/api/auth/student/login`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', origin: new URL(site).origin },
            body: JSON.stringify({ reg_or_emp_id: 'DEPLOYCHECK', password: 'not-a-real-password' }),
        });
        if (r.status === 401) add(PASS, 'Sign-in is accepted from the site (and refuses a made-up account)');
        else if (r.status === 403 && r.body && r.body.code === 'ORIGIN') add(FAIL, 'Sign-in is accepted from the site', 'CORS_ORIGIN does not match this address exactly');
        else if (r.status === 429) add(WARN, 'Sign-in is accepted from the site', 'rate limited; if everyone is, EDGE_PROXY_SECRET differs between Render and Pages');
        else add(FAIL, 'Sign-in is accepted from the site', `expected 401, got HTTP ${r.status}`);
    });

    await attempt('Metrics are private', async () => {
        const r = await get(`${site}/api/metrics`);
        if ([401, 403, 404].includes(r.status)) add(PASS, 'Metrics are private');
        else add(FAIL, 'Metrics are private', `HTTP ${r.status}: /api/metrics is readable by anyone`);
    });

    return results;
}

function print(results) {
    const mark = { [PASS]: 'ok  ', [WARN]: 'warn', [FAIL]: 'FAIL' };
    for (const r of results) console.log(`${mark[r.status]}  ${r.name}${r.detail ? `\n        ${r.detail}` : ''}`);
    const failed = results.filter((r) => r.status === FAIL).length;
    const warned = results.filter((r) => r.status === WARN).length;
    console.log(`\n${results.length - failed - warned} ok, ${warned} warning(s), ${failed} failed.`);
    return failed;
}

async function main() {
    const site = arg('site');
    if (!site || !/^https?:\/\//.test(site)) {
        console.error('Usage: npm run deploy:check -- --site https://your-domain [--api https://your-api.onrender.com]');
        process.exit(2);
    }
    console.log(`Checking ${site}${arg('api') ? ` and ${arg('api')}` : ''} ...\n`);
    const results = await runChecks({ site, api: arg('api') });
    process.exit(print(results) === 0 ? 0 : 1);
}

if (require.main === module) main();

module.exports = { runChecks, PASS, WARN, FAIL };
