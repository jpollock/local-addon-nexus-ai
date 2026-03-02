const path = require('path');

/** @type {import('jest').Config} */
module.exports = {
  rootDir: path.resolve(__dirname, '../..'),
  testMatch: ['<rootDir>/tests/eval/**/*.test.ts'],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  testEnvironment: 'node',
  testTimeout: 30000,
  verbose: true,
};
