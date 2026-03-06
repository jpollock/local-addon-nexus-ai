/**
 * Unit tests for FilterEngine
 */
import { FilterEngine } from '../../../src/main/search/FilterEngine';
import type { SmartFilter } from '../../../src/main/search/FilterEngine';

describe('FilterEngine', () => {
  let filterEngine: FilterEngine;
  let mockGraphService: any;
  let mockIndexRegistry: any;
  let mockSiteDataBridge: any;

  beforeEach(() => {
    mockGraphService = {
      getRecentEvents: jest.fn().mockResolvedValue([]),
      listPlugins: jest.fn().mockResolvedValue([]),
      listSites: jest.fn().mockResolvedValue([]),
    };

    mockIndexRegistry = {
      get: jest.fn().mockReturnValue(undefined),
      listAll: jest.fn().mockReturnValue([]),
    };

    mockSiteDataBridge = {
      getSites: jest.fn().mockReturnValue({
        'site-1': { id: 'site-1', name: 'Site 1', domain: 'https://site1.local', phpVersion: '8.2', path: '/path/1' },
        'site-2': { id: 'site-2', name: 'Site 2', domain: 'http://site2.local', phpVersion: '7.4', path: '/path/2' },
        'site-3': { id: 'site-3', name: 'Site 3', domain: 'https://site3.local', phpVersion: '7.2', path: '/path/3' },
      }),
    };

    filterEngine = new FilterEngine({
      graphService: mockGraphService,
      indexRegistry: mockIndexRegistry,
      siteDataBridge: mockSiteDataBridge,
    });
  });

  test('getFilterCounts returns array of SmartFilter objects', async () => {
    const filters = await filterEngine.getFilterCounts();

    expect(Array.isArray(filters)).toBe(true);
    expect(filters.length).toBe(8);

    for (const filter of filters) {
      expect(filter).toHaveProperty('id');
      expect(filter).toHaveProperty('category');
      expect(filter).toHaveProperty('label');
      expect(filter).toHaveProperty('description');
      expect(filter).toHaveProperty('count');
      expect(filter).toHaveProperty('severity');
      expect(['security', 'maintenance', 'activity', 'health']).toContain(filter.category);
      expect(['info', 'warning', 'error']).toContain(filter.severity);
      expect(typeof filter.count).toBe('number');
    }
  });

  test('filterOutdatedPHP returns sites with PHP < 8.0', async () => {
    const siteIds = await filterEngine.applyFilter('outdated-php');

    expect(siteIds).toContain('site-2'); // PHP 7.4
    expect(siteIds).toContain('site-3'); // PHP 7.2
    expect(siteIds).not.toContain('site-1'); // PHP 8.2
    expect(siteIds.length).toBe(2);
  });

  test('filterNoSSL returns sites without https domain', async () => {
    const siteIds = await filterEngine.applyFilter('no-ssl');

    expect(siteIds).toContain('site-2'); // http://site2.local
    expect(siteIds).not.toContain('site-1'); // https://site1.local
    expect(siteIds).not.toContain('site-3'); // https://site3.local
    expect(siteIds.length).toBe(1);
  });

  test('filterNotIndexed returns unindexed sites', async () => {
    // By default, mockIndexRegistry.get returns undefined for all sites
    const siteIds = await filterEngine.applyFilter('not-indexed');

    expect(siteIds.length).toBe(3);
    expect(siteIds).toContain('site-1');
    expect(siteIds).toContain('site-2');
    expect(siteIds).toContain('site-3');

    // Now mark site-1 as recently indexed
    mockIndexRegistry.get.mockImplementation((siteId: string) => {
      if (siteId === 'site-1') {
        return { siteId: 'site-1', lastIndexed: Date.now() };
      }
      return undefined;
    });

    const siteIds2 = await filterEngine.applyFilter('not-indexed');
    expect(siteIds2.length).toBe(2);
    expect(siteIds2).not.toContain('site-1');
  });

  test('filterNoEvents returns sites with no recent events', async () => {
    // Default mock returns empty events for all sites
    const siteIds = await filterEngine.applyFilter('no-events');

    expect(siteIds.length).toBe(3);
    expect(mockGraphService.getRecentEvents).toHaveBeenCalledTimes(3);

    // Now give site-1 some events
    mockGraphService.getRecentEvents.mockImplementation(async (opts: any) => {
      if (opts.siteId === 'site-1') {
        return [{ type: 'plugin_update', timestamp: Date.now() }];
      }
      return [];
    });

    const siteIds2 = await filterEngine.applyFilter('no-events');
    expect(siteIds2.length).toBe(2);
    expect(siteIds2).not.toContain('site-1');
  });

  test('applyFilter throws error for unknown filter ID', async () => {
    await expect(filterEngine.applyFilter('nonexistent-filter'))
      .rejects
      .toThrow('Unknown filter ID: nonexistent-filter');
  });

  test('applyFilter returns correct sites for outdated-php', async () => {
    // Override with different PHP versions
    mockSiteDataBridge.getSites.mockReturnValue({
      'site-a': { id: 'site-a', name: 'Site A', domain: 'https://a.local', phpVersion: '8.1', path: '/a' },
      'site-b': { id: 'site-b', name: 'Site B', domain: 'https://b.local', phpVersion: '7.4', path: '/b' },
      'site-c': { id: 'site-c', name: 'Site C', domain: 'https://c.local', phpVersion: '8.0', path: '/c' },
    });

    const siteIds = await filterEngine.applyFilter('outdated-php');

    expect(siteIds).toEqual(['site-b']); // Only 7.4 is < 8.0; 8.0 is not < 8.0
  });

  test('handles errors gracefully when site check fails', async () => {
    // Make getSites return a site, but graphService throws for it
    mockGraphService.getRecentEvents.mockRejectedValue(new Error('Connection failed'));

    // Should not throw - should skip the failed site
    const siteIds = await filterEngine.applyFilter('no-events');

    // All sites should be skipped (error caught), so empty result
    expect(Array.isArray(siteIds)).toBe(true);
    expect(siteIds.length).toBe(0);

    // getFilterCounts should also not throw
    const filters = await filterEngine.getFilterCounts();
    expect(Array.isArray(filters)).toBe(true);
    expect(filters.length).toBe(8);
  });
});
