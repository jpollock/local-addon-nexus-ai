import { extractProducts } from '../../../src/main/content/extractors/WooCommerceExtractor';

function createMockConnection(
  products: any[],
  metaRows: any[] = [],
  taxRows: any[] = [],
) {
  return {
    query: jest.fn()
      .mockResolvedValueOnce([products])   // product query
      .mockResolvedValueOnce([metaRows])   // meta query
      .mockResolvedValueOnce([taxRows]),   // taxonomy query
  } as any;
}

describe('WooCommerceExtractor edge cases', () => {
  test('variable product with 50+ variations does not crash', async () => {
    // Build 50 variation taxonomy entries for a single product
    const taxRows = Array.from({ length: 50 }, (_, i) => ({
      object_id: 200,
      name: `Variation ${i + 1}`,
      taxonomy: 'pa_size',
    }));

    const conn = createMockConnection(
      [
        {
          ID: 200,
          post_title: 'Size Chart Product',
          post_content: '<p>Many sizes</p>',
          post_excerpt: '',
          post_date: '2024-01-01',
          post_author: '1',
        },
      ],
      [
        { post_id: 200, meta_key: '_price', meta_value: '29.99' },
        { post_id: 200, meta_key: '_product_type', meta_value: 'variable' },
        { post_id: 200, meta_key: '_stock_status', meta_value: 'instock' },
      ],
      taxRows,
    );

    const result = await extractProducts(conn, 'wp_');

    expect(result).toHaveLength(1);
    expect(result[0].cleanedContent).toContain('Attributes:');
    expect(result[0].cleanedContent).toContain('size:');
  });

  test('missing _price meta produces graceful output', async () => {
    const conn = createMockConnection(
      [
        {
          ID: 201,
          post_title: 'No Price Product',
          post_content: '<p>A product without a price</p>',
          post_excerpt: '',
          post_date: '2024-01-01',
          post_author: '1',
        },
      ],
      [
        { post_id: 201, meta_key: '_product_type', meta_value: 'simple' },
        { post_id: 201, meta_key: '_stock_status', meta_value: 'instock' },
      ],
    );

    const result = await extractProducts(conn, 'wp_');

    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('No Price Product');
    expect(result[0].cleanedContent).toContain('simple product');
    // Should not contain "priced at $" when no price
    expect(result[0].cleanedContent).not.toContain('priced at $');
  });

  test('empty _price meta handled gracefully', async () => {
    const conn = createMockConnection(
      [
        {
          ID: 202,
          post_title: 'Empty Price Product',
          post_content: '',
          post_excerpt: '',
          post_date: '2024-01-01',
          post_author: '1',
        },
      ],
      [
        { post_id: 202, meta_key: '_price', meta_value: '' },
        { post_id: 202, meta_key: '_product_type', meta_value: 'simple' },
        { post_id: 202, meta_key: '_stock_status', meta_value: 'instock' },
      ],
    );

    const result = await extractProducts(conn, 'wp_');

    expect(result).toHaveLength(1);
    expect(result[0].cleanedContent).not.toContain('priced at $');
  });

  test('non-numeric price ("contact-for-price") does not crash', async () => {
    const conn = createMockConnection(
      [
        {
          ID: 203,
          post_title: 'Contact Price Product',
          post_content: '',
          post_excerpt: '',
          post_date: '2024-01-01',
          post_author: '1',
        },
      ],
      [
        { post_id: 203, meta_key: '_price', meta_value: 'contact-for-price' },
        { post_id: 203, meta_key: '_product_type', meta_value: 'simple' },
        { post_id: 203, meta_key: '_stock_status', meta_value: 'instock' },
      ],
    );

    expect(async () => {
      const result = await extractProducts(conn, 'wp_');
      expect(result).toHaveLength(1);
    }).not.toThrow();
  });

  test('Unicode category names preserved', async () => {
    const conn = createMockConnection(
      [
        {
          ID: 204,
          post_title: 'Japanese Product',
          post_content: '',
          post_excerpt: '',
          post_date: '2024-01-01',
          post_author: '1',
        },
      ],
      [
        { post_id: 204, meta_key: '_price', meta_value: '50.00' },
        { post_id: 204, meta_key: '_product_type', meta_value: 'simple' },
        { post_id: 204, meta_key: '_stock_status', meta_value: 'instock' },
      ],
      [
        { object_id: 204, name: '電子機器', taxonomy: 'product_cat' },
        { object_id: 204, name: 'セール', taxonomy: 'product_tag' },
      ],
    );

    const result = await extractProducts(conn, 'wp_');

    expect(result).toHaveLength(1);
    expect(result[0].cleanedContent).toContain('電子機器');
    expect(result[0].categories).toEqual(['電子機器']);
    expect(result[0].tags).toEqual(['セール']);
  });

  test('null meta_value does not crash', async () => {
    const conn = createMockConnection(
      [
        {
          ID: 205,
          post_title: 'Null Meta Product',
          post_content: '',
          post_excerpt: '',
          post_date: '2024-01-01',
          post_author: '1',
        },
      ],
      [
        { post_id: 205, meta_key: '_price', meta_value: null },
        { post_id: 205, meta_key: '_product_type', meta_value: null },
        { post_id: 205, meta_key: '_stock_status', meta_value: null },
      ],
    );

    const result = await extractProducts(conn, 'wp_');

    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('Null Meta Product');
  });
});
