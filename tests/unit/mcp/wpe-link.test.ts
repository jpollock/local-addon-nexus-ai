// tests/unit/mcp/wpe-link.test.ts
//
// Reproduced live: a local site named "NitroPack Production", genuinely connected via Local's
// own Pull-to-Local UI to the WPE PRODUCTION install "nitropack3", was reported by this tool as
// linked to "nitropackstg" (STAGING) instead. Root cause: `remoteSiteId` in hostConnections is a
// WPE *Site* UUID, not an install UUID — nitropack3/nitropackstg/nitropackdxdev (production,
// staging, development) all share one wpe_site_id in a real fleet's graph.db, and the old query
// (`WHERE wpe_site_id = ? LIMIT 1`, no environment filter) returned whichever sibling SQLite
// handed back first. The raw connection object already carries `remoteSiteEnv: "production"` —
// it was simply never read. Every downstream consumer of this resolution (log-based checks,
// push/pull target confirmation) was silently pointed at the wrong environment.

import { wpeLinkHandler } from '../../../src/main/mcp/modules/wpe/wpe-link';

function makeDb(rows: Array<{ name: string; wpe_site_id: string; environment: string; remote_install_id?: string }>) {
  return {
    prepare: (sql: string) => ({
      get: (...params: string[]) => {
        if (sql.includes('AND environment = ?')) {
          const [siteId, env] = params;
          return rows.find((r) => r.wpe_site_id === siteId && r.environment === env);
        }
        if (sql.includes('wpe_site_id = ?')) {
          const [siteId] = params;
          // Mirror SQLite's undefined tie-break: first matching row in table order.
          return rows.find((r) => r.wpe_site_id === siteId);
        }
        if (sql.includes('remote_install_id = ?')) {
          const [installId] = params;
          return rows.find((r) => r.remote_install_id === installId);
        }
        return undefined;
      },
    }),
  };
}

function makeServices(hostConnections: any[], db: ReturnType<typeof makeDb>) {
  const site = { id: 'site-1', name: 'NitroPack Production', path: '/x', domain: 'nitropack.local' };
  return {
    siteData: {
      getSite: (id: string) => (id === 'site-1' ? site : null),
      getSites: () => ({ 'site-1': site }),
    },
    localServices: {
      resolveSiteObject: () => ({ hostConnections }),
    },
    graphService: { getDb: () => db },
  } as any;
}

describe('local_wpe_link', () => {
  it('REGRESSION: resolves to the production sibling when three environments share one wpe_site_id', async () => {
    // Exact shape measured live: nitropackstg (staging), nitropack3 (production) and
    // nitropackdxdev (development) all under wpe_site_id 319c7bbd-....
    const db = makeDb([
      { name: 'nitropackstg', wpe_site_id: 'site-uuid-1', environment: 'staging' },
      { name: 'nitropack3', wpe_site_id: 'site-uuid-1', environment: 'production' },
      { name: 'nitropackdxdev', wpe_site_id: 'site-uuid-1', environment: 'development' },
    ]);
    const connections = [{
      hostId: 'wpe', accountId: 'a', userId: 'u',
      remoteSiteId: 'site-uuid-1', remoteSiteEnv: 'production',
    }];
    const services = makeServices(connections, db);

    const result = await wpeLinkHandler.execute({ site: 'NitroPack Production' }, services);
    const text = (result.content[0] as any).text;

    expect(text).toContain('nitropack3');
    expect(text).not.toContain('nitropackstg');
  });

  it('resolves to staging when remoteSiteEnv says staging, same sibling set', async () => {
    const db = makeDb([
      { name: 'nitropackstg', wpe_site_id: 'site-uuid-1', environment: 'staging' },
      { name: 'nitropack3', wpe_site_id: 'site-uuid-1', environment: 'production' },
    ]);
    const connections = [{ remoteSiteId: 'site-uuid-1', remoteSiteEnv: 'staging' }];
    const services = makeServices(connections, db);

    const result = await wpeLinkHandler.execute({ site: 'NitroPack Production' }, services);
    const text = (result.content[0] as any).text;

    expect(text).toContain('nitropackstg');
    expect(text).not.toContain('nitropack3');
  });

  it('falls back to the ambiguous lookup when remoteSiteEnv is absent, rather than returning nothing', async () => {
    const db = makeDb([
      { name: 'nitropack3', wpe_site_id: 'site-uuid-1', environment: 'production' },
    ]);
    const connections = [{ remoteSiteId: 'site-uuid-1' }]; // no remoteSiteEnv
    const services = makeServices(connections, db);

    const result = await wpeLinkHandler.execute({ site: 'NitroPack Production' }, services);
    const text = (result.content[0] as any).text;

    expect(text).toContain('nitropack3');
  });

  it('prefers an explicit installName over any UUID resolution', async () => {
    const db = makeDb([
      { name: 'nitropackstg', wpe_site_id: 'site-uuid-1', environment: 'staging' },
    ]);
    const connections = [{ installName: 'nitropack3', remoteSiteId: 'site-uuid-1', remoteSiteEnv: 'staging' }];
    const services = makeServices(connections, db);

    const result = await wpeLinkHandler.execute({ site: 'NitroPack Production' }, services);
    const text = (result.content[0] as any).text;

    expect(text).toContain('nitropack3');
  });

  it('reports no link when hostConnections is empty', async () => {
    const services = makeServices([], makeDb([]));
    const result = await wpeLinkHandler.execute({ site: 'NitroPack Production' }, services);
    const text = (result.content[0] as any).text;
    expect(text).toContain('not linked');
  });
});
