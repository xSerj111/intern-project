import { defineConfig, devices } from '@playwright/test';

// Runs against the already running stack (no webServer); see README "E2E".
export default defineConfig({
  testDir: 'e2e',
  outputDir: 'e2e/.artifacts',
  retries: 0,
  workers: 2,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.CLIENT_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
