import { McpToolHandler, McpToolResult } from '../../types';
import { buildFleetScoringInputs } from '../../../health/fleetScoring';
import { fleetFreshnessWarning, DAY_MS } from '../../../twin/twin-helpers';

function ok(text: string): McpToolResult {
  return { content: [{ type: 'text', text }] };
}

export const fleetHealthSummaryHandler: McpToolHandler = {
  definition: {
    name: 'fleet_health_summary',
    description:
      'Get health scores for all indexed LOCAL sites — per-site score (0-100), top issues, and fleet average. ' +
      'Scores are computed from database health, index freshness, and plugin/core currency. ' +
      'LOCAL SITES ONLY. Use to identify which sites need the most attention. ' +
      'For a specific site breakdown, use get_site_health. For database-specific health, use scan_database_health.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    annotations: { title: 'Fleet Health Summary', readOnlyHint: true },
  },

  async execute(_args, services): Promise<McpToolResult> {
    const calc = services.healthCalculator;
    if (!calc) return ok('Health scoring is not available.');

    const entries = services.indexRegistry.listAll().filter((e: any) => e.state === 'indexed');
    if (entries.length === 0) {
      return ok('No indexed sites found. Index sites first to get health scores.');
    }

    const allSites = services.siteData.getSites();
    // The shared derivation (health/fleetScoring.ts) — same module the
    // GraphQL and IPC loops consume. Remote entries resolve through the
    // graph and score security+performance under their ROW id; entries with
    // no scoreable data are excluded and reported, never scored 0.
    const inputs = buildFleetScoringInputs(
      entries, allSites as any, services.graphService?.getDb?.(),
    );
    const scoredSet = new Set(inputs.siteIds);
    const scoredEntries = entries.filter((e: any) => scoredSet.has(e.siteId));

    const scores = await calc.calculateAllScores(inputs.siteIds, inputs.siteInfoMap, inputs.perSite);

    let healthy = 0, warning = 0, critical = 0;
    let totalScore = 0;
    const siteLines: string[] = [];

    for (const entry of scoredEntries) {
      const score = scores[entry.siteId] || 0;
      totalScore += score;
      if (score >= 80) healthy++;
      else if (score >= 50) warning++;
      else critical++;

      const icon = score >= 80 ? 'Good' : score >= 50 ? 'Warning' : 'Critical';

      // Per-site staleness indicator from twin data
      let staleTag = '';
      if (services.twinService) {
        const twin = services.twinService.get(entry.siteId);
        if (twin?.asOf != null && Date.now() - twin.asOf > DAY_MS) {
          staleTag = ' ⚠️ stale';
        } else if (!twin || twin.asOf === null) {
          staleTag = ' ⚠️ no data';
        }
      }

      siteLines.push(`- **${entry.siteName}** (${entry.siteId}): ${score}/100 [${icon}]${staleTag}`);
    }

    // The honest denominator: entries actually scored. Dividing by the full
    // entry count would silently drag the average down by every excluded row.
    const avg = scoredEntries.length > 0 ? Math.round(totalScore / scoredEntries.length) : 0;

    const freshnessWarn = fleetFreshnessWarning(entries);

    const lines = [
      '## Fleet Health Summary',
      '',
      `**Fleet Average:** ${avg}/100`,
      `**Distribution:** ${healthy} healthy, ${warning} warning, ${critical} critical`
        + (inputs.unresolved.length > 0
          ? ` (${inputs.unresolved.length} not scored — no resolvable data)`
          : ''),
      '',
      '### Per-Site Scores',
      ...siteLines,
    ];

    if (freshnessWarn) lines.push(freshnessWarn);

    return ok(lines.join('\n'));
  },
};
