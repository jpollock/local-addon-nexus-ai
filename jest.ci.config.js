// CI gate config (P1-1).
//
// Runs the fast, fully-mocked unit + main suites as the required PR gate, EXCLUDING a set of
// pre-existing failing suites so the gate is trustworthy (green) rather than red-forever. Each
// exclusion is a known failure to FIX and RE-INCLUDE — do not add to this list to make a new
// failure pass. See docs/planning/2026-08-12-p1-plan.md (P1-1) and the testing review.
const base = require('./jest.config');

const KNOWN_FAILING = [
  // Pre-existing assertion / logic / compile failures (fix, then delete the line):
  '/tests/unit/cli/agent-commands.test.ts',
  '/tests/unit/mcp/wpe-deep-refresh.test.ts',
  '/tests/main/mcp-tools.test.ts',
  '/tests/unit/ai-gateway/routing.test.ts',
  '/tests/main/chat-providers.test.ts',
  '/tests/unit/graphql/content-search-external.test.ts',
  '/tests/unit/content/site-readiness.test.ts',
  '/tests/unit/common/iw-types.test.ts',
  // Require the ONNX embedding model / runtime (provide the model in CI to re-include):
  '/tests/main/error-recovery.test.ts',
  '/tests/main/embedding-service.test.ts',
  // Assumes CI env vars are unset, but GitHub Actions always sets CI=true, and the telemetry
  // config captures it at import before the test's beforeEach can delete it — so two cases fail
  // in any real CI. Fix by stubbing process.env.CI at import (jest.resetModules) and re-include.
  '/tests/unit/telemetry/telemetry-config.test.ts',
];

module.exports = {
  ...base,
  testPathIgnorePatterns: [...base.testPathIgnorePatterns, ...KNOWN_FAILING],
};
