import { McpToolHandler, McpToolResult } from '../../types';
import { ok, error, validateSlug } from './preflight';
import { resolveTransport } from '../../../transport';
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

    const transport = await resolveTransport(args, services, 'wpcli');
    if ('content' in transport) return transport;

    const cliArgs = slug === '--all'
      ? ['plugin', 'update', '--all']
      : ['plugin', 'update', slug];

    const executeCommand = async (): Promise<McpToolResult> => {
      // Plugin updates download from WordPress.org — allow up to 3 minutes
      const timeoutMs = transport.kind === 'local' ? 180000 : undefined;
      const result = await transport.runWpCli(cliArgs, timeoutMs ? { timeoutMs } : undefined);
      if (!result.success) {
        return error(
          transport.kind === 'wpe-ssh' && transport.siteRef.kind === 'wpe'
            ? `Failed to update plugin "${slug}" on ${transport.siteRef.installName}: ${result.stdout}`
            : `Failed to update plugin "${slug}": ${result.stdout}`
        );
      }

      return ok(
        result.stdout ||
        (transport.kind === 'wpe-ssh' && transport.siteRef.kind === 'wpe'
          ? `Plugin "${slug}" updated on ${transport.siteRef.installName}.`
          : `Plugin "${slug}" updated.`)
      );
    };

    // Local sites require the site to be running
    if (transport.kind === 'local' && transport.siteRef.kind === 'local') {
      return withSiteRunning(transport.siteRef.siteId, services, executeCommand);
    }

    return executeCommand();
  },
};
