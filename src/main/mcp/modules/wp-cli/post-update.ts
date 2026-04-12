import { McpToolHandler, McpToolResult } from '../../types';
import { requireRunning, ok, error } from './preflight';
import { resolveTarget, remoteWpCliRun } from './remote-exec';

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
    const target = await resolveTarget(args, services);
    if ('content' in target) return target; // error result

    const postId = args.post_id as number;

    // Build update arguments
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

    if (target.type === 'remote') {
      const result = await remoteWpCliRun(target.installName, cliArgs, services);
      if (!result.success) {
        return error(`Remote WP-CLI error: ${result.stdout}`);
      }
      return ok(`Updated post ${postId}`);
    }

    // Local path
    const check = requireRunning(target.site, services);
    if (check) return check;

    const result = await services.localServices!.wpCliRun(target.site.id, cliArgs);

    if (!result.success) {
      return error('Failed to update post: ' + result.stdout);
    }

    return ok(`Updated post ${postId}`);
  },
};
