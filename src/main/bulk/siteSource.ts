/**
 * Which population a bulk-operation site id belongs to.
 *
 * The graph's `sites.source` column is the authority on this, but a bulk
 * operation carries only ids, and `BulkOpDeps.graphService` exposes writes
 * rather than queries. The id namespaces are unambiguous enough to classify
 * without a lookup, because each is minted by exactly one writer:
 *
 *   - `wpe-<install-uuid>`  — WPESyncService (`removeWPESite` composes the same
 *     shape, `wpe-${installId}`). Verified on a real graph.db: 331 of 331 active
 *     wpe rows match, and `remote_install_id` is the id with the prefix removed.
 *   - `ssh:<alias>` / `ssh:<alias>/<site>` — the external site store. Verified:
 *     3 of 3 active external rows match, in both the bare and the /site form.
 *   - anything else — Local, whose ids come from Local's own store.
 *
 * Local is the default rather than a fourth "unknown" case on purpose: every
 * pre-existing caller of BulkOperationManager (INDEX_ALL_AUTO, SYNC_GRAPH_ALL,
 * SETUP_AI_ALL_AUTO) enumerates `siteData.getSites()` and is therefore local by
 * construction. A new source must add its own prefix here rather than inherit
 * the local path, which would fail confusingly deep inside a Local-only bridge.
 */
export type SiteSource = 'local' | 'wpe' | 'external';

const WPE_PREFIX = 'wpe-';
const EXTERNAL_PREFIX = 'ssh:';

export function siteSourceOf(siteId: string): SiteSource {
  if (siteId.startsWith(EXTERNAL_PREFIX)) return 'external';
  if (siteId.startsWith(WPE_PREFIX)) return 'wpe';
  return 'local';
}

/**
 * The CAPI install id behind a `wpe-` graph id. This is what
 * `WPESyncService.syncSingleSite` expects — it calls `capiGetInstall(installId)`,
 * which does not recognise the prefixed form.
 */
export function wpeInstallIdOf(siteId: string): string {
  return siteId.startsWith(WPE_PREFIX) ? siteId.slice(WPE_PREFIX.length) : siteId;
}
