import { mockContext } from '../../../../src/main/agent-sdk/testing';
import type { AgentDatabase } from '../../../../src/main/agent-sdk/types';
import {
  initSchema, getSource, upsertSource, setEnabled, getEnabledSites,
  getLedger, markLedger, getAggregate, saveAggregate, getAggregatesInRange,
  evict, storageStats,
} from '../../../../agents/log-processor/db';
import type { LedgerEntry } from '../../../../agents/log-processor/db';

function makeDb(): AgentDatabase {
  const ctx = mockContext();
  const db = ctx.db.open('logs');
  initSchema(db);
  return db;
}

const SITE = 'mysite';
const SOURCE = { site: SITE, provider: 's3', bucket: 'my-bucket', region: 'us-east-1', prefix: 'logs/', enabled: 1 };

describe('sources', () => {
  it('upsert + get round-trips', () => {
    const db = makeDb();
    upsertSource(db, SOURCE);
    expect(getSource(db, SITE)?.bucket).toBe('my-bucket');
    expect(getSource(db, SITE)?.enabled).toBe(1);
  });

  it('setEnabled toggles enabled flag', () => {
    const db = makeDb();
    upsertSource(db, SOURCE);
    setEnabled(db, SITE, false);
    expect(getSource(db, SITE)?.enabled).toBe(0);
    setEnabled(db, SITE, true);
    expect(getSource(db, SITE)?.enabled).toBe(1);
  });

  it('getEnabledSites returns only enabled', () => {
    const db = makeDb();
    upsertSource(db, SOURCE);
    upsertSource(db, { ...SOURCE, site: 'disabled', enabled: 0 });
    expect(getEnabledSites(db)).toEqual([SITE]);
  });
});

describe('ledger', () => {
  it('markLedger + getLedger round-trips', () => {
    const db = makeDb();
    const entry: LedgerEntry = { site: SITE, file_date: '2026-07-01', files: 2, bytes: 1000, lines: 500, processed_at: 1000 };
    markLedger(db, entry);
    expect(getLedger(db, SITE)['2026-07-01'].files).toBe(2);
  });

  it('getLedger returns empty object for unknown site', () => {
    const db = makeDb();
    expect(getLedger(db, 'unknown')).toEqual({});
  });
});

const EMPTY_AGG = {
  v: 1 as const, taxonomyVersion: '2026-07', site: SITE, day: '2026-07-01', skippedLines: 0,
  requests: 10, byClass: {}, byStatus: {}, aiTraining: {}, aiRetrieval: {}, searchBots: {},
  referrals: { search: {}, ai: {}, internal: 0, other: 0, spoofed: 0 },
  notFound: { scanner: 0, contentLike: {} },
  attack: {
    requests: 0, authAttack: {},
    enumeration: { userRestApi: {}, authorScan: {}, restRouteBypass: {} },
    probes: {},
    ipCardinality: { distinct: 0, histogram: { '1': 0, '2-5': 0, '6-20': 0, '21+': 0 } },
  },
};

describe('aggregates', () => {
  it('saveAggregate + getAggregate round-trips', () => {
    const db = makeDb();
    saveAggregate(db, EMPTY_AGG);
    const loaded = getAggregate(db, SITE, '2026-07-01');
    expect(loaded?.requests).toBe(10);
    expect(loaded?.taxonomyVersion).toBe('2026-07');
  });

  it('getAggregatesInRange returns only days in range', () => {
    const db = makeDb();
    saveAggregate(db, { ...EMPTY_AGG, day: '2026-07-01' });
    saveAggregate(db, { ...EMPTY_AGG, day: '2026-07-05' });
    saveAggregate(db, { ...EMPTY_AGG, day: '2026-07-10' });
    const result = getAggregatesInRange(db, SITE, '2026-07-03', '2026-07-08');
    expect(result).toHaveLength(1);
    expect(result[0].day).toBe('2026-07-05');
  });

  it('evict removes aggregates older than N days', () => {
    const db = makeDb();
    saveAggregate(db, { ...EMPTY_AGG, day: '2020-01-01' });
    saveAggregate(db, { ...EMPTY_AGG, day: '2026-07-01' });
    expect(evict(db, SITE, 30)).toBe(1);
    expect(getAggregate(db, SITE, '2020-01-01')).toBeUndefined();
    expect(getAggregate(db, SITE, '2026-07-01')).toBeDefined();
  });
});

describe('storageStats', () => {
  it('returns per-site stats', () => {
    const db = makeDb();
    upsertSource(db, SOURCE);
    saveAggregate(db, EMPTY_AGG);
    const stats = storageStats(db);
    expect(stats).toHaveLength(1);
    expect(stats[0].site).toBe(SITE);
    expect(stats[0].aggregateDays).toBe(1);
  });
});
