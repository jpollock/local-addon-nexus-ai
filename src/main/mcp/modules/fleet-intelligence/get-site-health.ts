import { McpToolHandler, McpToolResult } from '../../types';
import { remoteHealthFactors } from '../../../health/remoteFactors';
import { indexFreshnessWarning } from '../../../twin/twin-helpers';
import { queryQualifiedTarget } from '../../site-resolver';

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
    // The identifier everything downstream must key off. `siteId` is the raw
    // argument and may be a qualified target (`ssh:alias@production`), which is
    // NOT a graph id — the plugin count, the score and the index-registry
    // lookup all need the resolved row's real id.
    let resolvedId: string;

    if (localSite) {
      resolvedId = localSite.id;
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
      const COLUMNS = 'id, name, source, domain, php_version';

      type GraphRow = { id: string; name: string; source: string; domain: string | null; php_version: string | null };
      let row: GraphRow | undefined;

      // A qualified target — `ssh:<alias>@<env>` / `wpe:<account>/<install>@<env>`
      // — is what nexus_list_sites prints for the agent to reuse, but it is a
      // *name*, not an id, so the raw `WHERE id = ?` lookup below can never
      // match it. Unwrap it first. Returns null for a bare name/id, in which
      // case the original lookup runs unchanged.
      const qualified = queryQualifiedTarget(db, siteId, COLUMNS);
      if (qualified !== null) {
        // Exactly one row is the answer; zero or several is "not found" rather
        // than a guess. The bare-id fallback must not run for a qualified
        // target — `ssh:x@production` is not an id.
        row = qualified.length === 1 ? (qualified[0] as GraphRow) : undefined;
      } else {
        row = db?.prepare(`SELECT ${COLUMNS} FROM sites WHERE id = ? AND is_active = 1`).get(siteId) as GraphRow | undefined;
      }

      if (!row) return ok(`Site not found: ${siteId}`);

      resolvedId = row.id;
      siteName = row.name;
      // C3: no default — a fabricated '8.0' would collect real security/
      // performance credit for a PHP version that was never actually observed.
      siteInfo = { domain: row.domain || '', phpVersion: row.php_version || undefined };

      // The shared gate (health/remoteFactors.ts) — the same copy the
      // GraphQL path calls, so the two surfaces cannot drift.
      factorsToEvaluate = remoteHealthFactors(db!, {
        id: row.id,
        source: row.source === 'wpe' ? 'wpe' : 'external',
        php_version: row.php_version,
      });
    }

    if (factorsToEvaluate.length === 0) {
      return ok(`## Health Report: ${siteName}\n\nNot enough data to score this host yet — run \`nexus host refresh\` to collect plugin and PHP version data first.`);
    }

    const breakdown = await calc.calculateScore(resolvedId, siteInfo, factorsToEvaluate);

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

    const indexEntry = services.indexRegistry.get?.(resolvedId) ?? null;
    const warning = indexEntry ? indexFreshnessWarning(indexEntry) : null;
    if (warning) lines.push(warning);

    return ok(lines.join('\n'));
  },
};
