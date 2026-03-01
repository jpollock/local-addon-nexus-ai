const path = require('path');

const projectRoot = path.join(__dirname, '..', '..');

module.exports = {
  rootDir: projectRoot,
  preset: 'ts-jest',
  testEnvironment: '<rootDir>/tests/environments/onnx-environment.js',
  roots: ['<rootDir>/tests/integration'],
  // NO moduleNameMapper — we import real modules, no mocks
  globalSetup: '<rootDir>/tests/integration/setup.ts',
  globalTeardown: '<rootDir>/tests/integration/teardown.ts',
  testTimeout: 30000,
  sandboxInjectedGlobals: ['Float32Array', 'BigInt64Array', 'Uint8Array', 'ArrayBuffer'],
  testSequencer: '<rootDir>/tests/integration/sequencer.js',
};
