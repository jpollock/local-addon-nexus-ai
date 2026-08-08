import * as crypto from 'crypto';

/**
 * sqlite-vec table names can't contain anything outside `^[a-zA-Z0-9_-]+$`
 * (SqliteVecStore.validateSiteId). Real site ids can contain `:` and `/`
 * (external multi-site ids, `ssh:<alias>/<site>` — see externalSiteStore.ts's
 * externalSiteId, which must NOT change; it is the real id everywhere except
 * this boundary).
 *
 * IDENTITY for any id that already satisfies the regex -- this is load-bearing,
 * not an optimization. Several vector-store WRITERS (ContentPipeline,
 * WPESyncService, EventProcessor, SmartSearchHandler) write using the raw site
 * id directly and never call this function at all; several READERS
 * (search-content.ts, get-all-documents.ts, describe-site-fields.ts,
 * search-across-sites.ts, resolvers.ts, ipc-handlers.ts) DO call it before
 * searching. For every local/WPE id (which contains no invalid character),
 * these two groups must produce the exact same table name, or every local/WPE
 * site's content search silently returns empty results. Appending a hash
 * unconditionally (an earlier version of this function did this) broke that
 * agreement for every local/WPE site in the product -- verified: reads and
 * writes disagreed on the table name for a plain id like `mmWgjXGRS`.
 *
 * A character-class replace ALONE (no hash) creates a real collision for ids
 * that DO need sanitizing: `ssh:a/b-c` and `ssh:a-b/c` both sanitize to
 * `ssh_a_b_c`. So a short stable hash of the ORIGINAL id is appended, but
 * ONLY when sanitization actually changed something -- this is what lets
 * local/WPE ids stay identity while still disambiguating external multi-site
 * ids, which always contain at least one `:`.
 */
export function vectorSiteId(siteId: string): string {
  const sanitized = siteId.replace(/[^a-zA-Z0-9_-]/g, '_');
  if (sanitized === siteId) return siteId;
  const hash = crypto.createHash('sha256').update(siteId).digest('hex').slice(0, 8);
  return `${sanitized}_${hash}`;
}
