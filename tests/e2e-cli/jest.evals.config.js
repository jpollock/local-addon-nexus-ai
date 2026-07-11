module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/26-evals-sf-fa.cli-e2e.test.ts'],
  testTimeout: 300000,
  globalSetup: '<rootDir>/setup.ts',
  globalTeardown: '<rootDir>/teardown.ts',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  verbose: true,
  bail: false,
  maxWorkers: 1,
  forceExit: true,
};
