import { McpToolHandler, McpToolResult } from '../../types';
import { ok, capiError, requireCAPI } from './helpers';

export const getSshKeysHandler: McpToolHandler = {
  definition: {
    name: 'wpe_get_ssh_keys',
    description: 'List SSH keys associated with the authenticated WP Engine user. These keys are used for SSH/SFTP access to WP Engine environments.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    isAvailable: (services) => requireCAPI(services),
  },

  async execute(args, services): Promise<McpToolResult> {
    try {
      const data = await services.localServices!.capiDirect('/ssh_keys') as any;
      const results: any[] = data?.results ?? (Array.isArray(data) ? data : []);

      if (results.length === 0) {
        return ok('No SSH keys found for this account.');
      }

      const lines = [
        `## SSH Keys (${results.length})`,
        '',
        '| Label | Fingerprint | Created Date |',
        '|-------|-------------|--------------|',
      ];

      for (const key of results) {
        const label = key.label ?? '-';
        const fingerprint = key.fingerprint ?? '-';
        const created = key.created_at ?? '-';
        lines.push(`| ${label} | ${fingerprint} | ${created} |`);
      }

      return ok(lines.join('\n'));
    } catch (err: any) {
      return capiError(err);
    }
  },
};
