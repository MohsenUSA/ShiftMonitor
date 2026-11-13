import { defineConfig } from '@playwright/test';

const PORT = 3100;

/* End-to-end tests run the real app on the local dev backend, with a
   throwaway database file so they never touch your own dev data. */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    channel: 'chrome',             // the installed Google Chrome — no extra browser download
    viewport: { width: 1360, height: 900 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `rm -f .data/e2e-db.json && next dev --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { DEV_DB_PATH: '.data/e2e-db.json' },
  },
});
