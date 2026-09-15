import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  retries: 0,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }]
  ],
  use: {
    headless: false,
    viewport: { width: 1280, height: 800 },
    actionTimeout: 0,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  outputDir: 'test-results/'
});
