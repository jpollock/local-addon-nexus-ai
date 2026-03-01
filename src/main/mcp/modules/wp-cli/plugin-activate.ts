import { McpToolHandler, McpToolResult } from '../../types';
import { resolveSite } from '../../site-resolver';
import { requireRunning, ok, error, validateSlug } from './preflight';

export const pluginActivateHandler: McpToolHandler = {
  definition: {
    name: 'wp_plugin_activate',
    description: 'Activate an installed WordPress plugin.',
    inputSchema: {
      type: 'object',
      properties: {
        site: { type: 'string', description: 'Site name, ID, or domain' },
        slug: { type: 'string', description: 'Plugin slug to activate' },
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
    const slugErr = validateSlug(slug, 'plugin');
    if (slugErr) return slugErr;

    const result = await services.localServices!.wpCliRun(site.id, ['plugin', 'activate', slug]);
    if (!result.success) {
      return error(`Failed to activate plugin "${slug}": ${result.stdout}`);
    }

    return ok(`Plugin "${slug}" activated.`);
  },
};
