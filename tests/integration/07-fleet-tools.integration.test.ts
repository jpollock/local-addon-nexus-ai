import { TestHarness } from './helpers/harness';
import { loadRegistryEntries, createSiteData } from './helpers/fixtures';
import { expectToolSuccess } from './helpers/assertions';

describe('Fleet Tools (real IndexRegistry data)', () => {
  let harness: TestHarness;

  beforeAll(async () => {
    // compare_sites uses resolveSite() against siteData, so we need sites there
    const siteData = createSiteData({
      'site-1': {
        id: 'site-1',
        name: 'Production Blog',
        path: '/tmp/nexus-test/prod',
        domain: 'prod.local',
      },
      'site-2': {
        id: 'site-2',
        name: 'Staging Site',
        path: '/tmp/nexus-test/staging',
        domain: 'staging.local',
      },
    });

    harness = await TestHarness.create({ skipServer: true, siteData });

    // Load pre-built registry entries with realistic structure data
    const entries = loadRegistryEntries('indexed-sites');
    for (const [siteId, entry] of Object.entries(entries)) {
      harness.indexRegistry.update(siteId, entry);
    }
  }, 60000);

  afterAll(async () => {
    await harness.cleanup();
  });

  test('fleet_summary aggregates version distribution', async () => {
    const result = await harness.callTool('fleet_summary', {});
    expectToolSuccess(result);
    const text = result.content[0].text;
    expect(text).toContain('WordPress');
    expect(text).toContain('PHP');
  });

  test('fleet_summary with no indexed sites shows helpful message', async () => {
    const emptyHarness = await TestHarness.create({ skipServer: true });
    const result = await emptyHarness.callTool('fleet_summary', {});
    expectToolSuccess(result);
    expect(result.content[0].text).toContain('0');
    await emptyHarness.cleanup();
  }, 60000);

  test('find_sites_with_plugin finds correct sites', async () => {
    const result = await harness.callTool('find_sites_with_plugin', {
      plugin: 'woocommerce',
    });
    expectToolSuccess(result);
    expect(result.content[0].text.toLowerCase()).toContain('woocommerce');
  });

  test('find_outdated_sites identifies version mismatches', async () => {
    const result = await harness.callTool('find_outdated_sites', {});
    expectToolSuccess(result);
  });

  test('compare_sites shows differences between two sites', async () => {
    const result = await harness.callTool('compare_sites', {
      site_a: 'site-1',
      site_b: 'site-2',
    });
    expectToolSuccess(result);
  });
});
