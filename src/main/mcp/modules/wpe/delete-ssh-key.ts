import { McpToolHandler, McpToolResult } from '../../types';
import { ok, capiError, requireCAPI } from './helpers';

export const deleteSshKeyHandler: McpToolHandler = {
  definition: {
    name: 'wpe_delete_ssh_key',
    description: 'Tier 3 (destructive) — remove an SSH key from the authenticated WP Engine account. After removal, the corresponding private key can no longer be used for SSH/SFTP access. Requires confirmation token. Use wpe_get_ssh_keys to find the ssh_key_id.',
    inputSchema: {
      type: 'object',
      properties: {
        ssh_key_id: { type: 'string', description: 'SSH key ID to delete' },
        _confirmationToken: { type: 'string', description: 'Pass "confirm" to confirm deletion' },
      },
      required: ['ssh_key_id'],
    },
    isAvailable: (services) => requireCAPI(services),
  },

  async execute(args, services): Promise<McpToolResult> {
    if (!args._confirmationToken) {
      try {
        const data = await services.localServices!.capiDirect('/ssh_keys') as any;
        const results: any[] = data?.results ?? (Array.isArray(data) ? data : []);
        const key = results.find((k: any) => k.id === args.ssh_key_id);

        const label = key?.label ?? 'Unknown';
        return ok(
          `## ⚠️ Confirm Deletion\n\n` +
          `**SSH Key:** ${label}\n` +
          `**ID:** ${args.ssh_key_id}\n\n` +
          `**Warning:** Removing this key will revoke SSH/SFTP access for any system using it.\n\n` +
          `To confirm, call this tool again with the same parameters plus \`_confirmationToken: "confirm"\`.`,
        );
      } catch (err: any) {
        return capiError(err);
      }
    }

    try {
      await services.localServices!.capiDirect(
        `/ssh_keys/${args.ssh_key_id}`,
        'DELETE',
      );
      return ok(`SSH key \`${args.ssh_key_id}\` has been removed from your WP Engine account.`);
    } catch (err: any) {
      return capiError(err);
    }
  },
};
