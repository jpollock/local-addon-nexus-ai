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
  graphRows: Array<{
    id: string;
    source: 'wpe' | 'external';
    wpeSiteId: string | null;
    accountId: string | null;
    lastSyncAt: number | null;
  }>;
  /** Account IDs to include in WPE scope. Null = all accounts in scope. */
  wpeAccountFilter: string[] | null;
  /** Site rows with knowledge ladder and indexed state. Null when unavailable. */
  siteRows: Array<{
    id: string;
    knowledge: 'Unknown' | 'Basic' | 'Familiar' | 'Deep';
    lastSyncFailed: boolean;
  }> | null;
  /** Pending item count per site. Null when unavailable. */
  pendingBySite: Record<string, number> | null;
  /** Index registry entries. Null when unavailable. */
  indexEntries: Array<{
    siteId: string;
    state: 'indexed' | 'stale' | 'indexing' | 'error' | 'never';
    documentCount: number;
  }> | null;
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
  /** WPE accounts total and in-scope. */
  wpeAccounts: {
    total: number;
    inScope: number;
    /** E.g. "14 accounts · 11 in scope" or "14 accounts connected" when all are in scope. */
    label: string;
  };
  /**
   * Sites needing attention: pending items OR knowledge Basic OR last sync failed.
   * Null when any required input is unavailable.
   */
  needsAttention: PopulationCount | null;
  /**
   * Index/searchable figures. Honest phrasing — never "sites" when it's really
   * entries or documents. Null when index data unavailable.
   */
  indexed: {
    /** Distinct sites with state 'indexed' or 'stale'. */
    sitesIndexed: number;
    /** Total index registry entries (can exceed fleet count — includes deleted sites). */
    entriesIndexed: number;
    /** Total document count across all indexed entries. */
    documentCount: number;
    /** E.g. "449 documents across 312 sites" or "312 sites indexed · 8,234 documents". */
    label: string;
  } | null;
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

  // WPE accounts: total distinct account_id values, and how many are in scope.
  const allAccounts = new Set<string>();
  const scopedAccounts = new Set<string>();
  for (const row of wpeRows) {
    if (row.accountId) {
      allAccounts.add(row.accountId);
      // When filter is null, all accounts are in scope. Otherwise check membership.
      if (input.wpeAccountFilter === null || input.wpeAccountFilter.includes(row.accountId)) {
        scopedAccounts.add(row.accountId);
      }
    }
  }
  const totalAccounts = allAccounts.size;
  const inScopeAccounts = scopedAccounts.size;
  const accountsLabel = totalAccounts === inScopeAccounts
    ? `${totalAccounts} account${totalAccounts === 1 ? '' : 's'} connected`
    : `${totalAccounts} accounts · ${inScopeAccounts} in scope`;

  // Needs-attention: pending items OR knowledge Basic OR last sync failed.
  // Null when any input is unavailable.
  let needsAttention: PopulationCount | null = null;
  if (input.siteRows !== null && input.pendingBySite !== null) {
    const needsSet = new Set<string>();
    for (const row of input.siteRows) {
      const hasPending = (input.pendingBySite[row.id] ?? 0) > 0;
      const isBasic = row.knowledge === 'Basic';
      const failed = row.lastSyncFailed;
      if (hasPending || isBasic || failed) {
        needsSet.add(row.id);
      }
    }
    needsAttention = {
      count: needsSet.size,
      scope: 'sites needing attention',
    };
  }

  // Indexed: honest labeling. Never "sites" when it's really entries/documents.
  let indexed: FleetCounts['indexed'] = null;
  if (input.indexEntries !== null) {
    const indexedEntries = input.indexEntries.filter(
      (e) => e.state === 'indexed' || e.state === 'stale',
    );
    const entriesCount = indexedEntries.length;
    // Distinct site ids — the honest "sites" count.
    const sitesIndexed = new Set(indexedEntries.map((e) => e.siteId)).size;
    const documentCount = indexedEntries.reduce((sum, e) => sum + e.documentCount, 0);

    // Label: lead with the number the user sees (entries), clarify the population.
    // If sitesIndexed === entriesCount, the "across N sites" clause is redundant.
    const label = sitesIndexed === entriesCount
      ? `${entriesCount} site${entriesCount === 1 ? '' : 's'} indexed · ${documentCount.toLocaleString('en-US')} documents`
      : `${entriesCount} entries across ${sitesIndexed} sites · ${documentCount.toLocaleString('en-US')} documents`;

    indexed = { sitesIndexed, entriesIndexed: entriesCount, documentCount, label };
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
    wpeAccounts: { total: totalAccounts, inScope: inScopeAccounts, label: accountsLabel },
    needsAttention,
    indexed,
  };
}
