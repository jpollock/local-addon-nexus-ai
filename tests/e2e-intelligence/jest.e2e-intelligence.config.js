/**
 * WP-18 · Jest config for the MCP-driven intelligence journeys.
 *
 * NOT part of `npm test`, by two independent mechanisms:
 *
 *   1. `npm test` uses the root jest.config.js, which never loads this file.
 *   2. Journeys are named `*.journey.ts`, which jest's DEFAULT testMatch
 *      (`**\/__tests__/**` and `*.(spec|test).ts`) does not match — so even a
 *      run that widened its roots to this directory would not collect them.
 *
 * The second is the belt to the first's braces, and `layout.test.ts` pins it:
 * a journey renamed to `*.test.ts` would quietly make `npm test` require a
 * running Local, which is precisely the "environment-dependent test that can
 * silently skip" the strategy forbids.
 *
 * Run:  npm run test:e2e:intelligence
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // <rootDir> is this file's directory.
  testMatch: ['<rootDir>/journeys/**/*.journey.ts'],
  globalSetup: '<rootDir>/setup.ts',
  testTimeout: 180000, // a live re-check runs real WP-CLI against a real site
  maxWorkers: 1, // one conversation with one addon; parallel journeys interleave writes
  bail: false, // every journey reports, so one failure does not hide the rest
  verbose: true,
  forceExit: true,
};
