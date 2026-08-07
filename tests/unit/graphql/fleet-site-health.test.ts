/**
 * `nexusFleetSiteHealth`'s external branch, after Task 12's fix.
 *
 * Task 5 changed `externalSiteId` to a two-argument (alias, site) function and
 * changed the graph model so a connection alias can hold multiple sites, each
 * keyed by `account_id = alias, name = site`. The health lookup still called
 * the old one-argument `externalSiteId(alias)` and matched rows by `id = ? OR
 * LOWER(name) = ?` — this both failed to compile and, even patched to compile,
 * could not disambiguate two sites sharing a connection. It now delegates to
 * `findExternalSites` (Task 3), which resolves via `account_id`/`name` and
 * supports an explicit `ssh:<alias>/<site>@<env>` segment.
 */

import * as fs from 'fs';
import * as path from 'path';
import { createResolvers } from '../../../src/main/graphql/resolvers';
import { GraphService } from '../../../src/main/events/GraphService';

describe('nexusFleetSiteHealth — external lookup by connection+site', () => {
  let graphService: GraphService;
  let testDbPath: string;

  beforeEach(async () => {
    testDbPath = path.join(__dirname, `test-fleet-site-health-${Date.now()}-${Math.random()}.db`);
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
        logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
        siteData: {
          getSite: jest.fn().mockReturnValue(undefined),
          getSites: jest.fn().mockReturnValue({}),
        },
        healthCalculator: {
          calculateScore: jest.fn().mockResolvedValue({
            overall: 82,
            factors: { security: 85, performance: 79 },
            factorsEvaluated: ['security', 'performance'],
            issues: [],
            issuesByCategory: [],
            recommendations: [],
          }),
        },
      },
      registry: {},
    } as any;
  }

  async function seedSite(id: string, name: string, accountId: string, extra: Record<string, unknown> = {}) {
    await graphService.upsertSite({
      id,
      name,
      account_id: accountId,
      source: 'external',
      host: 'external',
      domain: `${name}.example.com`,
      is_active: true,
      wp_version: '6.8.0',
      php_version: '8.2.0',
      created_at: Date.now(),
      updated_at: Date.now(),
      ...extra,
    } as any);
  }

  it('resolves via a target with a site segment', async () => {
    await seedSite('ssh:hostinger-test/site-a', 'site-a', 'hostinger-test');
    await seedSite('ssh:hostinger-test/site-b', 'site-b', 'hostinger-test');

    await graphService.upsertPlugin({
      site_id: 'ssh:hostinger-test/site-a',
      slug: 'plugin-1',
      name: 'Plugin 1',
      version: '1.0.0',
      is_active: true,
      author: 'Test',
      created_at: Date.now(),
      updated_at: Date.now(),
    });

    const result = await (createResolvers(ctx()).Mutation as any).nexusFleetSiteHealth(
      null, { target: 'ssh:hostinger-test/site-a@production' },
    );

    expect(result.success).toBe(true);
    expect(result.health.wordpress.version).toBe('6.8.0');
  });

  it('a bare connection target with two sites under it cannot disambiguate, and is reported not-found', async () => {
    await seedSite('ssh:hostinger-test/site-a', 'site-a', 'hostinger-test');
    await seedSite('ssh:hostinger-test/site-b', 'site-b', 'hostinger-test');

    const result = await (createResolvers(ctx()).Mutation as any).nexusFleetSiteHealth(
      null, { target: 'ssh:hostinger-test@production' },
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not found/i);
  });

  it('a bare connection target with exactly one site under it resolves to that site', async () => {
    await seedSite('ssh:solo-host/only-site', 'only-site', 'solo-host');

    const result = await (createResolvers(ctx()).Mutation as any).nexusFleetSiteHealth(
      null, { target: 'ssh:solo-host@production' },
    );

    expect(result.success).toBe(true);
    expect(result.health.wordpress.version).toBe('6.8.0');
  });
});
