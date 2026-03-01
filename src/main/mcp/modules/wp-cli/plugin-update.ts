import { McpToolHandler, McpToolResult } from '../../types';
import { resolveSite } from '../../site-resolver';
import { requireRunning, ok, error, validateSlug } from './preflight';

export const pluginUpdateHandler: McpToolHandler = {
  definition: {
    name: 'wp_plugin_update',
    description: 'Update a WordPress plugin to its latest version.',
    inputSchema: {
      type: 'object',
      properties: {
        site: { type: 'string', description: 'Site name, ID, or domain' },
        slug: { type: 'string', description: 'Plugin slug to update. Use "--all" to update all plugins.' },
      },
      required: ['site', 'slug'],
    },
    isAvailable: (services) => !!services.localServices,
  },

  async execute(args, services): Promise<McpToolResult> {
    const site = resolveSite(args.site as string, services.siteData);
    if (!site) return error(`Site "${args.site}" not found.`);

    const check = requireRunning(site, services);
    if (check) return check;

    const slug = args.slug as string;
    if (slug !== '--all') {
      const slugErr = validateSlug(slug, 'plugin');
      if (slugErr) return slugErr;
    }

    const cliArgs = slug === '--all'
      ? ['plugin', 'update', '--all']
      : ['plugin', 'update', slug];

    const result = await services.localServices!.wpCliRun(site.id, cliArgs);
    if (!result.success) {
      return error(`Failed to update plugin "${slug}": ${result.stdout}`);
    }

    return ok(result.stdout || `Plugin "${slug}" updated.`);
  },
};
