import { discoverEnvironment, serializeEnvironment, startLocal } from './helpers/environment';

module.exports = async function globalSetup() {
  // Start Local if it's not already running
  console.log('\n[E2E Setup] Ensuring Local is running...');
  const localProcess = await startLocal();

  if (localProcess) {
    // We started Local — store flag so teardown knows to stop it
    process.env.NEXUS_E2E_STARTED_LOCAL = 'true';
  }

  console.log('[E2E Setup] Discovering test environment...');

  const env = await discoverEnvironment();

  console.log(`[E2E Setup] MCP server: ${env.connectionInfo.url}`);
  console.log(`[E2E Setup] Available tools: ${env.availableTools.length}`);
  console.log(`[E2E Setup] Running sites: ${env.runningSites.length}`);
  console.log(`[E2E Setup] Halted sites: ${env.haltedSites.length}`);
  console.log(`[E2E Setup] Test site: ${env.testSiteName ?? 'none'} (id: ${env.testSiteId ?? 'n/a'})`);
  console.log(`[E2E Setup] CAPI available: ${env.capiAvailable}`);
  console.log(`[E2E Setup] Ollama available: ${env.ollamaAvailable}`);

  // CLI tests can run with halted sites (they just need Local's GraphQL accessible)
  // Only MCP tool tests that interact with WordPress need running sites
  // So we just warn here instead of failing
  if (env.runningSites.length === 0 && !env.testSiteId) {
    console.warn(
      '[E2E Setup] WARNING: No running WordPress sites found.\n' +
      '[E2E Setup] CLI tests will run, but tests requiring WordPress will be skipped.\n' +
      '[E2E Setup] Start at least one site in Local for full E2E test coverage.',
    );
  }

  // Serialize to env var for test files to pick up
  serializeEnvironment(env);

  // Also store creation flag for teardown
  if (env.createdTestSite && env.testSiteId) {
    process.env.NEXUS_E2E_CREATED_SITE_ID = env.testSiteId;
  }
};
