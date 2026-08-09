/**
 * The single definition of "how many sites are in this fleet".
 *
 * Local installs come from Local's own site store, never from the graph — the
 * graph accumulates rows for sites that have since been deleted (22 dead
 * sentinel-* sandbox rows measured 2026-08-09), so a graph-derived local count
 * over-reports badly. WPE and external come from the graph, is_active = 1.
 */

export interface FleetCountsInput {
  /** Keys of Local's own site store (`siteData.getSites()`). */
  localSiteIds: string[];
  /** Active graph rows for non-local sources. */
  graphRows: Array<{ id: string; source: 'wpe' | 'external'; wpeSiteId: string | null }>;
}

export interface PopulationCount {
  count: number;
  /** What this number is scoped to. Rendered wherever the number is; never omitted. */
  scope: string;
}

export interface FleetCounts {
  /** The canonical fleet total. Installs, not parent sites. */
  installs: PopulationCount;
  local: PopulationCount;
  wpe: PopulationCount;
  external: PopulationCount;
  /** Distinct WP Engine parent sites. Strictly smaller than `wpe`. */
  wpeSites: PopulationCount;
}

export function computeFleetCounts(input: FleetCountsInput): FleetCounts {
  const local = input.localSiteIds.length;
  const wpeRows = input.graphRows.filter((r) => r.source === 'wpe');
  const externalRows = input.graphRows.filter((r) => r.source === 'external');

  // A row with no parent id is its own site — never collapse them together.
  const parents = new Set<string>();
  let unparented = 0;
  for (const row of wpeRows) {
    if (row.wpeSiteId) parents.add(row.wpeSiteId);
    else unparented++;
  }

  return {
    installs: {
      count: local + wpeRows.length + externalRows.length,
      scope: 'installs on this Mac, WP Engine and other hosts',
    },
    local: { count: local, scope: 'sites on this Mac' },
    wpe: { count: wpeRows.length, scope: 'WP Engine installs' },
    external: { count: externalRows.length, scope: 'sites on other hosts' },
    wpeSites: { count: parents.size + unparented, scope: 'WP Engine sites' },
  };
}
