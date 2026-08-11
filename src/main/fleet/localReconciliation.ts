/**
 * Nothing deactivates a graph row when a local site is deleted from Local.
 * `nexus host remove` soft-deletes external hosts and the retention sweep
 * hard-deletes already-inactive rows, but a deleted *local* site leaves its row
 * at is_active = 1 forever. Measured 2026-08-09: 22 of 56 active source='local'
 * rows were sentinel-* sandbox sites that no longer existed.
 *
 * FleetCounts already avoids this by counting local from Local's own store, so
 * this exists for every *other* consumer of the graph.
 */
export function findOrphanedLocalRows(
  graphLocalIds: string[],
  localStoreIds: string[],
): string[] {
  const live = new Set(localStoreIds);
  return graphLocalIds.filter((id) => !live.has(id));
}
