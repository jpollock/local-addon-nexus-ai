import { McpClient } from './helpers/client';
import { getClient, getTestSite, deserializeEnvironment, resultText, expectSuccess } from './helpers/environment';

/**
 * Site lifecycle tests — start/stop/restart.
 * Uses the designated test site to avoid disrupting other sites.
 */
describe('04 — Site Lifecycle', () => {
  let client: McpClient;
  let testSiteId: string;
  let testSiteName: string;
  let canRunMutations: boolean;

  beforeAll(() => {
    client = getClient();
    const env = deserializeEnvironment();
    canRunMutations = !!env.testSiteId;
    if (canRunMutations) {
      const testSite = getTestSite();
      testSiteId = testSite.id;
      testSiteName = testSite.name;
    }
  });

  it('local_stop_site stops a running site', async () => {
    if (!canRunMutations) {
      console.log('Skipping: no test site available');
      return;
    }

    const result = await client.callTool('local_stop_site', { site: testSiteName });
    expectSuccess(result);

    // Verify it's stopped
    const siteResult = await client.callTool('local_get_site', { site: testSiteName });
    const text = resultText(siteResult).toLowerCase();
    expect(text).toMatch(/halted|stopped/);
  });

  it('WP-CLI tool on stopped site returns helpful error', async () => {
    if (!canRunMutations) {
      console.log('Skipping: no test site available');
      return;
    }

    const result = await client.callTool('wp_core_version', { site: testSiteName });
    // Should fail with a message about the site not running
    expect(result.isError).toBe(true);
    const text = resultText(result).toLowerCase();
    expect(text).toMatch(/not running|stopped|halted|start/);
  });

  it('local_start_site starts a halted site', async () => {
    if (!canRunMutations) {
      console.log('Skipping: no test site available');
      return;
    }

    const result = await client.callTool('local_start_site', { site: testSiteName });
    expectSuccess(result);

    // Verify it's running
    const siteResult = await client.callTool('local_get_site', { site: testSiteName });
    const text = resultText(siteResult).toLowerCase();
    expect(text).toContain('running');
  }, 120000);

  it('local_start_site on already-running is idempotent', async () => {
    if (!canRunMutations) {
      console.log('Skipping: no test site available');
      return;
    }

    // Site should already be running from previous test
    const result = await client.callTool('local_start_site', { site: testSiteName });
    expectSuccess(result);

    const text = resultText(result).toLowerCase();
    expect(text).toMatch(/running|already/);
  });

  it('local_restart_site restarts a running site', async () => {
    if (!canRunMutations) {
      console.log('Skipping: no test site available');
      return;
    }

    const result = await client.callTool('local_restart_site', { site: testSiteName });
    expectSuccess(result);

    // After restart, site should be running
    const siteResult = await client.callTool('local_get_site', { site: testSiteName });
    const text = resultText(siteResult).toLowerCase();
    expect(text).toContain('running');
  }, 120000);
});
