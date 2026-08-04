import { McpToolHandler, McpToolResult } from '../../types';
import { ok, error, validateSlug } from './preflight';
import { resolveTransport } from '../../../transport';
import { withSiteRunning } from '../with-site-running';

export const pluginInstallHandler: McpToolHandler = {
  definition: {
    name: 'wp_plugin_install',
    description:
      'Install a WordPress plugin from WordPress.org by slug, optionally pinning a specific version. ' +
      'Works on local sites (site=), remote WPE installs via SSH (install_name=), and external SSH hosts (ssh_target=). ' +
      'Use version= to install an older or specific version (e.g. version="5.7" for Contact Form 7 5.7, version="7.4.0" for WooCommerce 7.4.0). ' +
      'Set activate=true to activate immediately after install. ' +
      'WordPress.org only — for premium plugins not on .org, upload the zip via WP Admin.',
    inputSchema: {
      type: 'object',
      properties: {
        site: { type: 'string', description: 'Local site name, ID, or domain' },
        install_name: { type: 'string', description: 'WPE install name for remote execution via SSH' },
        ssh_target: {
          type: 'string',
          description: 'External SSH host, as ssh:<alias>@<production|staging|development>. The alias is a Host entry in the user\'s ~/.ssh/config. Register one with `nexus host add`.',
        },
        wp_path: {
          type: 'string',
          description: 'Absolute WordPress root on an external host. Usually unnecessary — a registered host supplies its own discovered path.',
        },
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

    const transport = await resolveTransport(args, services, 'wpcli');
    if ('content' in transport) return transport;

    const cliArgs = ['plugin', 'install', slug];
    if (args.version) cliArgs.push(`--version=${args.version as string}`);
    if (args.activate) cliArgs.push('--activate');

    const executeCommand = async (): Promise<McpToolResult> => {
      const result = await transport.runWpCli(cliArgs);
      if (!result.success) {
        return error(
          transport.kind === 'wpe-ssh' && transport.siteRef.kind === 'wpe'
            ? `Failed to install plugin "${slug}" on ${transport.siteRef.installName}: ${result.stdout}`
            : `Failed to install plugin "${slug}": ${result.stdout}`
        );
      }

      return ok(
        transport.kind === 'wpe-ssh' && transport.siteRef.kind === 'wpe'
          ? `Plugin "${slug}" installed${args.activate ? ' and activated' : ''} on ${transport.siteRef.installName}.`
          : `Plugin "${slug}" installed${args.activate ? ' and activated' : ''}.`
      );
    };

    // Local sites require the site to be running
    if (transport.kind === 'local' && transport.siteRef.kind === 'local') {
      return withSiteRunning(transport.siteRef.siteId, services, executeCommand);
    }

    return executeCommand();
  },
};
