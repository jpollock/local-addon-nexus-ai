import { SiteDigitalTwinService } from '../../../src/main/twin/SiteDigitalTwinService';
import type { SiteDigitalTwin, FieldSource } from '../../../src/main/twin/SiteDigitalTwin';
import { HOUR_MS, DAY_MS } from '../../../src/main/twin/twin-helpers';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NOW = 1_700_000_000_000;

function makeService(): SiteDigitalTwinService {
  return new SiteDigitalTwinService({
    siteData:      { getSite: () => null, getSites: () => ({}) } as any,
    metadataCache: { getWithAge: () => null } as any,
    indexRegistry: { get: () => null } as any,
  });
}

function src(ageMs: number, requiresRunning = false): FieldSource {
  return { method: 'wp-cli', timestamp: NOW - ageMs, requiresRunning };
}

function makeTwin(overrides: Partial<SiteDigitalTwin> = {}): SiteDigitalTwin {
  return {
    siteId: 'site-1',
    siteName: 'My Blog',
    domain: 'myblog.local',
    path: '/sites/myblog',
    source: 'local',
    completeness: 'metadata',
    sources: {},
    asOf: NOW,
    ...overrides,
  } as SiteDigitalTwin;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SiteDigitalTwinService.canAnswer', () => {
  let service: SiteDigitalTwinService;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
    service = makeService();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('identity fields', () => {
    test.each(['siteId', 'siteName', 'domain', 'path', 'source', 'completeness', 'asOf'] as const)(
      '%s always returns high confidence',
      (field) => {
        const twin = makeTwin();
        const result = service.canAnswer(twin, field);
        expect(result).toEqual({ can: true, confidence: 'high' });
      }
    );
  });

  describe('field with no data and no source', () => {
    it('returns can:false when field is missing entirely', () => {
      const twin = makeTwin(); // no wpVersion, no sources
      const result = service.canAnswer(twin, 'wpVersion');
      expect(result.can).toBe(false);
      expect(result.confidence).toBe('stale');
      expect(result.reason).toMatch(/no data/i);
    });
  });

  describe('field with value but no source', () => {
    it('returns high confidence for inferred values', () => {
      const twin = makeTwin({ wpVersion: '7.0' }); // value exists, no source entry
      const result = service.canAnswer(twin, 'wpVersion');
      expect(result).toEqual({ can: true, confidence: 'high' });
    });
  });

  describe('field with source but no value', () => {
    it('returns can:false when collected but empty', () => {
      const twin = makeTwin({
        sources: { wpVersion: src(0) },
        // wpVersion still undefined
      });
      const result = service.canAnswer(twin, 'wpVersion');
      expect(result.can).toBe(false);
      expect(result.confidence).toBe('stale');
    });

    it('includes site start hint when requiresRunning', () => {
      const twin = makeTwin({
        sources: { plugins: src(0, true) },
        // plugins still undefined
      });
      const result = service.canAnswer(twin, 'plugins');
      expect(result.can).toBe(false);
      expect(result.reason).toMatch(/start the site/i);
    });
  });

  describe('freshness thresholds', () => {
    it('returns high confidence when data is < 1h old', () => {
      const twin = makeTwin({
        wpVersion: '7.0',
        sources: { wpVersion: src(HOUR_MS - 1) },
      });
      expect(service.canAnswer(twin, 'wpVersion')).toEqual({ can: true, confidence: 'high' });
    });

    it('returns medium confidence when data is 1–24h old', () => {
      const twin = makeTwin({
        wpVersion: '7.0',
        sources: { wpVersion: src(HOUR_MS + 1) },
      });
      expect(service.canAnswer(twin, 'wpVersion')).toEqual({ can: true, confidence: 'medium' });
    });

    it('returns stale confidence when data is > 24h old', () => {
      const twin = makeTwin({
        wpVersion: '7.0',
        sources: { wpVersion: src(DAY_MS + 1) },
      });
      const result = service.canAnswer(twin, 'wpVersion');
      expect(result.can).toBe(true);
      expect(result.confidence).toBe('stale');
      expect(result.reason).toBeDefined();
    });

    it('includes site start hint in stale reason when requiresRunning', () => {
      const twin = makeTwin({
        plugins: [{ name: 'woocommerce', status: 'active' }],
        sources: { plugins: src(DAY_MS + 1, true) },
      });
      const result = service.canAnswer(twin, 'plugins');
      expect(result.confidence).toBe('stale');
      expect(result.reason).toMatch(/start the site/i);
    });

    it('omits site start hint when not requiresRunning', () => {
      const twin = makeTwin({
        wpVersion: '7.0',
        sources: { wpVersion: src(DAY_MS + 1, false) },
      });
      const result = service.canAnswer(twin, 'wpVersion');
      expect(result.reason).not.toMatch(/start the site/i);
      expect(result.reason).toMatch(/nexus_site_refresh/i);
    });
  });

  describe('exact threshold boundaries', () => {
    it('is high at exactly 1h', () => {
      const twin = makeTwin({ wpVersion: '7.0', sources: { wpVersion: src(HOUR_MS) } });
      // at exactly HOUR_MS, ageMs === HOUR_MS, condition is > HOUR_MS → false → high
      expect(service.canAnswer(twin, 'wpVersion').confidence).toBe('high');
    });

    it('is medium at 1h + 1ms', () => {
      const twin = makeTwin({ wpVersion: '7.0', sources: { wpVersion: src(HOUR_MS + 1) } });
      expect(service.canAnswer(twin, 'wpVersion').confidence).toBe('medium');
    });

    it('is stale at exactly 24h + 1ms', () => {
      const twin = makeTwin({ wpVersion: '7.0', sources: { wpVersion: src(DAY_MS + 1) } });
      expect(service.canAnswer(twin, 'wpVersion').confidence).toBe('stale');
    });
  });
});
