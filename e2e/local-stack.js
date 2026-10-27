#!/usr/bin/env node
/**
 * Runs the browser tests against a throwaway local stack - no Docker needed.
 *
 *   node local-stack.js [playwright args]      e.g.  node local-stack.js tests/03-campus-intelligence.spec.ts
 *
 * Rebuilds the TEST database (fix_master_test) from the migrations and demo
 * seed, builds the web app, starts the API and a static server for the built
 * app on spare ports (5878 and 3878), runs Playwright with software rendering
 * only (no GPU), then stops everything. It never touches the development
 * database. Sign-in with the university account goes to a stand-in identity
 * provider (e2e/mock-idp.js). Mail goes to a small built-in catcher (e2e/mail-catcher.js) that
 * answers the same calls as Mailpit, so the sign-up and password-reset tests
 * run here too.
 */
const { spawn, spawnSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
const API_PORT = 5878;
const WEB_PORT = 3878;
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

async function waitFor(url, what) {
    for (let i = 0; i < 100; i += 1) {
        try {
            if ((await fetch(url)).ok) return;
        } catch {
            /* not up yet */
        }
        await new Promise((r) => setTimeout(r, 300));
    }
    throw new Error(`${what} did not start`);
}

(async () => {
    process.chdir(root); // the helper reads .env from the working directory
    process.env.NODE_ENV = 'test'; // only for the helper below, which refuses anything but a "test" database
    const helpers = require(path.join(root, 'tests', 'helpers'));
    await helpers.resetDatabase();

    const build = spawnSync(npm, ['run', 'build'], { cwd: path.join(root, 'client'), stdio: 'inherit', shell: process.platform === 'win32' });
    if (build.status !== 0) throw new Error('the web app did not build');

    // Mail goes to a catcher that answers the same calls as Mailpit, so the sign-up and password-reset tests run too.
    // It runs as its own process: Playwright is started synchronously below, which would stop a catcher living in this one.
    const mail = { smtpPort: 2578, httpPort: 8078 };
    // The university sign-in is a stand-in provider, also its own process (see mock-idp.js).
    const idp = { port: 7078, clientId: 'fixmaster-e2e', clientSecret: 'e2e-not-a-real-secret' };
    const env = {
        ...process.env,
        SMTP_URL: `smtp://127.0.0.1:${mail.smtpPort}`,
        MAIL_FROM: 'FixMaster <no-reply@fixmaster.test>',
        E2E_MAIL_URL: `http://127.0.0.1:${mail.httpPort}`,
        OIDC_ISSUER: `http://127.0.0.1:${idp.port}`,
        OIDC_CLIENT_ID: idp.clientId,
        OIDC_CLIENT_SECRET: idp.clientSecret,
        OIDC_REDIRECT_URI: `http://127.0.0.1:${WEB_PORT}/api/auth/sso/callback`,
        APP_URL: `http://127.0.0.1:${WEB_PORT}`,
        E2E_SSO: '1',
        NODE_ENV: 'development',
        PORT: String(API_PORT),
        DATABASE_URL: helpers.TEST_DB_URL,
        RATE_LIMIT_MAX: '1000000',
        RATE_LIMIT_ANON_MAX: '1000000',
        RATE_LIMIT_AUTH_MAX: '1000000',
        RATE_LIMIT_AUTH_IP_MAX: '1000000',
        RATE_LIMIT_ADMIN_AUTH_MAX: '1000000',
        RATE_LIMIT_ADMIN_AUTH_IP_MAX: '1000000',
        RATE_LIMIT_PRIVACY_MAX: '1000000',
        API_PROXY_TARGET: `http://127.0.0.1:${API_PORT}`,
    };
    delete env.OLLAMA_BASE_URL;
    const children = [
        spawn(process.execPath, [path.join(__dirname, 'mail-catcher.js')], { cwd: root, env: { ...env, MAIL_SMTP_PORT: String(mail.smtpPort), MAIL_HTTP_PORT: String(mail.httpPort) }, stdio: 'inherit' }),
        spawn(process.execPath, [path.join(__dirname, 'mock-idp.js')], {
            cwd: root,
            env: { ...env, MOCK_IDP_PORT: String(idp.port), MOCK_IDP_CLIENT_ID: idp.clientId, MOCK_IDP_CLIENT_SECRET: idp.clientSecret },
            stdio: 'inherit',
        }),
        spawn(process.execPath, ['src/server.js'], { cwd: root, env, stdio: 'inherit' }),
        spawn(npx, ['vite', 'preview', '--port', String(WEB_PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: path.join(root, 'client'), env, stdio: 'inherit', shell: process.platform === 'win32' }),
    ];
    // On Windows the web server runs under a shell, so the whole tree has to go.
    const stop = () =>
        children.forEach((c) => {
            if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(c.pid), '/T', '/F'], { stdio: 'ignore' });
            else c.kill();
        });
    process.on('SIGINT', () => {
        stop();
        process.exit(130);
    });

    let status = 1;
    try {
        await waitFor(`http://127.0.0.1:${API_PORT}/api/health`, 'the API');
        await waitFor(`http://127.0.0.1:${WEB_PORT}/`, 'the web app');
        const args = process.argv.slice(2);
        const run = spawnSync(npx, ['playwright', 'test', ...args], {
            cwd: __dirname,
            stdio: 'inherit',
            shell: process.platform === 'win32',
            // The installed Chrome is used by default, so nothing has to be downloaded. Software rendering (no GPU) either way.
            env: { ...env, E2E_BASE_URL: `http://127.0.0.1:${WEB_PORT}`, E2E_CHANNEL: process.env.E2E_CHANNEL || 'chrome' },
        });
        status = run.status ?? 1;
    } finally {
        stop();
    }
    process.exit(status);
})().catch((err) => {
    console.error(err.message);
    process.exit(1);
});
