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

  // External rows are stored the way `nexus host add` writes them: id is the
  // unique `ssh:<alias>/<site>` (externalSiteId), `name` is the SITE name, and
  // `account_id` links the row back to its connection alias. The resolver
  // resolves a target through findExternalSites (by account_id), exactly as
  // resolveTransport does — never by treating the alias as a graph `name`.
  async function addHost(
    id: string,
    name: string,
    source: 'external' | 'wpe',
    isActive = true,
    accountId?: string,
  ) {
    await graphService.upsertSite({
      id,
      name,
      source,
      host: source === 'external' ? 'external' : 'wpengine',
      domain: name,
      account_id: accountId,
      environment: 'production',
      is_active: isActive,
      created_at: Date.now(),
      updated_at: Date.now(),
    } as any);
  }

  it('resolves an external ssh: target and searches the translated vector id', async () => {
    // A connection with exactly one site: the bare `ssh:<alias>@env` form resolves.
    await addHost('ssh:myhost/main', 'main', 'external', true, 'myhost');

    const r = await (createResolvers(ctx()).Mutation as any).nexusContentSearch(null, {
      target: 'ssh:myhost@production',
      query: 'about us',
    });

    expect(r.success).toBe(true);
    // vectorSiteId() sanitizes `ssh:myhost/main` -> `ssh_myhost_main` and appends
    // a stable hash suffix at the vector-store boundary.
    expect(search).toHaveBeenCalledWith(
      expect.stringMatching(/^ssh_myhost_main_[0-9a-f]{8}$/),
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
    // WPE ids contain no invalid character, so vectorSiteId() is identity — no hash suffix.
    expect(search).toHaveBeenCalledWith(
      'wpe-1234',
      expect.any(Array),
      expect.any(Object),
    );
  });

  it('declines a bare alias whose connection has more than one site rather than guessing', async () => {
    // A single connection ("collide") hosting two WordPress installs. The bare
    // `ssh:collide@production` form is ambiguous — it must decline and name the
    // qualified forms, not pick one. A same-named WPE install is a DIFFERENT
    // namespace and must not be conflated (the old alias-as-name lookup did).
    await addHost('ssh:collide/one', 'one', 'external', true, 'collide');
    await addHost('ssh:collide/two', 'two', 'external', true, 'collide');
    await addHost('wpe-collide', 'collide', 'wpe');

    const r = await (createResolvers(ctx()).Mutation as any).nexusContentSearch(null, {
      target: 'ssh:collide@production',
      query: 'anything',
    });

    expect(r.success).toBe(false);
    expect(r.error).toMatch(/2 registered sites/i);
    expect(r.error).toContain('ssh:collide/one@production');
    expect(r.error).toContain('ssh:collide/two@production');
    expect(search).not.toHaveBeenCalled();
  });

  it('does not resolve a soft-deleted host (nexus host remove sets is_active=0)', async () => {
    await addHost('ssh:gone/main', 'main', 'external', false, 'gone');

    const r = await (createResolvers(ctx()).Mutation as any).nexusContentSearch(null, {
      target: 'ssh:gone@production',
      query: 'anything',
    });

    expect(r.success).toBe(false);
    expect(r.error).toMatch(/not found/i);
    expect(search).not.toHaveBeenCalled();
  });
});
