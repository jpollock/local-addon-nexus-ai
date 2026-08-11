import { findOrphanedLocalRows } from '../../../src/main/fleet/localReconciliation';

describe('findOrphanedLocalRows', () => {
  test('returns graph rows with no matching site in Local\'s store', () => {
    const orphans = findOrphanedLocalRows(['a', 'b', 'dead1', 'dead2'], ['a', 'b']);
    expect(orphans.sort()).toEqual(['dead1', 'dead2']);
  });

  test('returns nothing when every graph row still exists', () => {
    expect(findOrphanedLocalRows(['a', 'b'], ['a', 'b', 'c'])).toEqual([]);
  });

  test('a site in Local with no graph row is not an orphan', () => {
    expect(findOrphanedLocalRows(['a'], ['a', 'brand-new'])).toEqual([]);
  });

  test('an empty graph yields no orphans', () => {
    expect(findOrphanedLocalRows([], ['a', 'b'])).toEqual([]);
  });
});
