import { sortByAttention } from '../../../src/main/fleet/operationsSort';

describe('sortByAttention', () => {
  test('failing rows come before stale ones, stale before healthy', () => {
    const out = sortByAttention([
      { id: 'healthy', failing: false, lastSyncAt: Date.now() },
      { id: 'failing', failing: true, lastSyncAt: Date.now() },
      { id: 'stale', failing: false, lastSyncAt: 0 },
    ]);
    expect(out.map((r) => r.id)).toEqual(['failing', 'stale', 'healthy']);
  });

  test('among stale rows the oldest comes first', () => {
    const out = sortByAttention([
      { id: 'newer', failing: false, lastSyncAt: 5_000 },
      { id: 'older', failing: false, lastSyncAt: 1_000 },
    ]);
    expect(out.map((r) => r.id)).toEqual(['older', 'newer']);
  });

  test('a never-synced row sorts as the most stale', () => {
    const out = sortByAttention([
      { id: 'synced', failing: false, lastSyncAt: 1_000 },
      { id: 'never', failing: false, lastSyncAt: null },
    ]);
    expect(out.map((r) => r.id)).toEqual(['never', 'synced']);
  });

  test('does not mutate its input', () => {
    const input = [{ id: 'a', failing: false, lastSyncAt: 2 }, { id: 'b', failing: true, lastSyncAt: 1 }];
    sortByAttention(input);
    expect(input.map((r) => r.id)).toEqual(['a', 'b']);
  });
});
