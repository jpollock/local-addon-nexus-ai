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
    testDbPath = path.join(__dirname, `test-host-refresh-${Date.now()}.db`);
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

  function ctx() {
    return {
      services: {
        graphService,
        logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
        siteData: {
          getSite: jest.fn().mockReturnValue(undefined),
          getSites: jest.fn().mockReturnValue({}),
        },
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
      id: 'ssh:myhost',
      name: 'myhost',
      source: 'external',
      host: 'external',
      domain: 'myhost',
      environment: 'production',
      is_active: true,
      created_at: Date.now(),
      updated_at: Date.now(),
    });

    mockResolveTransport.mockResolvedValue(makeRunner());

    const r = await (createResolvers(ctx()).Mutation as any).nexusHostRefresh(null, { alias: 'myhost' });
    expect(r.success).toBe(true);
    expect(r.wpVersion).toBe('6.8.0');
    expect(r.pluginCount).toBe(0);
    expect(r.themeCount).toBe(0);

    // resolveTransport must be called through the ssh: target form, not a raw
    // SSH invocation constructed here.
    expect(mockResolveTransport).toHaveBeenCalledWith(
      { ssh_target: 'ssh:myhost@production' },
      expect.anything(),
      'wpcli_read',
    );

    // The local graph actually got the write.
    const db = graphService.getDb()!;
    const row = db.prepare('SELECT wp_version FROM sites WHERE id=?').get('ssh:myhost') as any;
    expect(row.wp_version).toBe('6.8.0');
  });

  it('surfaces a permission refusal as an error rather than a silent success', async () => {
    await graphService.upsertSite({
      id: 'ssh:denied',
      name: 'denied',
      source: 'external',
      host: 'external',
      domain: 'denied',
      environment: 'production',
      is_active: true,
      created_at: Date.now(),
      updated_at: Date.now(),
    });

    mockResolveTransport.mockResolvedValue({
      content: [{ type: 'text', text: 'Operation blocked: not permitted on "production" environments.' }],
    });

    const r = await (createResolvers(ctx()).Mutation as any).nexusHostRefresh(null, { alias: 'denied' });
    expect(r.success).toBe(false);
    expect(r.error).toBeTruthy();
    expect(r.error).toMatch(/blocked/i);
  });
});
