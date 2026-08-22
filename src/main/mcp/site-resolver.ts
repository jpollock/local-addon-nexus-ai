import { SiteDataAccessor, LocalSiteInfo } from './types';
import { parseTarget } from '../../common/target';

/**
 * A graph handle, as every caller already has one: `services.graphService`.
 * Typed structurally so this module keeps its single import of `./types` and
 * does not reach into the GraphService class.
 */
export type GraphHandle = { getDb?: () => any } | undefined;

/**
 * Outcome of a Local-store lookup that has ALSO checked whether the name means
 * something else somewhere in the fleet.
 *
 * `collision` carries the Local site it refused, so a caller with a better
 * message of its own (`resolveTargetArgs` has one, naming the install) does not
 * have to run the lookup again to write it.
 */
export type LocalSiteResult =
  | { kind: 'ok'; site: LocalSiteInfo }
  | { kind: 'none' }
  | { kind: 'collision'; site: LocalSiteInfo; name: string; matches: string[]; message: string };

/** How a Local site was matched. Only a NAME match can collide across sources. */
type LocalMatch = { site: LocalSiteInfo; by: 'id' | 'name' | 'domain' };

function matchLocal(query: string, siteData: SiteDataAccessor): LocalMatch | null {
  if (!query) return null;

  // 1. Exact ID match
  const byId = siteData.getSite(query);
  if (byId) return { site: byId, by: 'id' };

  const sites = Object.values(siteData.getSites());
  const q = query.toLowerCase();

  // 2. Exact name match
  const byName = sites.find((s) => s.name.toLowerCase() === q);
  if (byName) return { site: byName, by: 'name' };

  // 3. Domain match
  const byDomain = sites.find((s) => s.domain?.toLowerCase() === q);
  if (byDomain) return { site: byDomain, by: 'domain' };

  return null;
}

/**
 * Rows in the graph whose name could be what the caller typed.
 *
 * DELIBERATELY case-INSENSITIVE, and deliberately different from
 * `resolveRemoteGraphSite`'s exact `name = ?`. The two ask different questions
 * and the right answer differs:
 *
 *   - A RESOLVER asks "which row is this?" and must be exact, or it starts
 *     answering about rows the caller did not name.
 *   - This PROBE asks "could this string mean something else?" and must be
 *     generous, or a Local site called `MyLoop` beside the install `myloop`
 *     resolves silently to the copy — the coin toss, one casing away.
 *
 * `resolveTargetArgs` set this precedent (`LOWER(name)=?`) before this module
 * existed; it is followed here rather than re-decided.
 */
function graphRowsNamed(db: any, name: string): Array<{ id: string; name: string; source: string; account_id: string }> {
  if (!db || !name) return [];
  try {
    return (db.prepare(
      "SELECT id, name, source, account_id FROM sites WHERE source IN ('wpe','external') AND is_active = 1 AND LOWER(name) = ?",
    ).all(name.toLowerCase()) ?? []) as Array<{ id: string; name: string; source: string; account_id: string }>;
  } catch {
    // A graph we cannot read is not evidence of a collision. Never throw from
    // a resolver — every caller here predates this check.
    return [];
  }
}

/** The disambiguated form that addresses one graph row unambiguously. */
function remoteTargetForm(row: { name: string; source: string; account_id?: string }): string {
  return row.source === 'external'
    ? `ssh:${row.account_id}/${row.name}`
    : `wpe:<account>/${row.name}`;
}

/** True when the caller has already said which source it means. */
function isLocalPinned(query: string): boolean {
  return typeof query === 'string' && query.endsWith('@local');
}

/**
 * Resolve a user-provided reference (name, ID, or domain) against **Local's
 * site store**, refusing a name that also names a site elsewhere in the fleet.
 *
 * ── Why the name says `Local`, and why the graph handle is required ─────────
 * This was `resolveSite`, and it matched Local sites only — with no source
 * constraint and no decline — across 115 call sites. Against one of the names
 * that exists in both stores (`CLAUDE.md`, "Names collide across sources"; six
 * on the owner's fleet as of 2026-08-21) it silently answered "local": the
 * caller asked about a production install and got a copy.
 *
 * **A resolver may narrow its scope; it may not narrow its scope silently and
 * then answer as if it had searched everything.** The name now states the
 * scope, and the third parameter is REQUIRED so a new call site cannot narrow
 * it back by forgetting — a compile error is the only form of this rule that
 * does not depend on somebody remembering to read CLAUDE.md.
 *
 * The decline is scoped to NAME matches. An id is not a name and a domain is
 * not a name; declining on those would refuse an unambiguous question, and
 * most of the 115 call sites pass a Local site id.
 *
 * A caller that means the Local copy says so: `<name>@local` resolves here
 * without the check, because the caller has already answered the question the
 * decline would ask.
 */
export function resolveLocalSiteResult(
  query: string,
  siteData: SiteDataAccessor,
  graphService: GraphHandle,
): LocalSiteResult {
  if (!query) return { kind: 'none' };

  const pinned = isLocalPinned(query);
  const bare = pinned ? query.slice(0, -'@local'.length) : query;

  const match = matchLocal(bare, siteData);
  if (!match) return { kind: 'none' };
  if (pinned || match.by !== 'name') return { kind: 'ok', site: match.site };

  const rows = graphRowsNamed(graphService?.getDb?.(), bare);
  if (rows.length === 0) return { kind: 'ok', site: match.site };

  // The site's OWN name, not the caller's spelling — the disambiguated forms
  // are meant to be copied back in, and a form that echoes a casing the store
  // does not use fails one step later.
  const localForm = `${match.site.name}@local`;
  const matches = [localForm, ...rows.map(remoteTargetForm)];
  const remoteKinds = rows.some((r) => r.source === 'external')
    ? rows.some((r) => r.source === 'wpe')
      ? 'a WP Engine install and an external SSH host'
      : 'an external SSH host'
    : 'a WP Engine install';

  return {
    kind: 'collision',
    site: match.site,
    name: match.site.name,
    matches,
    message:
      `Ambiguous site "${bare}" — it names both a Local site and ${remoteKinds}. ` +
      `Specify which one you mean:\n` +
      matches.map((m) => `  ${m}`).join('\n'),
  };
}

/**
 * `resolveLocalSiteResult` for the 115 call sites that only need the site.
 * A collision returns null — the reason is available from the result form
 * above, and a caller that wants to say it should use that instead of
 * inventing a "not found".
 */
export function resolveLocalSite(
  query: string,
  siteData: SiteDataAccessor,
  graphService: GraphHandle,
): LocalSiteInfo | null {
  const result = resolveLocalSiteResult(query, siteData, graphService);
  return result.kind === 'ok' ? result.site : null;
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

  let rows: Array<{ id: string; name: string; source: string; account_id: string }>;
  try {
    rows = (db.prepare(
      "SELECT id, name, source, account_id FROM sites WHERE source IN ('wpe','external') AND is_active = 1 AND name = ?"
    ).all(name) ?? []) as Array<{ id: string; name: string; source: string; account_id: string }>;
  } catch {
    return { kind: 'none' };
  }

  if (rows.length === 0) return { kind: 'none' };
  if (rows.length > 1) {
    return {
      kind: 'ambiguous',
      matches: rows.map((r) => (r.source === 'external' ? `ssh:${r.account_id}/${r.name}` : `wpe:<account>/${r.name}`)),
    };
  }
  return { kind: 'ok', siteId: rows[0].id, siteName: rows[0].name, source: rows[0].source };
}

/**
 * Find external sites registered under a connection alias, optionally scoped
 * to one specific site.
 *
 * The alias is a CONNECTION (a `~/.ssh/config` Host entry), not a site — one
 * connection can have zero, one, or many WordPress installs under it
 * (confirmed live: a single Hostinger login can host two). `account_id` links
 * a site row back to its connection, reusing the same generic column WP
 * Engine already uses for its own account→install grouping.
 *
 * Returns every matching site when `site` is omitted — the caller decides
 * what 0/1/many rows means for its own error message (see `resolveTransport`
 * for the canonical ok/none/ambiguous handling). `columns` is an internal
 * constant supplied by this module's own callers, not caller-controlled
 * input, matching the same convention as `queryQualifiedTarget`.
 */
export function findExternalSites(
  db: any,
  alias: string,
  site?: string,
  columns = '*',
): any[] {
  if (!db) return [];
  try {
    return (site
      ? db.prepare(
          `SELECT ${columns} FROM sites WHERE source='external' AND is_active=1 AND account_id=? AND name=?`,
        ).all(alias, site)
      : db.prepare(
          `SELECT ${columns} FROM sites WHERE source='external' AND is_active=1 AND account_id=?`,
        ).all(alias)
    ) as any[];
  } catch {
    return [];
  }
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

  if (parsed.type === 'external') {
    if (!parsed.alias || !db) return [];
    // The alias is a connection, not a site — findExternalSites returns every
    // site under it when `site` is omitted, and the caller's existing
    // length===1/>1/0 branching already does the right thing with that.
    return findExternalSites(db, parsed.alias, parsed.site, columns);
  }

  let source: 'wpe';
  let name: string | undefined;
  if (parsed.type === 'wpe') {
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
 * (local, wpe, external) in one call. BOTH stores are consulted before an
 * answer is given; a name present in both declines with the disambiguated
 * forms.
 */
export type AnySiteResult =
  | { kind: 'ok'; id: string; name: string; source: 'local' | 'wpe' | 'external' }
  | { kind: 'none' }
  | { kind: 'ambiguous'; matches: string[] };

/**
 * Resolve a bare name/ID/domain against every fleet source — Local's own site
 * store and the graph's WPE and external rows — and decline when it matches
 * more than one.
 *
 * ── WP-58: local-first precedence was REMOVED, not documented ───────────────
 * This function was written to be the correct shared path and its docblock
 * credited it with `resolveRemoteGraphSite`'s collision-decline logic. That was
 * true for two WPE installs colliding with each other and FALSE for the
 * cross-source case the rule exists for: `resolveSite` was called first and
 * returned immediately, so the graph was only ever reached on a MISS. Against
 * one of the six names on the owner's fleet that exist in both stores, this
 * answered "local" — confidently, with no signal that a question had been
 * asked and not answered.
 *
 * Declining is cheap for the caller precisely because this function already
 * supports the qualified forms (`wpe:<account>/<install>@<env>`,
 * `ssh:<alias>/<site>@<env>`, `<name>@local`), which is why declining is the
 * ruled behaviour rather than a hardship.
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

  // `<name>@local` is a qualified target too: the caller has already said which
  // source it means, so it resolves against Local alone and never declines.
  if (isLocalPinned(query)) {
    const pinned = resolveLocalSiteResult(query, siteData, graphService);
    return pinned.kind === 'ok'
      ? { kind: 'ok', id: pinned.site.id, name: pinned.site.name, source: 'local' }
      : { kind: 'none' };
  }

  // Both stores, before any answer. `resolveLocalSiteResult` owns the one
  // collision policy — duplicating the probe here is how the two copies of
  // this rule drifted in the first place.
  const local = resolveLocalSiteResult(query, siteData, graphService);
  if (local.kind === 'collision') {
    return { kind: 'ambiguous', matches: local.matches };
  }
  if (local.kind === 'ok') {
    return { kind: 'ok', id: local.site.id, name: local.site.name, source: 'local' };
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
