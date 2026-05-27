import { McpToolHandler, McpToolResult } from '../../types';
import { resolveSite } from '../../site-resolver';
import { error } from '../wp-cli/preflight';
import { withSiteRunning } from '../with-site-running';
import { scanDatabase } from './db-scanner';

export const scanDatabaseHealthHandler: McpToolHandler = {
  definition: {
    name: 'scan_database_health',
    description:
      'Scan a local WordPress site database for bloat and health issues — post revisions, auto-drafts, trashed items, expired transients, orphaned postmeta, plugin leftover tables, and autoload bloat. ' +
      'Returns a structured health report with a score (0-100) and per-category breakdown. ' +
      'LOCAL SITES ONLY — site must be running. ' +
      'Use get_database_recommendations for actionable WP-CLI commands to fix issues found, and clean_database_items to execute cleanup.',
    inputSchema: {
      type: 'object',
      properties: {
        site: { type: 'string', description: 'Site name, ID, or domain' },
      },
      required: ['site'],
    },
    isAvailable: (services) => !!services.localServices,
  },

  async execute(args, services): Promise<McpToolResult> {
    const site = resolveSite(args.site as string, services.siteData);
    if (!site) return error(`Site "${args.site}" not found.`);

    return withSiteRunning(site.id, services, async () => {
      try {
        const result = await scanDatabase(site.id, services);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Database scan failed: ${err instanceof Error ? err.message : String(err)}` }],
        };
      }
    });
  },
};
