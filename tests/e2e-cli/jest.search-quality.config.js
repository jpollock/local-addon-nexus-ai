/**
 * Jest config for search quality e2e tests.
 *
 * Uses a minimal setup that skips nexus-e2e-cli-test-site creation —
 * these tests manage their own fixture sites (Newsroom Demo, ACF Recipes, etc.)
 *
 * Usage:
 *   npx jest --config tests/e2e-cli/jest.search-quality.config.js
 */

const path = require('path');
const dir = __dirname; // tests/e2e-cli/ — explicit, no <rootDir> ambiguity

module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // Use absolute path so <rootDir> resolution doesn't matter
  testMatch: [path.join(dir, '16-search-quality.cli-e2e.test.ts')],
  testTimeout: 360000, // 6 min — sites need to start + index
  globalSetup: path.join(dir, 'setup-search-quality.ts'),
  globalTeardown: path.join(dir, 'teardown.ts'),
  setupFilesAfterEnv: [path.join(dir, 'jest.setup.ts')],
  verbose: true,
  bail: false,
  maxWorkers: 1,
  forceExit: true,
};
