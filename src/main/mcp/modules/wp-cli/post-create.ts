import { McpToolHandler, McpToolResult } from '../../types';
import { ok, error } from './preflight';
import { resolveTransport } from '../../../transport';
import { withSiteRunning } from '../with-site-running';

export const wpPostCreateHandler: McpToolHandler = {
  definition: {
    name: 'wp_post_create',
    description:
      'Create a new WordPress post, page, or custom post type. ' +
      'Works on local sites (site=), remote WPE installs via SSH (install_name=), and external SSH hosts (ssh_target=). ' +
      'Status defaults to draft — set status=publish to make it live immediately. ' +
      'Returns the new post ID on success.',
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
        title: {
          type: 'string',
          description: 'Post title',
        },
        content: {
          type: 'string',
          description: 'Post content',
        },
        status: {
          type: 'string',
          description: 'Post status (publish, draft, etc.)',
          enum: ['publish', 'draft', 'pending', 'private'],
        },
        post_type: {
          type: 'string',
          description: 'Post type (default: post)',
        },
      },
      required: ['title'],
    },
    isAvailable: (services) => !!services.localServices,
  },

  async execute(args, services): Promise<McpToolResult> {
    const transport = await resolveTransport(args, services, 'wpcli');
    if ('content' in transport) return transport;

    const title = args.title as string;
    const content = (args.content as string) || '';
    const status = (args.status as string) || 'publish';
    const postType = (args.post_type as string) || 'post';

    const cliArgs = [
      'post',
      'create',
      '--post_title=' + title,
      '--post_content=' + content,
      '--post_status=' + status,
      '--post_type=' + postType,
      '--porcelain',
    ];

    const executeCommand = async (): Promise<McpToolResult> => {
      const result = await transport.runWpCli(cliArgs);

      if (!result.success) {
        return error(
          transport.kind === 'wpe-ssh'
            ? `Remote WP-CLI error: ${result.stdout}`
            : `Failed to create post: ${result.stdout}`
        );
      }

      const postId = result.stdout?.trim() || '';
      return ok(`Created post ${postId}: "${title}" (status: ${status})`);
    };

    // Local sites require the site to be running
    if (transport.kind === 'local' && transport.siteRef.kind === 'local') {
      return withSiteRunning(transport.siteRef.siteId, services, executeCommand);
    }

    return executeCommand();
  },
};
