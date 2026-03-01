import { McpToolHandler, McpToolResult } from '../../types';
import { requireRunning, ok, error, validateSlug } from './preflight';
import { resolveTarget, remoteWpCliRun } from './remote-exec';

export const pluginUpdateHandler: McpToolHandler = {
  definition: {
    name: 'wp_plugin_update',
    description: 'Update a WordPress plugin to its latest version.',
    inputSchema: {
      type: 'object',
      properties: {
        site: { type: 'string', description: 'Local site name, ID, or domain' },
        install_name: { type: 'string', description: 'WPE install name for remote execution via SSH' },
        slug: { type: 'string', description: 'Plugin slug to update. Use "--all" to update all plugins.' },
      },
      required: ['slug'],
    },
    isAvailable: (services) => !!services.localServices,
  },

  async execute(args, services): Promise<McpToolResult> {
    const slug = args.slug as string;
    if (slug !== '--all') {
      const slugErr = validateSlug(slug, 'plugin');
      if (slugErr) return slugErr;
    }

    const target = await resolveTarget(args, services);
    if ('content' in target) return target;

    const cliArgs = slug === '--all'
      ? ['plugin', 'update', '--all']
      : ['plugin', 'update', slug];

    if (target.type === 'remote') {
      const result = await remoteWpCliRun(target.installName, cliArgs, services);
      if (!result.success) {
        return error(`Failed to update plugin "${slug}" on ${target.installName}: ${result.stdout}`);
      }
      return ok(result.stdout || `Plugin "${slug}" updated on ${target.installName}.`);
    }

    const check = requireRunning(target.site, services);
    if (check) return check;

    const result = await services.localServices!.wpCliRun(target.site.id, cliArgs);
    if (!result.success) {
      return error(`Failed to update plugin "${slug}": ${result.stdout}`);
    }

    return ok(result.stdout || `Plugin "${slug}" updated.`);
  },
};
