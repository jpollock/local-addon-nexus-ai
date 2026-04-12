import { McpToolHandler, McpToolResult } from '../../types';
import { requireRunning, ok, error } from './preflight';
import { resolveTarget, remoteWpCliRun } from './remote-exec';

export const wpPostCreateHandler: McpToolHandler = {
  definition: {
    name: 'wp_post_create',
    description:
      'Create a new WordPress post, page, or custom post type. ' +
      'Works on local sites (site=) and remote WPE installs via SSH (install_name=). ' +
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
    const target = await resolveTarget(args, services);
    if ('content' in target) return target; // error result

    const title = args.title as string;
    const content = (args.content as string) || '';
    const status = (args.status as string) || 'publish';
    const postType = (args.post_type as string) || 'post';

    // Build WP-CLI command
    const cliArgs = [
      'post',
      'create',
      '--post_title=' + title,
      '--post_content=' + content,
      '--post_status=' + status,
      '--post_type=' + postType,
      '--porcelain', // Return just the post ID
    ];

    if (target.type === 'remote') {
      const result = await remoteWpCliRun(target.installName, cliArgs, services);
      if (!result.success) {
        return error(`Remote WP-CLI error: ${result.stdout}`);
      }
      const postId = result.stdout?.trim() || '';
      return ok(`Created post ${postId}: "${title}" (status: ${status})`);
    }

    // Local path
    const check = requireRunning(target.site, services);
    if (check) return check;

    const result = await services.localServices!.wpCliRun(target.site.id, cliArgs);

    if (!result.success) {
      return error('Failed to create post: ' + result.stdout);
    }

    const postId = result.stdout?.trim() || '';

    return ok(`Created post ${postId}: "${title}" (status: ${status})`);
  },
};
