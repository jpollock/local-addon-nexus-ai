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

describe('WooCommerceExtractor', () => {
  test('extracts products with price and SKU', async () => {
    const conn = createMockConnection(
      [
        {
          ID: 100,
          post_title: 'Blue Coffee Mug',
          post_content: '<p>A beautiful blue ceramic coffee mug.</p>',
          post_excerpt: 'Premium ceramic mug',
          post_date: '2024-03-15',
          post_author: '1',
        },
      ],
      [
        { post_id: 100, meta_key: '_price', meta_value: '24.99' },
        { post_id: 100, meta_key: '_regular_price', meta_value: '24.99' },
        { post_id: 100, meta_key: '_sku', meta_value: 'MUG-BLU-001' },
        { post_id: 100, meta_key: '_stock_status', meta_value: 'instock' },
        { post_id: 100, meta_key: '_product_type', meta_value: 'simple' },
      ],
      [
        { object_id: 100, name: 'Kitchen', taxonomy: 'product_cat' },
      ],
    );

    const result = await extractProducts(conn, 'wp_');

    expect(result).toHaveLength(1);
    expect(result[0].postType).toBe('product');
    expect(result[0].title).toBe('Blue Coffee Mug');
    expect(result[0].cleanedContent).toContain('priced at $24.99');
    expect(result[0].cleanedContent).toContain('SKU: MUG-BLU-001');
    expect(result[0].cleanedContent).toContain('Stock: instock');
    expect(result[0].cleanedContent).toContain('Categories: Kitchen');
    expect(result[0].customFields._price).toBe('24.99');
    expect(result[0].customFields._sku).toBe('MUG-BLU-001');
    expect(result[0].categories).toEqual(['Kitchen']);
  });

  test('handles sale prices', async () => {
    const conn = createMockConnection(
      [
        {
          ID: 101,
          post_title: 'Holiday Sweater',
          post_content: '',
          post_excerpt: 'Cozy holiday sweater',
          post_date: '2024-12-01',
          post_author: '1',
        },
      ],
      [
        { post_id: 101, meta_key: '_price', meta_value: '29.99' },
        { post_id: 101, meta_key: '_regular_price', meta_value: '49.99' },
        { post_id: 101, meta_key: '_sale_price', meta_value: '29.99' },
        { post_id: 101, meta_key: '_stock_status', meta_value: 'instock' },
        { post_id: 101, meta_key: '_product_type', meta_value: 'simple' },
      ],
    );

    const result = await extractProducts(conn, 'wp_');

    expect(result[0].cleanedContent).toContain('$29.99 (was $49.99)');
    expect(result[0].customFields._sale_price).toBe('29.99');
  });

  test('includes product attributes', async () => {
    const conn = createMockConnection(
      [
        {
          ID: 102,
          post_title: 'V-Neck T-Shirt',
          post_content: '',
          post_excerpt: '',
          post_date: '2024-02-01',
          post_author: '1',
        },
      ],
      [
        { post_id: 102, meta_key: '_price', meta_value: '19.99' },
        { post_id: 102, meta_key: '_product_type', meta_value: 'variable' },
        { post_id: 102, meta_key: '_stock_status', meta_value: 'instock' },
      ],
      [
        { object_id: 102, name: 'Red', taxonomy: 'pa_color' },
        { object_id: 102, name: 'Blue', taxonomy: 'pa_color' },
        { object_id: 102, name: 'Large', taxonomy: 'pa_size' },
        { object_id: 102, name: 'T-Shirts', taxonomy: 'product_cat' },
        { object_id: 102, name: 'summer', taxonomy: 'product_tag' },
      ],
    );

    const result = await extractProducts(conn, 'wp_');

    expect(result[0].cleanedContent).toContain('Attributes: color: Red, Blue');
    expect(result[0].cleanedContent).toContain('size: Large');
    expect(result[0].cleanedContent).toContain('Categories: T-Shirts');
    expect(result[0].tags).toEqual(['summer']);
    expect(result[0].customFields._product_type).toBe('variable');
  });

  test('handles products with no meta', async () => {
    const conn = createMockConnection(
      [
        {
          ID: 103,
          post_title: 'Basic Product',
          post_content: '<p>Just a product</p>',
          post_excerpt: '',
          post_date: '2024-01-01',
          post_author: '1',
        },
      ],
    );

    const result = await extractProducts(conn, 'wp_');

    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('Basic Product');
    expect(result[0].cleanedContent).toContain('simple product');
    expect(result[0].cleanedContent).toContain('Stock: instock');
  });

  test('handles empty database', async () => {
    const conn = {
      query: jest.fn().mockResolvedValueOnce([[]]),
    } as any;

    const result = await extractProducts(conn, 'wp_');
    expect(result).toEqual([]);
  });

  test('cleans HTML from product descriptions', async () => {
    const conn = createMockConnection(
      [
        {
          ID: 104,
          post_title: 'Fancy Product',
          post_content: '<h2>Features</h2><ul><li>Feature 1</li><li>Feature 2</li></ul>',
          post_excerpt: '',
          post_date: '2024-01-01',
          post_author: '1',
        },
      ],
      [
        { post_id: 104, meta_key: '_price', meta_value: '99.99' },
        { post_id: 104, meta_key: '_product_type', meta_value: 'simple' },
        { post_id: 104, meta_key: '_stock_status', meta_value: 'instock' },
      ],
    );

    const result = await extractProducts(conn, 'wp_');

    expect(result[0].cleanedContent).toContain('Features Feature 1 Feature 2');
    expect(result[0].cleanedContent).not.toContain('<');
  });

  test('multiple products extracted correctly', async () => {
    const conn = createMockConnection(
      [
        {
          ID: 105, post_title: 'Product A', post_content: '', post_excerpt: '',
          post_date: '2024-01-01', post_author: '1',
        },
        {
          ID: 106, post_title: 'Product B', post_content: '', post_excerpt: '',
          post_date: '2024-01-02', post_author: '1',
        },
      ],
      [
        { post_id: 105, meta_key: '_price', meta_value: '10.00' },
        { post_id: 105, meta_key: '_product_type', meta_value: 'simple' },
        { post_id: 106, meta_key: '_price', meta_value: '20.00' },
        { post_id: 106, meta_key: '_product_type', meta_value: 'simple' },
      ],
      [
        { object_id: 105, name: 'Category A', taxonomy: 'product_cat' },
        { object_id: 106, name: 'Category B', taxonomy: 'product_cat' },
      ],
    );

    const result = await extractProducts(conn, 'wp_');

    expect(result).toHaveLength(2);
    expect(result[0].title).toBe('Product A');
    expect(result[0].customFields._price).toBe('10.00');
    expect(result[1].title).toBe('Product B');
    expect(result[1].customFields._price).toBe('20.00');
  });

  test('handles out of stock products', async () => {
    const conn = createMockConnection(
      [
        {
          ID: 107, post_title: 'Sold Out Item', post_content: '', post_excerpt: '',
          post_date: '2024-01-01', post_author: '1',
        },
      ],
      [
        { post_id: 107, meta_key: '_price', meta_value: '15.00' },
        { post_id: 107, meta_key: '_stock_status', meta_value: 'outofstock' },
        { post_id: 107, meta_key: '_product_type', meta_value: 'simple' },
      ],
    );

    const result = await extractProducts(conn, 'wp_');

    expect(result[0].cleanedContent).toContain('Stock: outofstock');
    expect(result[0].customFields._stock_status).toBe('outofstock');
  });
});
