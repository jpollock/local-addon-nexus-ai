/**
 * Playwright Configuration for WordPress E2E Tests
 *
 * Extends Jest E2E suite with browser-based WordPress testing.
 * Uses @wordpress/e2e-test-utils-playwright for WordPress-specific helpers.
 */
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  // Test directory
  testDir: '.',
  testMatch: '**/29-wordpress-browser.e2e.test.ts',

  // Test timeout
  timeout: 60000, // 60 seconds per test
  expect: {
    timeout: 10000, // 10 seconds for assertions
  },

  // Run tests in serial (WordPress state management)
  fullyParallel: false,
  workers: 1,

  // Retries
  retries: process.env.CI ? 2 : 0,

  // Reporter
  reporter: [
    ['html', { outputFolder: 'playwright-report' }],
    ['list'],
  ],

  // Shared settings
  use: {
    // Base URL will be set dynamically per test (each site has different URL)
    // baseURL: 'http://nexus-e2e-test.local',

    // Collect trace on failure
    trace: 'on-first-retry',

    // Screenshots
    screenshot: 'only-on-failure',

    // Video
    video: 'retain-on-failure',

    // Browser context
    viewport: { width: 1280, height: 720 },
    ignoreHTTPSErrors: true,

    // WordPress admin credentials (set by test setup)
    storageState: undefined, // Will be set after login
  },

  // Projects (browsers to test)
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    // Uncomment to test in other browsers
    // {
    //   name: 'firefox',
    //   use: { ...devices['Desktop Firefox'] },
    // },
    // {
    //   name: 'webkit',
    //   use: { ...devices['Desktop Safari'] },
    // },
  ],

  // Web server (not needed - Local is already running)
  // webServer: undefined,
});
