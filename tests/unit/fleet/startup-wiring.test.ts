import { runStartupReconciliation } from '../../../src/main/fleet/startupReconciliation';

describe('runStartupReconciliation', () => {
  it('sweeps all sites, logs the unresolved count, and keeps the report', async () => {
    const resolver = {
      reconcileAll: jest.fn().mockResolvedValue({
        linked: [{ localSiteId: 'local-1' }],
        unresolved: [{ localSiteId: 'local-2', localSiteName: 'orphan' }],
      }),
      setLastReport: jest.fn(),
    } as any;
    const siteData = {
      getSites: () => ({
        'local-1': { id: 'local-1', name: 'a', path: '/a', domain: 'a.local' },
        'local-2': { id: 'local-2', name: 'orphan', path: '/b', domain: 'b.local' },
      }),
    } as any;
    const logger = { info: jest.fn(), error: jest.fn() };

    const report = await runStartupReconciliation(resolver, siteData, logger);

    expect(resolver.reconcileAll).toHaveBeenCalled();
    expect(report.unresolved).toHaveLength(1);
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('1 linked, 1 unresolved'));
    expect(resolver.setLastReport).toHaveBeenCalledWith(report);
  });

  it('never throws — a reconciliation failure must not break startup', async () => {
    const resolver = {
      reconcileAll: jest.fn().mockRejectedValue(new Error('boom')),
      setLastReport: jest.fn(),
    } as any;
    const siteData = { getSites: () => ({}) } as any;
    const logger = { info: jest.fn(), error: jest.fn() };

    const report = await runStartupReconciliation(resolver, siteData, logger);

    expect(report).toEqual({ linked: [], unresolved: [] });
    expect(logger.error).toHaveBeenCalled();
    expect(resolver.setLastReport).toHaveBeenCalledWith({ linked: [], unresolved: [] });
  });
});
