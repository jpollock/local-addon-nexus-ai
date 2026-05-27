import { WordPressOrgClient } from '../../../src/main/resolver/WordPressOrgClient';

const mockFetch = jest.fn();
global.fetch = mockFetch as any;

afterEach(() => { mockFetch.mockReset(); });

test('returns empty map when plugin list is empty', async () => {
  const result = await WordPressOrgClient.checkUpdates([]);
  expect(result.size).toBe(0);
  expect(mockFetch).not.toHaveBeenCalled();
});

test('returns update version when WP.org reports newer version', async () => {
  mockFetch.mockResolvedValueOnce({
    json: async () => ({
      plugins: { 'elementor/elementor.php': { new_version: '3.22.0', slug: 'elementor' } },
    }),
  });
  const result = await WordPressOrgClient.checkUpdates([{ slug: 'elementor', version: '3.21.0' }]);
  expect(result.get('elementor')).toBe('3.22.0');
});

test('returns empty map when WP.org API is unreachable', async () => {
  mockFetch.mockRejectedValueOnce(new Error('Network error'));
  const result = await WordPressOrgClient.checkUpdates([{ slug: 'elementor', version: '3.21.0' }]);
  expect(result.size).toBe(0);
});

test('skips plugins not in WP.org response', async () => {
  mockFetch.mockResolvedValueOnce({ json: async () => ({ plugins: {} }) });
  const result = await WordPressOrgClient.checkUpdates([{ slug: 'premium-plugin', version: '1.0.0' }]);
  expect(result.size).toBe(0);
});

test('handles multiple plugins in one call', async () => {
  mockFetch.mockResolvedValueOnce({
    json: async () => ({
      plugins: {
        'elementor/elementor.php': { new_version: '3.22.0' },
        'woocommerce/woocommerce.php': { new_version: '8.5.0' },
      },
    }),
  });
  const result = await WordPressOrgClient.checkUpdates([
    { slug: 'elementor', version: '3.21.0' },
    { slug: 'woocommerce', version: '8.4.0' },
  ]);
  expect(result.size).toBe(2);
  expect(result.get('woocommerce')).toBe('8.5.0');
});
