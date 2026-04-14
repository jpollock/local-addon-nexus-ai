import { McpToolHandler, McpToolResult } from '../../types';
import { requireRunning, ok, error, validateSlug } from './preflight';
import { resolveTarget, remoteWpCliRun } from './remote-exec';

export const pluginActivateHandler: McpToolHandler = {
  definition: {
    name: 'wp_plugin_activate',
    description:
      'Activate an installed but inactive WordPress plugin. ' +
      'Works on local sites (site=) and remote WPE installs via SSH (install_name=). ' +
      'Plugin must already be installed — use wp_plugin_install first if not.',
    inputSchema: {
      type: 'object',
      properties: {
        site: { type: 'string', description: 'Local site name, ID, or domain' },
        install_name: { type: 'string', description: 'WPE install name for remote execution via SSH' },
        slug: { type: 'string', description: 'Plugin slug to activate' },
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

    if (target.type === 'remote') {
      const result = await remoteWpCliRun(target.installName, ['plugin', 'activate', slug], services);
      if (!result.success) {
        return error(`Failed to activate plugin "${slug}" on ${target.installName}: ${result.stdout}`);
      }
      return ok(`Plugin "${slug}" activated on ${target.installName}.`);
    }

    const check = requireRunning(target.site, services);
    if (check) return check;

    const result = await services.localServices!.wpCliRun(target.site.id, ['plugin', 'activate', slug]);
    if (!result.success) {
      return error(`Failed to activate plugin "${slug}": ${result.stdout}`);
    }

    return ok(`Plugin "${slug}" activated.`);
  },
};
