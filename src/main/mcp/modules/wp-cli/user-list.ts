import { McpToolHandler, McpToolResult } from '../../types';
import { ok, error } from './preflight';
import { resolveTransport } from '../../../transport';
import { withSiteRunning } from '../with-site-running';

export const userListHandler: McpToolHandler = {
  definition: {
    name: 'wp_user_list',
    description: 'List WordPress users with their ID, login, email, display name, and roles. Works on local sites (site=) and remote WPE installs via SSH (install_name=). Useful for auditing access, finding admin accounts, or identifying test users before cleanup.',
    inputSchema: {
      type: 'object',
      properties: {
        site: { type: 'string', description: 'Local site name, ID, or domain' },
        install_name: { type: 'string', description: 'WPE install name for remote execution via SSH' },
      },
    },
    isAvailable: (services) => !!services.localServices,
  },

  async execute(args, services): Promise<McpToolResult> {
    const transport = await resolveTransport(args, services, 'wpcli_read');
    if ('content' in transport) return transport;

    const executeCommand = async (): Promise<McpToolResult> => {
      const result = await transport.runWpCli(['user', 'list', '--format=json']);

      if (!result.success) {
        return error(
          transport.kind === 'wpe-ssh'
            ? `Remote WP-CLI error: ${result.stdout}`
            : `Failed to list users: ${result.stdout}`
        );
      }

      try {
        const users = JSON.parse(result.stdout || '[]');
        if (users.length === 0) return ok('No users found.');

        const heading =
          transport.kind === 'wpe-ssh' && transport.siteRef.kind === 'wpe'
            ? `## Users (${users.length}) — ${transport.siteRef.installName}`
            : `## Users (${users.length})`;

        const lines = [heading];
        for (const u of users) {
          lines.push(`- ${u.user_login} (${u.display_name}) [${u.roles}]`);
        }
        return ok(lines.join('\n'));
      } catch {
        return ok(result.stdout || 'No users found.');
      }
    };

    // Local sites require the site to be running
    if (transport.kind === 'local' && transport.siteRef.kind === 'local') {
      return withSiteRunning(transport.siteRef.siteId, services, executeCommand);
    }

    return executeCommand();
  },
};
