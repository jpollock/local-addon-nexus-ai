import { McpToolHandler, McpToolResult } from '../../types';
import { ok, error } from './preflight';
import { resolveTransport } from '../../../transport';
import { withSiteRunning } from '../with-site-running';

export const optionGetHandler: McpToolHandler = {
  definition: {
    name: 'wp_option_get',
    description: 'Get a single WordPress option value by key from the wp_options table. Works on local sites (site=) and remote WPE installs via SSH (install_name=). Common keys: blogname (site title), siteurl, home, admin_email, blogdescription. Use wp_search_replace to change option values like domain URLs.',
    inputSchema: {
      type: 'object',
      properties: {
        site: { type: 'string', description: 'Local site name, ID, or domain' },
        install_name: { type: 'string', description: 'WPE install name for remote execution via SSH' },
        option: { type: 'string', description: 'Option name (e.g. "blogname", "siteurl")' },
      },
      required: ['option'],
    },
    isAvailable: (services) => !!services.localServices,
  },

  async execute(args, services): Promise<McpToolResult> {
    const option = args.option as string;
    if (!option) return error('Option name is required.');

    const transport = await resolveTransport(args, services, 'wpcli_read');
    if ('content' in transport) return transport;

    const executeCommand = async (): Promise<McpToolResult> => {
      // For remote, use WP-CLI; for local, try getOption first, fall back to WP-CLI
      if (transport.kind === 'wpe-ssh') {
        const result = await transport.runWpCli(['option', 'get', option]);
        if (!result.success) {
          return error(`Remote WP-CLI error: ${result.stdout}`);
        }
        return ok(`${option}: ${result.stdout?.trim() ?? '(empty)'}`);
      }

      // Local path: try getOption first
      try {
        const value = await services.localServices!.getOption(
          transport.siteRef.kind === 'local' ? transport.siteRef.siteId : '',
          option
        );
        if (value === null) {
          return error(`Option "${option}" not found.`);
        }
        return ok(`${option}: ${value}`);
      } catch (err) {
        // Fall back to WP-CLI if getOption fails
        const result = await transport.runWpCli(['option', 'get', option, '--format=json']);
        if (!result.success) {
          return error(`Option "${option}" not found.`);
        }
        return ok(`${option}: ${result.stdout?.trim() ?? '(empty)'}`);
      }
    };

    // Local sites require the site to be running
    if (transport.kind === 'local' && transport.siteRef.kind === 'local') {
      return withSiteRunning(transport.siteRef.siteId, services, executeCommand);
    }

    return executeCommand();
  },
};
