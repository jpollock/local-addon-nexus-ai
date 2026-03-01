import { McpToolHandler, McpToolResult } from '../../types';
import { requireRunning, ok, error } from './preflight';
import { resolveTarget, remoteWpCliRun } from './remote-exec';

export const userListHandler: McpToolHandler = {
  definition: {
    name: 'wp_user_list',
    description: 'List WordPress users for a local site or remote WPE install.',
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
    const target = await resolveTarget(args, services);
    if ('content' in target) return target;

    if (target.type === 'remote') {
      const result = await remoteWpCliRun(
        target.installName,
        ['user', 'list', '--format=json'],
        services,
      );
      if (!result.success) {
        return error(`Remote WP-CLI error: ${result.stdout}`);
      }
      try {
        const users = JSON.parse(result.stdout || '[]');
        if (users.length === 0) return ok('No users found.');
        const lines = [`## Users (${users.length}) — ${target.installName}`];
        for (const u of users) {
          lines.push(`- ${u.user_login} (${u.display_name}) [${u.roles}]`);
        }
        return ok(lines.join('\n'));
      } catch {
        return ok(result.stdout || 'No users found.');
      }
    }

    const check = requireRunning(target.site, services);
    if (check) return check;

    const result = await services.localServices!.wpCliRun(target.site.id, [
      'user', 'list', '--format=json',
    ]);

    if (!result.success) {
      return error(`Failed to list users: ${result.stdout}`);
    }

    try {
      const users = JSON.parse(result.stdout || '[]');
      if (users.length === 0) {
        return ok('No users found.');
      }

      const lines = [`## Users (${users.length})`];
      for (const u of users) {
        lines.push(`- ${u.user_login} (${u.display_name}) [${u.roles}]`);
      }
      return ok(lines.join('\n'));
    } catch {
      return ok(result.stdout || 'No users found.');
    }
  },
};
