import { McpClient } from './helpers/client';
import { getClient, getTestSite, deserializeEnvironment, resultText, expectSuccess } from './helpers/environment';

/**
 * Plugin management tests — install/activate/deactivate on the test site.
 * Uses "hello-dolly" as a safe, small test plugin.
 */
describe('05 — Plugin Management', () => {
  let client: McpClient;
  let testSiteName: string;
  let canRunMutations: boolean;
  const TEST_PLUGIN = 'hello-dolly';

  beforeAll(() => {
    client = getClient();
    const env = deserializeEnvironment();
    canRunMutations = !!env.testSiteId;
    if (canRunMutations) {
      testSiteName = getTestSite().name;
    }
  });

  afterAll(async () => {
    if (!canRunMutations) return;

    // Clean up: deactivate and remove the test plugin
    try {
      await client.callTool('wp_plugin_deactivate', {
        site: testSiteName,
        slug: TEST_PLUGIN,
      });
    } catch { /* already deactivated */ }
  });

  it('wp_plugin_install downloads and installs a plugin', async () => {
    if (!canRunMutations) {
      console.log('Skipping: no test site available');
      return;
    }

    const result = await client.callTool('wp_plugin_install', {
      site: testSiteName,
      slug: TEST_PLUGIN,
    });
    expectSuccess(result);

    const text = resultText(result);
    expect(text.length).toBeGreaterThan(0);
  });

  it('wp_plugin_list shows newly installed plugin', async () => {
    if (!canRunMutations) {
      console.log('Skipping: no test site available');
      return;
    }

    const result = await client.callTool('wp_plugin_list', { site: testSiteName });
    expectSuccess(result);

    const text = resultText(result).toLowerCase();
    expect(text).toContain('hello');
  });

  it('wp_plugin_activate activates the plugin', async () => {
    if (!canRunMutations) {
      console.log('Skipping: no test site available');
      return;
    }

    const result = await client.callTool('wp_plugin_activate', {
      site: testSiteName,
      slug: TEST_PLUGIN,
    });
    expectSuccess(result);

    // Verify activation
    const listResult = await client.callTool('wp_plugin_list', { site: testSiteName });
    const text = resultText(listResult).toLowerCase();
    expect(text).toMatch(/hello.*active|active.*hello/);
  });

  it('wp_plugin_deactivate deactivates the plugin', async () => {
    if (!canRunMutations) {
      console.log('Skipping: no test site available');
      return;
    }

    const result = await client.callTool('wp_plugin_deactivate', {
      site: testSiteName,
      slug: TEST_PLUGIN,
    });
    expectSuccess(result);

    // Verify deactivation
    const listResult = await client.callTool('wp_plugin_list', { site: testSiteName });
    const text = resultText(listResult).toLowerCase();
    expect(text).toMatch(/hello.*inactive|inactive.*hello/);
  });

  it('wp_plugin_install with invalid slug returns error', async () => {
    if (!canRunMutations) {
      console.log('Skipping: no test site available');
      return;
    }

    const result = await client.callTool('wp_plugin_install', {
      site: testSiteName,
      slug: 'this-plugin-does-not-exist-12345-zzz',
    });
    expect(result.isError).toBe(true);
  });

  it('wp_plugin_update runs without error', async () => {
    if (!canRunMutations) {
      console.log('Skipping: no test site available');
      return;
    }

    // Update all plugins — this is observational (may or may not find updates)
    const result = await client.callTool('wp_plugin_update', {
      site: testSiteName,
      slug: '--all',
    });
    // Should not be a hard error even if nothing to update
    expectSuccess(result);
  });
});
