import { McpToolHandler, McpToolResult } from '../../types';
import { HOUR_MS, DAY_MS } from '../../../twin/twin-helpers';
import type { SiteSource } from '../../../../common/types';
import { toSiteSource } from '../../../../common/types';
import { getIntelligenceCore } from '../../../intelligence-host/coreRegistry';
import { provisionalEnvironmentId } from '../../../intelligence-host/provisionalEntity';

interface Match {
  siteName: string;
  version: string;
  status: string;
  source: SiteSource;
  lastIndexed?: number;
  /** Phase B: provisional entity id, used to join twin facts for enrichment. */
  entityId?: string;
  observedAt?: string;
  trust?: string;
  fresh?: boolean;
}

export const findSitesWithPluginHandler: McpToolHandler = {
  definition: {
    name: 'find_sites_with_plugin',
    description:
      'Find all indexed sites that have a specific plugin installed — matches by slug (exact) or plugin name (case-insensitive substring). Works even when sites are stopped — reads from the content index. Returns site names, plugin version, and active/inactive status, plus when each fact was last observed (provenance-stamped from the intelligence ledger where available). Use before bulk updates to identify which sites have a specific plugin, or for security audits.' +
      'Matches by slug (exact) or name (case-insensitive substring). ' +
      'Works even when sites are stopped.',
    inputSchema: {
      type: 'object',
      properties: {
        plugin: {
          type: 'string',
          description: 'Plugin name or slug to search for (e.g. "woocommerce" or "WooCommerce")',
        },
      },
      required: ['plugin'],
    },
  },

  async execute(args, services): Promise<McpToolResult> {
    const query = args.plugin as string;
    if (!query) {
      return error('Missing required argument: plugin');
    }

    const queryLower = query.toLowerCase();
    const matches: Match[] = [];

    // ── Local sites: IndexRegistry structure ──────────────────────────────
    const entries = services.indexRegistry.listAll();
    const indexed = entries.filter((e: any) => e.structure);
    let staleCount = 0;
    const now = Date.now();

    for (const entry of indexed) {
      if (entry.lastIndexed && (now - entry.lastIndexed) > DAY_MS) staleCount++;
      for (const plugin of entry.structure!.plugins) {
        const slugMatch = plugin.slug.toLowerCase() === queryLower;
        const nameMatch = plugin.name.toLowerCase().includes(queryLower);
        if (slugMatch || nameMatch) {
          matches.push({
            siteName: entry.siteName || entry.siteId,
            version: plugin.version,
            status: plugin.isActive ? 'active' : 'inactive',
            source: 'local',
            lastIndexed: entry.lastIndexed,
            entityId: provisionalEnvironmentId(entry.siteId),
          });
          break;
        }
      }
    }

    // ── WPE sites: graph.db plugins table ─────────────────────────────────
    const graphService = (services as any).graphService;
    let wpeTotal = 0;
    if (graphService?.getDb) {
      try {
        const db = graphService.getDb();
        if (db) {
          // Remote sites of every kind: WPE installs and external SSH hosts.
          // Add new remote kinds here; `!= 'local'` is forbidden (see source-semantics.test.ts).
          const rows = db.prepare(`
            SELECT p.slug, p.version, p.is_active, s.id as site_id, s.name as site_name, s.source
            FROM plugins p
            JOIN sites s ON p.site_id = s.id
            WHERE s.source IN ('wpe', 'external')
              AND s.is_active = 1
              AND (LOWER(p.slug) = ? OR LOWER(p.slug) LIKE ?)
          `).all(queryLower, `%${queryLower}%`) as Array<{
            slug: string; version: string; is_active: number; site_id: string; site_name: string; source: string;
          }>;

          const wpeSitesSeen = new Set<string>();
          for (const row of rows) {
            if (!wpeSitesSeen.has(row.site_name)) {
              wpeSitesSeen.add(row.site_name);
              matches.push({
                siteName: row.site_name,
                version: row.version ?? '?',
                status: row.is_active ? 'active' : 'inactive',
                source: toSiteSource(row.source),
                entityId: provisionalEnvironmentId(row.site_id),
              });
            }
          }

          const wpeCount = (db.prepare(
            "SELECT COUNT(*) as c FROM sites WHERE source IN ('wpe', 'external') AND is_active = 1"
          ).get() as { c: number })?.c ?? 0;
          wpeTotal = wpeCount;
        }
      } catch { /* graph unavailable */ }
    }

    // ── Intelligence twins (phase B): provenance + freshness enrichment ───
    // The ledger-backed twin store stamps every fact with observed_at, trust,
    // and a provenance pointer. Enrichment is OPTIONAL: if the core is absent
    // the tool behaves exactly as before. Twin-only environments (in the
    // ledger but missing from the caches) are surfaced as a drift hint rather
    // than silently merged — cache and ledger disagreeing is itself a signal.
    let twinEnriched = 0;
    let twinFresh = 0;
    const twinOnlyNames: string[] = [];
    try {
      const core = getIntelligenceCore();
      if (core) {
        const twinRows = core.twins.search('plugin:').filter((f) => {
          const slug = f.fact.slice('plugin:'.length).toLowerCase();
          return slug === queryLower || slug.includes(queryLower);
        });
        const byEntity = new Map(twinRows.map((f) => [f.entityId, f]));
        const seenEntities = new Set<string>();

        for (const m of matches) {
          if (!m.entityId) continue;
          const fact = byEntity.get(m.entityId);
          if (!fact) continue;
          seenEntities.add(m.entityId);
          const freshness = core.twins.freshness(fact);
          m.observedAt = fact.observedAt;
          m.trust = fact.sourceTrust;
          m.fresh = freshness.fresh;
          twinEnriched++;
          if (freshness.fresh) twinFresh++;
        }

        for (const fact of twinRows) {
          if (seenEntities.has(fact.entityId)) continue;
          const value = fact.value as { active?: boolean };
          if (value?.active === false) continue; // removed/inactive-only facts aren't "missing from cache"
          const siteCore = core.twins.get(fact.entityId, 'site.core');
          const name = (siteCore?.value as { name?: string } | undefined)?.name;
          twinOnlyNames.push(name ?? fact.entityId);
        }
      }
    } catch { /* enrichment is optional — legacy behavior stands */ }

    const totalSearched = indexed.length + wpeTotal;

    if (matches.length === 0 && twinOnlyNames.length === 0) {
      return ok(`No sites have a plugin matching "${query}" (searched ${totalSearched} sites: ${indexed.length} local, ${wpeTotal} remote).`);
    }

    const lines: string[] = [`## Sites with "${query}"`, ''];
    lines.push('| Site | Version | Status | Source | Observed |');
    lines.push('|------|---------|--------|--------|----------|');

    const localMatches = matches.filter((m) => m.source === 'local');
    const remoteMatches = matches.filter((m) => m.source === 'wpe' || m.source === 'external');

    for (const m of [...localMatches, ...remoteMatches]) {
      let observed: string;
      if (m.observedAt) {
        const staleFlag = m.fresh === false ? ' ⚠ stale' : '';
        observed = `${fmtAge(now - Date.parse(m.observedAt))} (${m.trust})${staleFlag}`;
      } else if (m.lastIndexed) {
        observed = `indexed ${new Date(m.lastIndexed).toISOString().split('T')[0]}`;
      } else {
        observed = '—';
      }
      lines.push(`| ${m.siteName} | v${m.version} | ${m.status} | [${m.source}] | ${observed} |`);
    }

    lines.push('');
    lines.push(`Found in ${matches.length} of ${totalSearched} sites (${indexed.length} local, ${wpeTotal} remote).`);

    if (twinEnriched > 0) {
      const stale = twinEnriched - twinFresh;
      lines.push(
        stale === 0
          ? `Freshness: all ${twinEnriched} ledger-observed facts are within their SLO.`
          : `Freshness: ${twinFresh} of ${twinEnriched} ledger-observed facts within SLO — ${stale} stale; consider a live re-check before acting on those.`
      );
    }

    if (twinOnlyNames.length > 0) {
      const shown = twinOnlyNames.slice(0, 5).join(', ');
      const more = twinOnlyNames.length > 5 ? ` (+${twinOnlyNames.length - 5} more)` : '';
      lines.push(`Drift hint: the intelligence ledger also shows this plugin on ${twinOnlyNames.length} environment(s) missing from cache results: ${shown}${more}.`);
    }

    // Staleness: only warn if a meaningful fraction of local sites are stale
    if (staleCount > 0) {
      const pct = Math.round((staleCount / indexed.length) * 100);
      if (staleCount === indexed.length) {
        lines.push(`⚠️ All local site indexes are >24h old — run \`reindex_site\` to refresh.`);
      } else {
        lines.push(`ℹ️ ${staleCount} of ${indexed.length} local sites have indexes older than 24h.`);
      }
    }

    return ok(lines.join('\n'));
  },
};

function fmtAge(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return 'just now';
  if (ms < HOUR_MS) return `${Math.max(1, Math.round(ms / 60000))}m ago`;
  if (ms < DAY_MS) return `${Math.round(ms / HOUR_MS)}h ago`;
  return `${Math.round(ms / DAY_MS)}d ago`;
}

function ok(text: string): McpToolResult {
  return { content: [{ type: 'text', text }] };
}

function error(text: string): McpToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}
