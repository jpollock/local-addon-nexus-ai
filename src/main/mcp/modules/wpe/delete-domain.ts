import { McpToolHandler, McpToolResult } from '../../types';
import { ok, capiError, requireCAPI } from './helpers';

export const deleteDomainHandler: McpToolHandler = {
  definition: {
    name: 'wpe_delete_domain',
    description: 'Remove a domain from a WP Engine install. Tier 3 — requires confirmation. Live traffic to this domain will stop working.',
    inputSchema: {
      type: 'object',
      properties: {
        install_id: { type: 'string', description: 'WP Engine install ID' },
        domain_id: { type: 'string', description: 'Domain ID to delete' },
        _confirmationToken: { type: 'string', description: 'Pass "confirm" to confirm deletion' },
      },
      required: ['install_id', 'domain_id'],
    },
    isAvailable: (services) => requireCAPI(services),
  },

  async execute(args, services): Promise<McpToolResult> {
    if (!args._confirmationToken) {
      try {
        const d = await services.localServices!.capiDirect(`/installs/${args.install_id}/domains/${args.domain_id}`) as any;
        const primaryWarning = d.primary
          ? '\n\n**⚠️ This is the PRIMARY domain for this install. Deleting it will break the primary site URL.**'
          : '';

        return ok(
          `## ⚠️ Confirm Deletion\n\n` +
          `**Domain:** ${d.name ?? args.domain_id}\n` +
          `**Primary:** ${d.primary ? 'Yes' : 'No'}` +
          primaryWarning +
          `\n\n**Warning:** Live traffic to this domain will stop working immediately.\n\n` +
          `To confirm, call this tool again with the same parameters plus \`_confirmationToken: "confirm"\`.`,
        );
      } catch (err: any) {
        return capiError(err);
      }
    }

    try {
      await services.localServices!.capiDirect(
        `/installs/${args.install_id}/domains/${args.domain_id}`,
        'DELETE',
      );
      return ok(`Domain \`${args.domain_id}\` has been removed from install \`${args.install_id}\`.`);
    } catch (err: any) {
      return capiError(err);
    }
  },
};
