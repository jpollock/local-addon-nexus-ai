import * as path from 'path';
import * as fs from 'fs';
import { GraphService } from '../../../src/main/events/GraphService';
import { createResolvers } from '../../../src/main/graphql/resolvers';

describe('fleet queries include external sites', () => {
  let graphService: GraphService;
  let testDbPath: string;

  beforeEach(async () => {
    testDbPath = path.join(__dirname, `test-fleet-${Date.now()}.db`);
    graphService = new GraphService(testDbPath);
    await graphService.initialize();

    // Seed one site per source - all active
    await graphService.upsertSite({
      id: 'local-site-1',
      name: 'local-site',
      source: 'local',
      host: 'local',
      domain: 'local.local',
      is_active: true,
      wp_version: '6.8.0',
      php_version: '8.2',
      created_at: Date.now(),
      updated_at: Date.now(),
    });

    await graphService.upsertSite({
      id: 'wpe-site-1',
      name: 'wpe-install',
      source: 'wpe',
      host: 'wpe',
      domain: 'wpe.wpengine.com',
      remote_install_id: 'wpe-site-1',
      account_id: 'acc-1',
      is_active: true,
      wp_version: '6.8.0',
      php_version: '8.1',
      created_at: Date.now(),
      updated_at: Date.now(),
    });

    await graphService.upsertSite({
      id: 'ssh:ext-host',
      name: 'ext-host',
      source: 'external',
      host: 'external',
      domain: 'example.com',
      is_active: true,
      wp_version: '6.8.0',
      php_version: '8.3',
      created_at: Date.now(),
      updated_at: Date.now(),
    });

    // Add a plugin to the external site so nexusFleetPlugins can surface it
    await graphService.upsertPlugin({
      site_id: 'ssh:ext-host',
      slug: 'external-test-plugin',
      name: 'External Test Plugin',
      version: '1.0.0',
      is_active: true,
      author: 'Test Author',
      created_at: Date.now(),
      updated_at: Date.now(),
    });
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
        twinService: {
          getAll: jest.fn().mockReturnValue([]),
        },
        logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
        siteData: [],
      },
      registry: {},
    } as any;
  }

  it('nexusFleetSummary includes the external site', async () => {
    const r = await (createResolvers(ctx()).Mutation as any).nexusFleetSummary(null, {});
    if (!r.success) console.log('nexusFleetSummary error:', r.error);
    expect(r.success).toBe(true);
    // The external site should appear in the aggregated stats
    // External site has PHP 8.3, WPE has 8.1, so we should see both
    expect(r.totalSites).toBe(2);
    const phpVersions = r.phpVersions.map((v: any) => v.version);
    expect(phpVersions).toContain('8.3'); // external site
    expect(phpVersions).toContain('8.1'); // wpe site
  });

  it('nexusFleetPlugins includes the external site', async () => {
    const r = await (createResolvers(ctx()).Mutation as any).nexusFleetPlugins(null, {});
    expect(r.success).toBe(true);
    // The external site's plugin should appear in the results
    const externalPlugin = r.plugins.find((p: any) => p.slug === 'external-test-plugin');
    expect(externalPlugin).toBeDefined();
    expect(externalPlugin.sites).toContain('ext-host');
  });

  it('nexusFleetVersionSites includes the external site', async () => {
    const r = await (createResolvers(ctx()).Mutation as any).nexusFleetVersionSites(
      null,
      { phpVersion: '8.3' }
    );
    expect(r.success).toBe(true);
    // External site has PHP 8.3, should be the only match
    expect(r.sites).toHaveLength(1);
    expect(r.sites[0].name).toBe('ext-host');
  });

  it('nexusFleetSearch includes the external site', async () => {
    // This uses vectorStore, so we need to mock it
    const vectorStore = {
      searchAcrossSites: jest.fn().mockResolvedValue(new Map()),
    };
    const embeddingService = {
      embed: jest.fn().mockResolvedValue(new Array(384).fill(0)),
    };
    const context = ctx();
    context.services.vectorStore = vectorStore;
    context.services.embeddingService = embeddingService;
    context.services.indexRegistry = {
      listAll: jest.fn().mockReturnValue([]),
    };

    const r = await (createResolvers(context).Mutation as any).nexusFleetSearch(
      null,
      { query: 'test' }
    );
    expect(r.success).toBe(true);
    // Verify the external site ID was included in the search
    const searchCall = vectorStore.searchAcrossSites.mock.calls[0];
    const siteIds = searchCall[0];
    expect(siteIds).toContain('ssh:ext-host');
  });

  it('nexusSitesGet handles explicit ssh: targets', async () => {
    const r = await (createResolvers(ctx()).Mutation as any).nexusSitesGet(
      null,
      { target: 'ssh:ext-host@production' }
    );
    expect(r.success).toBe(true);
    expect(r.site.name).toBe('ext-host');
    expect(r.site.siteKind).toBe('external');
    expect(r.site.status).toBe('remote');
  });
});
