// CI gate config (P1-1).
//
// Runs the fast, fully-mocked unit + main suites as the required PR gate, plus the intelligence
// suites that live beside the code under src/**/__tests__/ (the `test:ci` script names all three
// trees positionally: `tests/unit tests/main src/` — the base config's `roots` makes them
// reachable, the positional patterns select which of them the gate runs). The original list of
// pre-existing failing suites has been cleared — all 11 were fixed (2 were real production bugs:
// the AIGateway unknown-X-WP-Site-ID upgrade, and the bare `ssh:<alias>@env` content-search
// resolution; the rest were stale tests). KNOWN_FAILING is kept empty as the one documented place
// to quarantine a suite if it ever must be temporarily excluded — do NOT add to it to make a new
// failure pass; fix the failure instead.
const base = require('./jest.config');

const KNOWN_FAILING = [];

module.exports = {
  ...base,
  // PARALLELISM. The base config sets detectOpenHandles: true, and jest treats
  // that as an implicit --runInBand (@jest/core testSchedulerHelper.js: "if
  // (runInBand || detectOpenHandles) return true" — it cannot detect leaks
  // inside workers). CI therefore ran all ~685 suites one at a time in a single
  // process; the 2026-09-12 run on develop was still going at 65 minutes.
  //
  // Measured on this repo, cold cache, same command, 8,979 tests:
  //   serial (detectOpenHandles: true)   151s
  //   parallel (detectOpenHandles: false) 104s
  // — and the gap is wider on a 4-core runner, where serial cannot use the
  // other cores at all and one long-lived process accumulates heap across every
  // suite instead of recycling workers.
  //
  // Local `npm test` keeps detectOpenHandles ON: that is where a new native
  // module handle leak should surface, per the rationale in CLAUDE.md. forceExit
  // (inherited from the base config) still prevents a hang here.
  //
  // NOT also disabling ts-jest diagnostics: measured at only 4s of the 104s, and
  // tsconfig.json excludes `tests`, so ts-jest is the ONLY type-checking the
  // test files get — the typecheck job's `tsc --noEmit` does not cover them.
  detectOpenHandles: false,
  testPathIgnorePatterns: [...base.testPathIgnorePatterns, ...KNOWN_FAILING],
};
