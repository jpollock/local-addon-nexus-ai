/**
 * Unit tests for nexus_fleet_plugins MCP tool
 */
import { fleetPluginsHandler } from '../../../src/main/mcp/modules/fleet-intelligence/fleet-plugins';
import type { NexusServices } from '../../../src/main/mcp/types';
import type { SiteDigitalTwin } from '../../../src/main/twin/SiteDigitalTwin';

function getText(result: any): string {
  return result.content[0].text;
}

function makeTwin(overrides: Partial<SiteDigitalTwin>): SiteDigitalTwin {
  return {
    siteId: 'site-1',
    siteName: 'my-site',
    domain: 'my-site.local',
    path: '/path/to/site',
    source: 'local',
    completeness: 'metadata',
    asOf: Date.now() - 1000,
    sources: {},
    ...overrides,
  };
}

function createMockServices(twins: SiteDigitalTwin[] = []): NexusServices {
  return {
    twinService: {
      getAll: jest.fn().mockReturnValue(twins),
    },
  } as any;
}

describe('nexus_fleet_plugins MCP tool', () => {
  test('returns error message when twinService is not available', async () => {
    const services = {} as any;
    const result = await fleetPluginsHandler.execute({}, services);
    expect(getText(result)).toContain('not available');
  });

  test('returns no sites message when fleet is empty', async () => {
    const services = createMockServices([]);
    const result = await fleetPluginsHandler.execute({}, services);
    expect(getText(result)).toContain('No sites found');
  });

  test('aggregates active plugin counts correctly', async () => {
    const twins = [
      makeTwin({
        siteId: 'site-1',
        siteName: 'site-one',
        plugins: [
          { name: 'woocommerce', title: 'WooCommerce', status: 'active' },
          { name: 'wordfence', title: 'Wordfence', status: 'inactive' },
        ],
      }),
      makeTwin({
        siteId: 'site-2',
        siteName: 'site-two',
        plugins: [
          { name: 'woocommerce', title: 'WooCommerce', status: 'active' },
          { name: 'wordfence', title: 'Wordfence', status: 'active' },
        ],
      }),
    ];
    const services = createMockServices(twins);
    const result = await fleetPluginsHandler.execute({}, services);
    const text = getText(result);
    // woocommerce active on 2, wordfence active on 1
    expect(text).toContain('woocommerce');
    expect(text).toContain('wordfence');
    // woocommerce should appear first (higher active count)
    const idxWoo = text.indexOf('woocommerce');
    const idxWF = text.indexOf('wordfence');
    expect(idxWoo).toBeLessThan(idxWF);
  });

  test('counts installedOnCount separately from activeOnCount', async () => {
    const twins = [
      makeTwin({
        siteId: 'site-1',
        siteName: 'site-one',
        plugins: [
          { name: 'hello-dolly', status: 'inactive' },
        ],
      }),
    ];
    const services = createMockServices(twins);
    const result = await fleetPluginsHandler.execute({}, services);
    const text = getText(result);
    // Should show hello-dolly with 0 active (filtered out by default min_sites=1)
    expect(text).toContain('No plugins found');
  });

  test('min_sites=0 shows inactive plugins too', async () => {
    const twins = [
      makeTwin({
        siteId: 'site-1',
        siteName: 'site-one',
        plugins: [
          { name: 'hello-dolly', status: 'inactive' },
        ],
      }),
    ];
    const services = createMockServices(twins);
    const result = await fleetPluginsHandler.execute({ min_sites: 0 }, services);
    const text = getText(result);
    expect(text).toContain('hello-dolly');
  });

  test('search filter works case-insensitively on slug', async () => {
    const twins = [
      makeTwin({
        siteId: 'site-1',
        siteName: 'site-one',
        plugins: [
          { name: 'woocommerce', title: 'WooCommerce', status: 'active' },
          { name: 'wordpress-seo', title: 'Yoast SEO', status: 'active' },
        ],
      }),
    ];
    const services = createMockServices(twins);
    const result = await fleetPluginsHandler.execute({ search: 'WOO' }, services);
    const text = getText(result);
    expect(text).toContain('woocommerce');
    expect(text).not.toContain('wordpress-seo');
  });

  test('search filter works on title', async () => {
    const twins = [
      makeTwin({
        siteId: 'site-1',
        siteName: 'site-one',
        plugins: [
          { name: 'woocommerce', title: 'WooCommerce', status: 'active' },
          { name: 'wordpress-seo', title: 'Yoast SEO', status: 'active' },
        ],
      }),
    ];
    const services = createMockServices(twins);
    const result = await fleetPluginsHandler.execute({ search: 'yoast' }, services);
    const text = getText(result);
    expect(text).toContain('Yoast SEO');
    expect(text).not.toContain('woocommerce');
  });

  test('min_sites filter excludes plugins below threshold', async () => {
    const twins = [
      makeTwin({
        siteId: 'site-1',
        siteName: 'site-one',
        plugins: [
          { name: 'woocommerce', status: 'active' },
          { name: 'wordfence', status: 'active' },
        ],
      }),
      makeTwin({
        siteId: 'site-2',
        siteName: 'site-two',
        plugins: [
          { name: 'woocommerce', status: 'active' },
        ],
      }),
    ];
    const services = createMockServices(twins);
    // Only show plugins active on 2+ sites
    const result = await fleetPluginsHandler.execute({ min_sites: 2 }, services);
    const text = getText(result);
    expect(text).toContain('woocommerce');
    expect(text).not.toContain('wordfence');
  });

  test('includes filesystem-only installed plugins', async () => {
    const twins = [
      makeTwin({
        siteId: 'site-1',
        siteName: 'site-one',
        completeness: 'filesystem',
        plugins: undefined,
        installedPlugins: ['my-custom-plugin', 'woocommerce'],
      }),
    ];
    const services = createMockServices(twins);
    // min_sites=0 to see all (installed but not active)
    const result = await fleetPluginsHandler.execute({ min_sites: 0 }, services);
    const text = getText(result);
    expect(text).toContain('my-custom-plugin');
    expect(text).toContain('woocommerce');
  });

  test('does not double-count plugins that appear in both plugins and installedPlugins', async () => {
    // When a site has both plugins[] and installedPlugins[], the plugins[] entry wins
    const twins = [
      makeTwin({
        siteId: 'site-1',
        siteName: 'site-one',
        plugins: [{ name: 'woocommerce', status: 'active' }],
        installedPlugins: ['woocommerce'],  // same slug in both
      }),
    ];
    const services = createMockServices(twins);
    const result = await fleetPluginsHandler.execute({ min_sites: 1 }, services);
    const text = getText(result);
    // Should appear once with activeOnCount=1, installedOnCount=1 (not 2)
    expect(text).toContain('woocommerce');
    // Verify only 1 plugin in the result
    expect(text).toContain('1 plugin found');
  });

  test('sorts plugins by activeOnCount descending', async () => {
    const twins = [
      makeTwin({
        siteId: 'site-1',
        siteName: 'site-one',
        plugins: [
          { name: 'plugin-a', status: 'active' },
          { name: 'plugin-b', status: 'active' },
        ],
      }),
      makeTwin({
        siteId: 'site-2',
        siteName: 'site-two',
        plugins: [
          { name: 'plugin-b', status: 'active' },
        ],
      }),
    ];
    const services = createMockServices(twins);
    const result = await fleetPluginsHandler.execute({}, services);
    const text = getText(result);
    // plugin-b (active on 2) should appear before plugin-a (active on 1)
    const idxA = text.indexOf('plugin-a');
    const idxB = text.indexOf('plugin-b');
    expect(idxB).toBeLessThan(idxA);
  });

  test('includes site names in output', async () => {
    const twins = [
      makeTwin({
        siteId: 'site-1',
        siteName: 'my-awesome-site',
        plugins: [{ name: 'woocommerce', status: 'active' }],
      }),
    ];
    const services = createMockServices(twins);
    const result = await fleetPluginsHandler.execute({}, services);
    const text = getText(result);
    expect(text).toContain('my-awesome-site');
  });
});
