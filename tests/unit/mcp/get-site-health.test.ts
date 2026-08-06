import { getSiteHealthHandler } from '../../../src/main/mcp/modules/fleet-intelligence/get-site-health';

function makeServices(opts: {
  localSite?: any;
  graphRow?: any;
  hasPlugins?: boolean;
  calculateScore?: jest.Mock;
} = {}) {
  const { localSite = null, graphRow = null, hasPlugins = false, calculateScore } = opts;
  const db = {
    prepare: jest.fn().mockImplementation((sql: string) => {
      if (sql.includes('FROM plugins')) {
        return { get: jest.fn().mockReturnValue({ c: hasPlugins ? 1 : 0 }) };
      }
      // `.all(name)` is the qualified WPE-target path (WHERE source=… AND
      // name=?); `.all(alias[, site])` is the external path, which routes
      // through findExternalSites and filters on `account_id` instead of
      // `name`. `.get(id)` is the raw-graph-id path. Honour whichever shape
      // is present so a qualified `ssh:` target cannot accidentally match a
      // `wpe` fixture row.
      return {
        get: jest.fn().mockReturnValue(graphRow),
        all: jest.fn().mockImplementation((...params: string[]) => {
          if (!graphRow) return [];
          if (sql.includes('account_id=?')) {
            const [alias, site] = params;
            if (graphRow.source !== 'external') return [];
            if ((graphRow.account_id ?? graphRow.name) !== alias) return [];
            if (site !== undefined && graphRow.name !== site) return [];
            return [graphRow];
          }
          const [name] = params;
          const sourceMatch = sql.match(/source\s*=\s*'(\w+)'/);
          if (sourceMatch && graphRow.source !== sourceMatch[1]) return [];
          return graphRow.name === name ? [graphRow] : [];
        }),
      };
    }),
  };
  return {
    siteData: { getSite: jest.fn().mockReturnValue(localSite) },
    graphService: { getDb: jest.fn().mockReturnValue(db) },
    healthCalculator: {
      calculateScore: calculateScore ?? jest.fn().mockResolvedValue({
        overall: 75,
        factors: { security: 80, performance: 70, maintenance: 0, activity: 0, stability: 0 },
        issues: [],
        recommendations: [],
      }),
    },
    indexRegistry: { get: jest.fn().mockReturnValue(null) },
  } as any;
}

function getText(result: any): string {
  return result.content[0].text;
}

describe('get_site_health — remote resolution', () => {
  it('scores an external host on security+performance only when it has plugin data and a php_version', async () => {
    const calculateScore = jest.fn().mockResolvedValue({
      overall: 75,
      factors: { security: 80, performance: 70, maintenance: 0, activity: 0, stability: 0 },
      issues: [],
      recommendations: [],
    });
    const services = makeServices({
      graphRow: { id: 'ssh:hostinger-test', name: 'hostinger-test', source: 'external', domain: 'example.com', php_version: '8.2', is_active: 1 },
      hasPlugins: true,
      calculateScore,
    });

    const result = await getSiteHealthHandler.execute({ site_id: 'ssh:hostinger-test' }, services);

    expect(calculateScore).toHaveBeenCalledWith('ssh:hostinger-test', expect.objectContaining({ phpVersion: '8.2' }), ['security', 'performance']);
    expect(getText(result)).not.toContain('Maintenance:');
  });

  it('reports "not enough data" for an unrefreshed external host, without calling calculateScore', async () => {
    const calculateScore = jest.fn();
    const services = makeServices({
      graphRow: { id: 'ssh:unrefreshed', name: 'unrefreshed', source: 'external', domain: '', php_version: null, is_active: 1 },
      hasPlugins: false,
      calculateScore,
    });

    const result = await getSiteHealthHandler.execute({ site_id: 'ssh:unrefreshed' }, services);

    expect(calculateScore).not.toHaveBeenCalled();
    expect(getText(result)).toMatch(/not enough data|no data/i);
  });

  it('scores a WPE install on security+performance', async () => {
    const calculateScore = jest.fn().mockResolvedValue({
      overall: 60,
      factors: { security: 50, performance: 70, maintenance: 0, activity: 0, stability: 0 },
      issues: [],
      recommendations: [],
    });
    const services = makeServices({
      graphRow: { id: 'wpe-abc', name: 'myinstall', source: 'wpe', domain: 'myinstall.wpengine.com', php_version: '8.1', is_active: 1 },
      calculateScore,
    });

    const result = await getSiteHealthHandler.execute({ site_id: 'wpe-abc' }, services);

    expect(calculateScore).toHaveBeenCalledWith('wpe-abc', expect.objectContaining({ phpVersion: '8.1' }), ['security', 'performance']);
  });

  it('still scores a local site on all five factors, unchanged', async () => {
    const calculateScore = jest.fn().mockResolvedValue({
      overall: 90,
      factors: { security: 90, performance: 90, maintenance: 90, activity: 90, stability: 90 },
      issues: [],
      recommendations: [],
    });
    const services = makeServices({
      localSite: { id: 'site-1', name: 'mysite', domain: 'mysite.local', phpVersion: '8.2' },
      calculateScore,
    });

    const result = await getSiteHealthHandler.execute({ site_id: 'site-1' }, services);

    expect(calculateScore).toHaveBeenCalledWith('site-1', expect.anything(), ['security', 'performance', 'maintenance', 'activity', 'stability']);
  });

  it('returns "not found" when neither local nor graph has the id', async () => {
    const services = makeServices({ localSite: null, graphRow: null });

    const result = await getSiteHealthHandler.execute({ site_id: 'nowhere' }, services);

    expect(getText(result)).toContain('not found');
  });
});

/**
 * Fix 3B — `nexus_list_sites` prints `— target: ssh:<alias>@production` and
 * tells the agent to reuse exactly that string, but get_site_health matched
 * `WHERE id = ?` against the raw argument, so the qualified form looked for a
 * row whose *id* was the whole target string and always came back not found.
 */
describe('get_site_health — qualified target strings', () => {
  const EXTERNAL_ROW = {
    id: 'ssh:hostinger-test',
    name: 'hostinger-test',
    source: 'external',
    domain: 'example.com',
    php_version: '8.2',
    is_active: 1,
  };
  const WPE_ROW = {
    id: 'wpe-abc',
    name: 'myinstall',
    source: 'wpe',
    domain: 'myinstall.wpengine.com',
    php_version: '8.1',
    is_active: 1,
  };

  function scoreMock() {
    return jest.fn().mockResolvedValue({
      overall: 75,
      factors: { security: 80, performance: 70, maintenance: 0, activity: 0, stability: 0 },
      issues: [],
      recommendations: [],
    });
  }

  it('resolves ssh:<alias>@production to the same result as the bare graph id', async () => {
    const qualifiedScore = scoreMock();
    const bareScore = scoreMock();

    const qualified = await getSiteHealthHandler.execute(
      { site_id: 'ssh:hostinger-test@production' },
      makeServices({ graphRow: EXTERNAL_ROW, hasPlugins: true, calculateScore: qualifiedScore }),
    );
    const bare = await getSiteHealthHandler.execute(
      { site_id: 'ssh:hostinger-test' },
      makeServices({ graphRow: EXTERNAL_ROW, hasPlugins: true, calculateScore: bareScore }),
    );

    expect(getText(qualified)).not.toContain('not found');
    expect(getText(qualified)).toBe(getText(bare));

    // Critically: the score is computed against the REAL graph id, never the
    // qualified target string.
    expect(qualifiedScore).toHaveBeenCalledWith(
      'ssh:hostinger-test',
      expect.objectContaining({ phpVersion: '8.2' }),
      ['security', 'performance'],
    );
  });

  it('keys the index-registry lookup off the resolved id, not the qualified target', async () => {
    const services = makeServices({ graphRow: EXTERNAL_ROW, hasPlugins: true, calculateScore: scoreMock() });

    await getSiteHealthHandler.execute({ site_id: 'ssh:hostinger-test@production' }, services);

    expect(services.indexRegistry.get).toHaveBeenCalledWith('ssh:hostinger-test');
    expect(services.indexRegistry.get).not.toHaveBeenCalledWith('ssh:hostinger-test@production');
  });

  it('resolves wpe:<account>/<install>@<env> to the same result as the bare install id', async () => {
    const qualifiedScore = scoreMock();

    const qualified = await getSiteHealthHandler.execute(
      { site_id: 'wpe:acct/myinstall@production' },
      makeServices({ graphRow: WPE_ROW, calculateScore: qualifiedScore }),
    );
    const bare = await getSiteHealthHandler.execute(
      { site_id: 'wpe-abc' },
      makeServices({ graphRow: WPE_ROW, calculateScore: scoreMock() }),
    );

    expect(getText(qualified)).not.toContain('not found');
    expect(getText(qualified)).toBe(getText(bare));
    expect(qualifiedScore).toHaveBeenCalledWith('wpe-abc', expect.anything(), ['security', 'performance']);
  });

  it('returns "not found" — not a thrown exception — for an unknown qualified target', async () => {
    const services = makeServices({ graphRow: EXTERNAL_ROW, hasPlugins: true });

    const result = await getSiteHealthHandler.execute({ site_id: 'ssh:doesnotexist@production' }, services);

    expect(getText(result)).toContain('not found');
  });

  it('does not let an ssh: target match a WPE row of the same name', async () => {
    const services = makeServices({ graphRow: WPE_ROW, calculateScore: scoreMock() });

    const result = await getSiteHealthHandler.execute({ site_id: 'ssh:myinstall@production' }, services);

    expect(getText(result)).toContain('not found');
  });
});
