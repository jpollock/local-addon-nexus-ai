import { McpToolHandler, McpToolResult } from '../../types';
import { resolveAnySite } from '../../site-resolver';
import { IndexEntry } from '../../../../common/types';
import { fleetFreshnessWarning, HOUR_MS, DAY_MS } from '../../../twin/twin-helpers';
import { getIntelligenceCore } from '../../../intelligence-host/coreRegistry';
import { provisionalEnvironmentId } from '../../../intelligence-host/provisionalEntity';

interface DriftItem {
  type: 'version_mismatch' | 'missing_plugin' | 'extra_plugin' | 'wp_version' | 'php_version' | 'theme_diff';
  description: string;
  /**
   * The twin fact this drift item is ABOUT, so the ledger's own drift record
   * can be matched against it. Rendering never uses this — it exists purely
   * for the reconciliation below.
   */
  fact: string;
}

/** One environment in scope, with its legacy findings and its ledger identity. */
interface TargetRecord {
  name: string;
  entityId: string;
  drifts: DriftItem[];
}

/** A `state.drift.detected` event, reduced to what this report renders. */
interface LedgerDrift {
  entityId: string;
  fact: string;
  previous: unknown;
  observed: unknown;
  observedAt: string;
}

export const detectDriftHandler: McpToolHandler = {
  definition: {
    name: 'detect_drift',
    description:
      'Compare a baseline site against other indexed sites to detect configuration drift — plugin version differences, missing or extra plugins, WordPress/PHP version mismatches. Use to ensure multiple sites (e.g. a network of similar sites) stay in sync. For local-vs-WPE drift detection, use wpe_detect_drift instead. Also reports changes the intelligence ledger recorded over time (a different axis from the cross-site comparison) and reconciles the two detectors, flagging divergences neither one explains.' +
      'Reports plugin version mismatches, missing/extra plugins, and WordPress/PHP version differences. ' +
      'Works even when sites are stopped.',
    inputSchema: {
      type: 'object',
      properties: {
        baseline_site: {
          type: 'string',
          description: 'The reference site to compare against — name, ID, or domain',
        },
        compare_sites: {
          type: 'array',
          items: { type: 'string' },
          description: 'Specific sites to compare (default: all other indexed sites)',
        },
      },
      required: ['baseline_site'],
    },
  },

  async execute(args, services): Promise<McpToolResult> {
    const graphService = (services as any).graphService;
    const resolvedBaseline = resolveAnySite(args.baseline_site as string, services.siteData, graphService);
    if (resolvedBaseline.kind === 'none') return error(`Baseline site "${args.baseline_site}" not found.`);
    if (resolvedBaseline.kind === 'ambiguous') {
      return error(`"${args.baseline_site}" matches ${resolvedBaseline.matches.length} sites across sources — specify which one: ${resolvedBaseline.matches.join(', ')}`);
    }
    const baselineSite = { id: resolvedBaseline.id, name: resolvedBaseline.name };

    const baselineEntry = services.indexRegistry.get(baselineSite.id);
    if (!baselineEntry?.structure) {
      return error(`Baseline site "${baselineSite.name}" has no index data.`);
    }

    // Determine comparison targets
    let targets: IndexEntry[];
    const compareSiteNames = args.compare_sites as string[] | undefined;

    if (compareSiteNames && compareSiteNames.length > 0) {
      targets = [];
      for (const name of compareSiteNames) {
        const resolved = resolveAnySite(name, services.siteData, graphService);
        if (resolved.kind === 'none') return error(`Comparison site "${name}" not found.`);
        if (resolved.kind === 'ambiguous') {
          return error(`"${name}" matches ${resolved.matches.length} sites across sources — specify which one: ${resolved.matches.join(', ')}`);
        }
        const entry = services.indexRegistry.get(resolved.id);
        if (!entry?.structure) return error(`Comparison site "${resolved.name}" has no index data.`);
        targets.push(entry);
      }
    } else {
      targets = services.indexRegistry
        .listAll()
        .filter((e) => e.siteId !== baselineSite.id && e.structure);
    }

    if (targets.length === 0) {
      return ok('No other indexed sites to compare against.');
    }

    const baselineName = baselineEntry.siteName || baselineSite.name;
    const baselineStruct = baselineEntry.structure;
    const baselinePlugins = new Map(baselineStruct.plugins.map((p) => [p.slug, p]));
    const baselineActiveTheme = baselineStruct.themes.find((t) => t.isActive);

    const lines: string[] = [`## Drift Report: baseline = "${baselineName}"`, ''];

    // Retained for the ledger reconciliation below; rendering is unchanged.
    const targetRecords: TargetRecord[] = [];

    for (const target of targets) {
      const targetName = target.siteName || target.siteId;
      const targetStruct = target.structure!;
      const drifts: DriftItem[] = [];

      // WordPress version
      if (targetStruct.wpVersion !== baselineStruct.wpVersion) {
        drifts.push({
          type: 'wp_version',
          description: `WordPress: ${baselineStruct.wpVersion} (baseline) vs ${targetStruct.wpVersion} (target)`,
          fact: 'site.core',
        });
      }

      // PHP version
      if (targetStruct.phpVersion !== baselineStruct.phpVersion) {
        drifts.push({
          type: 'php_version',
          description: `PHP: ${baselineStruct.phpVersion} (baseline) vs ${targetStruct.phpVersion} (target)`,
          fact: 'site.core',
        });
      }

      // Theme
      const targetActiveTheme = targetStruct.themes.find((t) => t.isActive);
      if (baselineActiveTheme && targetActiveTheme &&
          baselineActiveTheme.slug !== targetActiveTheme.slug) {
        drifts.push({
          type: 'theme_diff',
          description: `Active theme: ${baselineActiveTheme.name} (baseline) vs ${targetActiveTheme.name} (target)`,
          fact: `theme:${targetActiveTheme.slug}`,
        });
      }

      // Plugin comparison
      const targetPlugins = new Map(targetStruct.plugins.map((p) => [p.slug, p]));

      for (const [slug, basePlugin] of baselinePlugins) {
        const targetPlugin = targetPlugins.get(slug);
        if (!targetPlugin) {
          drifts.push({
            type: 'missing_plugin',
            description: `Missing plugin: ${basePlugin.name}`,
            fact: `plugin:${slug}`,
          });
        } else if (targetPlugin.version !== basePlugin.version) {
          drifts.push({
            type: 'version_mismatch',
            description: `${basePlugin.name}: ${basePlugin.version} (baseline) vs ${targetPlugin.version} (target)`,
            fact: `plugin:${slug}`,
          });
        }
      }

      for (const [slug, targetPlugin] of targetPlugins) {
        if (!baselinePlugins.has(slug)) {
          drifts.push({
            type: 'extra_plugin',
            description: `Extra plugin: ${targetPlugin.name} (not in baseline)`,
            fact: `plugin:${slug}`,
          });
        }
      }

      targetRecords.push({
        name: targetName,
        entityId: provisionalEnvironmentId(target.siteId),
        drifts,
      });

      lines.push(`### ${targetName} (${drifts.length} drift${drifts.length !== 1 ? 's' : ''})`);
      if (drifts.length === 0) {
        lines.push('- All aligned \u2713');
      } else {
        for (const d of drifts) {
          lines.push(`- ${d.description}`);
        }
      }
      lines.push('');
    }

    // ── Intelligence ledger (phase B): the SECOND drift detector ───────────
    // cp.drift-hint, per the pattern's universal rule — name this tool's real
    // ledger-vs-cache disagreement. For detect_drift that disagreement is
    // detector-vs-detector, and the two detectors do NOT measure the same
    // thing:
    //
    //   legacy  — SPATIAL drift: baseline vs another site, at one moment.
    //   ledger  — TEMPORAL drift: one environment's fact changing over time
    //             (stateTwinFold fires `state.drift.detected` when a fold
    //             overwrites a fact with a different value).
    //
    // A set-difference between them would be meaningless: they answer
    // different questions and neither is a subset of the other. So the
    // reconciliation below classifies each legacy finding by what the ledger
    // knows about the same FACT, and separately lists ledger changes the
    // cross-site comparison structurally cannot see. Everything is appended
    // and labeled by origin — the legacy report above is untouched.
    const enrichment: string[] = [];
    try {
      const core = getIntelligenceCore();
      if (core) {
        const baselineEntityId = provisionalEnvironmentId(baselineSite.id);
        const scope = new Map<string, string>([[baselineEntityId, `${baselineName} (baseline)`]]);
        for (const t of targetRecords) if (!scope.has(t.entityId)) scope.set(t.entityId, t.name);

        // ONE query, bucketed in memory. Per-entity queries would be N round
        // trips over a fleet-wide default run. The cap is disclosed rather
        // than silently applied: `query` is ORDER BY id ASC, so hitting the
        // limit drops the NEWEST events — the opposite of what a change report
        // wants — and a silent truncation would read as "nothing changed".
        const DRIFT_QUERY_LIMIT = 2000;
        const raw = core.ledger.query({ topicPrefix: 'state.drift.', limit: DRIFT_QUERY_LIMIT });
        const truncated = raw.length >= DRIFT_QUERY_LIMIT;

        const byEntity = new Map<string, LedgerDrift[]>();
        for (const ev of raw) {
          const entityId = ev.entity?.environment ?? ev.entity?.site;
          if (!entityId || !scope.has(entityId)) continue;
          const p = ev.payload as { fact?: string; previous?: unknown; observed?: unknown };
          if (!p?.fact) continue;
          const list = byEntity.get(entityId);
          const item: LedgerDrift = {
            entityId, fact: p.fact, previous: p.previous, observed: p.observed,
            observedAt: ev.observed_at,
          };
          if (list) list.push(item); else byEntity.set(entityId, [item]);
        }

        // Report-shaped observations header (cp.output), placed at the top of
        // the APPENDED block rather than the top of the report: append-only
        // enrichment is what makes the additive-parity pin an exact
        // `startsWith`, and this header caveats the ledger sections it
        // introduces. The legacy body keeps its own `fleetFreshnessWarning`.
        const now = Date.now();
        let observedEnvs = 0;
        let staleEnvs = 0;
        let stalest: { name: string; ageMs: number } | null = null;
        for (const [entityId, name] of scope) {
          const facts = core.twins.forEntity(entityId);
          if (facts.length === 0) continue;
          observedEnvs++;
          let entityStale = false;
          let oldest = 0;
          for (const f of facts) {
            const fr = core.twins.freshness(f);
            if (!fr.fresh) entityStale = true;
            oldest = Math.max(oldest, now - Date.parse(f.observedAt));
          }
          if (entityStale) staleEnvs++;
          if (!stalest || oldest > stalest.ageMs) stalest = { name, ageMs: oldest };
        }

        if (observedEnvs > 0) {
          const stalestNote = stalest && staleEnvs > 0
            ? ` (stalest: ${stalest.name}, ${fmtDuration(stalest.ageMs)} old)`
            : '';
          enrichment.push(
            staleEnvs === 0
              ? `> Observations: ${observedEnvs} of ${scope.size} environment(s) ledger-observed, all facts within SLO.`
              : `> Observations: ${observedEnvs} of ${scope.size} environment(s) ledger-observed — ${staleEnvs} carry at least one fact past its SLO${stalestNote}; consider a live re-check before acting on their drift.`,
          );
        }

        // ── Ledger-recorded changes, labeled by origin ──────────────────
        const allDrift = [...byEntity.values()].flat()
          .sort((a, b) => (a.observedAt < b.observedAt ? 1 : -1)); // newest first
        if (allDrift.length > 0) {
          enrichment.push('');
          enrichment.push('### Changes Recorded by the Ledger  [origin: ledger]');
          enrichment.push('| Environment | Fact | Change | Observed |');
          enrichment.push('|---|---|---|---|');
          for (const d of allDrift) {
            enrichment.push(
              `| ${scope.get(d.entityId) ?? d.entityId} | ${d.fact} | ${fmtChange(d.previous, d.observed)} | ${fmtAge(now - Date.parse(d.observedAt))} |`,
            );
          }
          if (truncated) {
            enrichment.push('');
            enrichment.push(`> ⚠️ Ledger drift query hit its ${DRIFT_QUERY_LIMIT}-event cap; the most recent changes may be missing from this table.`);
          }
        }

        // ── Reconciliation: what each detector saw that the other didn't ──
        const explained: string[] = [];
        const unexplained: string[] = [];
        const coverageGaps: string[] = [];
        const matchedFacts = new Set<string>();

        for (const t of targetRecords) {
          for (const d of t.drifts) {
            const onTarget = (byEntity.get(t.entityId) ?? []).find((x) => x.fact === d.fact);
            const onBaseline = (byEntity.get(baselineEntityId) ?? []).find((x) => x.fact === d.fact);
            const hit = onTarget ?? onBaseline;
            if (hit) {
              matchedFacts.add(`${hit.entityId}|${hit.fact}`);
              const side = onTarget ? t.name : `${baselineName} (baseline)`;
              explained.push(
                `- ${t.name} · \`${d.fact}\` — ${fmtAge(now - Date.parse(hit.observedAt))}, the ledger recorded ${side} changing ${fmtChange(hit.previous, hit.observed)}.`,
              );
              continue;
            }
            // No ledger change for this fact. Does the ledger know the fact at
            // all? "Never observed" is a pipeline coverage gap; "observed but
            // never changed" is longstanding divergence. Conflating them would
            // hide the one finding this packet exists to surface.
            const known = core.twins.get(t.entityId, d.fact) ?? core.twins.get(baselineEntityId, d.fact);
            (known ? unexplained : coverageGaps).push(
              known
                ? `- ${t.name} · \`${d.fact}\` — divergence is stable; the ledger has observed this fact but never recorded it changing.`
                : `- ${t.name} · \`${d.fact}\` — the ledger has never observed this fact on either side. [pipeline coverage gap]`,
            );
          }
        }

        const ledgerOnly = allDrift.filter((d) => !matchedFacts.has(`${d.entityId}|${d.fact}`));

        if (explained.length || unexplained.length || coverageGaps.length || ledgerOnly.length) {
          enrichment.push('');
          enrichment.push('### Detector Reconciliation');
          enrichment.push(
            'The two detectors measure different axes — the legacy report above finds ' +
            'cross-site divergence at one moment; the ledger records a single ' +
            'environment\'s facts changing over time. Neither subsumes the other, so ' +
            'these are the places where one informs the other.',
          );
          const section = (title: string, items: string[]) => {
            if (items.length === 0) return;
            enrichment.push('');
            enrichment.push(`**${title}** (${items.length})`);
            enrichment.push(...items);
          };
          section('Explained by a recorded change', explained);
          section('Stable divergence — no recorded change', unexplained);
          section('Not covered by the ledger', coverageGaps);
          section('Seen only by the ledger [both detectors disagree]', ledgerOnly.map((d) =>
            `- ${scope.get(d.entityId) ?? d.entityId} · \`${d.fact}\` — changed ${fmtChange(d.previous, d.observed)} ` +
            `${fmtAge(now - Date.parse(d.observedAt))}, but the cross-site comparison surfaced no drift for it ` +
            `(both sides moved together, or this fact is not a compared dimension).`,
          ));
        }
      }
    } catch { /* enrichment is optional — legacy behavior stands */ }

    if (enrichment.length > 0) lines.push(...enrichment);

    const warning = fleetFreshnessWarning([baselineEntry, ...targets]);
    if (warning) lines.push(warning);

    return ok(lines.join('\n'));
  },
};

/** `{version:'9.5'} → {version:'9.9'}` renders as `9.5 → 9.9`; else compact JSON. */
function fmtChange(previous: unknown, observed: unknown): string {
  const v = (x: unknown): string | undefined => {
    if (x && typeof x === 'object' && 'version' in x) {
      const ver = (x as { version?: unknown }).version;
      if (typeof ver === 'string' && ver) return ver;
    }
    return undefined;
  };
  const a = v(previous);
  const b = v(observed);
  if (a && b) return `${a} → ${b}`;
  return `${brief(previous)} → ${brief(observed)}`;
}

function brief(x: unknown): string {
  if (x === null || x === undefined) return '—';
  const s = JSON.stringify(x);
  return s.length > 60 ? `${s.slice(0, 57)}…` : s;
}

/** Same age vocabulary as the other migrated fleet tools. */
function fmtAge(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return 'just now';
  return `${fmtDuration(ms)} ago`;
}

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
