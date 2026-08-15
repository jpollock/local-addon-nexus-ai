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
  testPathIgnorePatterns: [...base.testPathIgnorePatterns, ...KNOWN_FAILING],
};
