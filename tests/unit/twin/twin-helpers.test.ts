import {
  indexFreshnessWarning,
  twinFreshnessWarning,
  dataSourceLine,
  HOUR_MS,
  DAY_MS,
  WEEK_MS,
} from '../../../src/main/twin/twin-helpers';
import type { IndexEntry } from '../../../src/common/types';
import type { SiteDigitalTwin } from '../../../src/main/twin/SiteDigitalTwin';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NOW = 1_700_000_000_000;

function makeEntry(overrides: Partial<IndexEntry> = {}): IndexEntry {
  return {
    siteId: 'site-1',
    siteName: 'My Blog',
    lastIndexed: NOW,
    documentCount: 10,
    chunkCount: 50,
    durationMs: 1000,
    structure: null,
    state: 'indexed',
    ...overrides,
  };
}

function makeTwin(asOf: number | null = NOW): Pick<SiteDigitalTwin, 'asOf' | 'siteId' | 'siteName' | 'domain' | 'path' | 'source' | 'completeness' | 'sources'> & Partial<SiteDigitalTwin> {
  return {
    siteId: 'site-1',
    siteName: 'My Blog',
    domain: 'myblog.local',
    path: '/sites/myblog',
    source: 'local',
    completeness: 'metadata',
    sources: {},
    asOf,
  } as SiteDigitalTwin;
}

// ---------------------------------------------------------------------------
// indexFreshnessWarning
// ---------------------------------------------------------------------------

describe('indexFreshnessWarning', () => {
  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
  });
  afterEach(() => jest.restoreAllMocks());

  it('returns null when index is fresh (< 1h)', () => {
    const entry = makeEntry({ lastIndexed: NOW - 30 * 60 * 1000 });
    expect(indexFreshnessWarning(entry)).toBeNull();
  });

  it('returns null when index is exactly at 1h boundary (exclusive)', () => {
    const entry = makeEntry({ lastIndexed: NOW - HOUR_MS + 1 });
    expect(indexFreshnessWarning(entry)).toBeNull();
  });

  it('returns inline note when 1–24h old', () => {
    const entry = makeEntry({ lastIndexed: NOW - 3 * HOUR_MS });
    const result = indexFreshnessWarning(entry);
    expect(result).toMatch(/^Index last updated/);
    expect(result).toContain('3h ago');
    expect(result).not.toContain('⚠️');
    expect(result).not.toContain('❌');
  });

  it('returns ⚠️ warning when > 24h old', () => {
    const entry = makeEntry({ lastIndexed: NOW - 2 * DAY_MS });
    const result = indexFreshnessWarning(entry);
    expect(result).toContain('⚠️');
    expect(result).toContain('2d ago');
    expect(result).toContain('reindex_site');
  });

  it('returns ❌ warning when > 7d old', () => {
    const entry = makeEntry({ lastIndexed: NOW - 8 * DAY_MS });
    const result = indexFreshnessWarning(entry);
    expect(result).toContain('❌');
    expect(result).toContain('8d ago');
    expect(result).toContain('reindex_site');
  });

  it('returns ❌ warning when state is stale (regardless of age)', () => {
    const entry = makeEntry({ lastIndexed: NOW - 2 * HOUR_MS, state: 'stale' });
    const result = indexFreshnessWarning(entry);
    expect(result).toContain('❌');
    expect(result).toContain('reindex_site');
  });

  it('returns ❌ error message when state is error', () => {
    const entry = makeEntry({ state: 'error' });
    const result = indexFreshnessWarning(entry);
    expect(result).toContain('❌');
    expect(result).toContain('error state');
    expect(result).toContain('reindex_site');
  });
});

// ---------------------------------------------------------------------------
// twinFreshnessWarning
// ---------------------------------------------------------------------------

describe('twinFreshnessWarning', () => {
  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
  });
  afterEach(() => jest.restoreAllMocks());

  it('returns ❌ when asOf is null', () => {
    const twin = makeTwin(null);
    const result = twinFreshnessWarning(twin as SiteDigitalTwin);
    expect(result).toContain('❌');
    expect(result).toContain('nexus_site_refresh');
  });

  it('returns null when twin is fresh (< 1h)', () => {
    const twin = makeTwin(NOW - 30 * 60 * 1000);
    expect(twinFreshnessWarning(twin as SiteDigitalTwin)).toBeNull();
  });

  it('returns null at exactly 1h boundary (exclusive)', () => {
    const twin = makeTwin(NOW - HOUR_MS + 1);
    expect(twinFreshnessWarning(twin as SiteDigitalTwin)).toBeNull();
  });

  it('returns inline note when 1–24h old', () => {
    const twin = makeTwin(NOW - 5 * HOUR_MS);
    const result = twinFreshnessWarning(twin as SiteDigitalTwin);
    expect(result).toMatch(/^Twin data from/);
    expect(result).toContain('5h ago');
    expect(result).not.toContain('⚠️');
  });

  it('returns ⚠️ when > 24h old', () => {
    const twin = makeTwin(NOW - 3 * DAY_MS);
    const result = twinFreshnessWarning(twin as SiteDigitalTwin);
    expect(result).toContain('⚠️');
    expect(result).toContain('3d ago');
    expect(result).toContain('nexus_site_refresh');
  });

  it('returns ❌ when > 7d old', () => {
    const twin = makeTwin(NOW - 10 * DAY_MS);
    const result = twinFreshnessWarning(twin as SiteDigitalTwin);
    expect(result).toContain('❌');
    expect(result).toContain('10d ago');
    expect(result).toContain('nexus_site_refresh');
  });
});

// ---------------------------------------------------------------------------
// dataSourceLine
// ---------------------------------------------------------------------------

describe('dataSourceLine', () => {
  it('returns live ✅ for live source with ageMs=0', () => {
    expect(dataSourceLine('live', 0)).toBe('(live ✅)');
  });

  it('returns source ✅ for non-live source with ageMs=0', () => {
    expect(dataSourceLine('twin', 0)).toBe('(twin ✅)');
  });

  it('returns <1h ago ✅ for fresh non-live data (< 1h)', () => {
    const result = dataSourceLine('twin', 30 * 60 * 1000);
    expect(result).toBe('(twin: <1h ago ✅)');
  });

  it('returns age without warning for 1–24h old data', () => {
    const result = dataSourceLine('index', 4 * HOUR_MS);
    expect(result).toBe('(index: 4h ago)');
    expect(result).not.toContain('⚠️');
    expect(result).not.toContain('❌');
  });

  it('returns ⚠️ annotation for > 24h old data', () => {
    const result = dataSourceLine('twin', 2 * DAY_MS);
    expect(result).toContain('⚠️');
    expect(result).toContain('2d ago');
    expect(result).toContain('twin');
  });

  it('returns ❌ annotation for > 7d old data', () => {
    const result = dataSourceLine('cache', 8 * DAY_MS);
    expect(result).toContain('❌');
    expect(result).toContain('8d ago');
    expect(result).toContain('cache');
  });

  it('handles arbitrary source names', () => {
    const result = dataSourceLine('graph', WEEK_MS - 1);
    expect(result).toContain('graph');
    expect(result).toContain('⚠️');
  });
});
