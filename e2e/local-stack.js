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
 * database. The tests that need a mail catcher (password reset, sign-up) are
 * the ones that still need the Docker stack; run those with docker-compose.e2e.yml.
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

    const env = {
        ...process.env,
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
