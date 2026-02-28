import { discoverCustomTables } from '../../../src/main/content/extractors/CustomTableDiscovery';

function createMockConnection(tables: Array<{ Name: string; Rows: number }>) {
  return {
    query: jest.fn().mockResolvedValue([tables]),
  } as any;
}

describe('CustomTableDiscovery', () => {
  test('filters out WordPress core tables', async () => {
    const conn = createMockConnection([
      { Name: 'wp_posts', Rows: 100 },
      { Name: 'wp_postmeta', Rows: 500 },
      { Name: 'wp_options', Rows: 200 },
      { Name: 'wp_comments', Rows: 50 },
      { Name: 'wp_users', Rows: 5 },
      { Name: 'wp_wc_orders', Rows: 42 },
    ]);

    const result = await discoverCustomTables(conn, 'wp_');

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('wp_wc_orders');
    expect(result[0].rowCount).toBe(42);
  });

  test('identifies WooCommerce tables', async () => {
    const conn = createMockConnection([
      { Name: 'wp_wc_orders', Rows: 42 },
      { Name: 'wp_wc_product_meta_lookup', Rows: 15 },
      { Name: 'wp_woocommerce_sessions', Rows: 3 },
    ]);

    const result = await discoverCustomTables(conn, 'wp_');

    expect(result).toHaveLength(3);
    expect(result.every((t) => t.pluginGuess === 'WooCommerce')).toBe(true);
  });

  test('identifies Action Scheduler tables', async () => {
    const conn = createMockConnection([
      { Name: 'wp_actionscheduler_actions', Rows: 100 },
      { Name: 'wp_actionscheduler_logs', Rows: 500 },
    ]);

    const result = await discoverCustomTables(conn, 'wp_');

    expect(result).toHaveLength(2);
    expect(result.every((t) => t.pluginGuess === 'Action Scheduler')).toBe(true);
  });

  test('marks unknown tables', async () => {
    const conn = createMockConnection([
      { Name: 'wp_custom_plugin_data', Rows: 10 },
    ]);

    const result = await discoverCustomTables(conn, 'wp_');

    expect(result).toHaveLength(1);
    expect(result[0].pluginGuess).toBe('Unknown');
  });

  test('handles empty database', async () => {
    const conn = createMockConnection([]);

    const result = await discoverCustomTables(conn, 'wp_');
    expect(result).toEqual([]);
  });

  test('skips tables with different prefix', async () => {
    const conn = createMockConnection([
      { Name: 'wp_posts', Rows: 100 },
      { Name: 'other_custom_table', Rows: 10 },
      { Name: 'wp_wc_orders', Rows: 42 },
    ]);

    const result = await discoverCustomTables(conn, 'wp_');

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('wp_wc_orders');
  });

  test('handles non-standard prefix', async () => {
    const conn = createMockConnection([
      { Name: 'mysite_posts', Rows: 100 },
      { Name: 'mysite_wc_orders', Rows: 42 },
    ]);

    const result = await discoverCustomTables(conn, 'mysite_');

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('mysite_wc_orders');
    expect(result[0].pluginGuess).toBe('WooCommerce');
  });

  test('identifies Yoast SEO tables', async () => {
    const conn = createMockConnection([
      { Name: 'wp_yoast_seo_links', Rows: 200 },
      { Name: 'wp_yoast_indexable', Rows: 100 },
    ]);

    const result = await discoverCustomTables(conn, 'wp_');

    expect(result).toHaveLength(2);
    expect(result.every((t) => t.pluginGuess === 'Yoast SEO')).toBe(true);
  });
});
