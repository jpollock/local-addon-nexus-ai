import { McpToolHandler, McpToolResult } from '../../types';
import { ok, error } from './preflight';
import { resolveTransport } from '../../../transport';
import { withSiteRunning } from '../with-site-running';

export const wpPostUpdateHandler: McpToolHandler = {
  definition: {
    name: 'wp_post_update',
    description:
      'Update an existing WordPress post, page, or custom post type by ID. ' +
      'Works on local sites (site=) and remote WPE installs via SSH (install_name=). ' +
      'Only provided fields are updated — omitted fields are left unchanged. ' +
      'Use wp_eval on local sites (or wp_option_get) to find post IDs if unknown.',
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
        post_id: {
          type: 'number',
          description: 'Post ID to update',
        },
        title: {
          type: 'string',
          description: 'New post title',
        },
        content: {
          type: 'string',
          description: 'New post content',
        },
        status: {
          type: 'string',
          description: 'New post status',
          enum: ['publish', 'draft', 'pending', 'private'],
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

    const cliArgs = ['post', 'update', String(postId)];

    if (args.title) {
      cliArgs.push('--post_title=' + args.title);
    }

    if (args.content) {
      cliArgs.push('--post_content=' + args.content);
    }

    if (args.status) {
      cliArgs.push('--post_status=' + args.status);
    }

    const executeCommand = async (): Promise<McpToolResult> => {
      const result = await transport.runWpCli(cliArgs);

      if (!result.success) {
        return error(
          transport.kind === 'wpe-ssh'
            ? `Remote WP-CLI error: ${result.stdout}`
            : `Failed to update post: ${result.stdout}`
        );
      }

      return ok(`Updated post ${postId}`);
    };

    // Local sites require the site to be running
    if (transport.kind === 'local' && transport.siteRef.kind === 'local') {
      return withSiteRunning(transport.siteRef.siteId, services, executeCommand);
    }

    return executeCommand();
  },
};
