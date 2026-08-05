import { resolveAnySite } from '../../../src/main/mcp/site-resolver';

describe('resolveAnySite', () => {
  function makeSiteData(sites: Array<{ id: string; name: string; domain?: string }>) {
    return {
      getSite: (id: string) => sites.find((s) => s.id === id) ?? null,
      getSites: () => Object.fromEntries(sites.map((s) => [s.id, s])),
    } as any;
  }

  function makeGraphService(rows: Array<{ id: string; name: string; source: string }>) {
    return {
      getDb: () => ({
        prepare: () => ({
          all: (name: string) => rows.filter((r) => r.name === name),
        }),
      }),
    } as any;
  }

  it('resolves a local site first, without touching the graph', () => {
    const siteData = makeSiteData([{ id: 'site-1', name: 'mysite', domain: 'mysite.local' }]);
    const graphService = makeGraphService([{ id: 'ssh:mysite', name: 'mysite', source: 'external' }]);

    const result = resolveAnySite('mysite', siteData, graphService);

    expect(result).toEqual({ kind: 'ok', id: 'site-1', name: 'mysite', source: 'local' });
  });

  it('falls back to the graph (external) when no local site matches', () => {
    const siteData = makeSiteData([]);
    const graphService = makeGraphService([{ id: 'ssh:hostinger-test', name: 'hostinger-test', source: 'external' }]);

    const result = resolveAnySite('hostinger-test', siteData, graphService);

    expect(result).toEqual({ kind: 'ok', id: 'ssh:hostinger-test', name: 'hostinger-test', source: 'external' });
  });

  it('falls back to the graph (wpe) when no local site matches', () => {
    const siteData = makeSiteData([]);
    const graphService = makeGraphService([{ id: 'wpe-abc', name: 'myinstall', source: 'wpe' }]);

    const result = resolveAnySite('myinstall', siteData, graphService);

    expect(result).toEqual({ kind: 'ok', id: 'wpe-abc', name: 'myinstall', source: 'wpe' });
  });

  it('declines with disambiguated forms on a cross-source name collision', () => {
    const siteData = makeSiteData([]);
    const graphService = makeGraphService([
      { id: 'wpe-abc', name: 'dupe', source: 'wpe' },
      { id: 'ssh:dupe', name: 'dupe', source: 'external' },
    ]);

    const result = resolveAnySite('dupe', siteData, graphService);

    expect(result.kind).toBe('ambiguous');
    if (result.kind === 'ambiguous') {
      expect(result.matches).toEqual(expect.arrayContaining(['ssh:dupe', 'wpe:<account>/dupe']));
    }
  });

  it('returns none when nothing matches anywhere', () => {
    const siteData = makeSiteData([]);
    const graphService = makeGraphService([]);

    const result = resolveAnySite('nowhere', siteData, graphService);

    expect(result).toEqual({ kind: 'none' });
  });

  it('returns none (not a crash) when graphService is undefined', () => {
    const siteData = makeSiteData([]);

    const result = resolveAnySite('anything', siteData, undefined);

    expect(result).toEqual({ kind: 'none' });
  });
});
