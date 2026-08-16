/**
 * Site Finder — twin-backed provenance for plugin-presence and plugin-version
 * results (WP-04, pattern `pat.reader-migration` adapted to an IPC surface).
 *
 * Site Finder's filter engine is the `SITE_FINDER_APPLY` handler inlined in
 * `ipc-handlers.ts`, which is under the integration lock: it takes a minimal
 * import + call, so all of the enrichment logic lives here instead.
 *
 * MEMBERSHIP IS NOT DECIDED HERE. The graph predicate continues to decide
 * which sites match, unchanged — this module only stamps the rows the handler
 * already selected with when each plugin fact was last observed, how it was
 * sourced, and whether it is inside its freshness SLO, and reports where the
 * ledger and the graph disagree. Letting a twin fact decide the predicate
 * would change matching semantics, which is the pattern's `ab.no-legacy-parity`
 * abort condition and would put the SF-01/05/06 eval expectations at risk.
 * (Owner ruling, WP-04 section of WORK_PACKETS.md.)
 *
 * Everything here is non-fatal by construction: no core, no graph handle, or
 * any throw at all yields `null` and the handler renders its legacy payload.
 */
import { getIntelligenceCore } from './coreRegistry';
import { provisionalEnvironmentId } from './provisionalEntity';

/** Per-row provenance, attached to a result row the graph predicate selected. */
export interface SiteFinderTwinRow {
  /** ISO timestamp: when the plugin fact was last true at its source. */
  observedAt: string;
  /** Trust class of the observation ('observed', 'reported', …). */
  trust: string;
  /** True when the observation is past this fact's freshness SLO. */
  stale: boolean;
  ageSeconds: number;
  sloSeconds: number;
  /** Which plugin slug this observation is for. */
  slug: string;
}

/** A row that matched, whose ledger and cache versions disagree. */
export interface SiteFinderVersionDrift {
  siteId: string;
  slug: string;
  /** Version the ledger last observed. */
  ledger: string;
  /** Version the graph cache currently holds — the one membership was decided on. */
  cache: string;
}

export interface SiteFinderTwinEnrichment {
  /** siteId → provenance. Only rows the ledger has actually observed appear. */
  rows: Map<string, SiteFinderTwinRow>;
  freshness: { observed: number; fresh: number; stale: number };
  /**
   * Matched rows for which the ledger holds no plugin fact at all. Distinct
   * from `twinOnly` below: this is a PIPELINE COVERAGE GAP (never observed),
   * not a divergence (observed, and disagreeing).
   */
  coverageGap: string[];
  /**
   * Environments the ledger shows carrying a queried plugin where the graph's
   * `plugins` table does not — a genuine ledger-vs-cache disagreement.
   *
   * Deliberately computed against the GRAPH's plugin rows, not against the
   * handler's result set. A site excluded by some other predicate in the same
   * query (`phpEolOnly`, `minPostCount`, …) was excluded correctly; blaming
   * that on a cache/ledger disagreement would be a false hint. The exemplar
   * (`find-sites-with-plugin.ts`) can subtract the result set directly because
   * it evaluates exactly one predicate; Site Finder composes many.
   */
  twinOnly: Array<{ entityId: string; name: string }>;
  /**
   * Fourth drift-hint variant — VALUE MISMATCH ON A MATCHED ROW. The pattern's
   * `cp.drift-hint` lists three (per-fact, per-dimension skew, population-level)
   * and asks that a fourth be recorded here when found. Site Finder's plugin
   * facts carry a version, so a row can be in both populations and still
   * disagree about *what* is installed. Reported, never acted on: membership
   * stays on the cache value (owner ruling).
   */
  versionDrift: SiteFinderVersionDrift[];
}

interface EnrichParams {
  /** Site ids the graph predicate matched — local store ids and graph `sites.id`. */
  siteIds: string[];
  /** The plugin slugs the query filtered on (presence filter, OR semantics). */
  plugins?: string[];
  /** The version filter, if one was in play. */
  pluginVersion?: { slug?: string; olderThan?: string };
  /** The graph db handle, or null when unavailable. */
  db: { prepare(sql: string): { all(...a: unknown[]): unknown[]; get(...a: unknown[]): unknown } } | null;
}

/**
 * Returns provenance for a Site Finder result set, or `null` when there is
 * nothing to add (no core, no plugin filter in play, or any failure).
 */
export function enrichSiteFinderPlugins(params: EnrichParams): SiteFinderTwinEnrichment | null {
  try {
    const core = getIntelligenceCore();
    if (!core) return null;

    const slugs = Array.from(
      new Set([...(params.plugins ?? []), ...(params.pluginVersion?.slug ? [params.pluginVersion.slug] : [])])
    ).filter((s) => !!s);
    if (slugs.length === 0) return null; // no plugin predicate — nothing to stamp

    // ── Twin facts for the queried slugs ────────────────────────────────────
    // byFact is the exact-fact primitive; one call per slug beats a `plugin:`
    // prefix scan of the whole fleet when the query names its slugs.
    const facts: Array<{
      entityId: string; slug: string; observedAt: string; trust: string;
      version?: string; active?: boolean; ageSeconds: number; sloSeconds: number; fresh: boolean;
    }> = [];
    for (const slug of slugs) {
      for (const fact of core.twins.byFact(`plugin:${slug}`)) {
        const value = fact.value as { version?: string; active?: boolean } | undefined;
        const f = core.twins.freshness(fact); // sloSeconds comes from config, never hardcoded
        facts.push({
          entityId: fact.entityId,
          slug,
          observedAt: fact.observedAt,
          trust: fact.sourceTrust,
          version: value?.version,
          active: value?.active,
          ageSeconds: f.ageSeconds,
          sloSeconds: f.sloSeconds,
          fresh: f.fresh,
        });
      }
    }
    if (facts.length === 0) {
      return {
        rows: new Map(),
        freshness: { observed: 0, fresh: 0, stale: 0 },
        coverageGap: [...params.siteIds],
        twinOnly: [],
        versionDrift: [],
      };
    }

    // ── Join to the matched rows by provisional entity id ───────────────────
    // The id derives from the site id the handler already holds — the Local
    // store id for local rows, graph `sites.id` for remote ones. Never a
    // display name: a wrong id source fails silently, producing no enrichment
    // and no error, which is why the test asserts enrichment actually renders.
    const factsByEntity = new Map<string, typeof facts>();
    for (const f of facts) {
      const list = factsByEntity.get(f.entityId);
      if (list) list.push(f);
      else factsByEntity.set(f.entityId, [f]);
    }

    const rows = new Map<string, SiteFinderTwinRow>();
    const coverageGap: string[] = [];
    const versionDrift: SiteFinderVersionDrift[] = [];
    const matchedEntities = new Set<string>();

    // Cache versions for the matched rows, so a ledger/cache disagreement is
    // visible. `is_active` is deliberately NOT constrained here: the presence
    // filter does not constrain it either, so constraining it would compare
    // against a row the predicate never looked at.
    const cacheVersion = (siteId: string, slug: string): string | undefined => {
      if (!params.db) return undefined;
      const row = params.db
        .prepare(`SELECT version FROM plugins WHERE site_id = ? AND slug = ? LIMIT 1`)
        .get(siteId, slug) as { version?: string | null } | undefined;
      return row?.version ?? undefined;
    };

    for (const siteId of params.siteIds) {
      const entityId = provisionalEnvironmentId(siteId);
      matchedEntities.add(entityId);
      const entityFacts = factsByEntity.get(entityId);
      if (!entityFacts || entityFacts.length === 0) {
        coverageGap.push(siteId); // ledger never observed any queried slug here
        continue;
      }

      // A row matching several queried slugs reports its STALEST observation —
      // a result is only as trustworthy as its oldest input (cp.output).
      let stalest = entityFacts[0];
      for (const f of entityFacts) {
        if (f.ageSeconds > stalest.ageSeconds) stalest = f;
      }
      rows.set(siteId, {
        observedAt: stalest.observedAt,
        trust: stalest.trust,
        stale: !stalest.fresh,
        ageSeconds: stalest.ageSeconds,
        sloSeconds: stalest.sloSeconds,
        slug: stalest.slug,
      });

      for (const f of entityFacts) {
        if (!f.version) continue;
        const cached = cacheVersion(siteId, f.slug);
        if (cached && cached !== f.version) {
          versionDrift.push({ siteId, slug: f.slug, ledger: f.version, cache: cached });
        }
      }
    }

    // ── Twin-only population: ledger has the plugin, the graph cache does not ─
    // Reverse-map entity ids back to graph site ids over the active population;
    // provisionalEnvironmentId is a one-way hash, so the map is built forwards.
    const graphSiteIds: string[] = [];
    if (params.db) {
      const siteRows = params.db
        .prepare(`SELECT id FROM sites WHERE is_active = 1`)
        .all() as Array<{ id: string }>;
      for (const r of siteRows) if (r?.id) graphSiteIds.push(r.id);
    }
    const siteIdByEntity = new Map<string, string>();
    for (const id of graphSiteIds) siteIdByEntity.set(provisionalEnvironmentId(id), id);

    const twinOnly: Array<{ entityId: string; name: string }> = [];
    const hinted = new Set<string>();
    for (const f of facts) {
      if (f.active === false) continue; // removed/inactive facts aren't "missing from cache"
      if (hinted.has(f.entityId)) continue;
      const siteId = siteIdByEntity.get(f.entityId);
      if (siteId) {
        // Known to the graph — only a disagreement if the cache lacks the row.
        if (!params.db) continue;
        const cached = params.db
          .prepare(`SELECT 1 AS present FROM plugins WHERE site_id = ? AND slug = ? LIMIT 1`)
          .get(siteId, f.slug) as { present?: number } | undefined;
        if (cached) continue;
      }
      // Either the cache has no such plugin row, or the ledger knows an
      // environment the graph has no active site row for at all.
      if (siteId && matchedEntities.has(f.entityId)) continue;
      hinted.add(f.entityId);
      const siteCore = core.twins.get(f.entityId, 'site.core');
      const name = (siteCore?.value as { name?: string } | undefined)?.name;
      twinOnly.push({ entityId: f.entityId, name: name ?? siteId ?? f.entityId });
    }

    let fresh = 0;
    for (const row of rows.values()) if (!row.stale) fresh++;

    return {
      rows,
      freshness: { observed: rows.size, fresh, stale: rows.size - fresh },
      coverageGap,
      twinOnly,
      versionDrift,
    };
  } catch {
    return null; // enrichment is optional — the legacy payload stands alone
  }
}

/**
 * Human-readable summary lines for the enrichment, for surfaces that render
 * text. Returns `[]` when there is nothing to say.
 */
export function summarizeSiteFinderTwins(e: SiteFinderTwinEnrichment | null): string[] {
  if (!e) return [];
  const lines: string[] = [];

  if (e.freshness.observed > 0) {
    lines.push(
      e.freshness.stale === 0
        ? `Freshness: all ${e.freshness.observed} ledger-observed facts are within their SLO.`
        : `Freshness: ${e.freshness.fresh} of ${e.freshness.observed} ledger-observed facts within SLO — ` +
          `${e.freshness.stale} stale; consider a live re-check before acting on those.`
    );
  }

  if (e.twinOnly.length > 0) {
    const shown = e.twinOnly.slice(0, 5).map((t) => t.name).join(', ');
    const more = e.twinOnly.length > 5 ? ` (+${e.twinOnly.length - 5} more)` : '';
    lines.push(
      `Drift hint: the intelligence ledger also shows this plugin on ${e.twinOnly.length} ` +
      `environment(s) the graph has no plugin row for: ${shown}${more}.`
    );
  }

  if (e.versionDrift.length > 0) {
    const shown = e.versionDrift
      .slice(0, 5)
      .map((d) => `${d.siteId} ${d.slug} (ledger v${d.ledger}, cache v${d.cache})`)
      .join('; ');
    const more = e.versionDrift.length > 5 ? ` (+${e.versionDrift.length - 5} more)` : '';
    lines.push(
      `Drift hint: ${e.versionDrift.length} matched row(s) disagree on version between ledger and ` +
      `cache — results were filtered on the cache value: ${shown}${more}.`
    );
  }

  if (e.coverageGap.length > 0) {
    lines.push(
      `Coverage gap: ${e.coverageGap.length} matched site(s) have no ledger observation for the ` +
      `queried plugin(s) — never observed, which is not the same as unchanged.`
    );
  }

  return lines;
}
