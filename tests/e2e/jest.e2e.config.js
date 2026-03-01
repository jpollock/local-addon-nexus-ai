const path = require('path');

const projectRoot = path.join(__dirname, '..', '..');

module.exports = {
  rootDir: projectRoot,
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests/e2e'],
  // No moduleNameMapper — E2E tests don't import addon source directly
  // No custom ONNX environment — we talk to the addon over HTTP
  globalSetup: '<rootDir>/tests/e2e/setup.ts',
  globalTeardown: '<rootDir>/tests/e2e/teardown.ts',
  testTimeout: 60000, // 60s — real site operations can be slow
  testSequencer: '<rootDir>/tests/e2e/sequencer.js',
  // Sequential execution — test 04 stops/starts sites, which breaks
  // concurrent tests that need a running site for WP-CLI operations
  maxWorkers: 1,
};
