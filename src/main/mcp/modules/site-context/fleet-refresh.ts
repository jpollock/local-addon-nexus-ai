/**
 * nexus_fleet_refresh — refresh the digital twin for all Local sites.
 *
 * Runs a filesystem scan for every known site, then WP-CLI enrichment for
 * all currently running ones. Reports per-site outcomes.
 */
import { McpToolHandler, McpToolResult } from '../../types';
import { StartupSiteScanner } from '../../../startup/StartupSiteScanner';

export const fleetRefreshHandler: McpToolHandler = {
  definition: {
    name: 'nexus_fleet_refresh',
    description:
      'Refresh the cached data (digital twin) for all Local sites at once. ' +
      'Runs a filesystem scan for every site (halted or running) to update WP version ' +
      'and installed plugins/themes. Enriches running sites with WP-CLI data. ' +
      'Use after major changes or when twin data seems stale across multiple sites.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },

  async execute(_args, services): Promise<McpToolResult> {
    const metadataCache = services.metadataCache;
    if (!metadataCache) return error('Metadata cache not available');

    const localServices = services.localServices;
    if (!localServices) return error('Local services not available');

    const allSites = Object.values(services.siteData.getSites());
    if (allSites.length === 0) {
      return ok('No local sites found.');
    }

    const statuses = localServices.getAllSiteStatuses() as Record<string, string>;
    const runningSiteIds = Object.entries(statuses)
      .filter(([, s]) => s === 'running')
      .map(([id]) => id);

    const scanner = new StartupSiteScanner({
      getAllSites: () => allSites.map((s: any) => ({
        id: s.id,
        name: s.name,
        path: s.path,
        phpVersion: s.phpVersion,
      })),
      getRunningSiteIds: () => runningSiteIds,
      localServices,
      metadataCache,
      logger: { info: services.logger.info.bind(services.logger), warn: services.logger.error.bind(services.logger), error: services.logger.error.bind(services.logger) },
    });

    await scanner.scan();

    // Build summary
    const lines: string[] = [];
    lines.push(`## Fleet refresh complete — ${allSites.length} sites`);
    lines.push('');

    let fullCount = 0;
    let fsCount   = 0;

    for (const site of allSites as any[]) {
      const meta = metadataCache.getWithAge(site.id);
      const depth = meta?.scanDepth ?? 'none';
      const age   = metadataCache.getAgeString(site.id);
      const icon  = depth === 'full' ? '✅' : depth === 'filesystem' ? '🔶' : '❌';
      const running = runningSiteIds.includes(site.id) ? ' (running)' : '';
      lines.push(`${icon} **${site.name}**${running} — ${depth} scan, updated ${age}`);
      if (depth === 'full') fullCount++;
      else if (depth === 'filesystem') fsCount++;
    }

    lines.push('');
    lines.push(`**Summary:** ${fullCount} full scans, ${fsCount} filesystem-only, ${allSites.length - fullCount - fsCount} failed`);

    if (fsCount > 0) {
      lines.push('');
      lines.push('_🔶 = filesystem scan only. Start the site and refresh again for plugin status and post counts._');
    }

    return ok(lines.join('\n'));
  },
};

function ok(text: string): McpToolResult {
  return { content: [{ type: 'text', text }] };
}

function error(text: string): McpToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}
