import { defineConfig, devices } from '@playwright/test';

// Runs against a live stack (see docker-compose.e2e.yml). The tests share one
// database and some change it, so they run one at a time, in file order, and
// each creates the accounts it needs. Expect a FRESH stack: re-running against
// one a previous run already used may collide on the same rooms and tickets.
//
//   E2E_BASE_URL   web address of the stack            (default http://localhost:8080)
//   E2E_MAIL_URL   Mailpit address (password reset)    (default http://localhost:8025)
//   E2E_CHANNEL    use an installed browser, e.g. "chrome" (default: Playwright's Chromium)
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    ...devices['Desktop Chrome'],
    channel: process.env.E2E_CHANNEL || undefined,
    // Software rendering only: the suite never needs, and never asks for, a GPU.
    launchOptions: { args: ['--disable-gpu', '--disable-gpu-compositing'] },
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:8080',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
