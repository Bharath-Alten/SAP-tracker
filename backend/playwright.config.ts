import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  // The SAP screens plus the grid rows need more than the 30s default.
  timeout: 180_000,
  retries: 0,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }]
  ],
  use: {
    headless: false,
    // The corporate HTTPS certificate is not in Node's trust store, so direct API
    // calls (page.request) fail with "self-signed certificate in certificate chain".
    ignoreHTTPSErrors: true,
    // Open the SAP window maximised: null viewport = follow the real window size.
    viewport: null,
    launchOptions: { args: ['--start-maximized'] },
    actionTimeout: 0,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  outputDir: 'test-results/'
});
