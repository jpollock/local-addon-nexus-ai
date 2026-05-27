import type { DataProvenance, ResolvedData, ResolvedPluginInfo } from '../../../src/common/types';

test('DataProvenance level union has all expected values', () => {
  const levels: DataProvenance['level'][] = ['live', 'configured', 'scanned', 'external-api'];
  expect(levels.length).toBe(4);
});

test('ResolvedData wraps any type with provenance', () => {
  const result: ResolvedData<string[]> = {
    data: ['a', 'b'],
    provenance: { level: 'configured', source: 'SiteMetadataCache', ageSeconds: 3600, caveat: 'Start site for fresh data' },
  };
  expect(result.data.length).toBe(2);
  expect(result.provenance.level).toBe('configured');
});

test('ResolvedPluginInfo has update field', () => {
  const plugin: ResolvedPluginInfo = {
    name: 'Elementor', slug: 'elementor', version: '3.21.0',
    status: 'active', updateAvailable: '3.22.0',
  };
  expect(plugin.updateAvailable).toBe('3.22.0');
});
