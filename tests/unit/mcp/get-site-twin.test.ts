/**
 * Unit tests for nexus_get_site_twin canAnswer() integration.
 *
 * Verifies that get-site-twin surfaces per-field staleness and missing-data
 * warnings via canAnswer() for 'filesystem' and 'metadata' completeness.
 */

import { getSiteTwinHandler } from '../../../src/main/mcp/modules/site-context/get-site-twin';
import type { NexusServices } from '../../../src/main/mcp/types';
import type { SiteDigitalTwin } from '../../../src/main/twin/SiteDigitalTwin';

const ONE_HOUR_MS = 60 * 60 * 1000;

function getText(result: any): string {
  return result.content[0].text;
}

function makeSite() {
  return { id: 'site-1', name: 'mysite', domain: 'mysite.local', path: '/sites/mysite' };
}

function makeTwin(overrides: Partial<SiteDigitalTwin> = {}): SiteDigitalTwin {
  return {
    siteId: 'site-1',
    siteName: 'mysite',
    domain: 'mysite.local',
    path: '/sites/mysite',
    source: 'local',
    completeness: 'metadata',
    asOf: Date.now() - ONE_HOUR_MS,
    sources: {},
    ...overrides,
  };
}

function makeServices(opts: {
  twin?: SiteDigitalTwin | null;
  canAnswer?: jest.Mock;
  format?: jest.Mock;
  getFreshness?: jest.Mock;
} = {}): NexusServices {
  const {
    twin = makeTwin(),
    canAnswer = jest.fn().mockReturnValue({ can: true, confidence: 'high' }),
    format = jest.fn().mockReturnValue('### mysite\n**Completeness:** Metadata'),
    getFreshness = jest.fn().mockReturnValue({ staleFields: [], requiresRunningFields: [] }),
  } = opts;

  return {
    vectorStore: {} as any,
    embeddingService: {} as any,
    contentPipeline: {} as any,
    indexRegistry: {} as any,
    fileScanner: {} as any,
    siteData: {
      getSite: jest.fn().mockReturnValue(makeSite()),
      getSites: jest.fn().mockReturnValue({ 'site-1': makeSite() }),
    },
    logger: { info: jest.fn(), error: jest.fn() } as any,
    twinService: {
      get: jest.fn().mockReturnValue(twin),
      format,
      getFreshness,
      canAnswer,
    } as any,
  } as any;
}

describe('nexus_get_site_twin — canAnswer() integration', () => {
  it('shows no warnings when all key fields are high confidence', async () => {
    const canAnswer = jest.fn().mockReturnValue({ can: true, confidence: 'high' });
    const services = makeServices({ canAnswer });

    const result = await getSiteTwinHandler.execute({ site: 'mysite' }, services);

    expect(result.isError).toBeUndefined();
    const text = getText(result);
    expect(text).not.toContain('> ⚠️');
    expect(canAnswer).toHaveBeenCalledWith(expect.anything(), 'wpVersion');
    expect(canAnswer).toHaveBeenCalledWith(expect.anything(), 'plugins');
    expect(canAnswer).toHaveBeenCalledWith(expect.anything(), 'themes');
  });

  it('prepends stale reason for fields with stale confidence', async () => {
    const canAnswer = jest.fn().mockImplementation((_twin: any, field: string) => {
      if (field === 'plugins') {
        return { can: true, confidence: 'stale', reason: 'Data from 2d ago — run nexus_site_refresh to refresh' };
      }
      return { can: true, confidence: 'high' };
    });
    const services = makeServices({ canAnswer });

    const result = await getSiteTwinHandler.execute({ site: 'mysite' }, services);

    expect(result.isError).toBeUndefined();
    const text = getText(result);
    expect(text).toContain('> ⚠️ `plugins`: Data from 2d ago');
    expect(text).toContain('nexus_site_refresh');
  });

  it('shows missing-data warning for fields that cannot be answered', async () => {
    const canAnswer = jest.fn().mockImplementation((_twin: any, field: string) => {
      if (field === 'themes') {
        return { can: false, confidence: 'stale', reason: 'Field not populated — run nexus_site_refresh' };
      }
      return { can: true, confidence: 'high' };
    });
    const services = makeServices({ canAnswer });

    const result = await getSiteTwinHandler.execute({ site: 'mysite' }, services);

    expect(result.isError).toBeUndefined();
    const text = getText(result);
    expect(text).toContain('Missing data for: themes');
    expect(text).toContain('nexus_site_refresh');
  });

  it('surfaces both stale and missing warnings together', async () => {
    const canAnswer = jest.fn().mockImplementation((_twin: any, field: string) => {
      if (field === 'wpVersion') {
        return { can: true, confidence: 'stale', reason: 'Data from 3d ago — run nexus_site_refresh to refresh' };
      }
      if (field === 'themes') {
        return { can: false, confidence: 'stale', reason: 'Field not populated' };
      }
      return { can: true, confidence: 'high' };
    });
    const services = makeServices({ canAnswer });

    const result = await getSiteTwinHandler.execute({ site: 'mysite' }, services);

    expect(result.isError).toBeUndefined();
    const text = getText(result);
    expect(text).toContain('> ⚠️ `wpVersion`: Data from 3d ago');
    expect(text).toContain('Missing data for: themes');
  });

  it('skips canAnswer checks for completeness=none — shows no data message instead', async () => {
    const twin = makeTwin({ completeness: 'none', asOf: null });
    const canAnswer = jest.fn();
    const services = makeServices({ twin, canAnswer });

    const result = await getSiteTwinHandler.execute({ site: 'mysite' }, services);

    expect(result.isError).toBeUndefined();
    const text = getText(result);
    expect(text).toContain('No data available');
    expect(text).toContain('nexus_site_refresh');
    // canAnswer should NOT be called for 'none' completeness
    expect(canAnswer).not.toHaveBeenCalled();
  });

  it('shows overall stale-fields warning for fully indexed twins', async () => {
    const twin = makeTwin({ completeness: 'indexed' });
    const getFreshness = jest.fn().mockReturnValue({
      staleFields: [{ field: 'plugins', ageMs: 48 * 60 * 60 * 1000 }],
      requiresRunningFields: [],
    });
    const canAnswer = jest.fn();
    const services = makeServices({ twin, canAnswer, getFreshness });

    const result = await getSiteTwinHandler.execute({ site: 'mysite' }, services);

    expect(result.isError).toBeUndefined();
    const text = getText(result);
    expect(text).toContain('> ⚠️ 1 field(s) are > 24h old');
    // For 'indexed' completeness, per-field canAnswer is NOT called
    expect(canAnswer).not.toHaveBeenCalled();
  });

  it('returns error when twinService is not available', async () => {
    const services = makeServices() as any;
    services.twinService = undefined;

    const result = await getSiteTwinHandler.execute({ site: 'mysite' }, services);
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('not available');
  });

  it('returns error when twin is not found', async () => {
    const services = makeServices({ twin: null });

    const result = await getSiteTwinHandler.execute({ site: 'mysite' }, services);
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('No twin found');
  });
});

describe('nexus_get_site_twin — WPE/external resolution via the graph', () => {
  function makeRemoteServices(opts: {
    rows?: Array<{ id: string; name: string; source: string; account_id?: string }>;
    fullRow?: Record<string, unknown>;
    getFromGraph?: jest.Mock;
  } = {}): NexusServices {
    const { rows = [], fullRow, getFromGraph = jest.fn().mockReturnValue(makeTwin({ source: 'external' })) } = opts;

    const db = {
      prepare: jest.fn().mockImplementation((sql: string) => {
        if (sql.includes('WHERE id = ?')) {
          return { get: jest.fn().mockReturnValue(fullRow) };
        }
        return { all: jest.fn().mockReturnValue(rows) };
      }),
    };

    return {
      vectorStore: {} as any,
      embeddingService: {} as any,
      contentPipeline: {} as any,
      indexRegistry: {} as any,
      fileScanner: {} as any,
      siteData: {
        // Not a Local site — forces the graph fallback path.
        getSite: jest.fn().mockReturnValue(undefined),
        getSites: jest.fn().mockReturnValue({}),
      },
      logger: { info: jest.fn(), error: jest.fn() } as any,
      twinService: {
        get: jest.fn(),
        getFromGraph,
        format: jest.fn().mockReturnValue('### hostinger-test\n**Completeness:** Metadata'),
        getFreshness: jest.fn().mockReturnValue({ staleFields: [], requiresRunningFields: [] }),
        canAnswer: jest.fn().mockReturnValue({ can: true, confidence: 'high' }),
      } as any,
      graphService: { getDb: jest.fn().mockReturnValue(db) } as any,
    } as any;
  }

  it('resolves a bare external alias via the graph and builds the twin from it', async () => {
    const fullRow = { id: 'ssh:hostinger-test', name: 'hostinger-test', source: 'external', wp_version: '6.5' };
    const getFromGraph = jest.fn().mockReturnValue(makeTwin({ source: 'external', siteId: 'ssh:hostinger-test' }));
    const services = makeRemoteServices({
      rows: [{ id: 'ssh:hostinger-test', name: 'hostinger-test', source: 'external' }],
      fullRow,
      getFromGraph,
    });

    const result = await getSiteTwinHandler.execute({ site: 'hostinger-test' }, services);

    expect(result.isError).toBeUndefined();
    expect(getFromGraph).toHaveBeenCalledWith(fullRow, services.graphService);
  });

  it('strips an ssh:<alias>@env target prefix before looking up the graph', async () => {
    const fullRow = { id: 'ssh:hostinger-test', name: 'hostinger-test', source: 'external' };
    const getFromGraph = jest.fn().mockReturnValue(makeTwin({ source: 'external' }));
    const services = makeRemoteServices({
      rows: [{ id: 'ssh:hostinger-test', name: 'hostinger-test', source: 'external' }],
      fullRow,
      getFromGraph,
    });

    const result = await getSiteTwinHandler.execute({ site: 'ssh:hostinger-test@production' }, services);

    expect(result.isError).toBeUndefined();
    expect(getFromGraph).toHaveBeenCalledWith(fullRow, services.graphService);
  });

  it('strips an incomplete ssh:<alias> prefix (no @env) the same way', async () => {
    const fullRow = { id: 'ssh:hostinger-test', name: 'hostinger-test', source: 'external' };
    const getFromGraph = jest.fn().mockReturnValue(makeTwin({ source: 'external' }));
    const services = makeRemoteServices({
      rows: [{ id: 'ssh:hostinger-test', name: 'hostinger-test', source: 'external' }],
      fullRow,
      getFromGraph,
    });

    const result = await getSiteTwinHandler.execute({ site: 'ssh:hostinger-test' }, services);

    expect(result.isError).toBeUndefined();
    expect(getFromGraph).toHaveBeenCalledWith(fullRow, services.graphService);
  });

  it('strips a wpe:account/install@env target prefix before looking up the graph', async () => {
    const fullRow = { id: 'wpe-abc123', name: 'myinstall', source: 'wpe' };
    const getFromGraph = jest.fn().mockReturnValue(makeTwin({ source: 'wpe' }));
    const services = makeRemoteServices({
      rows: [{ id: 'wpe-abc123', name: 'myinstall', source: 'wpe' }],
      fullRow,
      getFromGraph,
    });

    const result = await getSiteTwinHandler.execute({ site: 'wpe:myaccount/myinstall@production' }, services);

    expect(result.isError).toBeUndefined();
    expect(getFromGraph).toHaveBeenCalledWith(fullRow, services.graphService);
  });

  it('declines with disambiguated forms when the name collides across sources', async () => {
    const services = makeRemoteServices({
      rows: [
        { id: 'wpe-abc123', name: 'dupe', source: 'wpe' },
        { id: 'ssh:hostinger-test/dupe', name: 'dupe', source: 'external', account_id: 'hostinger-test' },
      ],
    });

    const result = await getSiteTwinHandler.execute({ site: 'dupe' }, services);

    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('matches 2 sites across sources');
    expect(getText(result)).toContain('ssh:hostinger-test/dupe');
    expect(getText(result)).toContain('wpe:<account>/dupe');
  });

  it('returns not-found when the name matches nothing local or remote', async () => {
    const services = makeRemoteServices({ rows: [] });

    const result = await getSiteTwinHandler.execute({ site: 'nowhere' }, services);

    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('not found');
  });

  it('returns not-found (not a crash) when graphService is unavailable', async () => {
    const services = makeRemoteServices({ rows: [] });
    (services as any).graphService = undefined;

    const result = await getSiteTwinHandler.execute({ site: 'hostinger-test' }, services);

    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('not found');
  });
});
