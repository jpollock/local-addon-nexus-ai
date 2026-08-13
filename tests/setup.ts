// Global test setup
// Add custom matchers or global mocks here if needed

// Disable telemetry in all tests. Telemetry is fire-and-forget over the network; when a test
// triggers it (e.g. a failed tool call now records an error event — P1-7), the request can
// resolve after the test finishes and Jest reports "Cannot log after tests are done", a flaky
// suite-level failure. CI already auto-disables telemetry (CI=true); this makes local runs match.
// Suites that specifically exercise telemetry config manage this env var themselves.
process.env.NEXUS_TELEMETRY = '0';
