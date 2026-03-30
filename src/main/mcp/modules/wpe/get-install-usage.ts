/**
 * WPE Install/Account Usage — calls CAPI directly with Local's OAuth token.
 * Local's generated CAPI client doesn't include usage endpoints, so we
 * use capiDirect() to call them via the Bearer token.
 *
 * Responses are cached in-memory:
 *   current month → 1-hour TTL
 *   past months   → 24-hour TTL
 */
import { McpToolHandler } from '../../types';
import type { NexusServices } from '../../types';
import { requireCAPI } from './helpers';
import {
  buildDateRange,
  getUsageCached,
  isCurrentMonthRange,
  makeUsageCacheKey,
  setUsageCached,
} from './usage-cache';

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
    isAvailable: (services: NexusServices) => requireCAPI(services),
  },
  async execute(args: Record<string, unknown>, services: NexusServices) {
    try {
      const installId = args.install_id as string;
      const monthOffset = (args.month_offset as number) ?? 0;

      const { firstDate, lastDate } = buildDateRange(monthOffset);
      const cacheKey = makeUsageCacheKey('install', installId, firstDate, lastDate);

      const cached = getUsageCached(cacheKey);
      if (cached) {
        const age = Math.round((Date.now() - cached.cachedAt) / 60000);
        const result = { ...cached.data as object, _cached: true, _cached_age_minutes: age };
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
      }

      const data = await services.localServices!.capiDirect(
        `/installs/${installId}/usage?first_date=${firstDate}&last_date=${lastDate}`,
      );

      setUsageCached(cacheKey, data, isCurrentMonthRange(firstDate, lastDate));

      return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
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
    isAvailable: (services: NexusServices) => requireCAPI(services),
  },
  async execute(args: Record<string, unknown>, services: NexusServices) {
    try {
      const accountId = args.account_id as string;
      const monthOffset = (args.month_offset as number) ?? 0;

      const { firstDate, lastDate } = buildDateRange(monthOffset);
      const cacheKey = makeUsageCacheKey('account', accountId, firstDate, lastDate);

      const cached = getUsageCached(cacheKey);
      if (cached) {
        const age = Math.round((Date.now() - cached.cachedAt) / 60000);
        const result = { ...cached.data as object, _cached: true, _cached_age_minutes: age };
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
      }

      const data = await services.localServices!.capiDirect(
        `/accounts/${accountId}/usage?first_date=${firstDate}&last_date=${lastDate}`,
      );

      setUsageCached(cacheKey, data, isCurrentMonthRange(firstDate, lastDate));

      return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
    } catch (err: any) {
      return {
        content: [{ type: 'text' as const, text: `Error fetching account usage: ${err.message}` }],
        isError: true,
      };
    }
  },
};
