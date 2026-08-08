import * as path from 'path';
import * as fs from 'fs';
import { GraphService } from '../../../src/main/events/GraphService';
import { createResolvers } from '../../../src/main/graphql/resolvers';

/**
 * Task 7's live check found that external content indexing wrote under the
 * vector store's colon-free id (`ssh_<alias>`) while every read path asked for
 * the raw `ssh:<alias>`, so indexed content could never be found. These tests
 * pin both halves of the fix on `nexus content search`'s own entrypoint:
 *
 *   1. the resolver resolves a WPE/external target at all (it was local-only), and
 *   2. it asks the vector store for the translated id.
 */
describe('nexusContentSearch — remote targets', () => {
  let graphService: GraphService;
  let testDbPath: string;
  let search: jest.Mock;

  beforeEach(async () => {
    testDbPath = path.join(__dirname, `test-content-search-${Date.now()}.db`);
    graphService = new GraphService(testDbPath);
    await graphService.initialize();
    search = jest.fn().mockResolvedValue([]);
  });

  afterEach(async () => {
    await graphService.close();
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  });

  function ctx() {
    return {
      services: {
        graphService,
        vectorStore: { search },
        embeddingService: { embed: jest.fn().mockResolvedValue(new Array(384).fill(0)) },
        indexRegistry: { get: jest.fn(), listAll: jest.fn().mockReturnValue([]) },
        logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
        siteData: {
          getSite: jest.fn().mockReturnValue(undefined),
          getSites: jest.fn().mockReturnValue({}),
        },
      },
      registry: {},
    } as any;
  }

  async function addHost(id: string, name: string, source: 'external' | 'wpe', isActive = true) {
    await graphService.upsertSite({
      id,
      name,
      source,
      host: source === 'external' ? 'external' : 'wpengine',
      domain: name,
      environment: 'production',
      is_active: isActive,
      created_at: Date.now(),
      updated_at: Date.now(),
    } as any);
  }

  it('resolves an external ssh: target and searches the translated vector id', async () => {
    await addHost('ssh:myhost', 'myhost', 'external');

    const r = await (createResolvers(ctx()).Mutation as any).nexusContentSearch(null, {
      target: 'ssh:myhost@production',
      query: 'about us',
    });

    expect(r.success).toBe(true);
    // vectorSiteId() appends a stable hash suffix at the vector-store boundary.
    expect(search).toHaveBeenCalledWith(
      expect.stringMatching(/^ssh_myhost_[0-9a-f]{8}$/),
      expect.any(Array),
      expect.any(Object),
    );
  });

  it('resolves a wpe: target and leaves its (colon-free) id untouched', async () => {
    await addHost('wpe-1234', 'myinstall', 'wpe');

    const r = await (createResolvers(ctx()).Mutation as any).nexusContentSearch(null, {
      target: 'wpe:acct/myinstall@production',
      query: 'pricing',
    });

    expect(r.success).toBe(true);
    // vectorSiteId() appends a stable hash suffix at the vector-store boundary.
    expect(search).toHaveBeenCalledWith(
      expect.stringMatching(/^wpe-1234_[0-9a-f]{8}$/),
      expect.any(Array),
      expect.any(Object),
    );
  });

  it('declines a name that matches more than one source rather than guessing', async () => {
    await addHost('ssh:collide', 'collide', 'external');
    await addHost('wpe-collide', 'collide', 'wpe');

    const r = await (createResolvers(ctx()).Mutation as any).nexusContentSearch(null, {
      target: 'ssh:collide@production',
      query: 'anything',
    });

    expect(r.success).toBe(false);
    expect(r.error).toMatch(/matches 2 sites/i);
    expect(search).not.toHaveBeenCalled();
  });

  it('does not resolve a soft-deleted host (nexus host remove sets is_active=0)', async () => {
    await addHost('ssh:gone', 'gone', 'external', false);

    const r = await (createResolvers(ctx()).Mutation as any).nexusContentSearch(null, {
      target: 'ssh:gone@production',
      query: 'anything',
    });

    expect(r.success).toBe(false);
    expect(r.error).toMatch(/not found/i);
    expect(search).not.toHaveBeenCalled();
  });
});
