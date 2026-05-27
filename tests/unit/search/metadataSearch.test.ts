import { searchMetadata, detectMetadataQueryIntent } from '../../../src/main/search/metadataSearch';
import type { MetadataSearchResult } from '../../../src/common/types';

// Mock db that returns a WPE plugin row
const mockDbWithPlugin = {
  prepare: jest.fn().mockImplementation((sql: string) => ({
    all: jest.fn().mockReturnValue(
      sql.includes('FROM plugins')
        ? [{ site_id: 'wpe-abc', slug: 'elementor/elementor.php', name: 'Elementor', version: '3.21.0', is_active: 1, site_name: 'acme-prod', source: 'wpe-capi' }]
        : sql.includes('php_version')
        ? [{ id: 'wpe-abc', name: 'acme-prod', source: 'wpe-capi' }]
        : sql.includes('wp_version')
        ? [{ id: 'wpe-abc', name: 'acme-prod', source: 'wpe-capi' }]
        : []
    ),
  })),
};

// Mock SiteMetadataCache accessor with one local site that has Elementor
const mockCache = {
  getAll: jest.fn().mockReturnValue({
    'local-123': {
      plugins: [
        { name: 'elementor', title: 'Elementor', version: '3.18.0', status: 'inactive' },
      ],
      themes: [],
    },
  }),
  getSiteNames: jest.fn().mockReturnValue({ 'local-123': 'my-local' }),
};

test('finds plugins in graph.db (WPE)', () => {
  const results = searchMetadata('elementor', mockDbWithPlugin as any, null, 10);
  expect(results.some(r => r.siteId === 'wpe-abc' && r.matchKind === 'plugin')).toBe(true);
  expect(results.find(r => r.siteId === 'wpe-abc')?.siteSource).toBe('wpe');
});

test('finds plugins in local metadata cache', () => {
  const results = searchMetadata('elementor', null, mockCache as any, 10);
  expect(results.some(r => r.siteId === 'local-123' && r.matchKind === 'plugin')).toBe(true);
  expect(results.find(r => r.siteId === 'local-123')?.siteSource).toBe('local');
  expect(results.find(r => r.siteId === 'local-123')?.value).toContain('inactive');
});

test('returns empty array when query is too short (< 3 chars)', () => {
  const results = searchMetadata('el', mockDbWithPlugin as any, mockCache as any, 10);
  expect(results).toEqual([]);
});

test('works with both db and cache together — returns results from both', () => {
  const results = searchMetadata('elementor', mockDbWithPlugin as any, mockCache as any, 10);
  expect(results.some(r => r.siteId === 'wpe-abc')).toBe(true);
  expect(results.some(r => r.siteId === 'local-123')).toBe(true);
});

test('respects limit — caps result count', () => {
  const results = searchMetadata('elementor', mockDbWithPlugin as any, mockCache as any, 1);
  expect(results.length).toBeLessThanOrEqual(1);
});

// ---------------------------------------------------------------------------
// detectMetadataQueryIntent tests
// ---------------------------------------------------------------------------

describe('detectMetadataQueryIntent', () => {
  test.each([
    ['what are my oldest php sites',       'php-sort'],
    ['which sites on old version of PHP',  'php-sort'],
    ['sites that need a PHP upgrade',      'php-sort'],
    ['outdated PHP',                       'php-sort'],
    ['PHP 7 sites',                        'php-sort'],
    ['latest PHP',                         'php-sort'],
    ['newest PHP version',                 'php-sort'],
    ['old WordPress sites',               'wp-sort'],
    ['sites needing WordPress upgrade',   'wp-sort'],
    ['latest WordPress',                  'wp-sort'],
  ])('"%s" → %s', (query, expectedKind) => {
    expect(detectMetadataQueryIntent(query).kind).toBe(expectedKind);
  });

  test.each([
    ['sites with form builders',   'plugin-category', 'form-builder'],
    ['contact form plugin',        'plugin-category', 'form-builder'],
    ['page builder sites',         'plugin-category', 'page-builder'],
    ['visual composer',            'plugin-category', 'page-builder'],
    ['which sites have seo',       'plugin-category', 'seo'],
    ['e-commerce sites',           'plugin-category', 'ecommerce'],
    ['sites with caching',         'plugin-category', 'caching'],
    ['security plugins',           'plugin-category', 'security'],
    ['backup plugin',              'plugin-category', 'backup'],
    ['site speed performance',     'plugin-category', 'performance'],
  ])('"%s" → plugin-category (%s)', (query, expectedKind, expectedCategory) => {
    const result = detectMetadataQueryIntent(query);
    expect(result.kind).toBe(expectedKind);
    if (result.kind === 'plugin-category') {
      expect(result.category).toBe(expectedCategory);
      expect(result.slugs.length).toBeGreaterThan(0);
    }
  });

  test('plain plugin name falls through to substring', () => {
    expect(detectMetadataQueryIntent('elementor').kind).toBe('substring');
    expect(detectMetadataQueryIntent('woocommerce').kind).toBe('substring');
  });
});

// ---------------------------------------------------------------------------
// searchMetadata with sorting queries
// ---------------------------------------------------------------------------

const mockDbWithPhpVersions = {
  prepare: jest.fn().mockImplementation((sql: string) => ({
    all: jest.fn().mockReturnValue(
      sql.includes('php_version') && sql.includes('ORDER BY')
        ? [
            { id: 'site-a', name: 'Old Site',  source: 'wpe-capi', php_version: '7.4', wp_version: null },
            { id: 'site-b', name: 'Newer Site', source: 'wpe-capi', php_version: '8.1', wp_version: null },
          ]
        : sql.includes('FROM plugins')
        ? []
        : []
    ),
  })),
};

test('php-sort query returns sites ordered by php_version', () => {
  const results = searchMetadata('oldest php sites', mockDbWithPhpVersions as any, null, 10);
  expect(results.length).toBeGreaterThan(0);
  expect(results[0].matchKind).toBe('php-version');
  expect(results[0].value).toContain('PHP');
});

test('plugin-category query returns sites with matching slugs', () => {
  const mockDbWithFormBuilder = {
    prepare: jest.fn().mockImplementation((sql: string) => ({
      all: jest.fn().mockReturnValue(
        sql.includes('slug IN')
          ? [{ site_id: 'wpe-abc', slug: 'contact-form-7', name: 'Contact Form 7', version: '5.9', is_active: 1, site_name: 'acme-prod', source: 'wpe-capi' }]
          : []
      ),
    })),
  };
  const results = searchMetadata('sites with form builders', mockDbWithFormBuilder as any, null, 10);
  expect(results.length).toBeGreaterThan(0);
  expect(results[0].matchKind).toBe('plugin');
  expect(results[0].field).toBe('contact-form-7');
});

test('sorts by score descending — active plugins score higher', () => {
  const results = searchMetadata('elementor', mockDbWithPlugin as any, mockCache as any, 10);
  // wpe-abc is active (is_active:1, score 1.0), local-123 is inactive (score 0.7)
  // Active result should come first
  const wpeIdx = results.findIndex(r => r.siteId === 'wpe-abc');
  const localIdx = results.findIndex(r => r.siteId === 'local-123');
  expect(wpeIdx).toBeLessThan(localIdx);
});
