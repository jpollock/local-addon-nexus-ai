import { getSiteHealthHandler } from '../../../src/main/mcp/modules/fleet-intelligence/get-site-health';

function makeServices(opts: {
  localSite?: any;
  graphRow?: any;
  hasPlugins?: boolean;
  calculateScore?: jest.Mock;
} = {}) {
  const { localSite = null, graphRow = null, hasPlugins = false, calculateScore } = opts;
  const db = {
    prepare: jest.fn().mockImplementation((sql: string) => {
      if (sql.includes('FROM plugins')) {
        return { get: jest.fn().mockReturnValue({ c: hasPlugins ? 1 : 0 }) };
      }
      return { get: jest.fn().mockReturnValue(graphRow) };
    }),
  };
  return {
    siteData: { getSite: jest.fn().mockReturnValue(localSite) },
    graphService: { getDb: jest.fn().mockReturnValue(db) },
    healthCalculator: {
      calculateScore: calculateScore ?? jest.fn().mockResolvedValue({
        overall: 75,
        factors: { security: 80, performance: 70, maintenance: 0, activity: 0, stability: 0 },
        issues: [],
        recommendations: [],
      }),
    },
    indexRegistry: { get: jest.fn().mockReturnValue(null) },
  } as any;
}

function getText(result: any): string {
  return result.content[0].text;
}

describe('get_site_health — remote resolution', () => {
  it('scores an external host on security+performance only when it has plugin data and a php_version', async () => {
    const calculateScore = jest.fn().mockResolvedValue({
      overall: 75,
      factors: { security: 80, performance: 70, maintenance: 0, activity: 0, stability: 0 },
      issues: [],
      recommendations: [],
    });
    const services = makeServices({
      graphRow: { id: 'ssh:hostinger-test', name: 'hostinger-test', source: 'external', domain: 'example.com', php_version: '8.2', is_active: 1 },
      hasPlugins: true,
      calculateScore,
    });

    const result = await getSiteHealthHandler.execute({ site_id: 'ssh:hostinger-test' }, services);

    expect(calculateScore).toHaveBeenCalledWith('ssh:hostinger-test', expect.objectContaining({ phpVersion: '8.2' }), ['security', 'performance']);
    expect(getText(result)).not.toContain('Maintenance:');
  });

  it('reports "not enough data" for an unrefreshed external host, without calling calculateScore', async () => {
    const calculateScore = jest.fn();
    const services = makeServices({
      graphRow: { id: 'ssh:unrefreshed', name: 'unrefreshed', source: 'external', domain: '', php_version: null, is_active: 1 },
      hasPlugins: false,
      calculateScore,
    });

    const result = await getSiteHealthHandler.execute({ site_id: 'ssh:unrefreshed' }, services);

    expect(calculateScore).not.toHaveBeenCalled();
    expect(getText(result)).toMatch(/not enough data|no data/i);
  });

  it('scores a WPE install on security+performance', async () => {
    const calculateScore = jest.fn().mockResolvedValue({
      overall: 60,
      factors: { security: 50, performance: 70, maintenance: 0, activity: 0, stability: 0 },
      issues: [],
      recommendations: [],
    });
    const services = makeServices({
      graphRow: { id: 'wpe-abc', name: 'myinstall', source: 'wpe', domain: 'myinstall.wpengine.com', php_version: '8.1', is_active: 1 },
      calculateScore,
    });

    const result = await getSiteHealthHandler.execute({ site_id: 'wpe-abc' }, services);

    expect(calculateScore).toHaveBeenCalledWith('wpe-abc', expect.objectContaining({ phpVersion: '8.1' }), ['security', 'performance']);
  });

  it('still scores a local site on all five factors, unchanged', async () => {
    const calculateScore = jest.fn().mockResolvedValue({
      overall: 90,
      factors: { security: 90, performance: 90, maintenance: 90, activity: 90, stability: 90 },
      issues: [],
      recommendations: [],
    });
    const services = makeServices({
      localSite: { id: 'site-1', name: 'mysite', domain: 'mysite.local', phpVersion: '8.2' },
      calculateScore,
    });

    const result = await getSiteHealthHandler.execute({ site_id: 'site-1' }, services);

    expect(calculateScore).toHaveBeenCalledWith('site-1', expect.anything(), ['security', 'performance', 'maintenance', 'activity', 'stability']);
  });

  it('returns "not found" when neither local nor graph has the id', async () => {
    const services = makeServices({ localSite: null, graphRow: null });

    const result = await getSiteHealthHandler.execute({ site_id: 'nowhere' }, services);

    expect(getText(result)).toContain('not found');
  });
});
