import { McpToolHandler, McpToolResult } from '../../types';
import { ok, error } from '../wp-cli/preflight';
import { scanDatabase } from '../db-scanner/db-scanner';
import type { DbScanResult } from '../../../../common/types';

/**
 * Composite tool: scans all running sites for database health and returns
 * a ranked JSON array sorted by healthScore ascending (worst first).
 */
export const dbAuditHandler: McpToolHandler = {
  definition: {
    name: 'fleet_database_health',
    description:
      'Scan all running local sites for database health issues. Returns a ranked list sorted by health score (worst first). Useful for identifying which sites need the most attention.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    isAvailable: (services) => !!services.localServices,
  },

  async execute(_args, services): Promise<McpToolResult> {
    const ls = services.localServices!;
    const sites = Object.values(services.siteData.getSites());
    const statuses = ls.getAllSiteStatuses();

    const runningSites = sites.filter((s) => statuses[s.id] === 'running');

    if (runningSites.length === 0) {
      return error('No running sites found. Start at least one site first.');
    }

    // Scan each running site — use allSettled so one failure doesn't abort the fleet
    const scanResults = await Promise.allSettled(
      runningSites.map((site) => scanDatabase(site.id, services)),
    );

    const successful: DbScanResult[] = [];
    const failed: Array<{ siteName: string; error: string }> = [];

    for (let i = 0; i < scanResults.length; i++) {
      const r = scanResults[i];
      if (r.status === 'fulfilled') {
        successful.push(r.value);
      } else {
        failed.push({
          siteName: runningSites[i].name,
          error: r.reason instanceof Error ? r.reason.message : String(r.reason),
        });
      }
    }

    // Sort by healthScore ascending (worst sites first)
    successful.sort((a, b) => a.healthScore - b.healthScore);

    const report = {
      scannedAt: Date.now(),
      sitesScanned: successful.length,
      sitesFailed: failed.length,
      sites: successful.map((s) => ({
        siteId: s.siteId,
        siteName: s.siteName,
        healthScore: s.healthScore,
        wpVersion: s.wpVersion,
        isWooCommerceActive: s.isWooCommerceActive,
        revisionCount: s.revisions.totalCount,
        expiredTransients: s.transients.expiredCount,
        leftoverTables: s.pluginTables.leftoverTables.length,
        topIssue: s.summary[0] ?? null,
        summary: s.summary,
        durationMs: s.durationMs,
      })),
      failures: failed,
    };

    return {
      content: [{ type: 'text', text: JSON.stringify(report, null, 2) }],
    };
  },
};
