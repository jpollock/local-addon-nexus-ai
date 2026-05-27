import { McpToolHandler, McpToolResult } from '../../types';
import { ok, error, validateSlug } from './preflight';
import { resolveTarget, remoteWpCliRun } from './remote-exec';
import { withSiteRunning } from '../with-site-running';

export const pluginUpdateHandler: McpToolHandler = {
  definition: {
    name: 'wp_plugin_update',
    description:
      'Update one or all WordPress plugins to their latest versions. ' +
      'Works on local sites (site=) and remote WPE installs via SSH (install_name=). ' +
      'Use slug="--all" to update every plugin in one call. ' +
      'Run wp_plugin_list first to see installed versions. ' +
      'If a plugin fails to update, it may require a WP core update first — run wp_core_update then retry.',
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

    return withSiteRunning(target.site.id, services, async () => {
      // Plugin updates download from WordPress.org — allow up to 3 minutes
      const result = await services.localServices!.wpCliRun(target.site.id, cliArgs, { timeoutMs: 180000 });
      if (!result.success) {
        return error(`Failed to update plugin "${slug}": ${result.stdout}`);
      }

      return ok(result.stdout || `Plugin "${slug}" updated.`);
    });
  },
};
