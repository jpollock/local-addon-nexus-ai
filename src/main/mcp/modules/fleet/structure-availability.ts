/**
 * Why a site has no `IndexRegistry` structure, said accurately.
 *
 * ── The defect this replaces (WP-61 / D2, D3, D4) ───────────────────────────
 * Five call sites across two tools said **"has no index data."** Two things
 * were wrong with that sentence, and the second is the expensive one.
 *
 * **It names the wrong store.** The check is on `entry.structure`; "index
 * data" sends the reader to the content index, where `get_index_status` will
 * cheerfully report the same site as indexed with hundreds of documents. The
 * reporter who found this lost about an hour to it. Not a contradiction —
 * two different fields — but nothing in the message said so.
 *
 * **It implies the data could be there.** For a WP Engine install or an
 * external SSH host it never can be, and that is provable by construction
 * rather than by failing to find a route:
 *
 *   - `entry.structure` is initialised `null` (`IndexRegistry.ts:53`).
 *   - Its sole CREATOR is `ContentPipeline.ts:90` — `fileScanner.scan(
 *     info.sitePath)`, a walk of a directory on this machine.
 *   - Its two other writers (`ipc-handlers.ts:2110`, `:5422`) are each guarded
 *     by `if (existingEntry?.structure)`. They can only REFRESH a structure
 *     that already exists.
 *
 * So both refresh paths are conditioned on the one path a remote site cannot
 * reach. A WPE install can be synced, refreshed and content-indexed to
 * completion and will still have `structure === null`, for ever, because the
 * only thing that writes it is a local disk.
 *
 * ── The ruling: say what is true; do not smuggle in a remote extractor ──────
 * Whether Nexus should grow a remote structure extractor is a roadmap
 * decision with its own packet. This module's job is that the product stops
 * telling the caller to go fix a store that is fine.
 */

/** The three fleet sources, as `resolveAnySite` reports them. */
export type SiteSource = 'local' | 'wpe' | 'external';

/** Human name for a source, in the grammar these sentences need. */
function sourceNoun(source: SiteSource): string {
  switch (source) {
    case 'wpe':      return 'a WP Engine install';
    case 'external': return 'an external SSH host';
    default:         return 'a Local site';
  }
}

/**
 * The message for a site whose `entry.structure` is absent.
 *
 * `toolName` is the tool declining, named in the sentence because the
 * limitation is the tool's and a bare "not supported" leaves the reader
 * guessing which of the four things they just called said it.
 *
 * `subject` distinguishes the roles a tool gives its arguments (`detect_drift`
 * has a baseline and comparison sites); pass a phrase like `'Baseline site'`,
 * or omit for a plain `'Site'`.
 */
export function structureUnavailableMessage(
  siteName: string,
  source: SiteSource,
  toolName: string,
  subject = 'Site',
): string {
  if (source === 'local') {
    // Reachable and fixable: the site simply has not been through the
    // pipeline. This is the one case where a remedy is honest.
    return (
      `${subject} "${siteName}" has no site-structure data yet — its plugins, themes and ` +
      `versions have not been scanned. Run reindex_site on it, then retry ${toolName}. ` +
      `(This is a different store from the content index: a site can be fully indexed for ` +
      `search and still have no structure record.)`
    );
  }

  const alternatives = source === 'wpe'
    ? 'For a WP Engine install, use wpe_detect_drift to compare it against its linked local ' +
      'site, or get_site_health / nexus_get_site_twin to inspect it on its own.'
    : 'For an external SSH host, use get_site_health or nexus_get_site_twin to inspect it, ' +
      'or fleet_sql to compare fields across hosts.';

  return (
    `${subject} "${siteName}" is ${sourceNoun(source)}, and ${toolName} cannot include it. ` +
    `The structural record it compares is built only by Local's filesystem scan of a site on ` +
    `this machine, so it does not exist for remote sites and no sync or re-index will create ` +
    `it — this is a limitation of ${toolName}, not stale or missing data. ` +
    `The site's content index and graph records are unaffected. ` +
    alternatives
  );
}
