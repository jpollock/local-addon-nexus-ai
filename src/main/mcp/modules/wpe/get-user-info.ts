/**
 * wpe_user_info — consolidated current-user + ssh-keys read
 *
 * Replaces: wpe_get_current_user, wpe_get_ssh_keys
 */
import { McpToolHandler, McpToolResult } from '../../types';
import { ok, capiError, requireCAPI } from './helpers';

export const getUserInfoHandler: McpToolHandler = {
  definition: {
    name: 'wpe_user_info',
    description:
      'Get the authenticated WP Engine user profile and optionally their registered SSH keys. ' +
      'include=["ssh_keys"] adds the SSH key list. ' +
      'Replaces wpe_get_current_user and wpe_get_ssh_keys.',
    inputSchema: {
      type: 'object',
      properties: {
        include: {
          type: 'array',
          items: { type: 'string', enum: ['ssh_keys'] },
          description: 'Additional data to fetch. Default: [].',
        },
      },
    },
    isAvailable: (services) => requireCAPI(services),
  },

  async execute(args, services): Promise<McpToolResult> {
    const include = (args.include as string[] | undefined) ?? [];

    try {
      const [user, keys] = await Promise.all([
        services.localServices!.capiDirect('/user') as Promise<any>,
        include.includes('ssh_keys')
          ? services.localServices!.capiDirect('/ssh_keys').catch(() => null)
          : Promise.resolve(null),
      ]);

      const lines = [
        `## Authenticated User`,
        '',
        `**Name:** ${user.first_name ?? ''} ${user.last_name ?? ''}`.trim(),
        `**Email:** ${user.email ?? '—'}`,
        `**ID:** ${user.id ?? '—'}`,
      ];

      if (user.accounts?.length) {
        lines.push('', '### Account Access', '');
        for (const a of user.accounts) {
          lines.push(`- ${a.name ?? a.id} (${a.roles ?? 'unknown role'})`);
        }
      }

      if (keys) {
        const keyList: any[] = (keys as any).results ?? (Array.isArray(keys) ? keys : []);
        lines.push('', `### SSH Keys (${keyList.length})`, '');
        if (keyList.length === 0) {
          lines.push('No SSH keys registered.');
        } else {
          lines.push('| ID | Name | Created |');
          lines.push('|----|------|---------|');
          for (const k of keyList) {
            lines.push(`| ${k.id} | ${k.name ?? '—'} | ${k.created_at ? new Date(k.created_at).toLocaleDateString() : '—'} |`);
          }
        }
      }

      return ok(lines.join('\n'));
    } catch (err: any) {
      return capiError(err);
    }
  },
};
