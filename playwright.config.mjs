import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './packages/web/e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4177',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [{
    name: 'desktop-chrome',
    use: {
      ...devices['Desktop Chrome'],
      channel: 'chrome',
      viewport: { width: 1280, height: 900 },
    },
  }],
  webServer: {
    command: 'pnpm build && node packages/web/e2e/start-server.mjs',
    url: 'http://127.0.0.1:4177/api/status',
    timeout: 120_000,
    reuseExistingServer: false,
  },
});
