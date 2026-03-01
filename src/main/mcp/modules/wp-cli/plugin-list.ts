import { McpToolHandler, McpToolResult } from '../../types';
import { resolveSite } from '../../site-resolver';
import { requireRunning, ok, error } from './preflight';

export const pluginListHandler: McpToolHandler = {
  definition: {
    name: 'wp_plugin_list',
    description: 'List all installed WordPress plugins for a site.',
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

    const plugins = await services.localServices!.getPlugins(site.id);

    if (plugins.length === 0) {
      return ok('No plugins installed.');
    }

    const lines = [`## Plugins (${plugins.length})`];
    for (const p of plugins) {
      const status = p.status === 'active' ? '**active**' : p.status;
      lines.push(`- ${p.name} v${p.version} [${status}]`);
    }

    return ok(lines.join('\n'));
  },
};
