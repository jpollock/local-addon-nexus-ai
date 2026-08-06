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

    const localSite = services.siteData.getSite(siteId);

    let siteName: string;
    let siteInfo: { domain: string; phpVersion?: string };
    let factorsToEvaluate: Array<'security' | 'performance' | 'maintenance' | 'activity' | 'stability'>;

    if (localSite) {
      siteName = localSite.name;
      siteInfo = {
        domain: localSite.domain || '',
        // Pre-existing default on the LOCAL path only — Local's own store
        // supplies a real phpVersion for local sites. Left alone deliberately;
        // see the identical note on nexusFleetSiteHealth in resolvers.ts.
        phpVersion: (localSite as any).phpVersion || '8.0',
      };
      factorsToEvaluate = ['security', 'performance', 'maintenance', 'activity', 'stability'];
    } else {
      const graphService = (services as any).graphService;
      const db = graphService?.getDb?.();
      const row = db?.prepare('SELECT id, name, source, domain, php_version FROM sites WHERE id = ? AND is_active = 1').get(siteId) as
        | { id: string; name: string; source: string; domain: string | null; php_version: string | null }
        | undefined;

      if (!row) return ok(`Site not found: ${siteId}`);

      siteName = row.name;
      // C3: no default — a fabricated '8.0' would collect real security/
      // performance credit for a PHP version that was never actually observed.
      siteInfo = { domain: row.domain || '', phpVersion: row.php_version || undefined };

      if (row.source === 'wpe') {
        factorsToEvaluate = ['security', 'performance'];
      } else {
        // external — same data-presence gate as nexusFleetSiteHealth: scoreable
        // only once a refresh has actually populated plugins + php_version.
        const hasPlugins = (db!.prepare('SELECT COUNT(*) as c FROM plugins WHERE site_id = ?').get(row.id) as { c: number }).c > 0;
        const externalScoreable = hasPlugins && !!row.php_version;
        factorsToEvaluate = externalScoreable ? ['security', 'performance'] : [];
      }
    }

    if (factorsToEvaluate.length === 0) {
      return ok(`## Health Report: ${siteName}\n\nNot enough data to score this host yet — run \`nexus host refresh\` to collect plugin and PHP version data first.`);
    }

    const breakdown = await calc.calculateScore(siteId, siteInfo, factorsToEvaluate);

    const factorLabels: Record<string, { label: string; weight: string }> = {
      security: { label: 'Security', weight: '30%' },
      performance: { label: 'Performance', weight: '25%' },
      maintenance: { label: 'Maintenance', weight: '20%' },
      activity: { label: 'Activity', weight: '15%' },
      stability: { label: 'Stability', weight: '10%' },
    };

    const lines = [
      `## Health Report: ${siteName}`,
      '',
      `**Overall Score:** ${breakdown.overall}/100`,
      '',
      '### Factor Scores',
      ...factorsToEvaluate.map((f) => `- ${factorLabels[f].label}: ${(breakdown.factors as any)[f]}/100 (weight: ${factorLabels[f].weight})`),
    ];

    if (factorsToEvaluate.length < 5) {
      lines.push('', `_Scored on ${factorsToEvaluate.join(' + ')} only — the other factors need data this site doesn't have yet._`);
    }

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
    const warning = indexEntry ? indexFreshnessWarning(indexEntry) : null;
    if (warning) lines.push(warning);

    return ok(lines.join('\n'));
  },
};
