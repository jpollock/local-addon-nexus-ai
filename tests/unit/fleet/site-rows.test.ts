import { buildSiteRows } from '../../../src/main/fleet/siteRows';

const local = (id: string, name: string, status = 'running') => ({ id, name, status });
// Mirrors the real `sites` columns. There is deliberately no `completeness`
// field — no such column exists, and a fixture that invents one would let a
// buildSiteRows that reads it pass here and throw in production.
const graph = (over: any) => ({
  id: 'g1', source: 'wpe' as const, name: 'install-a', domain: 'a.example.com',
  wp_version: '6.5', php_version: '8.2',
  host: null, content_indexed_at: null, last_sync_at: 1000, ...over,
});

describe('buildSiteRows', () => {
  test('covers all three sources in one list', () => {
    const out = buildSiteRows({
      localSites: [local('L1', 'My Site')],
      graphRows: [graph({}), graph({ id: 'g2', source: 'external', name: 'hostinger/shop' })],
      indexedSiteIds: new Set<string>(),
    });

    expect(out.rows).toHaveLength(3);
    expect(out.rows.map(r => r.source).sort()).toEqual(['external', 'local', 'wpe']);
  });

  test('the total carries a scope string, never a bare number', () => {
    const out = buildSiteRows({
      localSites: [local('L1', 'My Site')], graphRows: [], indexedSiteIds: new Set(),
    });
    expect(out.total.count).toBe(1);
    expect(out.total.scope).toBeTruthy();
  });

  test('an indexed external host is searchable', () => {
    // The Task 1 correction, asserted at the layer the UI actually reads.
    const out = buildSiteRows({
      localSites: [],
      graphRows: [graph({ id: 'x1', source: 'external', content_indexed_at: 5000 })],
      indexedSiteIds: new Set(),
    });
    expect(out.rows[0].knowledge).toBe('searchable');
  });

  test('either indexing signal alone is enough', () => {
    // The registry is the live view; content_indexed_at is what the last sync
    // wrote. They can disagree, and trusting only one under-reports.
    const viaRegistry = buildSiteRows({
      localSites: [], graphRows: [graph({ id: 'w1', content_indexed_at: null })],
      indexedSiteIds: new Set(['w1']),
    });
    expect(viaRegistry.rows[0].knowledge).toBe('searchable');

    const viaColumn = buildSiteRows({
      localSites: [], graphRows: [graph({ id: 'w2', content_indexed_at: 5000 })],
      indexedSiteIds: new Set(),
    });
    expect(viaColumn.rows[0].knowledge).toBe('searchable');
  });

  test('a row with a wp_version but no indexing is detailed', () => {
    const out = buildSiteRows({
      localSites: [], graphRows: [graph({ id: 'w3', wp_version: '6.5' })],
      indexedSiteIds: new Set(),
    });
    expect(out.rows[0].knowledge).toBe('detailed');
  });

  test('a row with nothing collected reads as nothing', () => {
    const out = buildSiteRows({
      localSites: [], graphRows: [graph({ id: 'w4', wp_version: null })],
      indexedSiteIds: new Set(),
    });
    expect(out.rows[0].knowledge).toBe('nothing');
  });

  test('a local site absent from the graph still appears', () => {
    // Local's store is authoritative for local sites; a site that has never
    // been indexed has no graph row and must not vanish from the table.
    const out = buildSiteRows({
      localSites: [local('L9', 'Never Indexed')], graphRows: [], indexedSiteIds: new Set(),
    });
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0].knowledge).toBe('nothing');
  });

  test('a graph row for a deleted local site is not resurrected', () => {
    // The 22 dead sentinel-* rows. Local rows come from Local's store, full stop.
    const out = buildSiteRows({
      localSites: [],
      graphRows: [graph({ id: 'sentinel-dead', source: 'local' as any })],
      indexedSiteIds: new Set(),
    });
    expect(out.rows).toHaveLength(0);
  });

  test('external rows carry the host name for display', () => {
    const out = buildSiteRows({
      localSites: [],
      graphRows: [graph({ id: 'ssh:hostinger/shop', source: 'external', name: 'shop' })],
      indexedSiteIds: new Set(),
    });
    expect(out.rows[0].host).toBe('hostinger');
  });

  test('the row count matches computeFleetCounts on the same input', () => {
    const { computeFleetCounts } = require('../../../src/main/fleet/FleetCounts');
    const graphRows = [
      graph({ id: 'w1' }), graph({ id: 'w2' }),
      graph({ id: 'x1', source: 'external' }),
    ];
    const rows = buildSiteRows({
      localSites: [local('L1', 'a'), local('L2', 'b')], graphRows, indexedSiteIds: new Set(),
    });
    const counts = computeFleetCounts({
      localSiteIds: ['L1', 'L2'],
      graphRows: graphRows.map((g: any) => ({ id: g.id, source: g.source, wpeSiteId: null })),
    });
    // Anchor to a known-correct value as well as to agreement. Two functions
    // that agree can still both be wrong; only the literal catches that.
    expect(rows.total.count).toBe(5);          // 2 local + 2 WPE + 1 external
    // Two definitions of "the fleet" that disagree is the bug the foundation
    // spec removed. They must not drift apart again.
    expect(rows.total.count).toBe(counts.installs.count);
  });

  test('a local site Local knows the WP version of is detailed, not nothing', () => {
    // ~113 sites on a real machine. Reporting "Nothing yet" for a site we have
    // the WP version of understates what we know — the same defect as the
    // external cap, with the sign flipped.
    const out = buildSiteRows({
      localSites: [{ id: 'L1', name: 'My Site', status: 'running', wpVersion: '6.5' }],
      graphRows: [], indexedSiteIds: new Set(),
    });
    expect(out.rows[0].knowledge).toBe('detailed');
    expect(out.rows[0].wpVersion).toBe('6.5');
  });

  test('an indexed local site is searchable regardless of version', () => {
    const out = buildSiteRows({
      localSites: [{ id: 'L2', name: 'Indexed', wpVersion: null }],
      graphRows: [], indexedSiteIds: new Set(['L2']),
    });
    expect(out.rows[0].knowledge).toBe('searchable');
  });
});
