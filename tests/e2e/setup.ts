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

  if (env.runningSites.length === 0 && !env.testSiteId) {
    throw new Error(
      'No running WordPress sites found and no test site could be created.\n' +
      'Start at least one site in Local before running E2E tests.',
    );
  }

  // Serialize to env var for test files to pick up
  serializeEnvironment(env);

  // Also store creation flag for teardown
  if (env.createdTestSite && env.testSiteId) {
    process.env.NEXUS_E2E_CREATED_SITE_ID = env.testSiteId;
  }
};
