/**
 * Operations rendered 37 rows in arrival order, every one reading
 * "halted · Searchable · 7h ago", so scanning was pointless. Sort by what
 * actually needs a human.
 */

export interface AttentionRow {
  failing: boolean;
  /** Epoch ms of the last successful sync, or null if never synced. */
  lastSyncAt: number | null;
}

export function sortByAttention<T extends AttentionRow>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    if (a.failing !== b.failing) return a.failing ? -1 : 1;
    // Never synced is the most stale thing there is.
    const aAge = a.lastSyncAt ?? -Infinity;
    const bAge = b.lastSyncAt ?? -Infinity;
    return aAge - bAge;
  });
}
