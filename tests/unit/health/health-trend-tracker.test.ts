/**
 * Unit tests for HealthTrendTracker
 */
import { HealthTrendTracker, DbLike } from '../../../src/main/health/HealthTrendTracker';

const ONE_HOUR_MS = 3_600_000;
const ONE_DAY_MS = 86_400_000;

/**
 * Simple in-memory mock of the DbLike interface.
 * Routes calls based on SQL pattern matching.
 */
function createMockDb(): DbLike {
  const rows: any[] = [];
  let nextId = 1;

  return {
    exec(_sql: string) {
      // Table/index creation — no-op in mock
    },
    prepare(sql: string) {
      return {
        get(...params: any[]) {
          if (sql.includes('SELECT score')) {
            // Dedup query: find most recent score for site within window
            const [siteId, since] = params;
            const matching = rows
              .filter((r) => r.site_id === siteId && r.timestamp > since)
              .sort((a, b) => b.timestamp - a.timestamp);
            return matching[0] || undefined;
          }
          if (sql.includes('AVG')) {
            const [start, end] = params;
            const matching = rows.filter(
              (r) => r.timestamp >= start && r.timestamp < end,
            );
            if (matching.length === 0) return { avg: null };
            const avg =
              matching.reduce((s, r) => s + r.score, 0) / matching.length;
            return { avg };
          }
          return undefined;
        },
        all(...params: any[]) {
          if (sql.includes('SELECT site_id')) {
            const [siteId, since] = params;
            return rows
              .filter((r) => r.site_id === siteId && r.timestamp > since)
              .sort((a, b) => a.timestamp - b.timestamp);
          }
          return [];
        },
        run(...params: any[]) {
          if (sql.includes('INSERT')) {
            const [siteId, score, timestamp] = params;
            rows.push({
              id: nextId++,
              site_id: siteId,
              score,
              timestamp,
            });
            return { changes: 1 };
          }
          if (sql.includes('DELETE')) {
            const [cutoff] = params;
            const before = rows.length;
            const toRemove = rows.filter((r) => r.timestamp < cutoff);
            toRemove.forEach((r) => {
              const idx = rows.indexOf(r);
              if (idx >= 0) rows.splice(idx, 1);
            });
            return { changes: before - rows.length };
          }
          return { changes: 0 };
        },
      };
    },
  };
}

describe('HealthTrendTracker', () => {
  let tracker: HealthTrendTracker;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-03-06T12:00:00Z'));
    tracker = new HealthTrendTracker(createMockDb());
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('record() creates a snapshot retrievable via getSiteTrend', () => {
    tracker.record('site-1', 85);

    const trend = tracker.getSiteTrend('site-1', 1);
    expect(trend).toHaveLength(1);
    expect(trend[0]).toEqual({
      siteId: 'site-1',
      score: 85,
      timestamp: Date.now(),
    });
  });

  test('dedup: same score within 1 hour is skipped', () => {
    tracker.record('site-1', 90);

    // Advance 30 minutes (within 1 hour)
    jest.advanceTimersByTime(30 * 60 * 1000);

    tracker.record('site-1', 90);

    const trend = tracker.getSiteTrend('site-1', 1);
    expect(trend).toHaveLength(1);
  });

  test('different score within 1 hour is recorded', () => {
    tracker.record('site-1', 90);

    jest.advanceTimersByTime(30 * 60 * 1000);

    tracker.record('site-1', 75);

    const trend = tracker.getSiteTrend('site-1', 1);
    expect(trend).toHaveLength(2);
    expect(trend[0].score).toBe(90);
    expect(trend[1].score).toBe(75);
  });

  test('getSiteTrend returns chronological snapshots for the site', () => {
    tracker.record('site-1', 80);
    jest.advanceTimersByTime(ONE_HOUR_MS + 1);
    tracker.record('site-1', 85);
    jest.advanceTimersByTime(ONE_HOUR_MS + 1);
    tracker.record('site-1', 90);

    const trend = tracker.getSiteTrend('site-1', 1);
    expect(trend).toHaveLength(3);
    expect(trend[0].score).toBe(80);
    expect(trend[1].score).toBe(85);
    expect(trend[2].score).toBe(90);
    // Verify ascending order
    expect(trend[0].timestamp).toBeLessThan(trend[1].timestamp);
    expect(trend[1].timestamp).toBeLessThan(trend[2].timestamp);
  });

  test('getSiteTrend filters by days parameter (old data excluded)', () => {
    tracker.record('site-1', 70);

    // Advance 3 days
    jest.advanceTimersByTime(3 * ONE_DAY_MS);

    tracker.record('site-1', 95);

    // Only look back 2 days — the first record should be excluded
    const trend = tracker.getSiteTrend('site-1', 2);
    expect(trend).toHaveLength(1);
    expect(trend[0].score).toBe(95);

    // Looking back 7 days should include both
    const fullTrend = tracker.getSiteTrend('site-1', 7);
    expect(fullTrend).toHaveLength(2);
  });

  test('getFleetTrend returns daily averages', () => {
    // Record scores for "yesterday" (advance to make it fall in the previous day bucket)
    const now = Date.now();

    // Go back ~1.5 days and record two scores
    jest.setSystemTime(now - ONE_DAY_MS - ONE_HOUR_MS);
    tracker.record('site-1', 80);
    tracker.record('site-2', 60);

    // Come back to now
    jest.setSystemTime(now);

    const fleet = tracker.getFleetTrend(2);
    // Should have at least one day with data
    expect(fleet.length).toBeGreaterThanOrEqual(1);
    // The day containing the two scores should average to 70
    const dayWithData = fleet.find((d) => d.avgScore === 70);
    expect(dayWithData).toBeDefined();
  });

  test('prune removes old snapshots and returns count', () => {
    tracker.record('site-1', 80);
    jest.advanceTimersByTime(ONE_HOUR_MS + 1);
    tracker.record('site-1', 85);

    // Advance 10 days
    jest.advanceTimersByTime(10 * ONE_DAY_MS);

    tracker.record('site-1', 90);

    // Prune anything older than 5 days
    const removed = tracker.prune(5);
    expect(removed).toBe(2);

    // Only the recent record should remain
    const trend = tracker.getSiteTrend('site-1', 30);
    expect(trend).toHaveLength(1);
    expect(trend[0].score).toBe(90);
  });

  test('empty DB returns empty arrays', () => {
    const siteTrend = tracker.getSiteTrend('nonexistent', 30);
    expect(siteTrend).toEqual([]);

    const fleetTrend = tracker.getFleetTrend(7);
    expect(fleetTrend).toEqual([]);
  });
});
