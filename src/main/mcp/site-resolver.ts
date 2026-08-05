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

/**
 * Outcome of resolving a bare name against ALL three fleet sources
 * (local, wpe, external) in one call. Local is checked first, then the
 * graph, using resolveRemoteGraphSite's collision-decline logic.
 */
export type AnySiteResult =
  | { kind: 'ok'; id: string; name: string; source: 'local' | 'wpe' | 'external' }
  | { kind: 'none' }
  | { kind: 'ambiguous'; matches: string[] };

/**
 * Resolve a bare name/ID/domain against Local's own site store first, then
 * fall back to the graph for WPE and external hosts via resolveRemoteGraphSite.
 * Use this in any MCP tool that currently calls resolveSite() alone and needs
 * WPE/external support too.
 */
export function resolveAnySite(
  query: string,
  siteData: SiteDataAccessor,
  graphService: { getDb?: () => any } | undefined,
): AnySiteResult {
  const local = resolveSite(query, siteData);
  if (local) {
    return { kind: 'ok', id: local.id, name: local.name, source: 'local' };
  }

  const db = graphService?.getDb?.();
  const remote = resolveRemoteGraphSite(db, query);
  if (remote.kind === 'ok') {
    return { kind: 'ok', id: remote.siteId, name: remote.siteName, source: remote.source as 'wpe' | 'external' };
  }
  if (remote.kind === 'ambiguous') {
    return { kind: 'ambiguous', matches: remote.matches };
  }
  return { kind: 'none' };
}
