import { McpToolHandler, McpToolResult } from '../../types';
import { requireRunning, ok, error } from './preflight';
import { resolveTarget, remoteWpCliRun } from './remote-exec';

export const wpPostDeleteHandler: McpToolHandler = {
  definition: {
    name: 'wp_post_delete',
    description:
      'Delete a WordPress post, page, or custom post type by ID. ' +
      'Works on local sites (site=) and remote WPE installs via SSH (install_name=). ' +
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
    const target = await resolveTarget(args, services);
    if ('content' in target) return target; // error result

    const postId = args.post_id as number;
    const force = args.force as boolean;

    // Build delete command
    const cliArgs = ['post', 'delete', String(postId)];

    if (force) {
      cliArgs.push('--force');
    }

    if (target.type === 'remote') {
      const result = await remoteWpCliRun(target.installName, cliArgs, services);
      if (!result.success) {
        return error(`Remote WP-CLI error: ${result.stdout}`);
      }
      return ok(`Deleted post ${postId}` + (force ? ' (permanent)' : ' (moved to trash)'));
    }

    // Local path
    const check = requireRunning(target.site, services);
    if (check) return check;

    const result = await services.localServices!.wpCliRun(target.site.id, cliArgs);

    if (!result.success) {
      return error('Failed to delete post: ' + result.stdout);
    }

    return ok(`Deleted post ${postId}` + (force ? ' (permanent)' : ' (moved to trash)'));
  },
};
