import { SiteDataAccessor, LocalSiteInfo } from './types';

/**
 * Resolves a user-provided site reference (name, ID, or domain) to a site.
 *
 * Resolution order:
 *   1. Exact site ID match
 *   2. Exact name match (case-insensitive)
 *   3. Domain match (case-insensitive)
 */
export function resolveSite(
  query: string,
  siteData: SiteDataAccessor,
): LocalSiteInfo | null {
  if (!query) return null;

  // 1. Exact ID match
  const byId = siteData.getSite(query);
  if (byId) return byId;

  const sites = Object.values(siteData.getSites());
  const q = query.toLowerCase();

  // 2. Exact name match
  const byName = sites.find((s) => s.name.toLowerCase() === q);
  if (byName) return byName;

  // 3. Domain match
  const byDomain = sites.find((s) => s.domain?.toLowerCase() === q);
  if (byDomain) return byDomain;

  return null;
}

/**
 * Outcome of a WPE/external lookup in the knowledge graph.
 * `ambiguous` carries the disambiguated forms to offer the caller.
 */
export type RemoteGraphSiteResult =
  | { kind: 'ok'; siteId: string; siteName: string; source: string }
  | { kind: 'none' }
  | { kind: 'ambiguous'; matches: string[] };

/**
 * Resolve a bare name to a WP Engine install or external SSH host row in the
 * knowledge graph.
 *
 * Names collide across sources (see CLAUDE.md "Names collide across sources"),
 * so an unordered `LIMIT 1` is a coin toss — this declines instead, returning
 * the disambiguated forms. `is_active = 1` is required because
 * `nexus host remove` soft-deletes.
 *
 * Extracted from search_site_content so every read path that needs the same
 * fallback shares one query and one collision policy.
 */
export function resolveRemoteGraphSite(db: any, name: unknown): RemoteGraphSiteResult {
  if (!db || typeof name !== 'string' || !name) return { kind: 'none' };

  let rows: Array<{ id: string; name: string; source: string }>;
  try {
    rows = (db.prepare(
      "SELECT id, name, source FROM sites WHERE source IN ('wpe','external') AND is_active = 1 AND name = ?"
    ).all(name) ?? []) as Array<{ id: string; name: string; source: string }>;
  } catch {
    return { kind: 'none' };
  }

  if (rows.length === 0) return { kind: 'none' };
  if (rows.length > 1) {
    return {
      kind: 'ambiguous',
      matches: rows.map((r) => (r.source === 'external' ? `ssh:${r.name}` : `wpe:<account>/${r.name}`)),
    };
  }
  return { kind: 'ok', siteId: rows[0].id, siteName: rows[0].name, source: rows[0].source };
}
