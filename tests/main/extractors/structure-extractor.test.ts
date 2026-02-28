import { extractSiteStructureData } from '../../../src/main/content/extractors/StructureExtractor';

function createMockConnection(
  optionRows: any[],
  roleRows: any[] = [],
) {
  return {
    query: jest.fn()
      .mockResolvedValueOnce([optionRows])  // options query
      .mockResolvedValueOnce([roleRows]),    // usermeta query
  } as any;
}

// Helper to build a PHP serialized array of strings
// e.g. a:2:{i:0;s:27:"woocommerce/woocommerce.php";i:1;s:9:"hello.php";}
function phpSerializeStringArray(items: string[]): string {
  const entries = items
    .map((s, i) => `i:${i};s:${s.length}:"${s}";`)
    .join('');
  return `a:${items.length}:{${entries}}`;
}

// Helper to build a PHP serialized capabilities value
// e.g. a:1:{s:13:"administrator";b:1;}
function phpSerializeCapabilities(role: string): string {
  return `a:1:{s:${role.length}:"${role}";b:1;}`;
}

describe('StructureExtractor', () => {
  test('detects active theme slug', async () => {
    const conn = createMockConnection([
      { option_name: 'stylesheet', option_value: 'flavor-starter-child' },
      { option_name: 'template', option_value: 'flavor-starter' },
    ]);

    const result = await extractSiteStructureData(conn, 'wp_');

    expect(result.activeThemeSlug).toBe('flavor-starter-child');
    expect(result.parentThemeSlug).toBe('flavor-starter');
  });

  test('detects active theme without child theme', async () => {
    const conn = createMockConnection([
      { option_name: 'stylesheet', option_value: 'flavor-starter' },
      { option_name: 'template', option_value: 'flavor-starter' },
    ]);

    const result = await extractSiteStructureData(conn, 'wp_');

    expect(result.activeThemeSlug).toBe('flavor-starter');
    expect(result.parentThemeSlug).toBe('flavor-starter');
  });

  test('parses active plugins from serialized array', async () => {
    const serialized = phpSerializeStringArray([
      'woocommerce/woocommerce.php',
      'advanced-custom-fields/acf.php',
      'hello.php',
    ]);

    const conn = createMockConnection([
      { option_name: 'active_plugins', option_value: serialized },
    ]);

    const result = await extractSiteStructureData(conn, 'wp_');

    expect(result.activePluginSlugs).toEqual([
      'woocommerce',
      'advanced-custom-fields',
      'hello',
    ]);
  });

  test('extracts user role breakdown', async () => {
    const conn = createMockConnection(
      [],
      [
        { meta_value: phpSerializeCapabilities('administrator'), cnt: 2 },
        { meta_value: phpSerializeCapabilities('editor'), cnt: 3 },
        { meta_value: phpSerializeCapabilities('subscriber'), cnt: 45 },
      ],
    );

    const result = await extractSiteStructureData(conn, 'wp_');

    expect(result.users.totalUsers).toBe(50);
    expect(result.users.roleBreakdown.administrator).toBe(2);
    expect(result.users.roleBreakdown.editor).toBe(3);
    expect(result.users.roleBreakdown.subscriber).toBe(45);
  });

  test('identifies custom roles', async () => {
    const conn = createMockConnection(
      [],
      [
        { meta_value: phpSerializeCapabilities('administrator'), cnt: 1 },
        { meta_value: phpSerializeCapabilities('support_agent'), cnt: 5 },
      ],
    );

    const result = await extractSiteStructureData(conn, 'wp_');

    expect(result.users.customRoles).toEqual(['support_agent']);
  });

  test('does not treat shop_manager as custom role', async () => {
    const conn = createMockConnection(
      [],
      [
        { meta_value: phpSerializeCapabilities('shop_manager'), cnt: 2 },
      ],
    );

    const result = await extractSiteStructureData(conn, 'wp_');

    expect(result.users.customRoles).toEqual([]);
  });

  test('parses permalink structure', async () => {
    const conn = createMockConnection([
      { option_name: 'permalink_structure', option_value: '/%postname%/' },
    ]);

    const result = await extractSiteStructureData(conn, 'wp_');

    expect(result.permalinks.structure).toBe('/%postname%/');
  });

  test('counts rewrite rules from serialized data', async () => {
    // Simulate a small rewrite_rules serialized associative array
    const serialized = 'a:3:{s:7:"rule_01";s:5:"val_1";s:7:"rule_02";s:5:"val_2";s:7:"rule_03";s:5:"val_3";}';
    const conn = createMockConnection([
      { option_name: 'rewrite_rules', option_value: serialized },
    ]);

    const result = await extractSiteStructureData(conn, 'wp_');

    expect(result.permalinks.totalRewriteRules).toBe(3);
  });

  test('extracts site health fields', async () => {
    const conn = createMockConnection([
      { option_name: 'blog_public', option_value: '1' },
      { option_name: 'WPLANG', option_value: 'fr_FR' },
      { option_name: 'timezone_string', option_value: 'Europe/Paris' },
      { option_name: 'default_role', option_value: 'subscriber' },
    ]);

    const result = await extractSiteStructureData(conn, 'wp_');

    expect(result.health.searchEngineVisibility).toBe(true);
    expect(result.health.language).toBe('fr_FR');
    expect(result.health.timezone).toBe('Europe/Paris');
    expect(result.health.defaultRole).toBe('subscriber');
  });

  test('detects search engine blocking', async () => {
    const conn = createMockConnection([
      { option_name: 'blog_public', option_value: '0' },
    ]);

    const result = await extractSiteStructureData(conn, 'wp_');

    expect(result.health.searchEngineVisibility).toBe(false);
  });

  test('falls back to gmt_offset when timezone_string is empty', async () => {
    const conn = createMockConnection([
      { option_name: 'timezone_string', option_value: '' },
      { option_name: 'gmt_offset', option_value: '-5' },
    ]);

    const result = await extractSiteStructureData(conn, 'wp_');

    expect(result.health.timezone).toBe('UTC-5');
  });

  test('handles empty options gracefully', async () => {
    const conn = createMockConnection([]);

    const result = await extractSiteStructureData(conn, 'wp_');

    expect(result.activeThemeSlug).toBe('');
    expect(result.activePluginSlugs).toEqual([]);
    expect(result.users.totalUsers).toBe(0);
    expect(result.permalinks.structure).toBe('/?p=%post_id%');
    expect(result.health.language).toBe('en_US');
    expect(result.health.timezone).toBe('UTC');
    expect(result.health.defaultRole).toBe('subscriber');
  });

  test('parses active plugins with non-sequential keys', async () => {
    // WordPress leaves gaps in keys after deactivating plugins
    const serialized = 'a:3:{i:0;s:30:"advanced-custom-fields/acf.php";i:3;s:31:"query-monitor/query-monitor.php";i:5;s:27:"woocommerce/woocommerce.php";}';

    const conn = createMockConnection([
      { option_name: 'active_plugins', option_value: serialized },
    ]);

    const result = await extractSiteStructureData(conn, 'wp_');

    expect(result.activePluginSlugs).toEqual([
      'advanced-custom-fields',
      'query-monitor',
      'woocommerce',
    ]);
  });

  test('handles malformed active_plugins gracefully', async () => {
    const conn = createMockConnection([
      { option_name: 'active_plugins', option_value: 'not-serialized-data' },
    ]);

    const result = await extractSiteStructureData(conn, 'wp_');

    expect(result.activePluginSlugs).toEqual([]);
  });

  test('handles malformed capabilities gracefully', async () => {
    const conn = createMockConnection(
      [],
      [
        { meta_value: 'bad-serialized-data', cnt: 5 },
      ],
    );

    const result = await extractSiteStructureData(conn, 'wp_');

    // Should still count users but no roles
    expect(result.users.totalUsers).toBe(5);
    expect(Object.keys(result.users.roleBreakdown)).toHaveLength(0);
  });

  test('uses correct capabilities meta key with prefix', async () => {
    const conn = createMockConnection([], []);

    await extractSiteStructureData(conn, 'wp_');

    // Second call should query with the correct meta_key
    expect(conn.query).toHaveBeenCalledTimes(2);
    const [, params] = conn.query.mock.calls[1];
    expect(params).toEqual(['wp_capabilities']);
  });
});
