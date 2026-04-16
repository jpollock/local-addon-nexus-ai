/**
 * Unit tests for nexus_fleet_summary MCP tool and nexusFleetSummary GraphQL resolver
 */
import { fleetSummaryHandler } from '../../../src/main/mcp/modules/fleet-intelligence/fleet-summary';
import type { NexusServices } from '../../../src/main/mcp/types';
import type { SiteDigitalTwin } from '../../../src/main/twin/SiteDigitalTwin';

function getText(result: any): string {
  return result.content[0].text;
}

const NOW = Date.now();
const DAY_MS = 24 * 60 * 60 * 1000;
const MONTH_MS = 30 * DAY_MS;

function makeTwin(overrides: Partial<SiteDigitalTwin>): SiteDigitalTwin {
  return {
    siteId: 'site-1',
    siteName: 'my-site',
    domain: 'my-site.local',
    path: '/path/to/site',
    source: 'local',
    completeness: 'metadata',
    asOf: NOW - 1000,
    sources: {},
    ...overrides,
  };
}

function createMockServices(twins: SiteDigitalTwin[] = []): NexusServices {
  return {
    twinService: {
      getAll: jest.fn().mockReturnValue(twins),
    },
  } as any;
}

describe('nexus_fleet_summary MCP tool', () => {
  test('returns error message when twinService is not available', async () => {
    const services = {} as any;
    const result = await fleetSummaryHandler.execute({}, services);
    expect(getText(result)).toContain('not available');
  });

  test('returns no sites message when fleet is empty', async () => {
    const services = createMockServices([]);
    const result = await fleetSummaryHandler.execute({}, services);
    expect(getText(result)).toContain('No sites found');
  });

  test('counts completeness correctly', async () => {
    const twins = [
      makeTwin({ siteId: 'a', completeness: 'indexed' }),
      makeTwin({ siteId: 'b', completeness: 'metadata' }),
      makeTwin({ siteId: 'c', completeness: 'filesystem' }),
      makeTwin({ siteId: 'd', completeness: 'none', asOf: null }),
    ];
    const services = createMockServices(twins);
    const result = await fleetSummaryHandler.execute({}, services);
    const text = getText(result);
    expect(text).toContain('indexed');
    expect(text).toContain('metadata');
    expect(text).toContain('filesystem');
    expect(text).toContain('none');
  });

  test('aggregates WP versions correctly', async () => {
    const twins = [
      makeTwin({ siteId: 'a', wpVersion: '7.0.1' }),
      makeTwin({ siteId: 'b', wpVersion: '7.0.1' }),
      makeTwin({ siteId: 'c', wpVersion: '6.4.2' }),
      makeTwin({ siteId: 'd', wpVersion: undefined }),
    ];
    const services = createMockServices(twins);
    const result = await fleetSummaryHandler.execute({}, services);
    const text = getText(result);
    expect(text).toContain('7.0.1');
    expect(text).toContain('6.4.2');
    expect(text).toContain('unknown');
  });

  test('aggregates PHP versions correctly', async () => {
    const twins = [
      makeTwin({ siteId: 'a', phpVersion: '8.2' }),
      makeTwin({ siteId: 'b', phpVersion: '8.2' }),
      makeTwin({ siteId: 'c', phpVersion: '8.1' }),
    ];
    const services = createMockServices(twins);
    const result = await fleetSummaryHandler.execute({}, services);
    const text = getText(result);
    expect(text).toContain('PHP');
    expect(text).toContain('8.2');
    expect(text).toContain('8.1');
  });

  test('counts stale twins (asOf > 24h)', async () => {
    const twins = [
      makeTwin({ siteId: 'a', asOf: NOW - (DAY_MS + 1000) }),  // stale
      makeTwin({ siteId: 'b', asOf: NOW - 1000 }),               // fresh
      makeTwin({ siteId: 'c', asOf: null }),                      // no data
    ];
    const services = createMockServices(twins);
    const result = await fleetSummaryHandler.execute({}, services);
    const text = getText(result);
    // Should mention refresh for stale
    expect(text).toContain('nexus fleet refresh');
  });

  test('counts never scanned sites (completeness = none)', async () => {
    const twins = [
      makeTwin({ siteId: 'a', completeness: 'none', asOf: null }),
      makeTwin({ siteId: 'b', completeness: 'metadata' }),
    ];
    const services = createMockServices(twins);
    const result = await fleetSummaryHandler.execute({}, services);
    const text = getText(result);
    expect(text).toContain('Never scanned');
  });

  test('counts recent activity correctly (lastPostAt < 30d)', async () => {
    const twins = [
      makeTwin({ siteId: 'a', lastPostAt: NOW - 1000 }),                   // recent
      makeTwin({ siteId: 'b', lastPostAt: NOW - (MONTH_MS + 1000) }),     // old
      makeTwin({ siteId: 'c', lastPostAt: undefined }),                     // none
    ];
    const services = createMockServices(twins);
    const result = await fleetSummaryHandler.execute({}, services);
    const text = getText(result);
    expect(text).toContain('Recent activity');
    expect(text).toContain('1 site');
  });

  test('sitesWithFullData counts metadata and indexed only', async () => {
    const twins = [
      makeTwin({ siteId: 'a', completeness: 'indexed' }),
      makeTwin({ siteId: 'b', completeness: 'metadata' }),
      makeTwin({ siteId: 'c', completeness: 'filesystem' }),
      makeTwin({ siteId: 'd', completeness: 'none', asOf: null }),
    ];
    const services = createMockServices(twins);
    const result = await fleetSummaryHandler.execute({}, services);
    const text = getText(result);
    // 2 sites with full data (indexed + metadata)
    expect(text).toContain('2 with full WP-CLI data');
  });

  test('puts unknown versions last in sorted output', async () => {
    const twins = [
      makeTwin({ siteId: 'a', wpVersion: undefined }),
      makeTwin({ siteId: 'b', wpVersion: '7.0.1' }),
    ];
    const services = createMockServices(twins);
    const result = await fleetSummaryHandler.execute({}, services);
    const text = getText(result);
    // 7.0.1 should appear before unknown in the text
    const idx7 = text.indexOf('7.0.1');
    const idxUnknown = text.indexOf('unknown');
    expect(idx7).toBeGreaterThan(-1);
    expect(idxUnknown).toBeGreaterThan(-1);
    expect(idx7).toBeLessThan(idxUnknown);
  });
});
