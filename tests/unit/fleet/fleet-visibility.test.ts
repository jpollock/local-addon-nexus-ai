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
      environment: 'production',
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
        siteData: {
          getSite: jest.fn().mockReturnValue(undefined),
          getSites: jest.fn().mockReturnValue({}),
        },
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

  it('wp_core_version falls back to a cached version for an external site', async () => {
    // Import the handler
    const { coreVersionHandler } = require('../../../src/main/mcp/modules/wp-cli/core-version');

    // Query by external site name when the live lookup fails
    const result = await coreVersionHandler.execute(
      { site: 'ext-host' },
      ctx().services
    );

    // The cached version should be returned from the external row
    expect('content' in result).toBe(true);
    if ('content' in result) {
      const text = (result.content[0] as any).text;
      expect(text).toContain('WordPress 6.8.0');
      expect(text).toContain('synced');
    }
  });

  it('fleet_overview reports WPE and external coverage over their own denominators', async () => {
    const { fleetOverviewHandler } = require('../../../src/main/mcp/modules/fleet-intelligence/fleet-overview');

    const result = await fleetOverviewHandler.execute({}, ctx().services);

    expect('content' in result).toBe(true);
    if ('content' in result) {
      const text = (result.content[0] as any).text;

      // Still 2 remote sites (1 wpe + 1 external)
      expect(text).toContain('2 remote');

      // Each coverage metric is counted over the population it is divided by.
      // The old assertion here was `2 of 1` — a numerator spanning both sources
      // over a WPE-only denominator, inside a metric labelled "(CAPI)".
      expect(text).toMatch(/With WP version \(CAPI\):\*\* 1 of 1/);
      expect(text).not.toMatch(/With WP version.*2 of 1/);

      // External hosts are reported as themselves, not folded into "installs".
      expect(text).toContain('### External SSH Hosts');
      expect(text).toMatch(/\*\*Hosts:\*\* 1/);
      expect(text).toMatch(/With WP version:\*\* 1 of 1/);
    }
  });

  it('fleet_overview never prints a WPE denominator of 0 when only external hosts exist', async () => {
    const { fleetOverviewHandler } = require('../../../src/main/mcp/modules/fleet-intelligence/fleet-overview');

    // Deactivate the WPE row so external hosts are the entire remote fleet —
    // the shape that used to print "With WP version (CAPI): 1 of 0".
    const db = graphService.getDb()!;
    db.prepare("UPDATE sites SET is_active = 0 WHERE source = 'wpe'").run();

    const result = await fleetOverviewHandler.execute({}, ctx().services);
    expect('content' in result).toBe(true);
    if ('content' in result) {
      const text = (result.content[0] as any).text;
      expect(text).not.toContain('of 0');
      expect(text).not.toContain('### WP Engine Installs');
      expect(text).toContain('### External SSH Hosts');
    }
  });

  it('search_site_content resolves an external site by name', async () => {
    const { searchContentHandler } = require('../../../src/main/mcp/modules/content/search-content');
    const context = ctx();

    // Mock the vector store and embedding service
    context.services.vectorStore = {
      search: jest.fn().mockResolvedValue([]),
    };
    context.services.embeddingService = {
      embed: jest.fn().mockResolvedValue(new Array(384).fill(0)),
    };
    context.services.indexRegistry = {
      get: jest.fn().mockReturnValue({ state: 'ready' }),
    };

    const result = await searchContentHandler.execute(
      { site: 'ext-host', query: 'test' },
      context.services
    );

    // Should succeed and call search with the external site ID
    expect('content' in result).toBe(true);
    expect(context.services.vectorStore.search).toHaveBeenCalledWith(
      'ssh:ext-host',
      expect.any(Array),
      expect.any(Object)
    );
  });

  it('describe_site_fields resolves an external site by name', async () => {
    const { describeSiteFieldsHandler } = require('../../../src/main/mcp/modules/content/describe-site-fields');
    const context = ctx();

    // Mock the vector store
    context.services.vectorStore = {
      getAllDocuments: jest.fn().mockResolvedValue([
        {
          postId: 1,
          postType: 'post',
          metadata: JSON.stringify({ customFields: { price: 100 } }),
        },
      ]),
    };

    const result = await describeSiteFieldsHandler.execute(
      { site: 'ext-host' },
      context.services
    );

    // Should succeed and call getAllDocuments with the external site ID
    expect('content' in result).toBe(true);
    expect(context.services.vectorStore.getAllDocuments).toHaveBeenCalledWith('ssh:ext-host');

    // Verify the result includes the field from the external site
    if ('content' in result) {
      const text = (result.content[0] as any).text;
      expect(text).toContain('ext-host');
      expect(text).toContain('price');
    }
  });

  it('wp_core_version refuses to serve cached version on name collision', async () => {
    const { coreVersionHandler } = require('../../../src/main/mcp/modules/wp-cli/core-version');

    // Seed a name collision: same name under two different sources
    await graphService.upsertSite({
      id: 'collision-local',
      name: 'collision-site',
      source: 'local',
      host: 'local',
      domain: 'collision.local',
      is_active: true,
      wp_version: '6.7.0',
      created_at: Date.now(),
      updated_at: Date.now(),
    });

    await graphService.upsertSite({
      id: 'collision-wpe',
      name: 'collision-site',
      source: 'wpe',
      host: 'wpe',
      domain: 'collision.wpengine.com',
      remote_install_id: 'collision-wpe',
      is_active: true,
      wp_version: '6.8.0',
      created_at: Date.now(),
      updated_at: Date.now(),
    });

    const result = await coreVersionHandler.execute(
      { site: 'collision-site' },
      ctx().services
    );

    // Should return the original error (site not found), NOT a cached version
    expect('content' in result).toBe(true);
    if ('content' in result) {
      const text = (result.content[0] as any).text;
      expect(text).toContain('not found');
      expect(text).not.toContain('WordPress 6.');
    }
  });

  it('nexusSitesList includes registered external hosts', async () => {
    const r = await (createResolvers(ctx()).Mutation as any).nexusSitesList();
    expect(r.external).toHaveLength(1);
    expect(r.external[0]).toMatchObject({
      alias: 'ext-host',
      id: 'ssh:ext-host',
      environment: 'production',
      wpVersion: '6.8.0',
    });
  });

  it('nexusSitesList drops a host that `nexus host remove` soft-deleted', async () => {
    // nexusHostRemove sets is_active = false and resets domain back to the alias.
    // Without an is_active filter the host stayed in `sites list` — with its
    // domain clobbered — while `host list` correctly omitted it.
    await graphService.upsertSite({
      id: 'ssh:ext-host',
      name: 'ext-host',
      source: 'external',
      host: 'external',
      domain: 'ext-host',
      environment: 'production',
      is_active: false,
      created_at: Date.now(),
      updated_at: Date.now(),
    });

    const r = await (createResolvers(ctx()).Mutation as any).nexusSitesList();
    expect(r.external).toEqual([]);
  });

  it('nexusSitesGet refuses a soft-deleted external host', async () => {
    await graphService.upsertSite({
      id: 'ssh:ext-host',
      name: 'ext-host',
      source: 'external',
      host: 'external',
      domain: 'ext-host',
      environment: 'production',
      is_active: false,
      created_at: Date.now(),
      updated_at: Date.now(),
    });

    const r = await (createResolvers(ctx()).Mutation as any).nexusSitesGet(null, { target: 'ssh:ext-host@production' });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/not found/i);
  });

  it('nexusSitesGet labels an external host by bare name as external, not WP Engine', async () => {
    const context = ctx();
    context.services.localServices = {
      getSiteStatus: jest.fn().mockReturnValue('halted'),
      resolveSiteObject: jest.fn().mockReturnValue(undefined),
    };
    context.services.indexRegistry = { get: jest.fn().mockReturnValue(undefined) };

    // No Local site of this name, so the bare name falls through to the graph.
    // `nexus sites get hostinger-test` used to print "🌐 WP Engine Environment"
    // for exactly this row, because buildWpeSiteDetails hardcoded siteKind.
    const r = await (createResolvers(context).Mutation as any).nexusSitesGet(null, { target: 'ext-host' });
    expect(r.success).toBe(true);
    expect(r.site.siteKind).toBe('external');

    const wpe = await (createResolvers(context).Mutation as any).nexusSitesGet(null, { target: 'wpe-install' });
    expect(wpe.success).toBe(true);
    expect(wpe.site.siteKind).toBe('wpe');
  });

  it('nexusSitesList reports an empty php_version as null, not an empty string', async () => {
    // Update the external site to have an empty php_version
    await graphService.upsertSite({
      id: 'ssh:ext-host',
      name: 'ext-host',
      source: 'external',
      host: 'external',
      domain: 'example.com',
      is_active: true,
      wp_version: '6.8.0',
      php_version: '',
      environment: 'production',
      created_at: Date.now(),
      updated_at: Date.now(),
    });

    const r = await (createResolvers(ctx()).Mutation as any).nexusSitesList();
    expect(r.external[0].phpVersion).toBeNull();
  });

  it('nexusSitesList returns external: [] rather than failing when the graph is unavailable', async () => {
    const noGraphCtx = {
      services: {
        graphService: { getDb: () => undefined },
        twinService: { getAll: jest.fn().mockReturnValue([]) },
        logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
        siteData: {
          getSite: jest.fn().mockReturnValue(undefined),
          getSites: jest.fn().mockReturnValue({}),
        },
      },
      registry: {},
    } as any;

    const r = await (createResolvers(noGraphCtx).Mutation as any).nexusSitesList();
    expect(r.external).toEqual([]);
    expect(r.local).toBeDefined();
  });
});

describe('nexusFleetHealth includes all sources', () => {
  let graphService: GraphService;
  let testDbPath: string;

  beforeEach(async () => {
    testDbPath = path.join(__dirname, `test-fleet-health-${Date.now()}.db`);
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
        localServices: {
          getSiteStatus: jest.fn().mockReturnValue('running'),
        },
        indexRegistry: {
          listAll: jest.fn().mockReturnValue([]),
        },
        healthCalculator: {
          calculateAllScores: jest.fn().mockResolvedValue({}),
        },
      },
      registry: {},
    } as any;
  }

  it('counts all three sources, and plugin totals are no longer always zero', async () => {
    // Seed: 1 wpe, 1 external in graph
    await graphService.upsertSite({
      id: 'wpe-1',
      name: 'wpe-site',
      source: 'wpe',
      host: 'wpe',
      domain: 'wpe.wpengine.com',
      remote_install_id: 'wpe-1',
      is_active: true,
      wp_version: '6.8.0',
      created_at: Date.now(),
      updated_at: Date.now(),
    });

    await graphService.upsertSite({
      id: 'ssh:ext-1',
      name: 'ext-site',
      source: 'external',
      host: 'external',
      domain: 'ext.example.com',
      is_active: true,
      wp_version: '6.8.0',
      created_at: Date.now(),
      updated_at: Date.now(),
    });

    // Add plugins and themes to the remote sites
    await graphService.upsertPlugin({
      site_id: 'wpe-1',
      slug: 'wpe-plugin',
      name: 'WPE Plugin',
      version: '1.0.0',
      is_active: true,
      author: 'Test',
      created_at: Date.now(),
      updated_at: Date.now(),
    });

    await graphService.upsertPlugin({
      site_id: 'ssh:ext-1',
      slug: 'ext-plugin',
      name: 'External Plugin',
      version: '1.0.0',
      is_active: true,
      author: 'Test',
      created_at: Date.now(),
      updated_at: Date.now(),
    });

    await graphService.upsertTheme({
      site_id: 'wpe-1',
      slug: 'wpe-theme',
      name: 'WPE Theme',
      version: '1.0.0',
      is_active: true,
      author: 'Test',
      created_at: Date.now(),
      updated_at: Date.now(),
    });

    await graphService.upsertTheme({
      site_id: 'ssh:ext-1',
      slug: 'ext-theme',
      name: 'External Theme',
      version: '1.0.0',
      is_active: true,
      author: 'Test',
      created_at: Date.now(),
      updated_at: Date.now(),
    });

    // Mock siteData with 1 local site
    const context = ctx();
    context.services.siteData.getSites = jest.fn().mockReturnValue({
      'local-1': { id: 'local-1', name: 'local-site' },
    });

    const r = await (createResolvers(context).Mutation as any).nexusFleetHealth();
    expect(r.success).toBe(true);
    expect(r.summary.totalSites).toBe(3); // 1 local + 2 remote
    expect(r.summary.localSites).toBe(1); // from siteData
    expect(r.summary.totalPlugins).toBe(2); // was hardcoded 0
    expect(r.summary.totalThemes).toBe(2); // was hardcoded 0
  });

  it('running + halted counts only Local sites', async () => {
    // Seed 1 wpe in graph (simulates a remote site)
    await graphService.upsertSite({
      id: 'wpe-1',
      name: 'wpe-site',
      source: 'wpe',
      host: 'wpe',
      domain: 'wpe.wpengine.com',
      remote_install_id: 'wpe-1',
      is_active: true,
      wp_version: '6.8.0',
      created_at: Date.now(),
      updated_at: Date.now(),
    });

    // Mock siteData to return MORE local sites than are in the graph
    // This is the real-world shape: Local's store has sites that haven't been indexed yet
    const context = ctx();
    context.services.siteData.getSites = jest.fn().mockReturnValue({
      'local-1': { id: 'local-1', name: 'local-site-1' },
      'local-2': { id: 'local-2', name: 'local-site-2' },
      'local-3': { id: 'local-3', name: 'local-site-3' },
    });
    // Mock all 3 as running
    context.services.localServices.getSiteStatus = jest.fn().mockReturnValue('running');

    const r = await (createResolvers(context).Mutation as any).nexusFleetHealth();
    expect(r.success).toBe(true);
    expect(r.summary.localSites).toBe(3); // from siteData
    expect(r.summary.runningSites).toBe(3); // all running
    expect(r.summary.haltedSites).toBe(0);
    expect(r.summary.runningSites + r.summary.haltedSites).toBe(r.summary.localSites);
    expect(r.summary.totalSites).toBe(4); // 3 local + 1 wpe
  });

  it('reports outdated counts as unknown rather than a false all-clear', async () => {
    const r = await (createResolvers(ctx()).Mutation as any).nexusFleetHealth();
    expect(r.success).toBe(true);
    expect(r.summary.outdatedPlugins).toBeNull();
    expect(r.summary.outdatedThemes).toBeNull();
  });

  it('excludes inactive sites from the totals', async () => {
    // Seed one active WPE and one inactive WPE
    await graphService.upsertSite({
      id: 'active-1',
      name: 'active-site',
      source: 'wpe',
      host: 'wpe',
      domain: 'active.wpengine.com',
      remote_install_id: 'active-1',
      is_active: true,
      wp_version: '6.8.0',
      created_at: Date.now(),
      updated_at: Date.now(),
    });

    await graphService.upsertSite({
      id: 'inactive-1',
      name: 'inactive-site',
      source: 'wpe',
      host: 'wpe',
      domain: 'inactive.wpengine.com',
      remote_install_id: 'inactive-1',
      is_active: false, // inactive
      wp_version: '6.8.0',
      created_at: Date.now(),
      updated_at: Date.now(),
    });

    // Add plugin and theme to inactive site
    await graphService.upsertPlugin({
      site_id: 'inactive-1',
      slug: 'inactive-plugin',
      name: 'Inactive Plugin',
      version: '1.0.0',
      is_active: true,
      author: 'Test',
      created_at: Date.now(),
      updated_at: Date.now(),
    });

    await graphService.upsertTheme({
      site_id: 'inactive-1',
      slug: 'inactive-theme',
      name: 'Inactive Theme',
      version: '1.0.0',
      is_active: true,
      author: 'Test',
      created_at: Date.now(),
      updated_at: Date.now(),
    });

    const r = await (createResolvers(ctx()).Mutation as any).nexusFleetHealth();
    expect(r.success).toBe(true);
    expect(r.summary.totalSites).toBe(1); // only active-1 (remote); siteData mock returns {}
    expect(r.summary.totalPlugins).toBe(0); // plugin belongs to inactive site
    expect(r.summary.totalThemes).toBe(0); // theme belongs to inactive site
  });

  it('counts sites with plugin/theme data separately from total sites', async () => {
    // Seed 3 active sites: 2 with plugin data, 1 without
    await graphService.upsertSite({
      id: 'wpe-1',
      name: 'wpe-with-plugins',
      source: 'wpe',
      host: 'wpe',
      domain: 'wpe1.wpengine.com',
      remote_install_id: 'wpe-1',
      is_active: true,
      wp_version: '6.8.0',
      created_at: Date.now(),
      updated_at: Date.now(),
    });

    await graphService.upsertSite({
      id: 'wpe-2',
      name: 'wpe-with-themes',
      source: 'wpe',
      host: 'wpe',
      domain: 'wpe2.wpengine.com',
      remote_install_id: 'wpe-2',
      is_active: true,
      wp_version: '6.8.0',
      created_at: Date.now(),
      updated_at: Date.now(),
    });

    await graphService.upsertSite({
      id: 'wpe-3',
      name: 'wpe-empty',
      source: 'wpe',
      host: 'wpe',
      domain: 'wpe3.wpengine.com',
      remote_install_id: 'wpe-3',
      is_active: true,
      wp_version: '6.8.0',
      created_at: Date.now(),
      updated_at: Date.now(),
    });

    // Add plugins to wpe-1 only
    await graphService.upsertPlugin({
      site_id: 'wpe-1',
      slug: 'plugin-1',
      name: 'Plugin 1',
      version: '1.0.0',
      is_active: true,
      author: 'Test',
      created_at: Date.now(),
      updated_at: Date.now(),
    });

    await graphService.upsertPlugin({
      site_id: 'wpe-1',
      slug: 'plugin-2',
      name: 'Plugin 2',
      version: '1.0.0',
      is_active: true,
      author: 'Test',
      created_at: Date.now(),
      updated_at: Date.now(),
    });

    // Add themes to wpe-2 only
    await graphService.upsertTheme({
      site_id: 'wpe-2',
      slug: 'theme-1',
      name: 'Theme 1',
      version: '1.0.0',
      is_active: true,
      author: 'Test',
      created_at: Date.now(),
      updated_at: Date.now(),
    });

    const r = await (createResolvers(ctx()).Mutation as any).nexusFleetHealth();
    expect(r.success).toBe(true);
    expect(r.summary.totalSites).toBe(3); // all 3 active remote sites
    expect(r.summary.totalPlugins).toBe(2); // 2 plugins
    expect(r.summary.sitesWithPluginData).toBe(1); // only wpe-1 has plugins
    expect(r.summary.totalThemes).toBe(1); // 1 theme
    expect(r.summary.sitesWithThemeData).toBe(1); // only wpe-2 has themes
  });
});

describe('nexusFleetSiteHealth accepts all three target types', () => {
  let graphService: GraphService;
  let testDbPath: string;

  beforeEach(async () => {
    testDbPath = path.join(__dirname, `test-site-health-${Date.now()}.db`);
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
          calculateScore: jest.fn().mockImplementation((_siteId, _siteInfo, factors = ['security', 'performance', 'maintenance', 'activity', 'stability']) => {
            return Promise.resolve({
              overall: 75,
              factors: {
                security: 80,
                performance: 70,
                maintenance: 60,
                activity: 50,
                stability: 90,
              },
              factorsEvaluated: factors,
              issues: ['Outdated plugins detected'],
              recommendations: [],
              issuesByCategory: [
                { category: 'security', message: 'Outdated plugins detected' },
              ],
            });
          }),
        },
      },
      registry: {},
    } as any;
  }

  it.each(['wpe:acct/wpe-install@production', 'ssh:ext-host@production'])(
    'resolves %s instead of reporting "not found: undefined"', async (target) => {
      // Seed the corresponding site
      if (target.startsWith('wpe:')) {
        await graphService.upsertSite({
          id: 'wpe-1',
          name: 'wpe-install',
          source: 'wpe',
          host: 'wpe',
          domain: 'wpe.wpengine.com',
          remote_install_id: 'wpe-1',
          is_active: true,
          wp_version: '6.8.0',
          php_version: '8.1',
          created_at: Date.now(),
          updated_at: Date.now(),
        });
      } else {
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
      }

      const r = await (createResolvers(ctx()).Mutation as any).nexusFleetSiteHealth(null, { target });
      expect(r.success).toBe(true);
      expect(r.error ?? null).toBeNull();

      // Assert the target actually resolved to the seeded row, rather than
      // merely that the error string does not say "undefined" — which cannot
      // fail once success is true.
      expect(r.health.wordpress.version).toBe('6.8.0');

      if (target.startsWith('wpe:')) {
        expect(r.health.factorsEvaluated).toEqual(['security', 'performance']);
        expect(typeof r.health.score).toBe('number');
      } else {
        // External hosts have no scoreable inputs — see C2.
        expect(r.health.factorsEvaluated).toEqual([]);
        expect(r.health.score).toBeNull();
        expect(r.health.status).toBeNull();
      }
    }
  );

  it('surfaces the ambiguous-bare-name error with all three disambiguated forms', async () => {
    // Seed a local site AND an active wpe install both named 'blog'
    await graphService.upsertSite({
      id: 'wpe-blog',
      name: 'blog',
      source: 'wpe',
      host: 'wpe',
      domain: 'blog.wpengine.com',
      remote_install_id: 'wpe-blog',
      is_active: true,
      wp_version: '6.8.0',
      created_at: Date.now(),
      updated_at: Date.now(),
    });

    const context = ctx();
    context.services.siteData.getSite = jest.fn().mockReturnValue({
      id: 'local-blog',
      name: 'blog',
      domain: 'blog.local',
    });

    const r = await (createResolvers(context).Mutation as any).nexusFleetSiteHealth(null, { target: 'blog' });
    expect(r.success).toBe(false);
    expect(r.error).toContain('blog@local');
    expect(r.error).toContain('wpe:');
    expect(r.error).toContain('ssh:');
  });

  it('reports real plugin and theme counts, not zeros', async () => {
    // Seed a site with 3 plugins (2 active) and 2 themes (1 active)
    await graphService.upsertSite({
      id: 'test-site',
      name: 'test-site',
      source: 'wpe',
      host: 'wpe',
      domain: 'test.wpengine.com',
      remote_install_id: 'test-site',
      is_active: true,
      wp_version: '6.8.0',
      created_at: Date.now(),
      updated_at: Date.now(),
    });

    await graphService.upsertPlugin({
      site_id: 'test-site',
      slug: 'plugin-1',
      name: 'Plugin 1',
      version: '1.0.0',
      is_active: true,
      author: 'Test',
      created_at: Date.now(),
      updated_at: Date.now(),
    });

    await graphService.upsertPlugin({
      site_id: 'test-site',
      slug: 'plugin-2',
      name: 'Plugin 2',
      version: '1.0.0',
      is_active: true,
      author: 'Test',
      created_at: Date.now(),
      updated_at: Date.now(),
    });

    await graphService.upsertPlugin({
      site_id: 'test-site',
      slug: 'plugin-3',
      name: 'Plugin 3',
      version: '1.0.0',
      is_active: false,
      author: 'Test',
      created_at: Date.now(),
      updated_at: Date.now(),
    });

    await graphService.upsertTheme({
      site_id: 'test-site',
      slug: 'theme-1',
      name: 'Theme 1',
      version: '1.0.0',
      is_active: true,
      author: 'Test',
      created_at: Date.now(),
      updated_at: Date.now(),
    });

    await graphService.upsertTheme({
      site_id: 'test-site',
      slug: 'theme-2',
      name: 'Theme 2',
      version: '1.0.0',
      is_active: false,
      author: 'Test',
      created_at: Date.now(),
      updated_at: Date.now(),
    });

    const r = await (createResolvers(ctx()).Mutation as any).nexusFleetSiteHealth(null, { target: 'wpe:acct/test-site@production' });
    expect(r.success).toBe(true);
    expect(r.health.plugins).toEqual({ total: 3, active: 2, outdated: null });
    expect(r.health.themes).toEqual({ total: 2, active: 1, outdated: null });
  });

  it('returns null rather than zero for a site with no indexed plugin data', async () => {
    // Seed a site with no plugins or themes
    await graphService.upsertSite({
      id: 'empty-site',
      name: 'empty-site',
      source: 'wpe',
      host: 'wpe',
      domain: 'empty.wpengine.com',
      remote_install_id: 'empty-site',
      is_active: true,
      wp_version: '6.8.0',
      created_at: Date.now(),
      updated_at: Date.now(),
    });

    const r = await (createResolvers(ctx()).Mutation as any).nexusFleetSiteHealth(null, { target: 'wpe:acct/empty-site@production' });
    expect(r.success).toBe(true);
    expect(r.health.plugins).toBeNull();
    expect(r.health.themes).toBeNull();
  });

  it('returns real issues with category and severity, not an empty list', async () => {
    // Seed a site
    await graphService.upsertSite({
      id: 'test-site',
      name: 'test-site',
      source: 'wpe',
      host: 'wpe',
      domain: 'test.wpengine.com',
      remote_install_id: 'test-site',
      is_active: true,
      wp_version: '6.8.0',
      php_version: '8.1',
      created_at: Date.now(),
      updated_at: Date.now(),
    });

    const r = await (createResolvers(ctx()).Mutation as any).nexusFleetSiteHealth(null, { target: 'wpe:acct/test-site@production' });
    expect(r.success).toBe(true);
    expect(r.health.issues.length).toBeGreaterThan(0);
    expect(['security', 'performance', 'maintenance', 'activity', 'stability'])
      .toContain(r.health.issues[0].category);
    expect(['critical', 'warning', 'healthy']).toContain(r.health.issues[0].severity);
  });

  it('reports the WordPress version from the graph', async () => {
    await graphService.upsertSite({
      id: 'test-site',
      name: 'test-site',
      source: 'wpe',
      host: 'wpe',
      domain: 'test.wpengine.com',
      remote_install_id: 'test-site',
      is_active: true,
      wp_version: '6.8.0',
      created_at: Date.now(),
      updated_at: Date.now(),
    });

    const r = await (createResolvers(ctx()).Mutation as any).nexusFleetSiteHealth(null, { target: 'wpe:acct/test-site@production' });
    expect(r.success).toBe(true);
    expect(r.health.wordpress.version).toBe('6.8.0');
    expect(r.health.wordpress.updateAvailable).toBeNull();
  });

  it('works for local sites too', async () => {
    const context = ctx();
    context.services.siteData.getSites = jest.fn().mockReturnValue({
      'local-1': {
        id: 'local-1',
        name: 'local-site',
        domain: 'local.local',
        phpVersion: '8.2',
      },
    });

    const r = await (createResolvers(context).Mutation as any).nexusFleetSiteHealth(null, { target: 'local-site@local' });
    expect(r.success).toBe(true);
    expect(r.health.score).toBe(75);
  });

  it('derives severity from factor scores (critical at 40, warning at 70, healthy at 90)', async () => {
    await graphService.upsertSite({
      id: 'test-site',
      name: 'test-site',
      source: 'wpe',
      host: 'wpe',
      domain: 'test.wpengine.com',
      remote_install_id: 'test-site',
      is_active: true,
      wp_version: '6.8.0',
      created_at: Date.now(),
      updated_at: Date.now(),
    });

    const context = ctx();
    context.services.healthCalculator.calculateScore = jest.fn().mockResolvedValue({
      overall: 60,
      factors: {
        security: 40,
        performance: 70,
        maintenance: 0,
        activity: 0,
        stability: 90,
      },
      factorsEvaluated: ['security', 'performance', 'stability'],
      issues: [],
      issuesByCategory: [
        { category: 'security', message: 'Critical issue' },
        { category: 'performance', message: 'Warning issue' },
        { category: 'stability', message: 'Healthy issue' },
      ],
      recommendations: [],
    });

    const r = await (createResolvers(context).Mutation as any).nexusFleetSiteHealth(null, { target: 'wpe:acct/test-site@production' });
    expect(r.success).toBe(true);
    expect(r.health.issues).toHaveLength(3);

    const criticalIssue = r.health.issues.find((i: any) => i.category === 'security');
    expect(criticalIssue.severity).toBe('critical'); // factor score 40

    const warningIssue = r.health.issues.find((i: any) => i.category === 'performance');
    expect(warningIssue.severity).toBe('warning'); // factor score 70

    const healthyIssue = r.health.issues.find((i: any) => i.category === 'stability');
    expect(healthyIssue.severity).toBe('healthy'); // factor score 90
  });

  it('returns wpe row data when local and wpe sites collide by name', async () => {
    // Seed a local site named 'blog'
    const context = ctx();
    context.services.siteData.getSites = jest.fn().mockReturnValue({
      'local-blog': {
        id: 'local-blog',
        name: 'blog',
        domain: 'blog.local',
        phpVersion: '8.1',
      },
    });

    // Seed a wpe install also named 'blog' with different wp_version
    await graphService.upsertSite({
      id: 'wpe-blog',
      name: 'blog',
      source: 'wpe',
      host: 'wpe',
      domain: 'blog.wpengine.com',
      remote_install_id: 'wpe-blog',
      is_active: true,
      wp_version: '6.9.0', // Different from any local version
      created_at: Date.now(),
      updated_at: Date.now(),
    });

    const r = await (createResolvers(context).Mutation as any).nexusFleetSiteHealth(null, { target: 'wpe:acct/blog@production' });
    expect(r.success).toBe(true);
    expect(r.health.wordpress.version).toBe('6.9.0'); // WPE row's version, not local's
  });

  it('WPE installs evaluate security and performance only — never stability', async () => {
    await graphService.upsertSite({
      id: 'wpe-1',
      name: 'wpe-install',
      source: 'wpe',
      host: 'wpe',
      domain: 'wpe.wpengine.com',
      remote_install_id: 'wpe-1',
      is_active: true,
      wp_version: '6.8.0',
      created_at: Date.now(),
      updated_at: Date.now(),
    });

    const r = await (createResolvers(ctx()).Mutation as any).nexusFleetSiteHealth(null, { target: 'wpe:acct/wpe-install@production' });
    expect(r.success).toBe(true);
    // `stability` counts failed event_queue rows, which only the Local MU-plugin
    // webhook writes. A remote site can never have one, so including it awarded
    // a fixed 100 for absent data — 15.4% of the score.
    expect(r.health.factorsEvaluated).toEqual(['security', 'performance']);
    expect(r.health.factorsEvaluated).not.toContain('stability');
  });

  it('does not invent a PHP version for a WPE row that has none', async () => {
    await graphService.upsertSite({
      id: 'wpe-nophp',
      name: 'wpe-nophp',
      source: 'wpe',
      host: 'wpe',
      domain: 'nophp.wpengine.com',
      remote_install_id: 'wpe-nophp',
      is_active: true,
      wp_version: '6.8.0',
      created_at: Date.now(),
      updated_at: Date.now(),
    });

    const context = ctx();
    await (createResolvers(context).Mutation as any).nexusFleetSiteHealth(null, { target: 'wpe:acct/wpe-nophp@production' });

    // 46 of 331 active WPE rows carry no php_version. `|| '8.0'` invented one
    // and collected security/performance points for it; the calculator's own
    // "PHP version unknown" path is the honest answer.
    const [, siteInfo] = context.services.healthCalculator.calculateScore.mock.calls[0];
    expect(siteInfo.phpVersion).toBeUndefined();
  });

  it('external hosts are not scored at all — score and status are null', async () => {
    await graphService.upsertSite({
      id: 'ssh:ext-host',
      name: 'ext-host',
      source: 'external',
      host: 'external',
      domain: 'example.com',
      is_active: true,
      wp_version: '6.8.0',
      created_at: Date.now(),
      updated_at: Date.now(),
    });

    const context = ctx();
    const r = await (createResolvers(context).Mutation as any).nexusFleetSiteHealth(null, { target: 'ssh:ext-host@production' });

    expect(r.success).toBe(true);
    expect(r.health.factorsEvaluated).toEqual([]);
    expect(r.health.score).toBeNull();
    expect(r.health.status).toBeNull();
    expect(r.health.issues).toEqual([]);
    // Nothing populates plugin rows for an external host, so no factor may be
    // scored from their absence — the calculator is never called.
    expect(context.services.healthCalculator.calculateScore).not.toHaveBeenCalled();
    // Real data still flows through.
    expect(r.health.wordpress.version).toBe('6.8.0');
  });

  it('a removed (soft-deleted) external host reports no health', async () => {
    await graphService.upsertSite({
      id: 'ssh:gone-host',
      name: 'gone-host',
      source: 'external',
      host: 'external',
      domain: 'gone-host',
      is_active: false,
      created_at: Date.now(),
      updated_at: Date.now(),
    });

    const r = await (createResolvers(ctx()).Mutation as any).nexusFleetSiteHealth(null, { target: 'ssh:gone-host@production' });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/not found/i);
  });

  it('local sites evaluate all five factors', async () => {
    const context = ctx();
    context.services.siteData.getSites = jest.fn().mockReturnValue({
      'local-1': {
        id: 'local-1',
        name: 'local-site',
        domain: 'local.local',
        phpVersion: '8.2',
      },
    });

    const r = await (createResolvers(context).Mutation as any).nexusFleetSiteHealth(null, { target: 'local-site@local' });
    expect(r.success).toBe(true);
    expect(r.health.factorsEvaluated).toEqual(['security', 'performance', 'maintenance', 'activity', 'stability']);
  });
});
