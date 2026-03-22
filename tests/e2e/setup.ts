import * as dotenv from 'dotenv';
import * as path from 'path';
import { discoverEnvironment, serializeEnvironment, startLocal, loadConnectionInfo } from './helpers/environment';
import { McpClient } from './helpers/client';

module.exports = async function globalSetup() {
  // Load environment variables from .env.e2e.local (if exists)
  const envPath = path.join(__dirname, '..', '..', '.env.e2e.local');
  dotenv.config({ path: envPath });

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

  // Configure API keys for AI setup testing (if available in environment)
  const apiKeys: Record<string, string> = {};

  if (process.env.ANTHROPIC_API_KEY) {
    apiKeys.anthropic = process.env.ANTHROPIC_API_KEY;
  }
  if (process.env.OPENAI_API_KEY) {
    apiKeys.openai = process.env.OPENAI_API_KEY;
  }
  if (process.env.GOOGLE_API_KEY) {
    apiKeys.google = process.env.GOOGLE_API_KEY;
  }

  if (Object.keys(apiKeys).length > 0) {
    console.log('[E2E Setup] Configuring API keys...');
    try {
      // Create MCP client directly using the connection info we already have
      const connectionInfo = loadConnectionInfo();
      if (!connectionInfo) {
        throw new Error('Connection info not available');
      }

      const client = new McpClient(connectionInfo.url, connectionInfo.authToken);
      await client.initialize();

      const result = await client.callTool('test_configure_api_keys', apiKeys);

      if (!result.isError) {
        const providers = Object.keys(apiKeys);
        console.log(`[E2E Setup] API keys configured: ${providers.join(', ')}`);
      } else {
        console.warn('[E2E Setup] Failed to configure API keys:', result.content[0].text);
      }
    } catch (err) {
      console.warn('[E2E Setup] Could not configure API keys:', (err as Error).message);
    }
  } else {
    console.log('[E2E Setup] No API keys in environment - AI setup tests will skip');
  }

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

  // If we have a test site, set it up with AI for tests that need it
  if (env.testSiteId && env.testSiteName) {
    try {
      const connectionInfo = loadConnectionInfo();
      if (!connectionInfo) {
        throw new Error('Connection info not available');
      }

      const client = new McpClient(connectionInfo.url, connectionInfo.authToken);
      await client.initialize();

      // Make sure the site is running before setup
      const isRunning = env.runningSites.some((s) => s.id === env.testSiteId);
      if (!isRunning) {
        console.log('[E2E Setup] Starting test site...');
        const startResult = await client.callTool('local_start_site', {
          site: env.testSiteName,
        });

        if (startResult.isError) {
          console.warn('[E2E Setup] Failed to start test site:', startResult.content[0]?.text);
        } else {
          console.log('[E2E Setup] Test site started, waiting for it to be ready...');
          // Wait for site to be fully running
          await new Promise((resolve) => setTimeout(resolve, 5000));
        }
      }

      console.log('[E2E Setup] Setting up AI on test site...');
      // Run wp_setup_ai with Ollama if available
      const setupResult = await client.callTool('wp_setup_ai', {
        site: env.testSiteName,
        enable_ollama: env.ollamaAvailable ?? false,
      });

      if (setupResult.isError) {
        console.warn('[E2E Setup] AI setup failed:', setupResult.content[0]?.text);
      } else {
        console.log('[E2E Setup] AI setup completed on test site');

        // Trigger initial indexing to make the site searchable
        console.log('[E2E Setup] Starting initial site indexing...');
        const indexResult = await client.callTool('reindex_site', {
          site: env.testSiteName,
        });

        if (!indexResult.isError) {
          console.log('[E2E Setup] Site indexing started');
        }
      }
    } catch (err) {
      console.warn('[E2E Setup] Could not set up AI on test site:', (err as Error).message);
    }
  }
};
