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
