/**
 * Playwright Configuration for WordPress E2E Tests
 *
 * Extends Jest E2E suite with browser-based WordPress testing.
 * Uses @wordpress/e2e-test-utils-playwright for WordPress-specific helpers.
 */
import { defineConfig, devices } from '@playwright/test';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load WordPress credentials from .env file created by global setup
dotenv.config({ path: path.join(__dirname, '.env.playwright') });

export default defineConfig({
  // Test directory
  testDir: '.',
  testMatch: ['**/29-wordpress-browser.e2e.test.ts', '**/30-ai-experiments-browser.e2e.test.ts'],

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

  // Global setup/teardown
  globalSetup: require.resolve('./playwright-setup'),
  globalTeardown: require.resolve('./playwright-teardown'),

  // Reporter
  reporter: [
    ['html', { outputFolder: 'playwright-report' }],
    ['list'],
  ],

  // Shared settings
  use: {
    // Base URL for WordPress E2E utils
    // TODO: Make this dynamic - hardcoded for POC
    baseURL: 'http://localhost:10048', // nexus-e2e-test site

    // Collect trace on failure
    trace: 'on-first-retry',

    // Screenshots
    screenshot: 'only-on-failure',

    // Video
    video: 'retain-on-failure',

    // Browser context
    viewport: { width: 1280, height: 720 },
    ignoreHTTPSErrors: true,

    // WordPress admin session (created by global setup, if available)
    storageState: require('fs').existsSync(path.join(__dirname, '.auth', 'wordpress-admin.json'))
      ? path.join(__dirname, '.auth', 'wordpress-admin.json')
      : undefined,
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
