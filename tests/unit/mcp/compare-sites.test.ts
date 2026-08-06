import { compareSitesHandler } from '../../../src/main/mcp/modules/fleet/compare-sites';

function makeServices(opts: {
  graphRows?: Array<{ id: string; name: string; source: string }>;
  entries?: Record<string, any>;
} = {}) {
  const { graphRows = [], entries = {} } = opts;
  const db = {
    prepare: (sql: string) => ({
      all: (name?: string) => {
        if (name) {
          return graphRows.filter((r) => r.name === name);
        }
        return graphRows;
      },
    }),
  };
  return {
    siteData: { getSite: jest.fn().mockReturnValue(null), getSites: jest.fn().mockReturnValue({}) },
    graphService: { getDb: jest.fn().mockReturnValue(db) },
    indexRegistry: { get: jest.fn((id: string) => entries[id] ?? null) },
  } as any;
}

describe('compare_sites — remote resolution', () => {
  it('resolves a WPE install name via the graph', async () => {
    const services = makeServices({
      graphRows: [
        { id: 'wpe-1', name: 'install-a', source: 'wpe' },
        { id: 'wpe-2', name: 'install-b', source: 'wpe' },
      ],
      entries: {
        'wpe-1': { siteName: 'install-a', structure: { wpVersion: '6.5', phpVersion: '8.2', plugins: [], themes: [] } },
        'wpe-2': { siteName: 'install-b', structure: { wpVersion: '6.5', phpVersion: '8.2', plugins: [], themes: [] } },
      },
    });

    const result = await compareSitesHandler.execute({ site_a: 'install-a', site_b: 'install-b' }, services);

    expect(result.isError).toBeUndefined();
  });

  it('resolves an external SSH host name via the graph', async () => {
    const services = makeServices({
      graphRows: [
        { id: 'ssh:prod-host', name: 'prod-host', source: 'external' },
        { id: 'ssh:stage-host', name: 'stage-host', source: 'external' },
      ],
      entries: {
        'ssh:prod-host': { siteName: 'prod-host', structure: { wpVersion: '6.5', phpVersion: '8.2', plugins: [], themes: [] } },
        'ssh:stage-host': { siteName: 'stage-host', structure: { wpVersion: '6.4', phpVersion: '8.1', plugins: [], themes: [] } },
      },
    });

    const result = await compareSitesHandler.execute({ site_a: 'prod-host', site_b: 'stage-host' }, services);

    expect(result.isError).toBeUndefined();
  });

  it('returns ambiguous error when name matches multiple sites across sources', async () => {
    const services = makeServices({
      graphRows: [
        { id: 'wpe-1', name: 'mysite', source: 'wpe' },
        { id: 'ssh:mysite', name: 'mysite', source: 'external' },
      ],
      entries: {},
    });

    const result = await compareSitesHandler.execute({ site_a: 'mysite', site_b: 'other' }, services);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('matches 2 sites across sources');
  });

  it('returns error when site not found', async () => {
    const services = makeServices();

    const result = await compareSitesHandler.execute({ site_a: 'nonexistent', site_b: 'also-missing' }, services);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('not found');
  });
});
