import { McpToolHandler, McpToolResult } from '../../types';
import { resolveSite } from '../../site-resolver';
import { requireRunning, error } from '../wp-cli/preflight';
import { scanDatabase } from './db-scanner';

export const scanDatabaseHealthHandler: McpToolHandler = {
  definition: {
    name: 'scan_database_health',
    description:
      'Scan a local WordPress site\'s database for bloat and issues. Returns structured JSON with revisions, transients, orphaned rows, plugin leftover tables, and a health score (0–100).',
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

    const check = requireRunning(site, services);
    if (check) return check;

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
  },
};
