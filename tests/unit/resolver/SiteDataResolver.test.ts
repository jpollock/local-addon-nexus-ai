import { SiteDataResolver } from '../../../src/main/resolver/SiteDataResolver';

function makeDeps(overrides: any = {}) {
  return {
    siteData: {
      getSites: () => ({
        'site-1': { id: 'site-1', name: 'acme', path: '/tmp/acme', phpVersion: '8.1' },
      }),
    },
    localServices: {
      getAllSiteStatuses: () => ({ 'site-1': 'halted' }),
      getPlugins: jest.fn(),
      wpCliRun: jest.fn(),
    },
    metadataCache: {
      get: (id: string) => id === 'site-1' ? {
        plugins: [{ name: 'elementor', title: 'Elementor', version: '3.21.0', status: 'active' }],
        wpVersion: '6.9.4',
        phpVersion: '8.1',
        lastUpdated: Date.now() - 3_600_000,
      } : null,
    },
    indexRegistry: { get: () => null },
    ...overrides,
  };
}

test('getPlugins returns configured level for halted site with cache', async () => {
  const resolver = new SiteDataResolver(makeDeps() as any);
  const result = await resolver.getPlugins('site-1');
  expect(result.provenance.level).toBe('configured');
  expect(result.data).toHaveLength(1);
  expect(result.data[0].slug).toBe('elementor');
  expect(result.data[0].version).toBe('3.21.0');
});

test('getPlugins returns empty array with scanned provenance when no data available', async () => {
  const deps = makeDeps({ metadataCache: { get: () => null } });
  const resolver = new SiteDataResolver(deps as any);
  const result = await resolver.getPlugins('site-1');
  expect(result.provenance.level).toBe('scanned');
  expect(result.data).toHaveLength(0);
  expect(result.provenance.caveat).toContain('Start site');
});

test('getPlugins falls back to IndexRegistry when cache is empty', async () => {
  const deps = makeDeps({
    metadataCache: { get: () => null },
    indexRegistry: {
      get: (id: string) => id === 'site-1' ? {
        lastIndexed: Date.now() - 86_400_000,
        structure: {
          plugins: [{ name: 'Elementor', slug: 'elementor', version: '3.20.0', isActive: true }],
        },
      } : null,
    },
  });
  const resolver = new SiteDataResolver(deps as any);
  const result = await resolver.getPlugins('site-1');
  expect(result.provenance.level).toBe('searchable');
  expect(result.data[0].slug).toBe('elementor');
});

test('getPhpVersion returns scanned level from Local site object', async () => {
  const resolver = new SiteDataResolver(makeDeps() as any);
  const result = await resolver.getPhpVersion('site-1');
  expect(result.provenance.level).toBe('scanned');
  expect(result.data).toBe('8.1');
  expect(result.provenance.ageSeconds).toBe(0);
  expect(result.provenance.caveat).toBeNull();
});

test('getPhpVersion falls back to cache when site object has no phpVersion', async () => {
  const deps = makeDeps({
    siteData: { getSites: () => ({ 'site-1': { id: 'site-1', name: 'acme', path: '/tmp/acme' } }) },
  });
  const resolver = new SiteDataResolver(deps as any);
  const result = await resolver.getPhpVersion('site-1');
  expect(result.provenance.level).toBe('configured');
  expect(result.data).toBe('8.1');
});

test('getWpVersion returns configured level from cache', async () => {
  const resolver = new SiteDataResolver(makeDeps() as any);
  const result = await resolver.getWpVersion('site-1');
  expect(result.provenance.level).toBe('configured');
  expect(result.data).toBe('6.9.4');
});

test('formatAge returns human-readable string', () => {
  const resolver = new SiteDataResolver(makeDeps() as any);
  expect(resolver.formatAge(0)).toBe('just now');
  expect(resolver.formatAge(90)).toBe('1m ago');
  expect(resolver.formatAge(7200)).toBe('2h ago');
  expect(resolver.formatAge(172800)).toBe('2d ago');
  expect(resolver.formatAge(null)).toBe('unknown age');
});
