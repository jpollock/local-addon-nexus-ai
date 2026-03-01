import { McpToolHandler, McpToolResult } from '../../types';
import { requireRunning, ok, error, validateSlug } from './preflight';
import { resolveTarget, remoteWpCliRun } from './remote-exec';

export const pluginInstallHandler: McpToolHandler = {
  definition: {
    name: 'wp_plugin_install',
    description: 'Install a WordPress plugin from the plugin directory.',
    inputSchema: {
      type: 'object',
      properties: {
        site: { type: 'string', description: 'Local site name, ID, or domain' },
        install_name: { type: 'string', description: 'WPE install name for remote execution via SSH' },
        slug: { type: 'string', description: 'Plugin slug (e.g. "akismet")' },
        activate: { type: 'boolean', description: 'Activate after install. Defaults to false.' },
      },
      required: ['slug'],
    },
    isAvailable: (services) => !!services.localServices,
  },

  async execute(args, services): Promise<McpToolResult> {
    const slug = args.slug as string;
    const slugErr = validateSlug(slug, 'plugin');
    if (slugErr) return slugErr;

    const target = await resolveTarget(args, services);
    if ('content' in target) return target;

    const cliArgs = ['plugin', 'install', slug];
    if (args.activate) cliArgs.push('--activate');

    if (target.type === 'remote') {
      const result = await remoteWpCliRun(target.installName, cliArgs, services);
      if (!result.success) {
        return error(`Failed to install plugin "${slug}" on ${target.installName}: ${result.stdout}`);
      }
      return ok(`Plugin "${slug}" installed${args.activate ? ' and activated' : ''} on ${target.installName}.`);
    }

    const check = requireRunning(target.site, services);
    if (check) return check;

    const result = await services.localServices!.wpCliRun(target.site.id, cliArgs);
    if (!result.success) {
      return error(`Failed to install plugin "${slug}": ${result.stdout}`);
    }

    return ok(`Plugin "${slug}" installed${args.activate ? ' and activated' : ''}.`);
  },
};
