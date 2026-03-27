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
  testMatch: ['**/tests/e2e-cli/**/*.cli-e2e.test.ts'],
  testTimeout: 120000, // 2 minutes per test (CLI operations can be slow)
  globalSetup: '<rootDir>/tests/e2e-cli/setup.ts',
  globalTeardown: '<rootDir>/tests/e2e-cli/teardown.ts',
  setupFilesAfterEnv: ['<rootDir>/tests/e2e-cli/jest.setup.ts'],
  verbose: true,
  bail: false, // Continue running tests even if some fail
  maxWorkers: 1, // Run tests sequentially to avoid conflicts
};
