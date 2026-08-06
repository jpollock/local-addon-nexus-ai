import { resolveAnySite, findExternalSites } from '../../../src/main/mcp/site-resolver';

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
        // The qualified-target query pins a source in the SQL text; the
        // bare-name query does not. Honour whichever clause is present so a
        // `ssh:` target cannot match a `wpe` row and vice versa.
        prepare: (sql: string) => ({
          all: (name: string) => {
            const sourceMatch = sql.match(/source = '(\w+)'/);
            return rows.filter(
              (r) => r.name === name && (!sourceMatch || r.source === sourceMatch[1]),
            );
          },
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

  /**
   * Fix 3A — nexus_list_sites prints `— target: ssh:<alias>@production` and
   * instructs the agent to reuse that exact string, but resolveRemoteGraphSite
   * matched on the bare `name` column only, so compare_sites, detect_drift and
   * get_all_site_documents all rejected the tool's own printed target.
   */
  describe('qualified target strings', () => {
    it('resolves ssh:<alias>@production identically to the bare alias', () => {
      const siteData = makeSiteData([]);
      const graphService = makeGraphService([
        { id: 'ssh:hostinger-test', name: 'hostinger-test', source: 'external' },
      ]);

      const qualified = resolveAnySite('ssh:hostinger-test@production', siteData, graphService);
      const bare = resolveAnySite('hostinger-test', siteData, graphService);

      expect(qualified).toEqual({ kind: 'ok', id: 'ssh:hostinger-test', name: 'hostinger-test', source: 'external' });
      expect(qualified).toEqual(bare);
    });

    it.each(['production', 'staging', 'development'])(
      'accepts the @%s environment suffix',
      (env) => {
        const siteData = makeSiteData([]);
        const graphService = makeGraphService([
          { id: 'ssh:hostinger-test', name: 'hostinger-test', source: 'external' },
        ]);

        expect(resolveAnySite(`ssh:hostinger-test@${env}`, siteData, graphService)).toEqual({
          kind: 'ok', id: 'ssh:hostinger-test', name: 'hostinger-test', source: 'external',
        });
      },
    );

    it('resolves wpe:<account>/<install>@<env> identically to the bare install name', () => {
      const siteData = makeSiteData([]);
      const graphService = makeGraphService([{ id: 'wpe-abc', name: 'myinstall', source: 'wpe' }]);

      const qualified = resolveAnySite('wpe:myaccount/myinstall@production', siteData, graphService);
      const bare = resolveAnySite('myinstall', siteData, graphService);

      expect(qualified).toEqual({ kind: 'ok', id: 'wpe-abc', name: 'myinstall', source: 'wpe' });
      expect(qualified).toEqual(bare);
    });

    it('does NOT decline a qualified target that collides by name across sources', () => {
      // The `ssh:` prefix already disambiguated — declining here would be
      // refusing to answer a question the caller answered.
      const siteData = makeSiteData([]);
      const graphService = makeGraphService([
        { id: 'wpe-1', name: 'dupe', source: 'wpe' },
        { id: 'ssh:dupe', name: 'dupe', source: 'external' },
      ]);

      expect(resolveAnySite('dupe', siteData, graphService).kind).toBe('ambiguous');
      expect(resolveAnySite('ssh:dupe@production', siteData, graphService)).toEqual({
        kind: 'ok', id: 'ssh:dupe', name: 'dupe', source: 'external',
      });
      expect(resolveAnySite('wpe:acct/dupe@production', siteData, graphService)).toEqual({
        kind: 'ok', id: 'wpe-1', name: 'dupe', source: 'wpe',
      });
    });

    it('returns none (not a throw) for an unknown qualified target', () => {
      const siteData = makeSiteData([]);
      const graphService = makeGraphService([
        { id: 'ssh:hostinger-test', name: 'hostinger-test', source: 'external' },
      ]);

      expect(resolveAnySite('ssh:doesnotexist@production', siteData, graphService)).toEqual({ kind: 'none' });
      expect(resolveAnySite('wpe:acct/doesnotexist@production', siteData, graphService)).toEqual({ kind: 'none' });
    });

    it('returns none (not a throw) for a malformed qualified target', () => {
      const siteData = makeSiteData([]);
      const graphService = makeGraphService([
        { id: 'ssh:hostinger-test', name: 'hostinger-test', source: 'external' },
      ]);

      // `ssh:` with no environment suffix is unparseable; it must not throw and
      // must not resolve to the alias by accident.
      expect(resolveAnySite('ssh:hostinger-test', siteData, graphService)).toEqual({ kind: 'none' });
      expect(resolveAnySite('ssh:hostinger-test@nonsense', siteData, graphService)).toEqual({ kind: 'none' });
    });

    it('never falls through to the local store for a qualified remote target', () => {
      // A local site literally named `ssh:x@production` cannot exist, but the
      // fall-through would also let a qualified miss silently match a local
      // site by domain. Pin that it does not happen.
      const siteData = makeSiteData([{ id: 'site-1', name: 'hostinger-test', domain: 'hostinger-test' }]);
      const graphService = makeGraphService([]);

      expect(resolveAnySite('ssh:hostinger-test@production', siteData, graphService)).toEqual({ kind: 'none' });
      // The bare name still resolves locally, unchanged.
      expect(resolveAnySite('hostinger-test', siteData, graphService)).toEqual({
        kind: 'ok', id: 'site-1', name: 'hostinger-test', source: 'local',
      });
    });

    it('resolves <name>@local like the bare name', () => {
      const siteData = makeSiteData([{ id: 'site-1', name: 'mysite', domain: 'mysite.local' }]);
      const graphService = makeGraphService([]);

      expect(resolveAnySite('mysite@local', siteData, graphService)).toEqual({
        kind: 'ok', id: 'site-1', name: 'mysite', source: 'local',
      });
    });
  });
});

describe('findExternalSites', () => {
  function makeDb(rows: Array<{ id: string; name: string; account_id: string; is_active: number }>) {
    return {
      prepare: (sql: string) => ({
        all: (...params: any[]) => {
          if (sql.includes('AND name=?')) {
            const [alias, site] = params;
            return rows.filter((r) => r.account_id === alias && r.name === site && r.is_active === 1);
          }
          const [alias] = params;
          return rows.filter((r) => r.account_id === alias && r.is_active === 1);
        },
      }),
    };
  }

  it('returns every active site under a connection when no site is given', () => {
    const db = makeDb([
      { id: 'ssh:hostinger-test/site-a', name: 'site-a', account_id: 'hostinger-test', is_active: 1 },
      { id: 'ssh:hostinger-test/site-b', name: 'site-b', account_id: 'hostinger-test', is_active: 1 },
      { id: 'ssh:other/site-c', name: 'site-c', account_id: 'other', is_active: 1 },
    ]);
    const rows = findExternalSites(db, 'hostinger-test');
    expect(rows.map((r: any) => r.name).sort()).toEqual(['site-a', 'site-b']);
  });

  it('scopes to exactly one site when given', () => {
    const db = makeDb([
      { id: 'ssh:hostinger-test/site-a', name: 'site-a', account_id: 'hostinger-test', is_active: 1 },
      { id: 'ssh:hostinger-test/site-b', name: 'site-b', account_id: 'hostinger-test', is_active: 1 },
    ]);
    const rows = findExternalSites(db, 'hostinger-test', 'site-a');
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('site-a');
  });

  it('returns empty for a connection with zero registered sites', () => {
    const db = makeDb([]);
    expect(findExternalSites(db, 'unregistered')).toEqual([]);
  });

  it('returns empty rather than throwing when db is unavailable', () => {
    expect(findExternalSites(undefined, 'hostinger-test')).toEqual([]);
    expect(findExternalSites(null, 'hostinger-test')).toEqual([]);
  });

  it('excludes a soft-deleted site (is_active=0)', () => {
    const db = makeDb([
      { id: 'ssh:hostinger-test/gone', name: 'gone', account_id: 'hostinger-test', is_active: 0 },
    ]);
    expect(findExternalSites(db, 'hostinger-test')).toEqual([]);
  });
});
