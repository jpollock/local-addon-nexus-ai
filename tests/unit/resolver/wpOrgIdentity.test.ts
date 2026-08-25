/**
 * A0b — the fabricated plugin path, and the answer it can bring back.
 *
 * `checkUpdates()` builds its request key as `slug/slug.php`. That is a
 * GUESS: WordPress plugins routinely name the bootstrap file something else
 * — ACF PRO lives at `advanced-custom-fields-pro/acf.php` — and the real
 * path is not stored anywhere in this codebase (the graph's `plugins` table
 * has no file column, and `slug` is derived from WP-CLI's directory name).
 *
 * The risk that survives A0's version comparison: if wp.org resolves our key
 * to a DIFFERENT plugin, its version is likely genuinely higher than ours, so
 * a version check waves it through. The answer is about another plugin
 * entirely, and no amount of comparing versions can tell.
 *
 * wp.org states which plugin it answered about. These pin that we read it.
 */
import { WordPressOrgClient } from '../../../src/main/resolver/WordPressOrgClient';

const mockFetch = jest.fn();
(global as any).fetch = mockFetch;
beforeEach(() => mockFetch.mockReset());

function replyRaw(plugins: Record<string, unknown>) {
  mockFetch.mockResolvedValueOnce({ json: async () => ({ plugins }) });
}

describe('A0b — the answer must be about the plugin we asked about', () => {
  it('accepts an answer wp.org confirms is the same plugin', async () => {
    replyRaw({ 'elementor/elementor.php': { new_version: '3.22.0', slug: 'elementor' } });
    const r = await WordPressOrgClient.checkUpdates([{ slug: 'elementor', version: '3.21.0' }]);
    expect(r.get('elementor')).toBe('3.22.0');
  });

  it('REFUSES an answer about a different plugin, however new it looks', async () => {
    // The fabricated key resolved to something else on wp.org. The version is
    // higher, so A0's comparison alone would have reported it.
    replyRaw({
      'advanced-custom-fields-pro/advanced-custom-fields-pro.php': {
        new_version: '9.9.9',
        slug: 'advanced-custom-fields',   // NOT the pro plugin we asked about
      },
    });
    const r = await WordPressOrgClient.checkUpdates([
      { slug: 'advanced-custom-fields-pro', version: '6.3.0' },
    ]);
    expect(r.has('advanced-custom-fields-pro')).toBe(false);
  });

  it('still answers when wp.org states no slug — absence is not a mismatch', async () => {
    // Older/edge responses omit it. Withholding on absence would silently
    // stop reporting real updates, which is the opposite failure.
    replyRaw({ 'elementor/elementor.php': { new_version: '3.22.0' } });
    const r = await WordPressOrgClient.checkUpdates([{ slug: 'elementor', version: '3.21.0' }]);
    expect(r.get('elementor')).toBe('3.22.0');
  });

  it('keys the result by OUR slug, so a caller can look up what it asked about', async () => {
    replyRaw({ 'elementor/elementor.php': { new_version: '3.22.0', slug: 'elementor' } });
    const r = await WordPressOrgClient.checkUpdates([{ slug: 'elementor', version: '3.21.0' }]);
    expect([...r.keys()]).toEqual(['elementor']);
  });
});
