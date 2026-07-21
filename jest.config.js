module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  moduleNameMapper: {
    '^@getflywheel/local/main$': '<rootDir>/tests/__mocks__/local-main.ts',
    '^@getflywheel/local-components$': '<rootDir>/tests/__mocks__/local-components.ts',
    '^electron$': '<rootDir>/tests/__mocks__/electron.ts',
    // p-limit v6+ is ESM-only; map to a CJS shim for Jest's CommonJS environment
    '^p-limit$': '<rootDir>/tests/__mocks__/p-limit.js',
  },
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
  sandboxInjectedGlobals: ['Float32Array', 'BigInt64Array', 'Uint8Array', 'ArrayBuffer'],
  coverageThreshold: {
    global: { branches: 80, functions: 80, lines: 80, statements: 80 },
  },
  testPathIgnorePatterns: ['/node_modules/', '/lib/', '/integration/', '/e2e/', '/e2e-cli/', '/eval/', '/stress/'],
  // LanceDB's native Rust module registers a CustomGC async_hook resource at
  // import time that the event loop cannot drain naturally inside Jest's sandbox.
  // forceExit ensures Jest exits after all tests complete rather than hanging
  // indefinitely. detectOpenHandles surfaces the handle in CI output so the
  // underlying root cause remains visible rather than silently masked.
  testTimeout: 30000,
  detectOpenHandles: true,
  forceExit: true,
};
