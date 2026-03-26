/**
 * CLI E2E Test Teardown
 *
 * Cleanup after CLI tests. Production Local is left running.
 */

export default async function globalTeardown() {
  console.log('\n[CLI E2E Teardown] Tests complete');
  console.log('[CLI E2E Teardown] Production Local is still running\n');
}
