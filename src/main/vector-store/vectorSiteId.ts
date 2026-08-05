/**
 * sqlite-vec table names can't contain ':' (SqliteVecStore.validateSiteId requires
 * ^[a-zA-Z0-9_-]+$). External site ids are `ssh:<alias>` — translate only at this
 * boundary. The graph `content` table, IndexRegistry, and every other consumer of
 * a site id keep the real `ssh:<alias>` value; only the vector store's
 * table-name-derived id changes.
 *
 * Local and WPE ids (`mmWgjXGRS`, `wpe-<uuid>`) contain no colons, so this is a
 * no-op for them — safe to apply unconditionally rather than branching on source.
 */
export function vectorSiteId(siteId: string): string {
  return siteId.replace(/:/g, '_');
}
