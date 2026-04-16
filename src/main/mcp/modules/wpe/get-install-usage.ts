/**
 * WPE Install/Account Usage — calls CAPI directly with Local's OAuth token.
 * Local's generated CAPI client doesn't include usage endpoints, so we
 * use capiDirect() to call them via the Bearer token.
 *
 * Cache layers (install usage only):
 *   Layer 1 — in-memory:  current month → 1h TTL, past months → 24h TTL
 *   Layer 2 — SQLite:     persisted via graphService.upsertSiteUsage; served
 *                         on CAPI failure with a "Network unavailable" warning
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

function formatAgeString(ageMs: number): string {
  return ageMs < 3600000
    ? `${Math.round(ageMs / 60000)}m`
    : `${Math.round(ageMs / 3600000)}h`;
}

export const getInstallUsageHandler: McpToolHandler = {
  definition: {
    name: 'wpe_get_install_usage',
    description: 'Get visit, bandwidth, and storage consumption metrics for a specific WP Engine install. Month defaults to current (0), use month=1 for last month. Use for chargebacks, monitoring, or identifying high-traffic installs. For account-level totals, use wpe_get_account_usage_summary. For traffic tiers across the full fleet, use wpe_fleet_health.',
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
    const installId = args.install_id as string;
    const monthOffset = (args.month_offset as number) ?? 0;

    const { firstDate, lastDate } = buildDateRange(monthOffset);
    const cacheKey = makeUsageCacheKey('install', installId, firstDate, lastDate);
    const period = firstDate.slice(0, 7);
    const graphSiteId = `wpe-${installId}`;

    // Layer 1: in-memory cache (fastest path — no CAPI or SQLite needed)
    const cached = getUsageCached(cacheKey);
    if (cached) {
      const age = Math.round((Date.now() - cached.cachedAt) / 60000);
      const result = { ...cached.data as object, _cached: true, _cached_age_minutes: age };
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    }

    // Layer 2: pre-fetch SQLite backup so it's ready if CAPI fails below
    const graphService = services.graphService;
    const sqliteRows: Array<{
      siteId: string; period: string; source: string;
      visits: number | null; bandwidthBytes: number | null; storageBytes: number | null;
      recordedAt: number;
    }> = graphService ? graphService.getSiteUsage(graphSiteId, period) : [];

    try {
      const data = await services.localServices!.capiDirect(
        `/installs/${installId}/usage?first_date=${firstDate}&last_date=${lastDate}`,
      );

      // Persist to SQLite so the backup cache stays warm
      graphService?.upsertSiteUsage(graphSiteId, period, data as Record<string, unknown>);

      setUsageCached(cacheKey, data, isCurrentMonthRange(firstDate, lastDate));
      return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
    } catch (err: any) {
      // Layer 3: SQLite fallback when CAPI is unreachable
      if (sqliteRows.length > 0) {
        const row = sqliteRows[0];
        const ageStr = formatAgeString(Date.now() - row.recordedAt);
        const result = {
          _warning: `⚠️ Network unavailable — showing data from ${ageStr} ago`,
          _source: 'sqlite_cache',
          period: row.period,
          visits: row.visits,
          bandwidth_bytes: row.bandwidthBytes,
          storage_bytes: row.storageBytes,
        };
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
      }
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
