import { McpToolHandler, McpToolResult } from '../../types';
import { ok, error } from './preflight';
import { resolveTransport } from '../../../transport';
import { withSiteRunning } from '../with-site-running';

export const wpPostDeleteHandler: McpToolHandler = {
  definition: {
    name: 'wp_post_delete',
    description:
      'Delete a WordPress post, page, or custom post type by ID. ' +
      'Works on local sites (site=), remote WPE installs via SSH (install_name=), and external SSH hosts (ssh_target=). ' +
      'Default (force=false) moves to trash — recoverable from WP Admin. ' +
      'Set force=true to permanently delete, bypassing trash.',
    inputSchema: {
      type: 'object',
      properties: {
        site: {
          type: 'string',
          description: 'Site name/ID/domain (local sites)',
        },
        install_name: {
          type: 'string',
          description: 'WPE install name (remote sites)',
        },
        ssh_target: {
          type: 'string',
          description: 'External SSH host, as ssh:<alias>@<production|staging|development>. The alias is a Host entry in the user\'s ~/.ssh/config. Register one with `nexus host add`.',
        },
        wp_path: {
          type: 'string',
          description: 'Absolute WordPress root on an external host. Usually unnecessary — a registered host supplies its own discovered path.',
        },
        post_id: {
          type: 'number',
          description: 'Post ID to delete',
        },
        force: {
          type: 'boolean',
          description: 'Skip trash and permanently delete',
        },
      },
      required: ['post_id'],
    },
    isAvailable: (services) => !!services.localServices,
  },

  async execute(args, services): Promise<McpToolResult> {
    const transport = await resolveTransport(args, services, 'wpcli');
    if ('content' in transport) return transport;

    const postId = args.post_id as number;
    const force = args.force as boolean;

    const cliArgs = ['post', 'delete', String(postId)];

    if (force) {
      cliArgs.push('--force');
    }

    const executeCommand = async (): Promise<McpToolResult> => {
      const result = await transport.runWpCli(cliArgs);

      if (!result.success) {
        return error(
          transport.kind === 'wpe-ssh'
            ? `Remote WP-CLI error: ${result.stdout}`
            : `Failed to delete post: ${result.stdout}`
        );
      }

      return ok(`Deleted post ${postId}` + (force ? ' (permanent)' : ' (moved to trash)'));
    };

    // Local sites require the site to be running
    if (transport.kind === 'local' && transport.siteRef.kind === 'local') {
      return withSiteRunning(transport.siteRef.siteId, services, executeCommand);
    }

    return executeCommand();
  },
};
