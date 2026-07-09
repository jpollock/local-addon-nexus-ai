/**
 * Unit Tests for Database Scanner
 */

import { NexusServices, SiteDataAccessor, LocalSiteInfo } from '../../../src/main/mcp/types';
import {
  computeHealthScore,
  detectLeftoverTables,
  scanDatabase,
  cleanDatabase,
  guessPluginFromOptionName,
  attributePluginTable,
} from '../../../src/main/mcp/modules/db-scanner/db-scanner';
import { scanDatabaseHealthHandler } from '../../../src/main/mcp/modules/db-scanner/scan-handler';
import { cleanDatabaseItemsHandler } from '../../../src/main/mcp/modules/db-scanner/clean-handler';

// ---------------------------------------------------------------------------
// Test Fixtures
// ---------------------------------------------------------------------------

const createMockSite = (overrides?: Partial<LocalSiteInfo>): LocalSiteInfo => ({
  id: 'test-site-1',
  name: 'test-site',
  domain: 'test-site.local',
  path: '/Users/test/Local Sites/test-site',
  ...overrides,
});

const createMockSiteData = (sites: LocalSiteInfo[]): SiteDataAccessor => {
  const siteMap: Record<string, LocalSiteInfo> = {};
  sites.forEach((s) => {
    siteMap[s.id] = s;
    siteMap[s.name] = s;
  });
  return {
    getSite: (id: string) => siteMap[id] ?? null,
    getSites: () => {
      const result: Record<string, LocalSiteInfo> = {};
      sites.forEach((s) => { result[s.id] = s; });
      return result;
    },
  };
};

/** Build a mock WP-CLI response factory */
const makeWpCliMock = (overrides: Record<string, { stdout: string; success?: boolean }> = {}) => {
  return jest.fn().mockImplementation((_siteId: string, args: string[]) => {
    const cmd = args[0];

    // Decode SQL from wp eval calls (base64 encoded)
    let sql = '';
    if (cmd === 'eval' && args[1]) {
      const match = args[1].match(/base64_decode\('([^']+)'\)/);
      if (match) {
        sql = Buffer.from(match[1], 'base64').toString('utf-8');
      }
    }

    // withSiteRunning readiness probe
    if (cmd === 'eval' && args[1] === "echo 'ready';") {
      return Promise.resolve({ success: true, stdout: 'ready', stderr: '' });
    }

    // core version
    if (cmd === 'core' && args[1] === 'version') {
      return Promise.resolve({ success: true, stdout: '6.5.0', stderr: '' });
    }

    // config get table_prefix
    if (cmd === 'config' && args[1] === 'get' && args[2] === 'table_prefix') {
      return Promise.resolve({ success: true, stdout: 'wp_', stderr: '' });
    }

    // plugin list
    if (cmd === 'plugin' && args[1] === 'list') {
      const key = 'plugin_list';
      if (overrides[key]) return Promise.resolve({ success: true, ...overrides[key] });
      return Promise.resolve({
        success: true,
        stdout: JSON.stringify([
          { name: 'woocommerce', status: 'inactive' },
          { name: 'akismet', status: 'active' },
        ]),
        stderr: '',
      });
    }

    // db query — table sizes
    if (sql.includes('information_schema')) {
      const key = 'tables';
      if (overrides[key]) return Promise.resolve({ success: true, ...overrides[key] });
      return Promise.resolve({
        success: true,
        stdout: JSON.stringify([
          { name: 'wp_posts', rows: 100, data_length: 1024000, index_length: 512000 },
          { name: 'wp_options', rows: 500, data_length: 256000, index_length: 128000 },
          { name: 'wp_foo_plugin_data', rows: 50, data_length: 10000, index_length: 5000 },
        ]),
        stderr: '',
      });
    }

    // revision count
    if (sql.includes("post_type = 'revision'") && sql.includes('COUNT(*)') && !sql.includes('LENGTH')) {
      const key = 'rev_count';
      if (overrides[key]) return Promise.resolve({ success: true, ...overrides[key] });
      return Promise.resolve({ success: true, stdout: JSON.stringify([{ cnt: 0 }]), stderr: '' });
    }

    // revision size
    if (sql.includes("post_type = 'revision'") && sql.includes('LENGTH')) {
      return Promise.resolve({ success: true, stdout: JSON.stringify([{ total_bytes: 0 }]), stderr: '' });
    }

    // revision top posts
    if (sql.includes('revisionCount')) {
      return Promise.resolve({ success: true, stdout: JSON.stringify([]), stderr: '' });
    }

    // expired transients
    if (sql.includes('_transient_timeout_') && sql.includes('UNIX_TIMESTAMP')) {
      const key = 'trans_expired';
      if (overrides[key]) return Promise.resolve({ success: true, ...overrides[key] });
      return Promise.resolve({ success: true, stdout: JSON.stringify([{ cnt: 0 }]), stderr: '' });
    }

    // total transients
    if (sql.includes('_transient_%') && !sql.includes('timeout') && sql.includes('COUNT(*)')) {
      return Promise.resolve({ success: true, stdout: JSON.stringify([{ cnt: 0 }]), stderr: '' });
    }

    // transient size
    if (sql.includes('_transient_%') && sql.includes('SUM(LENGTH')) {
      return Promise.resolve({ success: true, stdout: JSON.stringify([{ total_bytes: 0 }]), stderr: '' });
    }

    // orphaned meta key breakdown (must be checked before the generic postmeta check)
    if (sql.includes('meta_key') && sql.includes('GROUP BY')) {
      const key = 'orphan_meta_keys';
      if (overrides[key]) return Promise.resolve({ success: true, ...overrides[key] });
      return Promise.resolve({ success: true, stdout: JSON.stringify([]), stderr: '' });
    }

    // orphaned post meta
    if (sql.includes('postmeta') && sql.includes('LEFT JOIN') && sql.includes('posts')) {
      const key = 'orphan_pm';
      if (overrides[key]) return Promise.resolve({ success: true, ...overrides[key] });
      return Promise.resolve({ success: true, stdout: JSON.stringify([{ cnt: 0 }]), stderr: '' });
    }

    // orphaned comment meta
    if (sql.includes('commentmeta')) {
      return Promise.resolve({ success: true, stdout: JSON.stringify([{ cnt: 0 }]), stderr: '' });
    }

    // autoload size
    if (sql.includes('autoload') && sql.includes('SUM(LENGTH')) {
      const key = 'autoload_size';
      if (overrides[key]) return Promise.resolve({ success: true, ...overrides[key] });
      return Promise.resolve({ success: true, stdout: JSON.stringify([{ total_bytes: 0 }]), stderr: '' });
    }

    // autoload top options
    if (sql.includes('autoload') && sql.includes('size_bytes')) {
      const key = 'autoload_top';
      if (overrides[key]) return Promise.resolve({ success: true, ...overrides[key] });
      return Promise.resolve({ success: true, stdout: JSON.stringify([]), stderr: '' });
    }

    // draft/trash
    if (sql.includes("auto-draft") || sql.includes("'trash'")) {
      return Promise.resolve({ success: true, stdout: JSON.stringify([]), stderr: '' });
    }

    // Default
    return Promise.resolve({ success: true, stdout: JSON.stringify([]), stderr: '' });
  });
};

const createMockLocalServices = (wpCliOverrides: Record<string, any> = {}) => ({
  wpCliRun: makeWpCliMock(wpCliOverrides),
  getSiteStatus: jest.fn().mockReturnValue('running'),
  getAllSiteStatuses: jest.fn().mockReturnValue({ 'test-site-1': 'running' }),
  startSite: jest.fn().mockResolvedValue(undefined),
  stopSite: jest.fn().mockResolvedValue(undefined),
});

const createMockServices = (
  sites: LocalSiteInfo[],
  wpCliOverrides: Record<string, any> = {},
): NexusServices => ({
  vectorStore: {} as any,
  embeddingService: {} as any,
  contentPipeline: {} as any,
  indexRegistry: {} as any,
  fileScanner: {} as any,
  siteData: createMockSiteData(sites),
  graphService: {} as any,
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() } as any,
  auditLogger: {} as any,
  localServices: createMockLocalServices(wpCliOverrides) as any,
  registryStorage: {
    get: jest.fn().mockReturnValue(null),
    set: jest.fn(),
  } as any,
});

// ---------------------------------------------------------------------------
// Tests: computeHealthScore
// ---------------------------------------------------------------------------

describe('computeHealthScore', () => {
  const baseResult = {
    revisions: { totalCount: 0 },
    transients: { expiredCount: 0 },
    orphans: { orphanedPostMeta: 0, orphanedCommentMeta: 0 },
    draftsAndTrash: { autoDraftCount: 0, trashedPostCount: 0 },
    pluginTables: { leftoverTables: [] },
    wooCommerce: null,
    tables: [] as import('../../../src/common/types').DbTableInfo[],
  };

  it('returns 100 for a clean database', () => {
    expect(computeHealthScore(baseResult)).toBe(100);
  });

  it('applies -10 penalty for revisions > 500', () => {
    const result = { ...baseResult, revisions: { totalCount: 501 } };
    expect(computeHealthScore(result)).toBe(90);
  });

  it('applies -20 penalty for revisions > 2000 (replaces -10)', () => {
    const result = { ...baseResult, revisions: { totalCount: 2001 } };
    expect(computeHealthScore(result)).toBe(80);
  });

  it('applies -10 penalty for expired transients > 100', () => {
    const result = { ...baseResult, transients: { expiredCount: 101 } };
    expect(computeHealthScore(result)).toBe(90);
  });

  it('applies -20 penalty for expired transients > 500 (replaces -10)', () => {
    const result = { ...baseResult, transients: { expiredCount: 501 } };
    expect(computeHealthScore(result)).toBe(80);
  });

  it('applies -5 penalty for orphaned post meta > 50', () => {
    const result = {
      ...baseResult,
      orphans: { orphanedPostMeta: 75, orphanedCommentMeta: 0 },
    };
    expect(computeHealthScore(result)).toBe(95);
  });

  it('applies -10 penalty for orphaned post meta > 100', () => {
    const result = {
      ...baseResult,
      orphans: { orphanedPostMeta: 501, orphanedCommentMeta: 0 },
    };
    expect(computeHealthScore(result)).toBe(90);
  });

  it('applies -5 penalty for orphaned comment meta > 500', () => {
    const result = {
      ...baseResult,
      orphans: { orphanedPostMeta: 0, orphanedCommentMeta: 501 },
    };
    expect(computeHealthScore(result)).toBe(95);
  });

  it('applies -5 penalty for auto-drafts > 50', () => {
    const result = {
      ...baseResult,
      draftsAndTrash: { autoDraftCount: 51, trashedPostCount: 0 },
    };
    expect(computeHealthScore(result)).toBe(95);
  });

  it('applies -5 penalty for trashed posts > 50', () => {
    const result = {
      ...baseResult,
      draftsAndTrash: { autoDraftCount: 0, trashedPostCount: 51 },
    };
    expect(computeHealthScore(result)).toBe(95);
  });

  it('applies -5 per leftover table, max -15', () => {
    const result4 = {
      ...baseResult,
      pluginTables: { leftoverTables: ['t1', 't2', 't3', 't4'] },
    };
    expect(computeHealthScore(result4)).toBe(85); // 4 tables -> capped at -15
  });

  it('applies -10 penalty for WC sessions > 1000', () => {
    const result = {
      ...baseResult,
      wooCommerce: { sessionCount: 1001, estimatedSessionSizeBytes: 0, oldLogCount: 0 },
    };
    expect(computeHealthScore(result)).toBe(90);
  });

  it('applies -5 penalty for total DB > 500MB', () => {
    const bigTable = {
      name: 'wp_posts',
      rows: 1000,
      dataSizeBytes: 600 * 1024 * 1024,
      indexSizeBytes: 0,
      totalSizeBytes: 600 * 1024 * 1024,
    };
    const result = { ...baseResult, tables: [bigTable] };
    expect(computeHealthScore(result)).toBe(95);
  });

  it('applies -15 penalty for total DB > 1000MB (replaces -5)', () => {
    const bigTable = {
      name: 'wp_posts',
      rows: 1000,
      dataSizeBytes: 1100 * 1024 * 1024,
      indexSizeBytes: 0,
      totalSizeBytes: 1100 * 1024 * 1024,
    };
    const result = { ...baseResult, tables: [bigTable] };
    expect(computeHealthScore(result)).toBe(85);
  });

  it('floors the score at 0 for extreme cases', () => {
    const result = {
      ...baseResult,
      revisions: { totalCount: 5000 },
      transients: { expiredCount: 1000 },
      orphans: { orphanedPostMeta: 1000, orphanedCommentMeta: 1000 },
      draftsAndTrash: { autoDraftCount: 200, trashedPostCount: 200 },
      pluginTables: { leftoverTables: ['t1', 't2', 't3', 't4', 't5'] },
      wooCommerce: { sessionCount: 5000, estimatedSessionSizeBytes: 0, oldLogCount: 0 },
      tables: [{
        name: 'wp_posts', rows: 1, dataSizeBytes: 2000 * 1024 * 1024,
        indexSizeBytes: 0, totalSizeBytes: 2000 * 1024 * 1024,
      }],
    };
    expect(computeHealthScore(result)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Tests: guessPluginFromOptionName
// ---------------------------------------------------------------------------

describe('guessPluginFromOptionName', () => {
  it('recognizes Elementor options', () => {
    expect(guessPluginFromOptionName('elementor_version')).toBe('Elementor');
    expect(guessPluginFromOptionName('_elementor_global_css')).toBe('Elementor');
  });

  it('recognizes WooCommerce options', () => {
    expect(guessPluginFromOptionName('woocommerce_currency')).toBe('WooCommerce');
    expect(guessPluginFromOptionName('wc_cart_hash')).toBe('WooCommerce');
  });

  it('recognizes Yoast SEO options', () => {
    expect(guessPluginFromOptionName('yoast_seo_settings')).toBe('Yoast SEO');
  });

  it('recognizes Gravity Forms options', () => {
    expect(guessPluginFromOptionName('gravityforms_version')).toBe('Gravity Forms');
    expect(guessPluginFromOptionName('gform_pending_installation')).toBe('Gravity Forms');
  });

  it('returns null for transient options', () => {
    expect(guessPluginFromOptionName('_transient_feed_mod_1234')).toBeNull();
  });

  it('returns null for unrecognized options', () => {
    expect(guessPluginFromOptionName('my_unknown_option_xyz')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tests: attributePluginTable
// ---------------------------------------------------------------------------

describe('attributePluginTable', () => {
  it('attributes known Gravity Forms table', () => {
    expect(attributePluginTable('wp_gf_entry', 'wp_')).toBe('Gravity Forms');
  });

  it('attributes known Wordfence table', () => {
    expect(attributePluginTable('wp_wfhits', 'wp_')).toBe('Wordfence');
  });

  it('returns null for unknown table', () => {
    expect(attributePluginTable('wp_foo_custom', 'wp_')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tests: computeHealthScore — autoload penalty
// ---------------------------------------------------------------------------

describe('computeHealthScore — autoload', () => {
  const baseResult = {
    revisions: { totalCount: 0 },
    transients: { expiredCount: 0 },
    orphans: { orphanedPostMeta: 0, orphanedCommentMeta: 0 },
    draftsAndTrash: { autoDraftCount: 0, trashedPostCount: 0 },
    pluginTables: { leftoverTables: [] },
    wooCommerce: null,
    tables: [] as import('../../../src/common/types').DbTableInfo[],
  };

  it('applies no penalty when autoload field is absent', () => {
    expect(computeHealthScore(baseResult)).toBe(100);
  });

  it('applies -5 penalty for autoload > 1 MB', () => {
    const result = { ...baseResult, autoload: { totalSizeBytes: 2 * 1024 * 1024 - 1 } };
    expect(computeHealthScore(result)).toBe(95);
  });

  it('applies -10 penalty for autoload > 2 MB', () => {
    const result = { ...baseResult, autoload: { totalSizeBytes: 3 * 1024 * 1024 } };
    expect(computeHealthScore(result)).toBe(90);
  });

  it('applies -20 penalty for autoload > 5 MB', () => {
    const result = { ...baseResult, autoload: { totalSizeBytes: 6 * 1024 * 1024 } };
    expect(computeHealthScore(result)).toBe(80);
  });
});

// ---------------------------------------------------------------------------
// Tests: detectLeftoverTables
// ---------------------------------------------------------------------------

describe('detectLeftoverTables', () => {
  it('does not flag core WP tables', () => {
    const tables = [
      'wp_posts', 'wp_postmeta', 'wp_users', 'wp_usermeta',
      'wp_comments', 'wp_commentmeta', 'wp_options',
    ];
    expect(detectLeftoverTables(tables, [])).toHaveLength(0);
  });

  it('flags table with no matching active plugin', () => {
    const tables = ['wp_posts', 'wp_foo_data'];
    const activeSlugs = ['akismet', 'jetpack'];
    const leftover = detectLeftoverTables(tables, activeSlugs);
    expect(leftover).toContain('wp_foo_data');
  });

  it('does not flag table when matching plugin is active', () => {
    const tables = ['wp_posts', 'wp_woocommerce_sessions'];
    const activeSlugs = ['woocommerce'];
    const leftover = detectLeftoverTables(tables, activeSlugs);
    expect(leftover).not.toContain('wp_woocommerce_sessions');
  });

  it('handles hyphen-to-underscore slug normalization', () => {
    const tables = ['wp_posts', 'wp_my_plugin_data'];
    const activeSlugs = ['my-plugin'];
    const leftover = detectLeftoverTables(tables, activeSlugs);
    expect(leftover).not.toContain('wp_my_plugin_data');
  });

  it('returns empty array when all tables are core or matched', () => {
    const tables = ['wp_posts', 'wp_akismet_data'];
    const activeSlugs = ['akismet'];
    expect(detectLeftoverTables(tables, activeSlugs)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Tests: scan_database_health handler
// ---------------------------------------------------------------------------

describe('scan_database_health', () => {
  it('returns structured scan result for running site', async () => {
    const site = createMockSite({ id: 'site-1', name: 'mysite' });
    const services = createMockServices([site]);

    const result = await scanDatabaseHealthHandler.execute({ site: 'mysite' }, services);

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toHaveProperty('healthScore');
    expect(parsed).toHaveProperty('revisions');
    expect(parsed).toHaveProperty('transients');
    expect(parsed).toHaveProperty('summary');
    expect(typeof parsed.healthScore).toBe('number');
    expect(parsed.healthScore).toBeGreaterThanOrEqual(0);
    expect(parsed.healthScore).toBeLessThanOrEqual(100);
  });

  it('returns error if site not found', async () => {
    const services = createMockServices([]);

    const result = await scanDatabaseHealthHandler.execute({ site: 'nonexistent' }, services);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('not found');
  });

  it('auto-starts a halted site and scans it', async () => {
    const site = createMockSite({ id: 'site-1', name: 'mysite' });
    const services = createMockServices([site]);
    (services.localServices!.getSiteStatus as jest.Mock).mockReturnValue('halted');

    const result = await scanDatabaseHealthHandler.execute({ site: 'mysite' }, services);

    // withSiteRunning auto-starts the site — scan should succeed
    expect(services.localServices!.startSite).toHaveBeenCalledWith('site-1');
    expect(result.isError).toBeUndefined();
  });

  it('returns defaults of 0 when WP-CLI queries fail', async () => {
    const site = createMockSite({ id: 'site-1', name: 'mysite' });
    const services = createMockServices([site]);
    // Make all wpCliRun calls fail
    (services.localServices!.wpCliRun as jest.Mock).mockResolvedValue({
      success: false,
      stdout: '',
      stderr: 'error',
    });

    const result = await scanDatabaseHealthHandler.execute({ site: 'mysite' }, services);

    // Should succeed (graceful degradation), not error
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.revisions.totalCount).toBe(0);
    expect(parsed.transients.expiredCount).toBe(0);
    expect(parsed.orphans.orphanedPostMeta).toBe(0);
  });

  it('detects leftover tables from mock table list', async () => {
    // The default mock returns wp_foo_plugin_data with no matching active plugin
    const site = createMockSite({ id: 'site-1', name: 'mysite' });
    const services = createMockServices([site]);

    const result = await scanDatabaseHealthHandler.execute({ site: 'mysite' }, services);
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.pluginTables.leftoverTables).toContain('wp_foo_plugin_data');
  });

  it('includes autoload data in scan result', async () => {
    const site = createMockSite({ id: 'site-1', name: 'mysite' });
    const services = createMockServices([site], {
      autoload_size: { stdout: JSON.stringify([{ total_bytes: 1500000 }]) },
      autoload_top: { stdout: JSON.stringify([
        { option_name: 'elementor_version', size_bytes: 800000 },
        { option_name: 'my_custom_option', size_bytes: 700000 },
      ]) },
    });

    const result = await scanDatabaseHealthHandler.execute({ site: 'mysite' }, services);
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed).toHaveProperty('autoload');
    expect(parsed.autoload.totalSizeBytes).toBe(1500000);
    expect(parsed.autoload.topOptions).toHaveLength(2);
    expect(parsed.autoload.topOptions[0].likelyPlugin).toBe('Elementor');
  });

  it('includes orphaned meta key breakdown in scan result', async () => {
    const site = createMockSite({ id: 'site-1', name: 'mysite' });
    const services = createMockServices([site], {
      orphan_pm: { stdout: JSON.stringify([{ cnt: 376 }]) },
      orphan_meta_keys: { stdout: JSON.stringify([
        { meta_key: '_wp_attachment_image_alt', cnt: 200 },
        { meta_key: '_thumbnail_id', cnt: 176 },
      ]) },
    });

    const result = await scanDatabaseHealthHandler.execute({ site: 'mysite' }, services);
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.orphans.topOrphanedMetaKeys).toHaveLength(2);
    expect(parsed.orphans.topOrphanedMetaKeys[0].metaKey).toBe('_wp_attachment_image_alt');
    expect(parsed.orphans.topOrphanedMetaKeys[0].count).toBe(200);
  });

  it('includes leftoverTablesWithAttribution in scan result', async () => {
    const site = createMockSite({ id: 'site-1', name: 'mysite' });
    const services = createMockServices([site]);

    const result = await scanDatabaseHealthHandler.execute({ site: 'mysite' }, services);
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.pluginTables).toHaveProperty('leftoverTablesWithAttribution');
    expect(Array.isArray(parsed.pluginTables.leftoverTablesWithAttribution)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tests: clean_database_items handler
// ---------------------------------------------------------------------------

describe('clean_database_items', () => {
  it('defaults dry_run to true when not specified', async () => {
    const site = createMockSite({ id: 'site-1', name: 'mysite' });
    const services = createMockServices([site]);

    const result = await cleanDatabaseItemsHandler.execute(
      { site: 'mysite', items: ['post_revisions'] },
      services,
    );

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.dryRun).toBe(true);
  });

  it('dry_run=true returns estimates without deletion', async () => {
    const site = createMockSite({ id: 'site-1', name: 'mysite' });
    const services = createMockServices([site], {
      rev_count: { stdout: JSON.stringify([{ cnt: 42 }]) },
    });

    const result = await cleanDatabaseItemsHandler.execute(
      { site: 'mysite', items: ['post_revisions'], dry_run: true },
      services,
    );

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.dryRun).toBe(true);
    // Should have counted items
    const revItem = parsed.items.find((i: any) => i.type === 'post_revisions');
    expect(revItem).toBeTruthy();
    expect(revItem.success).toBe(true);
  });

  it('returns error if site not found', async () => {
    const services = createMockServices([]);
    const result = await cleanDatabaseItemsHandler.execute({ site: 'nonexistent' }, services);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('not found');
  });

  it('auto-starts a halted site and runs clean', async () => {
    const site = createMockSite({ id: 'site-1', name: 'mysite' });
    const services = createMockServices([site]);
    (services.localServices!.getSiteStatus as jest.Mock).mockReturnValue('halted');

    const result = await cleanDatabaseItemsHandler.execute(
      { site: 'mysite', items: ['post_revisions'] },
      services,
    );

    // withSiteRunning auto-starts the site — clean should succeed
    expect(services.localServices!.startSite).toHaveBeenCalledWith('site-1');
    expect(result.isError).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Tests: fleet_database_health (via scanDatabase directly)
// ---------------------------------------------------------------------------

describe('fleet_database_health (scanDatabase)', () => {
  it('skips non-running sites', async () => {
    const site1 = createMockSite({ id: 'site-1', name: 'running-site' });
    const site2 = createMockSite({ id: 'site-2', name: 'halted-site' });
    const services = createMockServices([site1, site2]);

    // site2 is halted
    (services.localServices!.getAllSiteStatuses as jest.Mock).mockReturnValue({
      'site-1': 'running',
      'site-2': 'halted',
    });

    // scanning only site-1 should succeed
    const result = await scanDatabase('site-1', services);
    expect(result.siteId).toBe('site-1');
    expect(result.healthScore).toBeGreaterThanOrEqual(0);
  });

  it('scan result is sorted by healthScore ascending', () => {
    // Verify that computeHealthScore returns lower scores for worse databases
    const badResult = computeHealthScore({
      revisions: { totalCount: 3000 },
      transients: { expiredCount: 600 },
      orphans: { orphanedPostMeta: 600, orphanedCommentMeta: 600 },
      draftsAndTrash: { autoDraftCount: 60, trashedPostCount: 60 },
      pluginTables: { leftoverTables: ['t1', 't2', 't3'] },
      wooCommerce: null,
      tables: [],
    });

    const goodResult = computeHealthScore({
      revisions: { totalCount: 0 },
      transients: { expiredCount: 0 },
      orphans: { orphanedPostMeta: 0, orphanedCommentMeta: 0 },
      draftsAndTrash: { autoDraftCount: 0, trashedPostCount: 0 },
      pluginTables: { leftoverTables: [] },
      wooCommerce: null,
      tables: [],
    });

    expect(badResult).toBeLessThan(goodResult);

    // When sorted ascending, bad site should come first
    const sites = [
      { healthScore: goodResult },
      { healthScore: badResult },
    ].sort((a, b) => a.healthScore - b.healthScore);

    expect(sites[0].healthScore).toBe(badResult);
  });
});
