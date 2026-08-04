import { McpToolHandler, McpToolResult } from '../../types';
import { ok, error } from './preflight';
import { resolveTransport } from '../../../transport';
import { withSiteRunning } from '../with-site-running';

export const themeActivateHandler: McpToolHandler = {
  definition: {
    name: 'wp_theme_activate',
    description:
      'Activate a WordPress theme by slug. ' +
      'Works on local sites (site=), remote WPE installs via SSH (install_name=), and external SSH hosts (ssh_target=). ' +
      'Runs with --skip-themes internally, so it works even when the currently active theme ' +
      'crashes WordPress on bootstrap (e.g. theme requires a newer WP API than is installed). ' +
      'Use this for crash recovery: switch to a compatible theme (twentytwentyone, twentytwentytwo) ' +
      'when the active theme prevents WordPress from loading. ' +
      'The theme must already be installed — use wp_theme_list to see available themes.',
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
        slug: {
          type: 'string',
          description: 'Theme slug to activate (e.g. "twentytwentyone", "twentytwentytwo", "astra")',
        },
      },
      required: ['slug'],
    },
    isAvailable: (services) => !!services.localServices,
  },

  async execute(args, services): Promise<McpToolResult> {
    const slug = args.slug as string;
    if (!slug) return error('Theme slug is required.');

    const transport = await resolveTransport(args, services, 'wpcli');
    if ('content' in transport) return transport;

    const executeCommand = async (): Promise<McpToolResult> => {
      // Always skip themes when activating — this is the key: it lets us switch themes
      // even when the currently active theme crashes WordPress on load.
      const result = await transport.runWpCli(['theme', 'activate', slug], {
        skipPlugins: false,
        skipThemes: true,
      });

      if (!result.success) {
        return error(
          transport.kind === 'wpe-ssh' && transport.siteRef.kind === 'wpe'
            ? `Failed to activate theme "${slug}" on ${transport.siteRef.installName}: ${result.stdout}`
            : `Failed to activate theme "${slug}": ${result.stdout}`
        );
      }

      return ok(
        transport.kind === 'wpe-ssh' && transport.siteRef.kind === 'wpe'
          ? `Theme "${slug}" activated on ${transport.siteRef.installName}.`
          : `Theme "${slug}" activated. WordPress will now load with the new theme.`
      );
    };

    // Local sites require the site to be running
    if (transport.kind === 'local' && transport.siteRef.kind === 'local') {
      return withSiteRunning(transport.siteRef.siteId, services, executeCommand);
    }

    return executeCommand();
  },
};
