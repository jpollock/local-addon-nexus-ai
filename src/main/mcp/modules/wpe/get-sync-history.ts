import { McpToolHandler, McpToolResult } from '../../types';
import { resolveSite } from '../../site-resolver';
import { ok, error, requireLocalServices } from './helpers';

export const getSyncHistoryHandler: McpToolHandler = {
  definition: {
    name: 'local_get_sync_history',
    description: 'Get the history of push and pull sync operations for a local site linked to WPE — shows operation type, timestamp, and status for recent syncs. Use to audit when a site was last synced, or to verify that a push or pull completed successfully.',
    inputSchema: {
      type: 'object',
      properties: {
        site: {
          type: 'string',
          description: 'Site name, ID, or domain',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of history events to return (default: 10)',
        },
      },
      required: ['site'],
    },
    isAvailable: (services) => requireLocalServices(services),
  },

  async execute(args, services): Promise<McpToolResult> {
    const site = resolveSite(args.site as string, services.siteData);
    if (!site) return error(`Site "${args.site}" not found.`);

    const limit = (args.limit as number) || 10;

    try {
      const events = await services.localServices!.getSyncHistory?.(site.id);

      if (!events) {
        return error('Connect history service not available in this version of Local');
      }

      const limited = events.slice(0, limit);

      const result = {
        site: site.name,
        totalEvents: events.length,
        showing: limited.length,
        events: limited.map((e) => ({
          direction: e.direction,
          remoteName: e.remoteInstallName || null,
          environment: e.environment,
          status: e.status || 'unknown',
          timestamp: new Date(e.timestamp).toISOString(),
        })),
      };

      return ok(JSON.stringify(result, null, 2));
    } catch (err: any) {
      return error(`Failed to get sync history: ${err.message}`);
    }
  },
};
