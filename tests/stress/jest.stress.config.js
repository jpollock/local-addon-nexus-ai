/**
 * Jest configuration for stress tests
 *
 * These tests validate performance under load and may take longer to run.
 */

const baseConfig = require('../../jest.config');

module.exports = {
  ...baseConfig,
  rootDir: '../..', // Set root to project root
  testMatch: ['<rootDir>/tests/stress/**/*.test.ts'],
  testTimeout: 120000, // 2 minutes per test (stress tests can be slow)
  maxWorkers: 1, // Run tests serially to avoid resource contention
  globalSetup: '<rootDir>/tests/e2e/setup.ts',
  globalTeardown: '<rootDir>/tests/e2e/teardown.ts',
};
