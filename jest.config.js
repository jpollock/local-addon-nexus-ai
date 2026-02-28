module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  moduleNameMapper: {
    '^@getflywheel/local/main$': '<rootDir>/tests/__mocks__/local-main.ts',
    '^@getflywheel/local-components$': '<rootDir>/tests/__mocks__/local-components.ts',
    '^electron$': '<rootDir>/tests/__mocks__/electron.ts',
  },
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
  sandboxInjectedGlobals: ['Float32Array', 'BigInt64Array', 'Uint8Array', 'ArrayBuffer'],
  coverageThreshold: {
    global: { branches: 80, functions: 80, lines: 80, statements: 80 },
  },
  testPathIgnorePatterns: ['/node_modules/', '/lib/', '/integration/'],
};
