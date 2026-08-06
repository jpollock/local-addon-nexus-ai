import { SiteDataAccessor, LocalSiteInfo } from './types';
import { parseTarget } from '../../common/target';

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
 * Look a fully qualified target — `ssh:<alias>@<env>` or
 * `wpe:<account>/<install>@<env>` — up in the graph, pinned to the source the
 * prefix names.
 *
 * This exists because `nexus_list_sites` prints exactly that qualified string
 * as the target an agent should reuse, while every graph lookup matched on the
 * bare `name` column, so following the tool's own printed instructions
 * produced "not found". `parseTarget` (`src/common/target.ts`) is the one
 * canonical parser for this syntax and is reused rather than re-implemented.
 *
 * @returns `null` when `target` is NOT a qualified remote target (a bare name,
 *   an `@local` target, or unparseable) — the caller should fall through to its
 *   existing bare-name path. Otherwise the matching rows, which may be empty.
 *
 * `columns` is an internal constant supplied by this module's own callers, not
 * caller-controlled input.
 */
export function queryQualifiedTarget(
  db: any,
  target: string,
  columns = 'id, name, source',
): any[] | null {
  let parsed;
  try {
    parsed = parseTarget(target);
  } catch {
    // Not parseable as a target at all (e.g. a bare `ssh:alias` with no
    // environment suffix). Leave it to the bare-name path.
    return null;
  }

  let source: 'external' | 'wpe';
  let name: string | undefined;
  if (parsed.type === 'external') {
    source = 'external';
    name = parsed.alias;
  } else if (parsed.type === 'wpe') {
    source = 'wpe';
    name = parsed.installName;
  } else {
    // type === 'local' — a bare name or `<name>@local`. Not our business.
    return null;
  }

  // It IS a qualified remote target. From here we own the outcome: an empty
  // result must be reported as "not found", never handed back to the bare-name
  // path, which would try to match the whole `ssh:x@production` string.
  if (!name || !db) return [];

  try {
    return (db.prepare(
      `SELECT ${columns} FROM sites WHERE source = '${source}' AND is_active = 1 AND name = ?`,
    ).all(name) ?? []) as any[];
  } catch {
    return [];
  }
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
  // A caller may pass a bare name (the original, unchanged path below) or a
  // fully qualified target — `ssh:<alias>@<env>` / `wpe:<account>/<install>@<env>`
  // — which is exactly what nexus_list_sites prints for the agent to reuse.
  const qualified = queryQualifiedTarget(graphService?.getDb?.(), query);
  if (qualified !== null) {
    // The prefix already pinned the source, so there is no cross-source
    // collision to decline over: one row is an answer, not a coin toss.
    if (qualified.length === 1) {
      return {
        kind: 'ok',
        id: qualified[0].id,
        name: qualified[0].name,
        source: qualified[0].source as 'wpe' | 'external',
      };
    }
    if (qualified.length > 1) {
      // Two installs of the same name within one source (different accounts).
      // The graph has no account *slug* to match parsed.account against, so
      // decline rather than pick.
      return { kind: 'ambiguous', matches: qualified.map((r: any) => `${r.source}:${r.name} (${r.id})`) };
    }
    return { kind: 'none' };
  }

  // `<name>@local` should resolve like the bare name it wraps.
  try {
    const parsed = parseTarget(query);
    if (parsed.type === 'local' && parsed.siteName) query = parsed.siteName;
  } catch {
    // Unparseable — leave `query` exactly as given.
  }

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
