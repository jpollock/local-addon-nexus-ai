import * as path from 'path';
import * as fs from 'fs';
import { GraphService } from '../../../src/main/events/GraphService';

// resolveTransport is exercised end-to-end elsewhere (transport tests); here we
// stub it so the resolver's own behavior — routing, error surfacing, and the
// indexOne call — is what's under test, with no real SSH involved.
const mockResolveTransport = jest.fn();
jest.mock('../../../src/main/transport', () => ({
  resolveTransport: (...args: unknown[]) => mockResolveTransport(...args),
}));

// ExternalContentIndexService itself is covered by its own unit tests
// (tests/unit/events/ExternalContentIndexService.test.ts). Here we only need
// to verify the resolver constructs it and relays its result.
const mockIndexOne = jest.fn();
jest.mock('../../../src/main/events/ExternalContentIndexService', () => ({
  ExternalContentIndexService: jest.fn().mockImplementation(() => ({
    indexOne: (...args: unknown[]) => mockIndexOne(...args),
  })),
}));

import { createResolvers } from '../../../src/main/graphql/resolvers';

describe('nexusHostIndex', () => {
  let graphService: GraphService;
  let testDbPath: string;

  beforeEach(async () => {
    testDbPath = path.join(__dirname, `test-host-index-${Date.now()}.db`);
    graphService = new GraphService(testDbPath);
    await graphService.initialize();
    mockResolveTransport.mockReset();
    mockIndexOne.mockReset();
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
        embeddingService: {},
        vectorStore: {},
        indexRegistry: {},
        logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
        siteData: {
          getSite: jest.fn().mockReturnValue(undefined),
          getSites: jest.fn().mockReturnValue({}),
        },
      },
      registry: {},
    } as any;
  }

  it('refuses an alias that is not a registered external host', async () => {
    const r = await (createResolvers(ctx()).Mutation as any).nexusHostIndex(null, { alias: 'nope' });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/not a registered external host/i);
    expect(mockResolveTransport).not.toHaveBeenCalled();
  });

  it('reports the document count on success', async () => {
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

    mockResolveTransport.mockResolvedValue({ siteRef: { kind: 'external', alias: 'myhost' } });
    mockIndexOne.mockResolvedValue({ documentCount: 7 });

    const r = await (createResolvers(ctx()).Mutation as any).nexusHostIndex(null, { alias: 'myhost' });
    expect(r.success).toBe(true);
    expect(typeof r.documentCount).toBe('number');
    expect(r.documentCount).toBe(7);

    // resolveTransport must be called through the ssh: target form, not a raw
    // SSH invocation constructed here.
    expect(mockResolveTransport).toHaveBeenCalledWith(
      { ssh_target: 'ssh:myhost@production' },
      expect.anything(),
      'wpcli_read',
    );

    // indexOne is invoked with the resolved transport, the graph site id, and the alias.
    expect(mockIndexOne).toHaveBeenCalledWith(
      { siteRef: { kind: 'external', alias: 'myhost' } },
      'ssh:myhost',
      'myhost',
    );

    // A manual index stamps the same staleness column the scheduler reads, so
    // the next scheduler cycle does not redundantly re-index this host. The
    // column is created here if the scheduler has never run in this process.
    const stamped = graphService.getDb()!
      .prepare('SELECT content_indexed_at FROM sites WHERE id = ?')
      .get('ssh:myhost') as { content_indexed_at: number | null };
    expect(stamped.content_indexed_at).toEqual(expect.any(Number));
    expect(stamped.content_indexed_at! > 0).toBe(true);
  });

  it('does not stamp content_indexed_at when the host could not be reached', async () => {
    await graphService.upsertSite({
      id: 'ssh:unreachable',
      name: 'unreachable',
      source: 'external',
      host: 'external',
      domain: 'unreachable',
      environment: 'production',
      is_active: true,
      created_at: Date.now(),
      updated_at: Date.now(),
    });

    mockResolveTransport.mockResolvedValue({
      content: [{ type: 'text', text: 'Could not reach host' }],
    });

    const r = await (createResolvers(ctx()).Mutation as any).nexusHostIndex(null, { alias: 'unreachable' });
    expect(r.success).toBe(false);

    // The column may not exist at all on this fresh db — either way, nothing
    // was stamped.
    const cols = graphService.getDb()!
      .prepare(`SELECT COUNT(*) as c FROM pragma_table_info('sites') WHERE name='content_indexed_at'`)
      .get() as { c: number };
    if (cols.c) {
      const row = graphService.getDb()!
        .prepare('SELECT content_indexed_at FROM sites WHERE id = ?')
        .get('ssh:unreachable') as { content_indexed_at: number | null };
      expect(row.content_indexed_at).toBeNull();
    }
  });

  it('surfaces a permission refusal as an error', async () => {
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

    const r = await (createResolvers(ctx()).Mutation as any).nexusHostIndex(null, { alias: 'denied' });
    expect(r.success).toBe(false);
    expect(r.error).toBeTruthy();
    expect(r.error).toMatch(/blocked/i);
    expect(mockIndexOne).not.toHaveBeenCalled();
  });
});
