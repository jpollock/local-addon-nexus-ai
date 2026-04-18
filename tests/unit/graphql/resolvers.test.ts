/**
 * Unit tests for GraphQL resolver domain modules.
 *
 * These tests verify resolver behaviour using lightweight mocks of NexusServices,
 * without spinning up a real GraphQL server or touching any real databases.
 */

import { createSiteResolvers } from '../../../src/main/graphql/resolvers/sites';
import { createTwinResolvers } from '../../../src/main/graphql/resolvers/twin';
import { createWpCliResolvers } from '../../../src/main/graphql/resolvers/wp-cli';
import { parseTarget, resolveSite } from '../../../src/main/graphql/resolver-utils';
import type { NexusServices } from '../../../src/main/types/nexus-services';

// ---------------------------------------------------------------------------
// Minimal service factory helpers
// ---------------------------------------------------------------------------

/** Build a minimal NexusServices mock that passes most guard checks. */
function makeServices(overrides: Partial<NexusServices> = {}): NexusServices {
  const siteData = {
    getSites: jest.fn().mockReturnValue({}),
    getSite: jest.fn().mockReturnValue(null),
  };

  return {
    vectorStore: {} as any,
    embeddingService: {} as any,
    contentPipeline: {} as any,
    indexRegistry: {
      get: jest.fn().mockReturnValue(null),
      listAll: jest.fn().mockReturnValue([]),
    } as any,
    fileScanner: {} as any,
    siteData,
    logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
    ...overrides,
  } as NexusServices;
}

/** Build a mock site record matching LocalSite shape. */
function makeSite(name: string, id = `id-${name}`, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name,
    path: `/sites/${name}`,
    domain: `${name}.local`,
    phpVersion: '8.2',
    wpVersion: '6.5',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// parseTarget helper tests
// ---------------------------------------------------------------------------

describe('parseTarget', () => {
  test('parses plain site name as local', () => {
    const result = parseTarget('mysite');
    expect(result.type).toBe('local');
    expect(result.siteName).toBe('mysite');
  });

  test('parses @local suffix', () => {
    const result = parseTarget('mysite@local');
    expect(result.type).toBe('local');
    expect(result.siteName).toBe('mysite');
  });

  test('parses full WPE target', () => {
    const result = parseTarget('wpe:myaccount/myinstall@production');
    expect(result.type).toBe('wpe');
    expect(result.account).toBe('myaccount');
    expect(result.installName).toBe('myinstall');
    expect(result.environment).toBe('production');
  });

  test('throws on incomplete WPE target', () => {
    expect(() => parseTarget('wpe:acct/install')).toThrow('Incomplete WPE target');
  });

  test('throws on invalid target format', () => {
    expect(() => parseTarget('mysite@invalid')).toThrow('Invalid target syntax');
  });
});

// ---------------------------------------------------------------------------
// resolveSite helper tests
// ---------------------------------------------------------------------------

describe('resolveSite', () => {
  test('finds site by name', () => {
    const site = makeSite('test-site');
    const siteData = { getSites: () => ({ 'id-test-site': site }), getSite: () => null };
    const result = resolveSite('test-site', siteData);
    expect(result?.name).toBe('test-site');
  });

  test('returns undefined for unknown site', () => {
    const siteData = { getSites: () => ({}), getSite: () => null };
    const result = resolveSite('unknown', siteData);
    expect(result).toBeUndefined();
  });

  test('finds site by id', () => {
    const site = makeSite('test-site', 'abc123');
    const siteData = { getSites: () => ({ abc123: site }), getSite: () => null };
    const result = resolveSite('abc123', siteData);
    expect(result?.id).toBe('abc123');
  });
});

// ---------------------------------------------------------------------------
// Site resolvers
// ---------------------------------------------------------------------------

describe('nexusSitesGet', () => {
  test('returns error when site not found', async () => {
    // Provide localServices so the "not available" guard passes
    const services = makeServices({
      localServices: {
        getSiteStatus: jest.fn(),
        resolveSiteObject: jest.fn().mockReturnValue(null),
      } as any,
    });
    const resolvers = createSiteResolvers(services);

    const result = await resolvers.nexusSitesGet(undefined, { target: 'unknown-site' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  test('returns error when localServices unavailable for local target', async () => {
    const services = makeServices({ localServices: undefined });
    const resolvers = createSiteResolvers(services);

    const result = await resolvers.nexusSitesGet(undefined, { target: 'mysite@local' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Local services not available');
  });

  test('resolves local site by name', async () => {
    const site = makeSite('my-wp-site');
    const services = makeServices({
      siteData: {
        getSites: jest.fn().mockReturnValue({ [site.id]: site }),
        getSite: jest.fn().mockReturnValue(site),
      } as any,
      localServices: {
        getSiteStatus: jest.fn().mockReturnValue('running'),
        resolveSiteObject: jest.fn().mockReturnValue({ hostConnections: {} }),
      } as any,
      indexRegistry: {
        get: jest.fn().mockReturnValue(null),
        listAll: jest.fn().mockReturnValue([]),
      } as any,
    });

    const resolvers = createSiteResolvers(services);
    const result = await resolvers.nexusSitesGet(undefined, { target: 'my-wp-site' });

    expect(result.success).toBe(true);
    expect(result.site).toBeDefined();
    expect((result as any).site.name).toBe('my-wp-site');
  });
});

describe('nexusSitesList', () => {
  test('returns empty lists when no sites exist', async () => {
    const services = makeServices({ localServices: undefined });
    const resolvers = createSiteResolvers(services);

    const result = await resolvers.nexusSitesList();

    expect(result.local).toEqual([]);
  });

  test('returns local sites when localServices unavailable', async () => {
    const site = makeSite('site-a');
    const services = makeServices({
      siteData: {
        getSites: jest.fn().mockReturnValue({ [site.id]: site }),
        getSite: jest.fn().mockReturnValue(site),
      } as any,
      localServices: undefined,
    });

    const resolvers = createSiteResolvers(services);
    const result = await resolvers.nexusSitesList();

    // Should not throw even when localServices is absent
    expect(result.local).toBeDefined();
    expect(result.wpe).toBeDefined();
  });
});

describe('nexusSitesDelete', () => {
  test('returns error when local services not available', async () => {
    const services = makeServices({ localServices: undefined });
    const resolvers = createSiteResolvers(services);

    const result = await resolvers.nexusSitesDelete(undefined, { target: 'my-site' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Local services not available');
  });

  test('returns error for WPE target', async () => {
    const services = makeServices({
      localServices: { getSiteStatus: jest.fn() } as any,
    });
    const resolvers = createSiteResolvers(services);

    const result = await resolvers.nexusSitesDelete(undefined, { target: 'wpe:acct/install@production' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('cannot be deleted');
  });
});

// ---------------------------------------------------------------------------
// Twin resolvers
// ---------------------------------------------------------------------------

describe('nexusFleetSummary', () => {
  test('returns error when twinService not available', () => {
    const services = makeServices({ twinService: undefined });
    const registry = { call: jest.fn() } as any;
    const resolvers = createTwinResolvers(services, registry);

    const result = resolvers.nexusFleetSummary();

    expect(result.success).toBe(false);
    expect(result.error).toContain('Twin service not available');
  });

  test('returns expected structure with empty fleet', () => {
    const services = makeServices({
      twinService: { getAll: jest.fn().mockReturnValue([]) } as any,
    });
    const registry = { call: jest.fn() } as any;
    const resolvers = createTwinResolvers(services, registry);

    const result = resolvers.nexusFleetSummary();

    expect(result.success).toBe(true);
    expect(result).toHaveProperty('totalSites', 0);
    expect(result).toHaveProperty('wpVersions');
    expect(result).toHaveProperty('phpVersions');
    expect(result).toHaveProperty('completeness');
  });

  test('correctly counts stale and metadata-complete sites', () => {
    const NOW = Date.now();
    const DAY_MS = 24 * 60 * 60 * 1000;

    const twins = [
      { siteName: 'site-a', completeness: 'metadata', asOf: NOW - 2 * DAY_MS, wpVersion: '6.5', phpVersion: '8.2', lastPostAt: null },
      { siteName: 'site-b', completeness: 'indexed',  asOf: NOW - 1000,       wpVersion: '6.4', phpVersion: '8.1', lastPostAt: null },
      { siteName: 'site-c', completeness: 'none',     asOf: null,             wpVersion: null,  phpVersion: null,  lastPostAt: null },
    ];

    const services = makeServices({
      twinService: { getAll: jest.fn().mockReturnValue(twins) } as any,
    });
    const registry = { call: jest.fn() } as any;
    const resolvers = createTwinResolvers(services, registry);

    const result = resolvers.nexusFleetSummary();

    expect(result.success).toBe(true);
    expect(result.totalSites).toBe(3);
    expect(result.sitesWithFullData).toBe(2); // metadata + indexed
    expect(result.staleCount).toBe(1);        // site-a is > 24h old
    expect(result.neverScannedCount).toBe(1); // site-c is 'none'
    expect(result.completeness.none).toBe(1);
    expect(result.completeness.metadata).toBe(1);
    expect(result.completeness.indexed).toBe(1);
  });
});

describe('nexusWpeSiteDeepRefresh', () => {
  test('returns error when localServices not available', async () => {
    const services = makeServices({ localServices: undefined });
    const registry = { call: jest.fn() } as any;
    const resolvers = createTwinResolvers(services, registry);

    const result = await resolvers.nexusWpeSiteDeepRefresh(undefined, { installName: 'my-install' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Local services not available');
  });

  test('returns error when SSH key not available', async () => {
    const services = makeServices({
      localServices: {
        isSSHKeyAvailable: jest.fn().mockReturnValue(false),
      } as any,
    });
    const registry = { call: jest.fn() } as any;
    const resolvers = createTwinResolvers(services, registry);

    const result = await resolvers.nexusWpeSiteDeepRefresh(undefined, { installName: 'my-install' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('SSH key not found');
  });
});

// ---------------------------------------------------------------------------
// WP-CLI resolvers
// ---------------------------------------------------------------------------

describe('nexusWpCommand', () => {
  test('returns error when localServices not available', async () => {
    const services = makeServices({ localServices: undefined });
    const resolvers = createWpCliResolvers(services);

    const result = await resolvers.nexusWpCommand(undefined, { target: 'mysite', command: ['help'] });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Local services not available');
    expect(result.exitCode).toBe(1);
  });

  test('blocks dangerous commands on WPE sites', async () => {
    const services = makeServices({
      localServices: { getSiteStatus: jest.fn() } as any,
    });
    const resolvers = createWpCliResolvers(services);

    const result = await resolvers.nexusWpCommand(
      undefined,
      { target: 'wpe:acct/install@production', command: ['eval', '$x = 1;'] }
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('blocked on remote sites');
  });

  test('returns error when site not found', async () => {
    const services = makeServices({
      localServices: { getSiteStatus: jest.fn().mockReturnValue('running') } as any,
    });
    const resolvers = createWpCliResolvers(services);

    const result = await resolvers.nexusWpCommand(
      undefined,
      { target: 'nonexistent-site', command: ['core', 'version'] }
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });
});
