import { McpToolHandler, McpToolResult } from '../../types';
import { resolveSite } from '../../site-resolver';
import { requireRunning, ok, error } from './preflight';

export const siteHealthHandler: McpToolHandler = {
  definition: {
    name: 'wp_site_health',
    description: 'Run WordPress site health check.',
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

    const result = await services.localServices!.wpCliRun(site.id, [
      'site', 'health', 'status', '--format=json',
    ]);

    if (!result.success) {
      return error(`Site health check failed: ${result.stdout}`);
    }

    return ok(result.stdout || 'Site health check completed.');
  },
};
