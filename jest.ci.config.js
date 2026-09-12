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
  // SERIAL, DELIBERATELY — do not set detectOpenHandles: false here again.
  //
  // The base config sets detectOpenHandles: true, which jest treats as an
  // implicit --runInBand (@jest/core testSchedulerHelper.js: "detectOpenHandles
  // makes no sense without runInBand, because it cannot detect leaks in
  // workers"). That is load-bearing for this repo, and 2026-09-12 proved why.
  //
  // Overriding it to false here did make jest parallel — and hung CI. Evidence
  // from the shard-1 job on that run:
  //
  //     PASS ...  (the 174th and last suite of the shard)
  //     ...36 minutes of silence...
  //     The operation was canceled.
  //     Terminate orphan process: pid 2495 (node)   <- jest main
  //     Terminate orphan process: pid 2531 (node)   <- worker
  //     Terminate orphan process: pid 2532 (node)   <- worker
  //     Terminate orphan process: pid 2538 (node)   <- worker
  //
  // Every suite reported. No "Test Suites:" summary was ever printed. The hang
  // is in jest's SHUTDOWN, not in any test: forceExit (inherited, still on)
  // acts on the main process, and the main process never got far enough to
  // invoke it while workers held native handles open. Serial has no workers, so
  // forceExit does its job — which is exactly the rationale CLAUDE.md records
  // for turning it on.
  //
  // It was nondeterministic: all four shards carry 32-47 suites that touch
  // better-sqlite3 or intelligence-host, and only two of them hung.
  //
  // Speed comes from SHARDING instead (see ci.yml): ~172 suites per shard
  // rather than 698, which is a far larger win than parallelism was and does
  // not reintroduce workers.
  testPathIgnorePatterns: [...base.testPathIgnorePatterns, ...KNOWN_FAILING],
};
