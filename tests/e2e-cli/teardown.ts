/**
 * CLI E2E Test Teardown
 *
 * Cleanup after CLI tests. Production Local is left running.
 */

/**
 * CLI E2E Test Teardown
 *
 * Cleanup after CLI tests. Production Local is left running. Both the MCP suite
 * (tests/e2e/teardown.ts) and this suite stop the SSH fixture: they are separate
 * jest invocations that never run concurrently, so each must clean up after itself.
 */

export default async function globalTeardown() {
  const { stopSshFixture } = require('./helpers/ssh-fixture');
  console.log('\n[CLI E2E Teardown] Stopping SSH host fixture...');
  await stopSshFixture();
  console.log('[CLI E2E Teardown] Tests complete');
  console.log('[CLI E2E Teardown] Production Local is still running\n');
}
