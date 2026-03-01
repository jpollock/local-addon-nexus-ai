import { McpToolHandler, McpToolResult } from '../../types';
import { resolveSite } from '../../site-resolver';
import { requireRunning, ok, error, validateSlug } from './preflight';

export const pluginInstallHandler: McpToolHandler = {
  definition: {
    name: 'wp_plugin_install',
    description: 'Install a WordPress plugin from the plugin directory.',
    inputSchema: {
      type: 'object',
      properties: {
        site: { type: 'string', description: 'Site name, ID, or domain' },
        slug: { type: 'string', description: 'Plugin slug (e.g. "akismet")' },
        activate: { type: 'boolean', description: 'Activate after install. Defaults to false.' },
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

    const cliArgs = ['plugin', 'install', slug];
    if (args.activate) cliArgs.push('--activate');

    const result = await services.localServices!.wpCliRun(site.id, cliArgs);
    if (!result.success) {
      return error(`Failed to install plugin "${slug}": ${result.stdout}`);
    }

    return ok(`Plugin "${slug}" installed${args.activate ? ' and activated' : ''}.`);
  },
};
