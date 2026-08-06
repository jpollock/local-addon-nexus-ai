import { detectDriftHandler } from '../../../src/main/mcp/modules/fleet/detect-drift';

function makeServices(opts: {
  graphRows?: Array<{ id: string; name: string; source: string }>;
  entries?: Record<string, any>;
} = {}) {
  const { graphRows = [], entries = {} } = opts;
  const db = {
    prepare: (sql: string) => ({
      all: (name?: string) => {
        if (name) {
          // The qualified-target query pins a source in the SQL text; the
          // bare-name query does not. Honour whichever clause is present.
          const sourceMatch = sql.match(/source = '(\w+)'/);
          return graphRows.filter(
            (r) => r.name === name && (!sourceMatch || r.source === sourceMatch[1]),
          );
        }
        return graphRows;
      },
    }),
  };
  return {
    siteData: { getSite: jest.fn().mockReturnValue(null), getSites: jest.fn().mockReturnValue({}) },
    graphService: { getDb: jest.fn().mockReturnValue(db) },
    indexRegistry: {
      get: jest.fn((id: string) => entries[id] ?? null),
      listAll: jest.fn(() => Object.entries(entries).map(([siteId, entry]) => ({ ...entry, siteId }))),
    },
  } as any;
}

describe('detect_drift — remote resolution', () => {
  it('resolves WPE baseline site via the graph', async () => {
    const services = makeServices({
      graphRows: [{ id: 'wpe-1', name: 'prod-install', source: 'wpe' }],
      entries: {
        'wpe-1': {
          siteName: 'prod-install',
          siteId: 'wpe-1',
          structure: { wpVersion: '6.5', phpVersion: '8.2', plugins: [], themes: [] },
        },
      },
    });

    const result = await detectDriftHandler.execute({ baseline_site: 'prod-install' }, services);

    expect(result.isError).toBeUndefined();
  });

  it('resolves external host baseline site via the graph', async () => {
    const services = makeServices({
      graphRows: [{ id: 'ssh:prod-host', name: 'prod-host', source: 'external' }],
      entries: {
        'ssh:prod-host': {
          siteName: 'prod-host',
          siteId: 'ssh:prod-host',
          structure: { wpVersion: '6.5', phpVersion: '8.2', plugins: [], themes: [] },
        },
      },
    });

    const result = await detectDriftHandler.execute({ baseline_site: 'prod-host' }, services);

    expect(result.isError).toBeUndefined();
  });

  it('resolves specific compare sites from the graph', async () => {
    const services = makeServices({
      graphRows: [
        { id: 'wpe-1', name: 'prod-install', source: 'wpe' },
        { id: 'wpe-2', name: 'staging-install', source: 'wpe' },
        { id: 'ssh:prod-host', name: 'prod-host', source: 'external' },
      ],
      entries: {
        'wpe-1': {
          siteName: 'prod-install',
          siteId: 'wpe-1',
          structure: { wpVersion: '6.5', phpVersion: '8.2', plugins: [], themes: [] },
        },
        'wpe-2': {
          siteName: 'staging-install',
          siteId: 'wpe-2',
          structure: { wpVersion: '6.5', phpVersion: '8.2', plugins: [], themes: [] },
        },
        'ssh:prod-host': {
          siteName: 'prod-host',
          siteId: 'ssh:prod-host',
          structure: { wpVersion: '6.4', phpVersion: '8.1', plugins: [], themes: [] },
        },
      },
    });

    const result = await detectDriftHandler.execute(
      { baseline_site: 'prod-install', compare_sites: ['staging-install', 'prod-host'] },
      services
    );

    expect(result.isError).toBeUndefined();
  });

  it('returns ambiguous error when baseline name matches multiple sites', async () => {
    const services = makeServices({
      graphRows: [
        { id: 'wpe-1', name: 'mysite', source: 'wpe' },
        { id: 'ssh:mysite', name: 'mysite', source: 'external' },
      ],
      entries: {},
    });

    const result = await detectDriftHandler.execute({ baseline_site: 'mysite' }, services);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('matches 2 sites across sources');
  });

  it('returns error when baseline site not found', async () => {
    const services = makeServices();

    const result = await detectDriftHandler.execute({ baseline_site: 'nonexistent' }, services);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('not found');
  });
});

/**
 * Fix 3 — detect_drift rejected the qualified target string that
 * nexus_list_sites tells the agent to use.
 */
describe('detect_drift — qualified target strings', () => {
  const ROWS = [{ id: 'ssh:hostinger-test', name: 'hostinger-test', source: 'external' }];
  const ENTRIES = {
    'ssh:hostinger-test': {
      siteName: 'hostinger-test',
      siteId: 'ssh:hostinger-test',
      structure: { wpVersion: '6.5', phpVersion: '8.2', plugins: [], themes: [] },
    },
  };

  it('accepts ssh:<alias>@production and produces the same report as the bare alias', async () => {
    const qualified = await detectDriftHandler.execute(
      { baseline_site: 'ssh:hostinger-test@production' },
      makeServices({ graphRows: ROWS, entries: ENTRIES }),
    );
    const bare = await detectDriftHandler.execute(
      { baseline_site: 'hostinger-test' },
      makeServices({ graphRows: ROWS, entries: ENTRIES }),
    );

    expect(qualified.isError).toBeUndefined();
    expect(qualified.content[0].text).toBe(bare.content[0].text);
  });

  it('errors cleanly (no throw) on an unknown qualified target', async () => {
    const result = await detectDriftHandler.execute(
      { baseline_site: 'ssh:doesnotexist@production' },
      makeServices({ graphRows: ROWS, entries: ENTRIES }),
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('not found');
  });
});
