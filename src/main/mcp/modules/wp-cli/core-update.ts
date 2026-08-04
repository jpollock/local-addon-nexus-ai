import { McpToolHandler, McpToolResult } from '../../types';
import { ok, error } from './preflight';
import { resolveTransport } from '../../../transport';
import { withSiteRunning } from '../with-site-running';

export const coreUpdateHandler: McpToolHandler = {
  definition: {
    name: 'wp_core_update',
    description:
      'Update WordPress core to the latest version (or a specific version). ' +
      'Works on local sites (site=), remote WPE installs via SSH (install_name=), and external SSH hosts (ssh_target=). ' +
      'Run wp_core_version first to see the current version. ' +
      'After updating core, re-run wp_plugin_update --all to catch any plugins blocked by WP version requirements.',
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
        version: {
          type: 'string',
          description: 'Specific version to update to (e.g. "6.9.4"). Omit for latest.',
        },
        force: {
          type: 'boolean',
          description: 'Force update even if already on the target version. Default: false.',
        },
      },
    },
    isAvailable: (services) => !!services.localServices,
  },

  async execute(args, services): Promise<McpToolResult> {
    const transport = await resolveTransport(args, services, 'wpcli');
    if ('content' in transport) return transport;

    const cliArgs = ['core', 'update'];
    if (args.version) cliArgs.push(`--version=${args.version}`);
    if (args.force) cliArgs.push('--force');

    const executeCommand = async (): Promise<McpToolResult> => {
      const timeoutMs = transport.kind === 'local' ? 180000 : undefined;
      const result = await transport.runWpCli(cliArgs, { timeoutMs });

      if (!result.success) {
        return error(
          transport.kind === 'wpe-ssh' && transport.siteRef.kind === 'wpe'
            ? `Failed to update WP core on ${transport.siteRef.installName}: ${result.stdout}`
            : `Failed to update WP core: ${result.stdout}`
        );
      }

      return ok(
        result.stdout ||
          (transport.kind === 'wpe-ssh' && transport.siteRef.kind === 'wpe'
            ? `WordPress core updated on ${transport.siteRef.installName}.`
            : 'WordPress core updated.')
      );
    };

    // Local sites require the site to be running
    if (transport.kind === 'local' && transport.siteRef.kind === 'local') {
      return withSiteRunning(transport.siteRef.siteId, services, executeCommand);
    }

    return executeCommand();
  },
};
