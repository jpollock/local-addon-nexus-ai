/**
 * Playwright Global Setup
 *
 * Runs before all browser tests to initialize the E2E environment.
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import { discoverEnvironment, serializeEnvironment, startLocal, loadConnectionInfo } from './helpers/environment';
import { McpClient } from './helpers/client';

async function globalSetup() {
  // Load environment variables from .env.e2e.local (if exists)
  const envPath = path.join(__dirname, '..', '..', '.env.e2e.local');
  dotenv.config({ path: envPath });

  // Start Local if it's not already running
  console.log('\n[Playwright Setup] Ensuring Local is running...');
  const localProcess = await startLocal();

  if (localProcess) {
    // We started Local — store flag so teardown knows to stop it
    process.env.NEXUS_E2E_STARTED_LOCAL = 'true';
  }

  console.log('[Playwright Setup] Discovering test environment...');

  const env = await discoverEnvironment();

  console.log(`[Playwright Setup] MCP server: ${env.connectionInfo.url}`);
  console.log(`[Playwright Setup] Available tools: ${env.availableTools.length}`);
  console.log(`[Playwright Setup] Running sites: ${env.runningSites.length}`);
  console.log(`[Playwright Setup] Halted sites: ${env.haltedSites.length}`);
  console.log(`[Playwright Setup] Test site: ${env.testSiteName ?? 'none'} (id: ${env.testSiteId ?? 'n/a'})`);
  console.log(`[Playwright Setup] CAPI available: ${env.capiAvailable}`);
  console.log(`[Playwright Setup] Ollama available: ${env.ollamaAvailable}`);

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
    console.log('[Playwright Setup] Configuring API keys...');
    try {
      const connectionInfo = loadConnectionInfo();
      if (!connectionInfo) {
        throw new Error('Connection info not available');
      }

      const client = new McpClient(connectionInfo.url, connectionInfo.authToken);
      await client.initialize();

      const result = await client.callTool('test_configure_api_keys', apiKeys);

      if (!result.isError) {
        const providers = Object.keys(apiKeys);
        console.log(`[Playwright Setup] API keys configured: ${providers.join(', ')}`);
      } else {
        console.warn('[Playwright Setup] Failed to configure API keys:', result.content[0].text);
      }
    } catch (err) {
      console.warn('[Playwright Setup] Could not configure API keys:', (err as Error).message);
    }
  } else {
    console.log('[Playwright Setup] No API keys in environment - AI tests will skip');
  }

  // Warn if no running sites
  if (env.runningSites.length === 0 && !env.testSiteId) {
    console.warn(
      '[Playwright Setup] WARNING: No running WordPress sites found.\n' +
      '[Playwright Setup] Browser tests require a running WordPress site.\n' +
      '[Playwright Setup] Start at least one site in Local for browser tests to run.',
    );
  }

  // Serialize to env var for test files to pick up
  serializeEnvironment(env);

  // Store creation flag for teardown
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

      console.log(`[Playwright Setup] Setting up AI for site ${env.testSiteName}...`);
      const setupResult = await client.callTool('wp_setup_ai', {
        site: env.testSiteName,
      });

      if (!setupResult.isError) {
        console.log('[Playwright Setup] AI setup complete (credentials auto-synced)');
      } else {
        console.warn('[Playwright Setup] AI setup failed:', setupResult.content[0].text);
      }
    } catch (err) {
      console.warn('[Playwright Setup] Could not set up AI:', (err as Error).message);
    }
  }

  // Get the actual site URL (localhost:PORT) for WordPress
  // Local sites run on localhost with a port, not via .local domains
  // TODO: Make port detection fully dynamic - hardcoded for POC
  const siteUrl = 'http://localhost:10048'; // nexus-e2e-test site port
  console.log(`[Playwright Setup] Using WordPress URL: ${siteUrl}`);

  // Force WordPress to reinitialize with newly activated provider plugins
  // Provider plugins register on 'init' hook but need admin context to activate properly
  // Loading wp-admin ensures init hooks run with providers fully registered
  if (env.capiAvailable) {
    console.log('[Playwright Setup] Initializing AI provider plugins...');
    try {
      const initResponse = await fetch(`${siteUrl}/wp-admin/`);
      await initResponse.text(); // Wait for full response
      // Give WordPress time to complete all init hooks and register providers
      await new Promise(resolve => setTimeout(resolve, 2000));
      console.log('[Playwright Setup] Provider plugins initialized');
    } catch (err) {
      console.warn('[Playwright Setup] Could not initialize providers:', (err as Error).message);
    }
  }

  // Write .env file for test workers to read
  // Playwright workers don't inherit process.env from globalSetup
  const playwrightEnvPath = path.join(__dirname, '.env.playwright');
  const envContent = `WP_USERNAME=admin\nWP_PASSWORD=admin\nWP_BASE_URL=${siteUrl}\n`;
  require('fs').writeFileSync(playwrightEnvPath, envContent);

  console.log('[Playwright Setup] WordPress URL: ' + siteUrl);
  console.log('[Playwright Setup] Wrote credentials to .env.playwright');

  // Create authenticated storage state for WordPress
  // This allows tests to reuse the login session instead of logging in for each test
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL: siteUrl });
  const page = await context.newPage();

  try {
    console.log('[Playwright Setup] Logging into WordPress...');
    console.log(`[Playwright Setup] Login URL: ${siteUrl}/wp-login.php`);

    // Navigate to login page
    await page.goto(`${siteUrl}/wp-login.php`, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Check if we're already logged in (redirected to dashboard)
    if (page.url().includes('wp-admin')) {
      console.log('[Playwright Setup] Already logged in');
    } else {
      // Wait for login form to appear
      await page.waitForSelector('input[name="log"]', { timeout: 10000 });

      // Fill login form
      await page.fill('input[name="log"]', 'admin');
      await page.fill('input[name="pwd"]', 'admin');
      await page.click('input[type="submit"]');

      // Wait for redirect to dashboard
      await page.waitForURL(/wp-admin/, { timeout: 10000 });
    }

    // Save authenticated state
    const storageStatePath = path.join(__dirname, '.auth', 'wordpress-admin.json');
    const authDir = path.join(__dirname, '.auth');
    if (!require('fs').existsSync(authDir)) {
      require('fs').mkdirSync(authDir, { recursive: true });
    }
    await context.storageState({ path: storageStatePath });

    console.log('[Playwright Setup] WordPress login complete');
  } catch (err) {
    console.warn('[Playwright Setup] Could not log in to WordPress:', (err as Error).message);
    console.warn('[Playwright Setup] Tests will attempt to log in individually');
  } finally {
    await browser.close();
  }
  console.log('[Playwright Setup] Complete\n');
}

export default globalSetup;
