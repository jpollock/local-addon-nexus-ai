import * as path from 'path';
import * as fs from 'fs';
import { GraphService } from '../../../src/main/events/GraphService';
import { createResolvers } from '../../../src/main/graphql/resolvers';

describe('nexusSitesGet — external target resolves by connection+site', () => {
  let graphService: GraphService;
  let testDbPath: string;

  beforeEach(async () => {
    testDbPath = path.join(__dirname, `test-sites-get-${Date.now()}-${Math.random()}.db`);
    graphService = new GraphService(testDbPath);
    await graphService.initialize();
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
        indexRegistry: {
          get: jest.fn().mockReturnValue(null),
          listAll: jest.fn().mockReturnValue([]),
        },
        logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
        siteData: {
          getSite: jest.fn().mockReturnValue(undefined),
          getSites: jest.fn().mockReturnValue({}),
        },
      },
      registry: {},
    } as any;
  }

  async function seedSite(alias: string, siteName: string, env = 'production') {
    const now = Date.now();
    await graphService.upsertSite({
      id: `ssh:${alias}/${siteName}`,
      name: siteName,
      source: 'external',
      host: 'external',
      domain: `${siteName}.example.com`,
      account_id: alias,
      environment: env,
      is_active: true,
      created_at: now,
      updated_at: now,
    } as any);
  }

  it('resolves ssh:<alias>/<site>@<env>', async () => {
    await seedSite('hostinger-test', 'site-a');
    await seedSite('hostinger-test', 'site-b');

    const result = await createResolvers(ctx()).Mutation.nexusSitesGet(
      null, { target: 'ssh:hostinger-test/site-a@production' },
    );
    expect(result.success).toBe(true);
    expect(result.site.id).toBe('ssh:hostinger-test/site-a');
  });

  it('bare shorthand resolves when the connection has exactly one site', async () => {
    await seedSite('solo-host', 'solo-host');

    const result = await createResolvers(ctx()).Mutation.nexusSitesGet(
      null, { target: 'ssh:solo-host@production' },
    );
    expect(result.success).toBe(true);
  });

  it('bare shorthand against a multi-site connection fails with a clear disambiguation message', async () => {
    await seedSite('hostinger-test', 'site-a');
    await seedSite('hostinger-test', 'site-b');

    const result = await createResolvers(ctx()).Mutation.nexusSitesGet(
      null, { target: 'ssh:hostinger-test@production' },
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/site-a/);
    expect(result.error).toMatch(/site-b/);
  });

  it('returns a not-found error for an unregistered connection', async () => {
    const result = await createResolvers(ctx()).Mutation.nexusSitesGet(
      null, { target: 'ssh:nope@production' },
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not found/i);
  });

  it('returns a scoped not-found error when the site is missing under a known connection', async () => {
    await seedSite('hostinger-test', 'site-a');

    const result = await createResolvers(ctx()).Mutation.nexusSitesGet(
      null, { target: 'ssh:hostinger-test/site-missing@production' },
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/site-missing/);
    expect(result.error).toMatch(/hostinger-test/);
  });
});
