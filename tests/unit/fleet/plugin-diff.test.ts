import { computePluginDiff } from '../../../src/main/fleet/plugin-diff';

const pluginsA = [
  { slug: 'woocommerce', version: '8.0.0', status: 'active' },
  { slug: 'wordfence',   version: '7.10.0', status: 'active' },
  { slug: 'jetpack',     version: '12.0',   status: 'inactive' },
];

const pluginsB = [
  { slug: 'woocommerce', version: '8.1.0', status: 'active' },
  { slug: 'akismet',     version: '5.0',   status: 'active' },
];

describe('computePluginDiff', () => {
  it('identifies version mismatches', () => {
    const diff = computePluginDiff(pluginsA, pluginsB);
    const mismatch = diff.versionMismatches.find(d => d.slug === 'woocommerce');
    expect(mismatch).toBeDefined();
    expect(mismatch!.versionA).toBe('8.0.0');
    expect(mismatch!.versionB).toBe('8.1.0');
  });

  it('identifies plugins only in A', () => {
    const diff = computePluginDiff(pluginsA, pluginsB);
    const slugs = diff.onlyInA.map(p => p.slug);
    expect(slugs).toContain('wordfence');
    expect(slugs).toContain('jetpack');
    expect(slugs).not.toContain('woocommerce');
  });

  it('identifies plugins only in B', () => {
    const diff = computePluginDiff(pluginsA, pluginsB);
    expect(diff.onlyInB.map(p => p.slug)).toContain('akismet');
  });

  it('returns empty arrays when installs are identical', () => {
    const diff = computePluginDiff(pluginsA, pluginsA);
    expect(diff.versionMismatches).toHaveLength(0);
    expect(diff.onlyInA).toHaveLength(0);
    expect(diff.onlyInB).toHaveLength(0);
  });
});
