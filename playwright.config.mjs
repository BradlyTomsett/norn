import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser', fullyParallel: false, workers: 1, timeout: 45000,
  use: { baseURL: 'http://127.0.0.1:18976', ...devices['Pixel 7'], browserName: 'chromium', channel: process.env.NORN_TEST_CHANNEL || undefined, trace: 'retain-on-failure' },
  webServer: { command: 'node tools/preview.mjs --fixture', env: { NORN_PREVIEW_PORT: '18976' }, url: 'http://127.0.0.1:18976', reuseExistingServer: false },
});
