import { McpToolHandler, McpToolResult } from '../../types';
import { ok, error, validateSlug } from './preflight';
import { resolveTransport } from '../../../transport';
import { withSiteRunning } from '../with-site-running';

export const pluginActivateHandler: McpToolHandler = {
  definition: {
    name: 'wp_plugin_activate',
    description:
      'Activate an installed but inactive WordPress plugin. ' +
      'Works on local sites (site=), remote WPE installs via SSH (install_name=), and external SSH hosts (ssh_target=). ' +
      'Plugin must already be installed — use wp_plugin_install first if not.',
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

    const transport = await resolveTransport(args, services, 'wpcli');
    if ('content' in transport) return transport;

    const executeCommand = async (): Promise<McpToolResult> => {
      const result = await transport.runWpCli(['plugin', 'activate', slug]);
      if (!result.success) {
        return error(
          transport.kind === 'wpe-ssh' && transport.siteRef.kind === 'wpe'
            ? `Failed to activate plugin "${slug}" on ${transport.siteRef.installName}: ${result.stdout}`
            : `Failed to activate plugin "${slug}": ${result.stdout}`
        );
      }

      return ok(
        transport.kind === 'wpe-ssh' && transport.siteRef.kind === 'wpe'
          ? `Plugin "${slug}" activated on ${transport.siteRef.installName}.`
          : `Plugin "${slug}" activated.`
      );
    };

    // Local sites require the site to be running
    if (transport.kind === 'local' && transport.siteRef.kind === 'local') {
      return withSiteRunning(transport.siteRef.siteId, services, executeCommand);
    }

    return executeCommand();
  },
};
