/**
 * Jest Configuration for CLI E2E Tests
 *
 * These tests run against PRODUCTION Local (/Applications/Local.app),
 * not the development build from flywheel-local source.
 *
 * Requirements:
 * - Production Local must be running
 * - Nexus AI addon must be installed and enabled
 * - At least one WordPress site should exist
 */

module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // <rootDir> resolves to the directory containing this config file (tests/e2e-cli/)
  testMatch: ['<rootDir>/**/*.cli-e2e.test.ts'],
  testTimeout: 120000, // 2 minutes per test (CLI operations can be slow)
  globalSetup: '<rootDir>/setup.ts',
  globalTeardown: '<rootDir>/teardown.ts',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  verbose: true,
  bail: false, // Continue running tests even if some fail
  maxWorkers: 1, // Run tests sequentially to avoid conflicts
  forceExit: true, // Kill any hanging child processes on Ctrl+C or completion
};
