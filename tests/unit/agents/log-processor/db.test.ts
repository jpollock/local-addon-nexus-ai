import { mockContext } from '../../../../src/main/agent-sdk/testing';
import type { AgentDatabase } from '../../../../src/main/agent-sdk/types';
import {
  initSchema, getBucketConfig, setBucketConfig, setLastScannedAt, clearBucketConfig,
  saveInstallScan, getInstallScan, listInstallScans, replaceInstallScans,
  migrateFromPerSiteSources, getMigrationNotice, wipeAggregatesAndLedger,
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
const BUCKET = { bucket: 'my-bucket', region: 'us-east-1', prefix: 'wpe_logs/nginx/' };
const scanRow = (site: string, objects = 10) => ({
  site, object_count: objects, bytes: objects * 1000,
  oldest_object_at: '2026-07-01', newest_object_at: '2026-08-01',
  sample_key: `20260801-0016-${site}.apachestyle.log.gz`,
});

describe('bucket_config', () => {
  it('set + get round-trips, and is a singleton', () => {
    const db = makeDb();
    setBucketConfig(db, BUCKET);
    expect(getBucketConfig(db)?.bucket).toBe('my-bucket');
    expect(getBucketConfig(db)?.prefix).toBe('wpe_logs/nginx/');

    setBucketConfig(db, { ...BUCKET, bucket: 'other' });
    expect(getBucketConfig(db)?.bucket).toBe('other');
  });

  it('starts with no last-scan timestamp, then records one', () => {
    const db = makeDb();
    setBucketConfig(db, BUCKET);
    expect(getBucketConfig(db)?.last_scanned_at).toBeNull();
    setLastScannedAt(db, 1_700_000_000_000);
    expect(getBucketConfig(db)?.last_scanned_at).toBe(1_700_000_000_000);
  });

  it('clearing the bucket also drops the install cache it described', () => {
    const db = makeDb();
    setBucketConfig(db, BUCKET);
    saveInstallScan(db, scanRow(SITE));
    clearBucketConfig(db);
    expect(getBucketConfig(db)).toBeUndefined();
    expect(listInstallScans(db)).toEqual([]);
  });
});

describe('install_scan', () => {
  it('save + get round-trips', () => {
    const db = makeDb();
    saveInstallScan(db, scanRow(SITE, 42));
    const row = getInstallScan(db, SITE);
    expect(row?.object_count).toBe(42);
    expect(row?.newest_object_at).toBe('2026-08-01');
    expect(row?.scanned_at).toBeGreaterThan(0);
  });

  it('replaceInstallScans drops installs that fell out of the bucket', () => {
    const db = makeDb();
    replaceInstallScans(db, [scanRow('a'), scanRow('b')]);
    expect(listInstallScans(db).map(r => r.site)).toEqual(['a', 'b']);

    // A scan is a complete picture: 'b' no longer appearing means it has no objects, and a stale
    // row would keep its switch live with nothing to read.
    replaceInstallScans(db, [scanRow('a')]);
    expect(listInstallScans(db).map(r => r.site)).toEqual(['a']);
  });
});

describe('migrateFromPerSiteSources', () => {
  const legacy = (site: string, bucket: string, prefix = 'wpe_logs/nginx/'): unknown[] =>
    [site, 's3', bucket, 'us-east-1', prefix, 1, 1];

  function seedLegacy(db: AgentDatabase, rows: unknown[][]) {
    const sql = 'INSERT INTO sources (site, provider, bucket, region, prefix, enabled, created_at) VALUES (?,?,?,?,?,?,?)';
    for (const args of rows) db.prepare(sql).run(...args);
  }

  it('is a no-op on a fresh database', () => {
    const db = makeDb();
    expect(migrateFromPerSiteSources(db)).toBeNull();
    expect(getBucketConfig(db)).toBeUndefined();
  });

  it('collapses agreeing per-site rows onto one account-level bucket', () => {
    const db = makeDb();
    seedLegacy(db, [legacy('a', 'wpejpp'), legacy('b', 'wpejpp')]);
    const result = migrateFromPerSiteSources(db);
    expect(result?.rows).toBe(2);
    expect(result?.chosen.bucket).toBe('wpejpp');
    expect(result?.discarded).toEqual([]);
    expect(getBucketConfig(db)?.bucket).toBe('wpejpp');
  });

  it('keeps the most common location and surfaces the rest as a notice', () => {
    const db = makeDb();
    seedLegacy(db, [legacy('a', 'wpejpp'), legacy('b', 'wpejpp'), legacy('c', 'otherbucket')]);
    const result = migrateFromPerSiteSources(db);
    expect(result?.chosen.bucket).toBe('wpejpp');
    expect(result?.discarded).toEqual([
      { bucket: 'otherbucket', region: 'us-east-1', prefix: 'wpe_logs/nginx/', sites: ['c'] },
    ]);
    expect(getMigrationNotice(db)?.[0].bucket).toBe('otherbucket');
  });

  it('wipes aggregates and ledger — they were computed under the mis-attributing sync', () => {
    const db = makeDb();
    seedLegacy(db, [legacy('a', 'wpejpp')]);
    saveAggregate(db, EMPTY_AGG);
    markLedger(db, { site: SITE, file_date: '2026-07-01', files: 1, bytes: 1, lines: 1, processed_at: 1 });

    const result = migrateFromPerSiteSources(db);
    expect(result?.aggregatesWiped).toBe(1);
    expect(result?.ledgerWiped).toBe(1);
    expect(getAggregate(db, SITE, '2026-07-01')).toBeUndefined();
    expect(getLedger(db, SITE)).toEqual({});
  });

  it('runs at most once, even with legacy rows still present', () => {
    const db = makeDb();
    seedLegacy(db, [legacy('a', 'wpejpp')]);
    expect(migrateFromPerSiteSources(db)).not.toBeNull();
    expect(migrateFromPerSiteSources(db)).toBeNull();
  });

  it('never overwrites a bucket the user already configured', () => {
    const db = makeDb();
    setBucketConfig(db, BUCKET);
    seedLegacy(db, [legacy('a', 'legacy-bucket')]);
    expect(migrateFromPerSiteSources(db)).toBeNull();
    expect(getBucketConfig(db)?.bucket).toBe('my-bucket');
  });
});

describe('wipeAggregatesAndLedger', () => {
  it('reports what it deleted', () => {
    const db = makeDb();
    saveAggregate(db, EMPTY_AGG);
    saveAggregate(db, { ...EMPTY_AGG, day: '2026-07-02' });
    markLedger(db, { site: SITE, file_date: '2026-07-01', files: 1, bytes: 1, lines: 1, processed_at: 1 });
    expect(wipeAggregatesAndLedger(db)).toEqual({ aggregates: 2, ledger: 1 });
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
    // Relative to today, not a hardcoded date: `evict` compares against `now - olderThanDays`, so
    // a literal "recent" day silently ages past the cutoff and the test starts failing on a
    // calendar boundary rather than on a code change.
    const daysAgo = (n: number) => {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - n);
      return d.toISOString().slice(0, 10);
    };
    saveAggregate(db, { ...EMPTY_AGG, day: daysAgo(120) });
    saveAggregate(db, { ...EMPTY_AGG, day: daysAgo(5) });
    expect(evict(db, SITE, 30)).toBe(1);
    expect(getAggregate(db, SITE, daysAgo(120))).toBeUndefined();
    expect(getAggregate(db, SITE, daysAgo(5))).toBeDefined();
  });
});

describe('storageStats', () => {
  it('returns per-site stats keyed off the scan cache', () => {
    const db = makeDb();
    saveInstallScan(db, scanRow(SITE, 7));
    saveAggregate(db, EMPTY_AGG);
    markLedger(db, { site: SITE, file_date: '2026-07-01', files: 1, bytes: 1, lines: 1, processed_at: 5000 });
    const stats = storageStats(db);
    expect(stats).toHaveLength(1);
    expect(stats[0].site).toBe(SITE);
    expect(stats[0].objectCount).toBe(7);
    expect(stats[0].aggregateDays).toBe(1);
    expect(stats[0].ledgerDays).toBe(1);
    expect(stats[0].lastSyncedAt).toBe(5000);
  });

  it('covers sites that appear in only one table', () => {
    const db = makeDb();
    // Scanned, never synced.
    saveInstallScan(db, scanRow('scanned-only'));
    // Synced, then dropped out of the bucket. Keying off install_scan alone would hide it, and
    // its aggregates are still on disk and still searchable.
    saveAggregate(db, { ...EMPTY_AGG, site: 'agg-only' });

    const stats = storageStats(db);
    expect(stats.map(s => s.site)).toEqual(['agg-only', 'scanned-only']);
    expect(stats.find(s => s.site === 'scanned-only')?.aggregateDays).toBe(0);
    expect(stats.find(s => s.site === 'agg-only')?.objectCount).toBe(0);
  });
});
