/**
 * Unit tests for wpe_get_install_usage — CAPI backup route via SQLite.
 */

const FIRST_DATE = '2026-04-01';
const LAST_DATE  = '2026-04-30';
const PERIOD     = '2026-04';
const CACHE_KEY  = 'install:abc-123:2026-04-01:2026-04-30';

// Mock usage-cache so in-memory hits never short-circuit these tests.
jest.mock('../../../src/main/mcp/modules/wpe/usage-cache', () => ({
  buildDateRange:    jest.fn().mockReturnValue({ firstDate: FIRST_DATE, lastDate: LAST_DATE }),
  makeUsageCacheKey: jest.fn().mockReturnValue(CACHE_KEY),
  getUsageCached:    jest.fn().mockReturnValue(null),
  setUsageCached:    jest.fn(),
  isCurrentMonthRange: jest.fn().mockReturnValue(true),
}));

import { getInstallUsageHandler } from '../../../src/main/mcp/modules/wpe/get-install-usage';

const INSTALL_ID    = 'abc-123';
const GRAPH_SITE_ID = `wpe-${INSTALL_ID}`;

const CAPI_RESPONSE = {
  install_id: INSTALL_ID,
  visits: 9999,
  bandwidth: 123456,
  storage: 654321,
};

const SQLITE_ROW = {
  siteId:         GRAPH_SITE_ID,
  period:         PERIOD,
  source:         'wpe-capi',
  visits:         8888,
  bandwidthBytes: 111111,
  storageBytes:   222222,
  recordedAt:     Date.now() - 2 * 3600 * 1000, // 2 hours ago
};

function getText(result: any): string {
  return result.content[0].text;
}

function makeMockServices({
  capiDirect,
  getSiteUsage = jest.fn().mockReturnValue([]),
  upsertSiteUsage = jest.fn(),
}: {
  capiDirect: jest.Mock;
  getSiteUsage?: jest.Mock;
  upsertSiteUsage?: jest.Mock;
}) {
  return {
    localServices: {
      capiDirect,
      isCAPIAvailable: jest.fn().mockReturnValue(true),
    },
    graphService: {
      getSiteUsage,
      upsertSiteUsage,
    },
    siteData: { getSites: jest.fn().mockReturnValue({}) },
  } as any;
}

describe('wpe_get_install_usage — SQLite backup route', () => {
  describe('CAPI success path', () => {
    it('returns CAPI data and persists to SQLite', async () => {
      const capiDirect     = jest.fn().mockResolvedValue(CAPI_RESPONSE);
      const upsertSiteUsage = jest.fn();
      const getSiteUsage    = jest.fn().mockReturnValue([]);

      const result = await getInstallUsageHandler.execute(
        { install_id: INSTALL_ID },
        makeMockServices({ capiDirect, getSiteUsage, upsertSiteUsage }),
      );

      expect(result.isError).toBeFalsy();
      const parsed = JSON.parse(getText(result));
      expect(parsed.visits).toBe(9999);

      // Must persist to SQLite after a live fetch
      expect(upsertSiteUsage).toHaveBeenCalledWith(GRAPH_SITE_ID, PERIOD, CAPI_RESPONSE);
    });

    it('calls CAPI with correct date-range URL', async () => {
      const capiDirect = jest.fn().mockResolvedValue(CAPI_RESPONSE);

      await getInstallUsageHandler.execute(
        { install_id: INSTALL_ID },
        makeMockServices({ capiDirect }),
      );

      expect(capiDirect).toHaveBeenCalledWith(
        `/installs/${INSTALL_ID}/usage?first_date=${FIRST_DATE}&last_date=${LAST_DATE}`,
      );
    });
  });

  describe('CAPI failure — SQLite fallback', () => {
    it('serves SQLite data with age warning when CAPI fails', async () => {
      const capiDirect  = jest.fn().mockRejectedValue(new Error('network timeout'));
      const getSiteUsage = jest.fn().mockReturnValue([SQLITE_ROW]);

      const result = await getInstallUsageHandler.execute(
        { install_id: INSTALL_ID },
        makeMockServices({ capiDirect, getSiteUsage }),
      );

      expect(result.isError).toBeFalsy();
      const parsed = JSON.parse(getText(result));

      expect(parsed._warning).toMatch(/Network unavailable/);
      expect(parsed._warning).toMatch(/ago/);
      expect(parsed._source).toBe('sqlite_cache');
      expect(parsed.visits).toBe(SQLITE_ROW.visits);
      expect(parsed.bandwidth_bytes).toBe(SQLITE_ROW.bandwidthBytes);
      expect(parsed.storage_bytes).toBe(SQLITE_ROW.storageBytes);
      expect(parsed.period).toBe(PERIOD);
    });

    it('looks up SQLite with derived graph site_id (wpe-{installId})', async () => {
      const capiDirect  = jest.fn().mockRejectedValue(new Error('offline'));
      const getSiteUsage = jest.fn().mockReturnValue([SQLITE_ROW]);

      await getInstallUsageHandler.execute(
        { install_id: INSTALL_ID },
        makeMockServices({ capiDirect, getSiteUsage }),
      );

      expect(getSiteUsage).toHaveBeenCalledWith(GRAPH_SITE_ID, PERIOD);
    });

    it('formats age in minutes when under 1 hour', async () => {
      const capiDirect  = jest.fn().mockRejectedValue(new Error('offline'));
      const recentRow   = { ...SQLITE_ROW, recordedAt: Date.now() - 15 * 60 * 1000 }; // 15m ago
      const getSiteUsage = jest.fn().mockReturnValue([recentRow]);

      const result = await getInstallUsageHandler.execute(
        { install_id: INSTALL_ID },
        makeMockServices({ capiDirect, getSiteUsage }),
      );

      const parsed = JSON.parse(getText(result));
      expect(parsed._warning).toMatch(/15m ago/);
    });

    it('formats age in hours when 1 hour or more', async () => {
      const capiDirect  = jest.fn().mockRejectedValue(new Error('offline'));
      const oldRow      = { ...SQLITE_ROW, recordedAt: Date.now() - 3 * 3600 * 1000 }; // 3h ago
      const getSiteUsage = jest.fn().mockReturnValue([oldRow]);

      const result = await getInstallUsageHandler.execute(
        { install_id: INSTALL_ID },
        makeMockServices({ capiDirect, getSiteUsage }),
      );

      const parsed = JSON.parse(getText(result));
      expect(parsed._warning).toMatch(/3h ago/);
    });
  });

  describe('CAPI failure — no SQLite data', () => {
    it('returns error when CAPI fails and no SQLite data exists', async () => {
      const capiDirect  = jest.fn().mockRejectedValue(new Error('connection refused'));
      const getSiteUsage = jest.fn().mockReturnValue([]);

      const result = await getInstallUsageHandler.execute(
        { install_id: INSTALL_ID },
        makeMockServices({ capiDirect, getSiteUsage }),
      );

      expect(result.isError).toBe(true);
      expect(getText(result)).toContain('connection refused');
    });

    it('returns error when graphService is absent and CAPI fails', async () => {
      const capiDirect = jest.fn().mockRejectedValue(new Error('timeout'));
      const services = {
        localServices: {
          capiDirect,
          isCAPIAvailable: jest.fn().mockReturnValue(true),
        },
        // no graphService
        siteData: { getSites: jest.fn().mockReturnValue({}) },
      } as any;

      const result = await getInstallUsageHandler.execute({ install_id: INSTALL_ID }, services);

      expect(result.isError).toBe(true);
      expect(getText(result)).toContain('timeout');
    });
  });
});
