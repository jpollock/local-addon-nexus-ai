import { McpToolHandler, McpToolResult } from '../../types';
import { ok, error, capiError, requireCAPI } from './helpers';

export const refreshAccountDiskUsageHandler: McpToolHandler = {
  definition: {
    name: 'wpe_refresh_account_disk_usage',
    description: 'Trigger a disk usage recalculation for all installs in a WP Engine account.',
    inputSchema: {
      type: 'object',
      properties: {
        account_id: { type: 'string', description: 'WP Engine account ID' },
      },
      required: ['account_id'],
    },
    isAvailable: (services) => requireCAPI(services),
  },

  async execute(args, services): Promise<McpToolResult> {
    try {
      const accountId = args.account_id as string;
      if (!accountId) return error('Account ID is required.');

      await services.localServices!.capiDirect(
        `/accounts/${accountId}/usage/refresh_disk_usage`,
        'POST',
        {},
      );

      return ok(
        `Disk usage recalculation triggered for all installs in account \`${accountId}\`.\n\n` +
        `The updated usage data may take a few minutes to reflect.`,
      );
    } catch (err: any) {
      return capiError(err);
    }
  },
};
