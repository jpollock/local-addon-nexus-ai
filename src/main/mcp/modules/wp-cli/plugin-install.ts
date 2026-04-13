import { McpToolHandler, McpToolResult } from '../../types';
import { requireRunning, ok, error, validateSlug } from './preflight';
import { resolveTarget, remoteWpCliRun } from './remote-exec';

export const pluginInstallHandler: McpToolHandler = {
  definition: {
    name: 'wp_plugin_install',
    description:
      'Install a WordPress plugin from WordPress.org by slug, optionally pinning a specific version. ' +
      'Works on local sites (site=) and remote WPE installs via SSH (install_name=). ' +
      'Use version= to install an older or specific version (e.g. version="5.7" for Contact Form 7 5.7, version="7.4.0" for WooCommerce 7.4.0). ' +
      'Set activate=true to activate immediately after install. ' +
      'WordPress.org only — for premium plugins not on .org, upload the zip via WP Admin.',
    inputSchema: {
      type: 'object',
      properties: {
        site: { type: 'string', description: 'Local site name, ID, or domain' },
        install_name: { type: 'string', description: 'WPE install name for remote execution via SSH' },
        slug: { type: 'string', description: 'Plugin slug (e.g. "contact-form-7", "woocommerce")' },
        version: { type: 'string', description: 'Specific version to install (e.g. "5.7", "7.4.0"). Omit for latest.' },
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
    if (args.version) cliArgs.push(`--version=${args.version as string}`);
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
