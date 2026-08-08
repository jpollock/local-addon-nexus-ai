import * as path from 'path';
import * as fs from 'fs';
import { GraphService } from '../../../src/main/events/GraphService';

// resolveTransport is exercised end-to-end elsewhere (transport tests); here we
// stub it so the resolver's own behavior — routing, error surfacing, and the
// collect+write call — is what's under test, with no real SSH involved.
const mockResolveTransport = jest.fn();
jest.mock('../../../src/main/transport', () => ({
  resolveTransport: (...args: unknown[]) => mockResolveTransport(...args),
}));

import { createResolvers } from '../../../src/main/graphql/resolvers';

describe('nexusHostRefresh', () => {
  let graphService: GraphService;
  let testDbPath: string;

  beforeEach(async () => {
    testDbPath = path.join(__dirname, `test-host-refresh-${Date.now()}-${Math.random()}.db`);
    graphService = new GraphService(testDbPath);
    await graphService.initialize();
    mockResolveTransport.mockReset();
  });

  afterEach(async () => {
    await graphService.close();
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  function ctx(overrides: { operationAuditLog?: { log: jest.Mock } } = {}) {
    return {
      services: {
        graphService,
        logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
        siteData: {
          getSite: jest.fn().mockReturnValue(undefined),
          getSites: jest.fn().mockReturnValue({}),
        },
        ...overrides,
      },
      registry: {},
    } as any;
  }

  /** A BatchRunner double that answers the four batches collectExternalHostData issues. */
  function makeRunner() {
    let call = 0;
    return {
      siteRef: { kind: 'external', alias: 'myhost' },
      runWpCliBatch: jest.fn(async (commands: string[][]) => {
        call += 1;
        if (call === 1) {
          // Batch A: scalars. Only core version is asserted on below.
          return commands.map(() => null).map((_, i) => (i === 0 ? '6.8.0' : null));
        }
        if (call === 2) return [JSON.stringify([])]; // plugins
        if (call === 3) return [JSON.stringify([])]; // themes
        return commands.map(() => null); // counts
      }),
    };
  }

  it('refuses an alias that is not a registered external host', async () => {
    const r = await (createResolvers(ctx()).Mutation as any).nexusHostRefresh(null, { alias: 'nope' });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/not a registered external host/i);
    expect(mockResolveTransport).not.toHaveBeenCalled();
  });

  it('reports what it collected on success', async () => {
    await graphService.upsertSite({
      id: 'ssh:myhost/myhost',
      name: 'myhost',
      source: 'external',
      host: 'external',
      domain: 'myhost',
      account_id: 'myhost',
      environment: 'production',
      is_active: true,
      created_at: Date.now(),
      updated_at: Date.now(),
    } as any);

    mockResolveTransport.mockResolvedValue(makeRunner());

    const r = await (createResolvers(ctx()).Mutation as any).nexusHostRefresh(null, { alias: 'myhost' });
    expect(r.success).toBe(true);
    expect(r.results).toHaveLength(1);
    expect(r.results[0].site).toBe('myhost');
    expect(r.results[0].wpVersion).toBe('6.8.0');
    expect(r.results[0].pluginCount).toBe(0);
    expect(r.results[0].themeCount).toBe(0);

    // resolveTransport must be called through the ssh: target form, not a raw
    // SSH invocation constructed here.
    expect(mockResolveTransport).toHaveBeenCalledWith(
      { ssh_target: 'ssh:myhost/myhost@production' },
      expect.anything(),
      'wpcli_read',
    );

    // The local graph actually got the write.
    const db = graphService.getDb()!;
    const row = db.prepare('SELECT wp_version FROM sites WHERE id=?').get('ssh:myhost/myhost') as any;
    expect(row.wp_version).toBe('6.8.0');
  });

  it('surfaces a permission refusal as an error rather than a silent success', async () => {
    await graphService.upsertSite({
      id: 'ssh:denied/denied',
      name: 'denied',
      source: 'external',
      host: 'external',
      domain: 'denied',
      account_id: 'denied',
      environment: 'production',
      is_active: true,
      created_at: Date.now(),
      updated_at: Date.now(),
    } as any);

    mockResolveTransport.mockResolvedValue({
      content: [{ type: 'text', text: 'Operation blocked: not permitted on "production" environments.' }],
    });

    const r = await (createResolvers(ctx()).Mutation as any).nexusHostRefresh(null, { alias: 'denied' });
    expect(r.success).toBe(true); // the connection resolved; the one site under it failed
    expect(r.results).toHaveLength(1);
    expect(r.results[0].success).toBe(false);
    expect(r.results[0].error).toBeTruthy();
    expect(r.results[0].error).toMatch(/blocked/i);
  });

  describe('nexusHostRefresh — operates on every site under the connection', () => {
    async function seedTwoSites(alias: string) {
      const now = Date.now();
      await graphService.upsertSite({
        id: `ssh:${alias}/site-a`,
        name: 'site-a',
        source: 'external',
        host: 'external',
        domain: 'site-a.example.com',
        account_id: alias,
        environment: 'production',
        is_active: true,
        created_at: now,
        updated_at: now,
      } as any);
      await graphService.upsertSite({
        id: `ssh:${alias}/site-b`,
        name: 'site-b',
        source: 'external',
        host: 'external',
        domain: 'site-b.example.com',
        account_id: alias,
        environment: 'production',
        is_active: true,
        created_at: now,
        updated_at: now,
      } as any);
    }

    it('refreshes every site when given a bare alias', async () => {
      await seedTwoSites('hostinger-test');
      mockResolveTransport.mockResolvedValue(makeRunner());

      const result = await (createResolvers(ctx()).Mutation as any).nexusHostRefresh(null, { alias: 'hostinger-test' });
      expect(result.success).toBe(true);
      expect(result.results).toHaveLength(2);
      const sites = result.results.map((r: any) => r.site).sort();
      expect(sites).toEqual(['site-a', 'site-b']);
    });

    it('scopes to one site when given alias/site', async () => {
      await seedTwoSites('hostinger-test');
      mockResolveTransport.mockResolvedValue(makeRunner());

      const result = await (createResolvers(ctx()).Mutation as any).nexusHostRefresh(null, { alias: 'hostinger-test/site-a' });
      expect(result.results).toHaveLength(1);
      expect(result.results[0].site).toBe('site-a');
    });

    it('one site failing does not prevent the others from refreshing', async () => {
      await seedTwoSites('hostinger-test');
      mockResolveTransport.mockImplementation(async ({ ssh_target }: { ssh_target: string }) => {
        if (ssh_target.includes('/site-a@')) {
          return { content: [{ type: 'text', text: 'Could not reach host' }] };
        }
        return makeRunner();
      });

      const result = await (createResolvers(ctx()).Mutation as any).nexusHostRefresh(null, { alias: 'hostinger-test' });
      expect(result.success).toBe(true);
      expect(result.results).toHaveLength(2);
      const siteA = result.results.find((r: any) => r.site === 'site-a');
      const siteB = result.results.find((r: any) => r.site === 'site-b');
      expect(siteA.success).toBe(false);
      expect(siteB.success).toBe(true);
    });

    it('a connection with zero sites reports a clear top-level error, not an empty results list', async () => {
      const result = await (createResolvers(ctx()).Mutation as any).nexusHostRefresh(null, { alias: 'empty-conn' });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/no registered sites/i);
      expect(result.results).toEqual([]);
    });
  });

  it('audits the operation on both success and failure', async () => {
    const auditMock = jest.fn();
    const c = ctx({ operationAuditLog: { log: auditMock } });

    // Failure path: alias is not a registered external host.
    await (createResolvers(c).Mutation as any).nexusHostRefresh(null, { alias: 'nope' });
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'external.host.refresh',
      outcome: 'failure',
    }));
    auditMock.mockClear();

    // Success path.
    await graphService.upsertSite({
      id: 'ssh:myhost/myhost',
      name: 'myhost',
      source: 'external',
      host: 'external',
      domain: 'myhost',
      account_id: 'myhost',
      environment: 'production',
      is_active: true,
      created_at: Date.now(),
      updated_at: Date.now(),
    } as any);
    mockResolveTransport.mockResolvedValue(makeRunner());

    await (createResolvers(c).Mutation as any).nexusHostRefresh(null, { alias: 'myhost' });
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'external.host.refresh',
      outcome: 'success',
    }));
  });

  it('serializes concurrent calls through the same queue every other host resolver uses', async () => {
    // withQueue is imported from resolver-utils and used by every sibling host
    // resolver (nexusHostProbe, nexusHostAdd, nexusHostRemove); this resolver's
    // body must run inside it too. We don't re-verify withQueue's own
    // serialization semantics here (covered elsewhere) -- just that calling
    // the resolver twice concurrently still resolves both without throwing,
    // exercising the withQueue wrapping added around the resolver body.
    mockResolveTransport.mockResolvedValue(makeRunner());
    await graphService.upsertSite({
      id: 'ssh:myhost/myhost',
      name: 'myhost',
      source: 'external',
      host: 'external',
      domain: 'myhost',
      account_id: 'myhost',
      environment: 'production',
      is_active: true,
      created_at: Date.now(),
      updated_at: Date.now(),
    } as any);

    const c = ctx();
    const resolver = (createResolvers(c).Mutation as any).nexusHostRefresh;
    const [r1, r2] = await Promise.all([
      resolver(null, { alias: 'myhost' }),
      resolver(null, { alias: 'myhost' }),
    ]);
    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);
  });
});
