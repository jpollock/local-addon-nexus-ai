module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // Two roots, deliberately. Most suites live under tests/, but the intelligence
  // layer keeps its tests beside the code (src/**/__tests__/) — see CLAUDE.md
  // "Intelligence Layer". With tests/ alone, those suites silently never ran and
  // every packet's "green" claim was measured against a set that excluded them.
  roots: ['<rootDir>/tests', '<rootDir>/src'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.test.json' }],
    // The Vercel AI SDK (ai, @ai-sdk/*) ships ESM-only with no CJS build, and
    // unlike p-limit/marked below it cannot be shimmed — the spike's tests
    // exercise the SDK's own SSE parsing, so the real package must load.
    // ts-jest downlevels its ESM to CJS for Jest's CommonJS runtime; at
    // runtime Electron 42 (Node 22.20) / CI's 22.16 load it natively via
    // require(esm), so this transform is a Jest-only concern.
    '^.+\\.m?js$': ['ts-jest', {
      tsconfig: { allowJs: true, module: 'commonjs', target: 'ES2022', esModuleInterop: true },
      diagnostics: false,
    }],
  },
  transformIgnorePatterns: ['/node_modules/(?!(ai|@ai-sdk|@workflow|eventsource-parser)/)'],
  moduleNameMapper: {
    '^@getflywheel/local/main$': '<rootDir>/tests/__mocks__/local-main.ts',
    '^@getflywheel/local-components$': '<rootDir>/tests/__mocks__/local-components.ts',
    '^electron$': '<rootDir>/tests/__mocks__/electron.ts',
    // p-limit v6+ is ESM-only; map to a CJS shim for Jest's CommonJS environment
    '^p-limit$': '<rootDir>/tests/__mocks__/p-limit.js',
    // marked is ESM-only; map to its UMD (CJS-compatible) build for Jest
    '^marked$': '<rootDir>/node_modules/marked/lib/marked.umd.js',
    // Agent SDK — resolved from src at test time; at runtime the platform provides this via Node require paths
    '^@nexus-ai/agent-sdk$': '<rootDir>/src/main/agent-sdk/index.ts',
  },
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
  sandboxInjectedGlobals: ['Float32Array', 'BigInt64Array', 'Uint8Array', 'ArrayBuffer'],
  coverageThreshold: {
    global: { branches: 80, functions: 80, lines: 80, statements: 80 },
  },
  testPathIgnorePatterns: ['/node_modules/', '/lib/', '/integration/', '/e2e/', '/e2e-cli/', '/eval/', '/stress/'],
  // Native modules (sqlite-vec, onnxruntime, better-sqlite3) can register background
  // threads/handles with the event loop at import time that Jest's sandbox cannot drain
  // naturally. forceExit ensures Jest exits after all tests complete rather than hanging
  // indefinitely. detectOpenHandles surfaces any such handle in CI output so a new, real
  // leak remains visible rather than silently masked.
  testTimeout: 30000,
  detectOpenHandles: true,
  forceExit: true,
};
