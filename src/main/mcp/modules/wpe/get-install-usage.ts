/**
 * WPE Install Usage — calls CAPI directly with Local's OAuth token.
 * Local's generated CAPI client doesn't include usage endpoints, so we
 * use capiDirect() to call them via the Bearer token.
 */
import { McpToolHandler } from '../../tool-registry';
import type { NexusServices } from '../../types';
import { requireCapi } from './helpers';

export const getInstallUsageHandler: McpToolHandler = {
  definition: {
    name: 'wpe_get_install_usage',
    description: 'Get bandwidth, storage, and visitor usage data for a WP Engine install.',
    inputSchema: {
      type: 'object',
      properties: {
        install_id: { type: 'string', description: 'WP Engine install ID (UUID)' },
        month_offset: {
          type: 'number',
          description: 'Month offset from current (0 = current, 1 = last month). Default: 0',
        },
      },
      required: ['install_id'],
    },
    isAvailable: (services: NexusServices) => requireCapi(services),
  },
  async execute(args: Record<string, unknown>, services: NexusServices) {
    try {
      const installId = args.install_id as string;
      const monthOffset = (args.month_offset as number) ?? 0;

      // Calculate date range (first/last day of target month)
      const now = new Date();
      const target = new Date(now.getFullYear(), now.getMonth() - monthOffset, 1);
      const from = target.toISOString().split('T')[0];
      const to = new Date(target.getFullYear(), target.getMonth() + 1, 0).toISOString().split('T')[0];

      const data = await services.localServices!.capiDirect(
        `/installs/${installId}/usage?from=${from}&to=${to}`
      );

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
      };
    } catch (err: any) {
      return {
        content: [{ type: 'text' as const, text: `Error fetching install usage: ${err.message}` }],
        isError: true,
      };
    }
  },
};

export const getAccountUsageHandler: McpToolHandler = {
  definition: {
    name: 'wpe_get_account_usage',
    description: 'Get account-level bandwidth, storage, and visitor usage for a WP Engine account.',
    inputSchema: {
      type: 'object',
      properties: {
        account_id: { type: 'string', description: 'WP Engine account ID (UUID)' },
        month_offset: {
          type: 'number',
          description: 'Month offset from current (0 = current, 1 = last month). Default: 0',
        },
      },
      required: ['account_id'],
    },
    isAvailable: (services: NexusServices) => requireCapi(services),
  },
  async execute(args: Record<string, unknown>, services: NexusServices) {
    try {
      const accountId = args.account_id as string;
      const monthOffset = (args.month_offset as number) ?? 0;

      const now = new Date();
      const target = new Date(now.getFullYear(), now.getMonth() - monthOffset, 1);
      const from = target.toISOString().split('T')[0];
      const to = new Date(target.getFullYear(), target.getMonth() + 1, 0).toISOString().split('T')[0];

      const data = await services.localServices!.capiDirect(
        `/accounts/${accountId}/usage?from=${from}&to=${to}`
      );

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
      };
    } catch (err: any) {
      return {
        content: [{ type: 'text' as const, text: `Error fetching account usage: ${err.message}` }],
        isError: true,
      };
    }
  },
};
