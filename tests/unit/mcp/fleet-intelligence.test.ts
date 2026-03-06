/**
 * Unit tests for fleet intelligence MCP tools
 */
import { fleetHealthSummaryHandler } from '../../../src/main/mcp/modules/fleet-intelligence/fleet-health-summary';
import { getSiteHealthHandler } from '../../../src/main/mcp/modules/fleet-intelligence/get-site-health';
import { fleetSearchHandler } from '../../../src/main/mcp/modules/fleet-intelligence/fleet-search';
import { fleetFilterHandler } from '../../../src/main/mcp/modules/fleet-intelligence/fleet-filter';
import { bulkReindexHandler } from '../../../src/main/mcp/modules/fleet-intelligence/bulk-reindex';
import { bulkPluginUpdateHandler } from '../../../src/main/mcp/modules/fleet-intelligence/bulk-plugin-update';
import { listSiteGroupsHandler } from '../../../src/main/mcp/modules/fleet-intelligence/list-site-groups';
import { manageSiteGroupHandler } from '../../../src/main/mcp/modules/fleet-intelligence/manage-site-group';
import type { NexusServices } from '../../../src/main/mcp/types';

function getText(result: any): string {
  return result.content[0].text;
}

function createMockServices(overrides: Partial<NexusServices> = {}): NexusServices {
  return {
    vectorStore: {} as any,
    embeddingService: {} as any,
    contentPipeline: {} as any,
    indexRegistry: {
      listAll: jest.fn().mockReturnValue([]),
    } as any,
    fileScanner: {} as any,
    siteData: {
      getSite: jest.fn().mockReturnValue(null),
      getSites: jest.fn().mockReturnValue({}),
    },
    logger: { info: jest.fn(), error: jest.fn() },
    ...overrides,
  } as any;
}

describe('fleet-health-summary', () => {
  test('returns unavailable when no healthCalculator', async () => {
    const services = createMockServices();
    const result = await fleetHealthSummaryHandler.execute({}, services);
    expect(getText(result)).toContain('not available');
  });

  test('returns no sites when none indexed', async () => {
    const services = createMockServices({
      healthCalculator: { calculateAllScores: jest.fn() },
      indexRegistry: { listAll: jest.fn().mockReturnValue([]) } as any,
    });
    const result = await fleetHealthSummaryHandler.execute({}, services);
    expect(getText(result)).toContain('No indexed sites');
  });

  test('returns fleet health summary with scores', async () => {
    const services = createMockServices({
      healthCalculator: {
        calculateAllScores: jest.fn().mockResolvedValue({ 'site-1': 85, 'site-2': 45 }),
      },
      indexRegistry: {
        listAll: jest.fn().mockReturnValue([
          { siteId: 'site-1', siteName: 'Site One', state: 'indexed' },
          { siteId: 'site-2', siteName: 'Site Two', state: 'indexed' },
        ]),
      } as any,
      siteData: {
        getSite: jest.fn(),
        getSites: jest.fn().mockReturnValue({
          'site-1': { id: 'site-1', name: 'Site One', path: '/a', domain: 'one.local' },
          'site-2': { id: 'site-2', name: 'Site Two', path: '/b', domain: 'two.local' },
        }),
      },
    });

    const result = await fleetHealthSummaryHandler.execute({}, services);
    const text = getText(result);
    expect(text).toContain('Fleet Health Summary');
    expect(text).toContain('Site One');
    expect(text).toContain('85/100');
    expect(text).toContain('45/100');
    expect(text).toContain('1 healthy');
    expect(text).toContain('1 critical');
  });

  test('has correct definition', () => {
    expect(fleetHealthSummaryHandler.definition.name).toBe('fleet_health_summary');
    expect(fleetHealthSummaryHandler.definition.annotations).toEqual({ title: 'Fleet Health Summary', readOnlyHint: true });
  });
});

describe('get-site-health', () => {
  test('returns unavailable when no healthCalculator', async () => {
    const services = createMockServices();
    const result = await getSiteHealthHandler.execute({ site_id: 'x' }, services);
    expect(getText(result)).toContain('not available');
  });

  test('returns not found for unknown site', async () => {
    const services = createMockServices({
      healthCalculator: { calculateScore: jest.fn() },
    });
    const result = await getSiteHealthHandler.execute({ site_id: 'unknown' }, services);
    expect(getText(result)).toContain('Site not found');
  });

  test('returns detailed health breakdown', async () => {
    const breakdown = {
      overall: 72,
      factors: { security: 80, performance: 70, maintenance: 60, activity: 75, stability: 90 },
      issues: ['Plugin X outdated'],
      recommendations: ['Update Plugin X'],
    };
    const services = createMockServices({
      healthCalculator: { calculateScore: jest.fn().mockResolvedValue(breakdown) },
      siteData: {
        getSite: jest.fn().mockReturnValue({ id: 's1', name: 'My Site', path: '/p', domain: 'my.local' }),
        getSites: jest.fn().mockReturnValue({}),
      },
    });

    const result = await getSiteHealthHandler.execute({ site_id: 's1' }, services);
    const text = getText(result);
    expect(text).toContain('Health Report: My Site');
    expect(text).toContain('72/100');
    expect(text).toContain('Security: 80/100');
    expect(text).toContain('Plugin X outdated');
    expect(text).toContain('Update Plugin X');
  });
});

describe('fleet-search', () => {
  test('returns unavailable when no searchService', async () => {
    const services = createMockServices();
    const result = await fleetSearchHandler.execute({ query: 'test' }, services);
    expect(getText(result)).toContain('not available');
  });

  test('returns no results message', async () => {
    const services = createMockServices({
      searchService: { searchFleet: jest.fn().mockResolvedValue({ total: 0, results: [] }) },
    });
    const result = await fleetSearchHandler.execute({ query: 'nothing' }, services);
    expect(getText(result)).toContain('No results found');
  });

  test('returns search results formatted', async () => {
    const services = createMockServices({
      searchService: {
        searchFleet: jest.fn().mockResolvedValue({
          total: 1,
          results: [{ title: 'Hello World', type: 'post', siteName: 'Blog', score: 0.95, excerpt: 'A post about hello world.' }],
        }),
      },
    });

    const result = await fleetSearchHandler.execute({ query: 'hello' }, services);
    const text = getText(result);
    expect(text).toContain('Search Results');
    expect(text).toContain('Hello World');
    expect(text).toContain('95%');
    expect(text).toContain('Blog');
  });

  test('passes options correctly to searchFleet', async () => {
    const searchFleet = jest.fn().mockResolvedValue({ total: 0, results: [] });
    const services = createMockServices({ searchService: { searchFleet } });

    await fleetSearchHandler.execute({
      query: 'test',
      content_types: ['post', 'plugin'],
      site_ids: ['s1'],
      limit: 5,
    }, services);

    expect(searchFleet).toHaveBeenCalledWith(
      'test',
      { contentTypes: ['post', 'plugin'], siteIds: ['s1'] },
      { limit: 5 },
    );
  });
});

describe('fleet-filter', () => {
  test('returns unavailable when no filterEngine', async () => {
    const services = createMockServices();
    const result = await fleetFilterHandler.execute({ filter_id: 'no-ssl' }, services);
    expect(getText(result)).toContain('not available');
  });

  test('returns all clear when no matches', async () => {
    const services = createMockServices({
      filterEngine: { applyFilter: jest.fn().mockResolvedValue([]) },
    });
    const result = await fleetFilterHandler.execute({ filter_id: 'no-ssl' }, services);
    expect(getText(result)).toContain('All clear');
  });

  test('returns matched sites', async () => {
    const services = createMockServices({
      filterEngine: { applyFilter: jest.fn().mockResolvedValue(['s1', 's2']) },
      siteData: {
        getSite: jest.fn(),
        getSites: jest.fn().mockReturnValue({
          's1': { id: 's1', name: 'Alpha', path: '/a' },
          's2': { id: 's2', name: 'Beta', path: '/b' },
        }),
      },
    });

    const result = await fleetFilterHandler.execute({ filter_id: 'outdated-php' }, services);
    const text = getText(result);
    expect(text).toContain('2 site(s) matched');
    expect(text).toContain('Alpha');
    expect(text).toContain('Beta');
  });

  test('handles filter error gracefully', async () => {
    const services = createMockServices({
      filterEngine: { applyFilter: jest.fn().mockRejectedValue(new Error('boom')) },
    });
    const result = await fleetFilterHandler.execute({ filter_id: 'bad' }, services);
    expect(getText(result)).toContain('failed');
    expect(getText(result)).toContain('boom');
  });
});

describe('bulk-reindex', () => {
  test('returns unavailable when no bulkOpManager', async () => {
    const services = createMockServices();
    const result = await bulkReindexHandler.execute({ site_ids: ['s1'] }, services);
    expect(getText(result)).toContain('not available');
  });

  test('returns error when no site IDs', async () => {
    const services = createMockServices({ bulkOpManager: { execute: jest.fn() } });
    const result = await bulkReindexHandler.execute({ site_ids: [] }, services);
    expect(getText(result)).toContain('No site IDs');
  });

  test('starts bulk reindex and returns op ID', async () => {
    const services = createMockServices({
      bulkOpManager: { execute: jest.fn().mockResolvedValue('op-123') },
    });

    const result = await bulkReindexHandler.execute({ site_ids: ['s1', 's2'] }, services);
    const text = getText(result);
    expect(text).toContain('op-123');
    expect(text).toContain('2 site(s)');
    expect(services.bulkOpManager!.execute).toHaveBeenCalledWith({
      type: 'reindex',
      siteIds: ['s1', 's2'],
    });
  });
});

describe('bulk-plugin-update', () => {
  test('returns unavailable when no bulkOpManager', async () => {
    const services = createMockServices();
    const result = await bulkPluginUpdateHandler.execute({ site_ids: ['s1'], plugin_slug: 'akismet' }, services);
    expect(getText(result)).toContain('not available');
  });

  test('returns error when no plugin slug', async () => {
    const services = createMockServices({ bulkOpManager: { execute: jest.fn() } });
    const result = await bulkPluginUpdateHandler.execute({ site_ids: ['s1'], plugin_slug: '' }, services);
    expect(getText(result)).toContain('No plugin slug');
  });

  test('starts bulk plugin update', async () => {
    const services = createMockServices({
      bulkOpManager: { execute: jest.fn().mockResolvedValue('op-456') },
    });

    const result = await bulkPluginUpdateHandler.execute({
      site_ids: ['s1'],
      plugin_slug: 'akismet',
    }, services);
    const text = getText(result);
    expect(text).toContain('op-456');
    expect(text).toContain('akismet');
  });
});

describe('list-site-groups', () => {
  test('returns unavailable when no localServices', async () => {
    const services = createMockServices();
    const result = await listSiteGroupsHandler.execute({}, services);
    expect(getText(result)).toContain('not available');
  });

  test('returns empty message when no groups', async () => {
    const services = createMockServices({
      localServices: { getSiteGroups: jest.fn().mockReturnValue([]) } as any,
    });
    const result = await listSiteGroupsHandler.execute({}, services);
    expect(getText(result)).toContain('No site groups');
  });

  test('returns formatted group list', async () => {
    const services = createMockServices({
      localServices: {
        getSiteGroups: jest.fn().mockReturnValue([
          { id: 'default', name: 'Sites', siteIds: ['s1'], index: 0 },
          { id: 'g2', name: 'Staging', siteIds: ['s1', 's2'], index: 1 },
        ]),
      } as any,
      siteData: {
        getSite: jest.fn(),
        getSites: jest.fn().mockReturnValue({
          's1': { id: 's1', name: 'Alpha', path: '/a' },
          's2': { id: 's2', name: 'Beta', path: '/b' },
        }),
      },
    });

    const result = await listSiteGroupsHandler.execute({}, services);
    const text = getText(result);
    expect(text).toContain('Sites');
    expect(text).toContain('Staging');
    expect(text).toContain('Alpha');
  });
});

describe('manage-site-group', () => {
  test('returns unavailable when no localServices', async () => {
    const services = createMockServices();
    const result = await manageSiteGroupHandler.execute({ action: 'create' }, services);
    expect(getText(result)).toContain('not available');
  });

  test('creates a group', async () => {
    const services = createMockServices({
      localServices: {
        getSiteGroups: jest.fn(),
        createSiteGroup: jest.fn().mockReturnValue({ id: 'g1', name: 'Test Group', siteIds: [], index: 2 }),
      } as any,
    });

    const result = await manageSiteGroupHandler.execute({
      action: 'create',
      name: 'Test Group',
    }, services);
    expect(getText(result)).toContain('Test Group');
    expect(getText(result)).toContain('created');
  });

  test('requires name for create', async () => {
    const services = createMockServices({
      localServices: { getSiteGroups: jest.fn() } as any,
    });
    const result = await manageSiteGroupHandler.execute({ action: 'create' }, services);
    expect(getText(result)).toContain('Name is required');
  });

  test('renames a group', async () => {
    const services = createMockServices({
      localServices: {
        getSiteGroups: jest.fn(),
        renameSiteGroup: jest.fn().mockReturnValue({ id: 'g1', name: 'Updated', siteIds: [], index: 0 }),
      } as any,
    });
    const result = await manageSiteGroupHandler.execute({
      action: 'rename',
      group_id: 'g1',
      name: 'Updated',
    }, services);
    expect(getText(result)).toContain('renamed');
  });

  test('deletes a group', async () => {
    const services = createMockServices({
      localServices: {
        getSiteGroups: jest.fn(),
        deleteSiteGroup: jest.fn(),
      } as any,
    });
    const result = await manageSiteGroupHandler.execute({ action: 'delete', group_id: 'g1' }, services);
    expect(getText(result)).toContain('deleted');
  });

  test('adds a site to group', async () => {
    const services = createMockServices({
      localServices: {
        getSiteGroups: jest.fn(),
        moveSitesToGroup: jest.fn(),
      } as any,
    });
    const result = await manageSiteGroupHandler.execute({
      action: 'add_site',
      group_id: 'g1',
      site_id: 's1',
    }, services);
    expect(getText(result)).toContain('moved');
  });

  test('removes a site from group', async () => {
    const services = createMockServices({
      localServices: {
        getSiteGroups: jest.fn(),
        removeSitesFromGroups: jest.fn(),
      } as any,
    });
    const result = await manageSiteGroupHandler.execute({
      action: 'remove_site',
      site_id: 's1',
    }, services);
    expect(getText(result)).toContain('removed');
  });

  test('handles unknown action', async () => {
    const services = createMockServices({
      localServices: { getSiteGroups: jest.fn() } as any,
    });
    const result = await manageSiteGroupHandler.execute({ action: 'unknown' }, services);
    expect(getText(result)).toContain('Unknown action');
  });
});
