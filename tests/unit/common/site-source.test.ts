import { toSiteSource } from '../../../src/common/types';

describe('toSiteSource', () => {
  it.each(['local', 'wpe', 'external'] as const)('passes %s through', (v) => {
    expect(toSiteSource(v)).toBe(v);
  });

  it("defaults null and undefined to 'local' — matching the column default", () => {
    // sites.source is `TEXT DEFAULT "local"` (GraphService.ts:191), so a row
    // written before that migration reads as local, not as an unknown kind.
    expect(toSiteSource(null)).toBe('local');
    expect(toSiteSource(undefined)).toBe('local');
  });

  it("maps an unrecognised value to 'local' rather than silently to 'wpe'", () => {
    // The bug this type exists to prevent: `x === 'local' ? 'local' : 'wpe'`
    // relabelled every unknown source as a WP Engine install.
    expect(toSiteSource('laravel')).toBe('local');
  });
});
