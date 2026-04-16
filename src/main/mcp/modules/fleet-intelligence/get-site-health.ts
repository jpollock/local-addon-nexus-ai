import { McpToolHandler, McpToolResult } from '../../types';
import { indexFreshnessWarning } from '../../../twin/twin-helpers';

function ok(text: string): McpToolResult {
  return { content: [{ type: 'text', text }] };
}

export const getSiteHealthHandler: McpToolHandler = {
  definition: {
    name: 'get_site_health',
    description:
      'Get a detailed health breakdown for a specific indexed site — overall score (0–100), per-dimension scores (database, index freshness, plugin currency), and actionable recommendations. Use after fleet_health_summary to drill into a site flagged with a low score. For database-specific details and cleanup commands, use scan_database_health.' +
      'with factor scores (security, performance, maintenance, activity, stability), ' +
      'issues found, and recommendations.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'The site ID to check health for' },
      },
      required: ['site_id'],
    },
    annotations: { title: 'Get Site Health', readOnlyHint: true },
  },

  async execute(args, services): Promise<McpToolResult> {
    const calc = services.healthCalculator;
    if (!calc) return ok('Health scoring is not available.');

    const siteId = args.site_id as string;
    const site = services.siteData.getSite(siteId);
    if (!site) return ok(`Site not found: ${siteId}`);

    const breakdown = await calc.calculateScore(siteId, {
      domain: site.domain || '',
      phpVersion: (site as any).phpVersion || '8.0',
    });

    const lines = [
      `## Health Report: ${site.name}`,
      '',
      `**Overall Score:** ${breakdown.overall}/100`,
      '',
      '### Factor Scores',
      `- Security: ${breakdown.factors.security}/100 (weight: 30%)`,
      `- Performance: ${breakdown.factors.performance}/100 (weight: 25%)`,
      `- Maintenance: ${breakdown.factors.maintenance}/100 (weight: 20%)`,
      `- Activity: ${breakdown.factors.activity}/100 (weight: 15%)`,
      `- Stability: ${breakdown.factors.stability}/100 (weight: 10%)`,
    ];

    if (breakdown.issues && breakdown.issues.length > 0) {
      lines.push('', '### Issues Found');
      for (const issue of breakdown.issues) {
        lines.push(`- ${issue}`);
      }
    }

    if (breakdown.recommendations && breakdown.recommendations.length > 0) {
      lines.push('', '### Recommendations');
      for (const rec of breakdown.recommendations) {
        lines.push(`- ${rec}`);
      }
    }

    const indexEntry = services.indexRegistry.get?.(siteId) ?? null;
    const warning = indexFreshnessWarning(indexEntry);
    if (warning) lines.push(warning);

    return ok(lines.join('\n'));
  },
};
