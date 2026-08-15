import { McpToolHandler, McpToolResult } from '../../types';
import { resolveAnySite } from '../../site-resolver';
import { SiteStructure } from '../../../../common/types';
import { fleetFreshnessWarning, HOUR_MS, DAY_MS } from '../../../twin/twin-helpers';
import { getIntelligenceCore } from '../../../intelligence-host/coreRegistry';
import { provisionalEnvironmentId } from '../../../intelligence-host/provisionalEntity';
import type { TwinFact } from '../../../../intelligence';

/**
 * One compared dimension's observation on ONE side of the comparison.
 *
 * `sloSeconds` travels with the observation rather than being looked up at
 * render time: the SLO is a property of the underlying fact (`plugin:` is 8h,
 * `site.core` falls back to 4h), so the skew test below must use the SLO of the
 * fact it is actually comparing, not a single tool-wide constant.
 */
interface SideObservation {
  ageSeconds: number;
  sloSeconds: number;
  trust: string;
  fresh: boolean;
}

/** A compared dimension, with whatever the ledger has observed for each side. */
interface DimensionObservation {
  label: string;
  a?: SideObservation;
  b?: SideObservation;
}

export const compareSitesHandler: McpToolHandler = {
  definition: {
    name: 'compare_sites',
    description:
      'Side-by-side comparison of two indexed sites — shared and unique plugins, version differences, WordPress/PHP version, and theme differences. Use to synchronize environments (e.g. confirm local matches WPE production), identify configuration drift, or plan migrations. Both sites must be indexed — run reindex_site if data is stale. Reports when each side was last observed, and warns when the two sides differ in age by more than the freshness SLO (comparing fresh data against stale data is this tool\'s chief footgun).' +
      'theme differences, user counts, and content volume. Works even when sites are stopped.',
    inputSchema: {
      type: 'object',
      properties: {
        site_a: {
          type: 'string',
          description: 'First site — name, ID, or domain',
        },
        site_b: {
          type: 'string',
          description: 'Second site — name, ID, or domain',
        },
      },
      required: ['site_a', 'site_b'],
    },
  },

  async execute(args, services): Promise<McpToolResult> {
    const graphService = (services as any).graphService;

    const resolvedA = resolveAnySite(args.site_a as string, services.siteData, graphService);
    if (resolvedA.kind === 'none') return error(`Site "${args.site_a}" not found.`);
    if (resolvedA.kind === 'ambiguous') {
      return error(`"${args.site_a}" matches ${resolvedA.matches.length} sites across sources — specify which one: ${resolvedA.matches.join(', ')}`);
    }
    const siteA = { id: resolvedA.id, name: resolvedA.name };

    const resolvedB = resolveAnySite(args.site_b as string, services.siteData, graphService);
    if (resolvedB.kind === 'none') return error(`Site "${args.site_b}" not found.`);
    if (resolvedB.kind === 'ambiguous') {
      return error(`"${args.site_b}" matches ${resolvedB.matches.length} sites across sources — specify which one: ${resolvedB.matches.join(', ')}`);
    }
    const siteB = { id: resolvedB.id, name: resolvedB.name };

    const entryA = services.indexRegistry.get(siteA.id);
    if (!entryA?.structure) return error(`Site "${siteA.name}" has no index data.`);

    const entryB = services.indexRegistry.get(siteB.id);
    if (!entryB?.structure) return error(`Site "${siteB.name}" has no index data.`);

    const nameA = entryA.siteName || siteA.name;
    const nameB = entryB.siteName || siteB.name;
    const structA = entryA.structure;
    const structB = entryB.structure;

    // ── Intelligence twins (phase B): per-side observation age per dimension ─
    // Same optional-core template as find_sites_with_plugin: the whole block is
    // guarded, so with no core this tool renders byte-identically to before.
    //
    // Structural deviation from the table-shaped exemplars, deliberate: those
    // tools have one row per site and replace a column with `Observed`. This
    // tool renders ONE comparison across two sides, so there is no per-row
    // column to replace — the per-side ages go in their own additive section
    // and nothing above it changes. The exemplars' drift-hint step (twin facts
    // with no cache counterpart) has no analogue here either: compare_sites
    // takes two caller-named sites rather than discovering a match set, so
    // "in the ledger but missing from results" is not a reachable state. What
    // replaces it is the skew warning — the disagreement that actually matters
    // for a two-sided comparison is between the two sides' observation ages.
    const dimensions: DimensionObservation[] = [];
    // Each distinct fact observation counted ONCE, even though `site.core`
    // renders on two dimension rows — a coverage figure that double-counts is
    // worse than none.
    const countedSides: Array<SideObservation | undefined> = [];
    try {
      const core = getIntelligenceCore();
      if (core) {
        const entityA = provisionalEnvironmentId(siteA.id);
        const entityB = provisionalEnvironmentId(siteB.id);

        const observe = (fact: TwinFact | undefined): SideObservation | undefined => {
          if (!fact) return undefined;
          const f = core.twins.freshness(fact);
          return {
            ageSeconds: f.ageSeconds,
            sloSeconds: f.sloSeconds,
            trust: fact.sourceTrust,
            fresh: f.fresh,
          };
        };

        // WordPress and PHP are separate compared dimensions in this tool's own
        // vocabulary, but both are folded from the single `site.core` fact — so
        // their ages are necessarily identical. Listed separately anyway: a user
        // reading "PHP: 8.1 vs 8.3" wants that line's provenance without having
        // to know which fact it came from.
        const coreA = core.twins.get(entityA, 'site.core');
        const coreB = core.twins.get(entityB, 'site.core');
        const coreObsA = observe(coreA);
        const coreObsB = observe(coreB);
        dimensions.push({ label: 'WordPress', a: coreObsA, b: coreObsB });
        dimensions.push({ label: 'PHP', a: coreObsA, b: coreObsB });
        countedSides.push(coreObsA, coreObsB);

        // A comparison is only as trustworthy as its OLDEST input, so each
        // multi-fact dimension reports its stalest observation, not its newest.
        const stalest = (entityId: string, prefix: string): SideObservation | undefined => {
          const facts = core.twins
            .forEntity(entityId)
            .filter((f) => f.fact.startsWith(prefix));
          if (facts.length === 0) return undefined;
          const oldest = facts.reduce((acc, f) =>
            Date.parse(f.observedAt) < Date.parse(acc.observedAt) ? f : acc,
          );
          return observe(oldest);
        };

        const pluginA = stalest(entityA, 'plugin:');
        const pluginB = stalest(entityB, 'plugin:');
        if (pluginA || pluginB) {
          dimensions.push({ label: 'Plugins (stalest)', a: pluginA, b: pluginB });
          countedSides.push(pluginA, pluginB);
        }

        const themeA = stalest(entityA, 'theme:');
        const themeB = stalest(entityB, 'theme:');
        if (themeA || themeB) {
          dimensions.push({ label: 'Themes (stalest)', a: themeA, b: themeB });
          countedSides.push(themeA, themeB);
        }
      }
    } catch { /* enrichment is optional — legacy behavior stands */ }

    const lines: string[] = [`## Site Comparison: ${nameA} vs ${nameB}`, ''];

    // Shared attributes
    const shared: string[] = [];
    if (structA.wpVersion === structB.wpVersion) {
      shared.push(`- WordPress ${structA.wpVersion}`);
    }
    if (structA.phpVersion === structB.phpVersion) {
      shared.push(`- PHP ${structA.phpVersion}`);
    }

    // Shared plugins
    const pluginsA = new Map(structA.plugins.map((p) => [p.slug, p]));
    const pluginsB = new Map(structB.plugins.map((p) => [p.slug, p]));

    for (const [slug, pA] of pluginsA) {
      const pB = pluginsB.get(slug);
      if (pB) {
        if (pA.version === pB.version) {
          shared.push(`- ${pA.name} v${pA.version}`);
        }
      }
    }

    if (shared.length > 0) {
      lines.push('### Shared');
      lines.push(...shared);
      lines.push('');
    }

    // Version differences (for shared components)
    const diffs: string[] = [];
    if (structA.wpVersion !== structB.wpVersion) {
      diffs.push(`- WordPress: ${structA.wpVersion} (${nameA}) vs ${structB.wpVersion} (${nameB})`);
    }
    if (structA.phpVersion !== structB.phpVersion) {
      diffs.push(`- PHP: ${structA.phpVersion} (${nameA}) vs ${structB.phpVersion} (${nameB})`);
    }
    for (const [slug, pA] of pluginsA) {
      const pB = pluginsB.get(slug);
      if (pB && pA.version !== pB.version) {
        diffs.push(`- ${pA.name}: v${pA.version} (${nameA}) vs v${pB.version} (${nameB})`);
      }
    }
    if (diffs.length > 0) {
      lines.push('### Version Differences');
      lines.push(...diffs);
      lines.push('');
    }

    // Only in A
    const onlyA: string[] = [];
    for (const [slug, pA] of pluginsA) {
      if (!pluginsB.has(slug)) {
        onlyA.push(`- ${pA.name} v${pA.version}`);
      }
    }
    const activeThemeA = structA.themes.find((t) => t.isActive);
    const activeThemeB = structB.themes.find((t) => t.isActive);
    if (activeThemeA) {
      onlyA.push(`- Theme: ${activeThemeA.name} (${activeThemeA.isActive ? 'active' : 'inactive'})`);
    }
    if (onlyA.length > 0) {
      lines.push(`### Only in ${nameA}`);
      lines.push(...onlyA);
      lines.push('');
    }

    // Only in B
    const onlyB: string[] = [];
    for (const [slug, pB] of pluginsB) {
      if (!pluginsA.has(slug)) {
        onlyB.push(`- ${pB.name} v${pB.version}`);
      }
    }
    if (activeThemeB) {
      onlyB.push(`- Theme: ${activeThemeB.name} (${activeThemeB.isActive ? 'active' : 'inactive'})`);
    }
    if (onlyB.length > 0) {
      lines.push(`### Only in ${nameB}`);
      lines.push(...onlyB);
      lines.push('');
    }

    // Content comparison
    lines.push('### Content');
    lines.push(`| | ${nameA} | ${nameB} |`);
    lines.push('|---|---|---|');
    lines.push(`| Documents | ${entryA.documentCount} | ${entryB.documentCount} |`);
    lines.push(`| Chunks | ${entryA.chunkCount} | ${entryB.chunkCount} |`);

    const usersA = structA.users?.totalUsers ?? '—';
    const usersB = structB.users?.totalUsers ?? '—';
    lines.push(`| Users | ${usersA} | ${usersB} |`);

    // Integration flags
    const integrations: string[] = [];
    if (structA.hasWooCommerce !== structB.hasWooCommerce) {
      integrations.push(`- WooCommerce: ${nameA}=${structA.hasWooCommerce}, ${nameB}=${structB.hasWooCommerce}`);
    }
    if (structA.hasACF !== structB.hasACF) {
      integrations.push(`- ACF: ${nameA}=${structA.hasACF}, ${nameB}=${structB.hasACF}`);
    }
    if (integrations.length > 0) {
      lines.push('');
      lines.push('### Integration Differences');
      lines.push(...integrations);
    }

    // ── Observation ages (phase B) ────────────────────────────────────────
    // Appended, never interleaved: every section above renders exactly as it
    // did pre-migration, so an absent core is indistinguishable from the
    // legacy tool.
    const observed = countedSides.filter((o): o is SideObservation => !!o);
    if (observed.length > 0) {
      lines.push('');
      lines.push('### Observation Ages');
      lines.push(`| Dimension | ${nameA} | ${nameB} |`);
      lines.push('|---|---|---|');
      for (const d of dimensions) {
        lines.push(`| ${d.label} | ${renderSide(d.a)} | ${renderSide(d.b)} |`);
      }

      // The skew warning — this packet's reason for existing. Two sides whose
      // observations are more than one SLO apart are not really comparable:
      // a "difference" between them may be nothing but the older side having
      // been observed before a change both sides already share.
      const skewed = dimensions.filter(
        (d) => d.a && d.b && Math.abs(d.a.ageSeconds - d.b.ageSeconds) > Math.max(d.a.sloSeconds, d.b.sloSeconds),
      );
      if (skewed.length > 0) {
        // Dimensions folded from the SAME underlying fact (WordPress and PHP
        // both come from `site.core`) would otherwise emit identical warnings.
        // Group by the age pair so the user gets one line per real skew.
        const groups = new Map<string, { labels: string[]; d: DimensionObservation }>();
        for (const d of skewed) {
          const key = `${d.a!.ageSeconds}|${d.b!.ageSeconds}|${d.a!.sloSeconds}|${d.b!.sloSeconds}`;
          const g = groups.get(key);
          if (g) { g.labels.push(d.label); } else { groups.set(key, { labels: [d.label], d }); }
        }
        lines.push('');
        for (const { labels, d } of groups.values()) {
          const gap = Math.abs(d.a!.ageSeconds - d.b!.ageSeconds);
          const slo = Math.max(d.a!.sloSeconds, d.b!.sloSeconds);
          const older = d.a!.ageSeconds > d.b!.ageSeconds ? nameA : nameB;
          lines.push(
            `> ⚠️ Observation skew — ${labels.join(', ')}: ${nameA} observed ${fmtAge(d.a!.ageSeconds * 1000)}, ` +
            `${nameB} observed ${fmtAge(d.b!.ageSeconds * 1000)} — a gap of ${fmtDuration(gap * 1000)}, ` +
            `more than the ${fmtDuration(slo * 1000)} freshness SLO for ${labels.length > 1 ? 'these facts' : 'this fact'}. ` +
            `Differences reported above may be ${older}'s data being older rather than real drift; ` +
            `consider a live re-check of ${older} before acting on them.`,
          );
        }
      }

      const staleCount = observed.filter((o) => !o.fresh).length;
      lines.push('');
      lines.push(
        staleCount === 0
          ? `Freshness: all ${observed.length} ledger-observed fact(s) across both sides are within their SLO.`
          : `Freshness: ${observed.length - staleCount} of ${observed.length} ledger-observed fact(s) within SLO — ` +
            `${staleCount} stale; consider a live re-check before acting on those.`,
      );
    }

    const warning = fleetFreshnessWarning([entryA, entryB]);
    if (warning) lines.push(warning);

    return ok(lines.join('\n'));
  },
};

/** One side of one dimension: `"{age} ({trust})"`, `" ⚠ stale"` past SLO. */
function renderSide(o: SideObservation | undefined): string {
  if (!o) return '—';
  return `${fmtAge(o.ageSeconds * 1000)} (${o.trust})${o.fresh ? '' : ' ⚠ stale'}`;
}

/** Identical to the exemplars' fmtAge — same vocabulary across fleet tools. */
function fmtAge(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return 'just now';
  return `${fmtDuration(ms)} ago`;
}

/**
 * A span of time, not a point in the past. Separate from fmtAge because this
 * tool is the first to print a *gap between* two ages and an SLO budget, and
 * "a gap of 2h ago" is not English.
 */
function fmtDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0m';
  if (ms < HOUR_MS) return `${Math.max(1, Math.round(ms / 60000))}m`;
  if (ms < DAY_MS) return `${Math.round(ms / HOUR_MS)}h`;
  return `${Math.round(ms / DAY_MS)}d`;
}

function ok(text: string): McpToolResult {
  return { content: [{ type: 'text', text }] };
}

function error(text: string): McpToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}
