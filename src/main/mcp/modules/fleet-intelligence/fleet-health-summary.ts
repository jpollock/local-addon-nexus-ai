import { McpToolHandler, McpToolResult } from '../../types';
import { fleetFreshnessWarning, DAY_MS } from '../../../twin/twin-helpers';

function ok(text: string): McpToolResult {
  return { content: [{ type: 'text', text }] };
}

export const fleetHealthSummaryHandler: McpToolHandler = {
  definition: {
    name: 'fleet_health_summary',
    description:
      'Get health scores for all indexed sites in the fleet — per-site score (0-100), top issues, and fleet average. Scores are computed from database health, index freshness, and plugin/core currency. Use to identify which sites need the most attention. For a specific site breakdown, use get_site_health. For database-specific health, use scan_database_health.' +
      'and fleet-wide statistics (healthy/warning/critical counts, average score).',
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
    const siteInfoMap: Record<string, any> = {};
    const siteIds: string[] = [];

    for (const entry of entries) {
      const site = allSites[entry.siteId];
      siteIds.push(entry.siteId);
      siteInfoMap[entry.siteId] = {
        domain: site?.domain || '',
        phpVersion: (site as any)?.phpVersion || '8.0',
      };
    }

    const scores = await calc.calculateAllScores(siteIds, siteInfoMap);

    let healthy = 0, warning = 0, critical = 0;
    let totalScore = 0;
    const siteLines: string[] = [];

    for (const entry of entries) {
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

    const avg = Math.round(totalScore / entries.length);

    const freshnessWarn = fleetFreshnessWarning(entries);

    const lines = [
      '## Fleet Health Summary',
      '',
      `**Fleet Average:** ${avg}/100`,
      `**Distribution:** ${healthy} healthy, ${warning} warning, ${critical} critical`,
      '',
      '### Per-Site Scores',
      ...siteLines,
    ];

    if (freshnessWarn) lines.push(freshnessWarn);

    return ok(lines.join('\n'));
  },
};
