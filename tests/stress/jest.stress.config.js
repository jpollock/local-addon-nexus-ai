/**
 * Jest configuration for stress tests
 *
 * These tests validate performance under load and may take longer to run.
 */

const baseConfig = require('../../jest.config');

module.exports = {
  ...baseConfig,
  testMatch: ['<rootDir>/tests/stress/**/*.test.ts'],
  testTimeout: 120000, // 2 minutes per test (stress tests can be slow)
  maxWorkers: 1, // Run tests serially to avoid resource contention
  globalSetup: '<rootDir>/tests/e2e/jest.global-setup.ts',
  setupFilesAfterEnv: ['<rootDir>/tests/e2e/jest.setup.ts'],
};
