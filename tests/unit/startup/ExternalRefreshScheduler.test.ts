import { ExternalRefreshScheduler } from '../../../src/main/startup/ExternalRefreshScheduler';

jest.mock('../../../src/main/transport', () => ({ resolveTransport: jest.fn() }));
import { resolveTransport } from '../../../src/main/transport';

const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
const NOW = 1_800_000_000_000;

function graph(rows: any[]) {
  return {
    getDb: () => ({ prepare: () => ({ all: () => rows, get: () => undefined, run: () => {} }) }),
    upsertSite: jest.fn(async () => {}),
    upsertPlugin: jest.fn(async () => {}),
    upsertTheme: jest.fn(async () => {}),
  };
}
function okTransport() {
  return {
    kind: 'external-ssh',
    siteRef: { kind: 'external', alias: 'a' },
    runWpCliBatch: jest.fn(async (c: string[][]) => new Array(c.length).fill(null)),
  };
}

beforeEach(() => { jest.clearAllMocks(); jest.spyOn(Date, 'now').mockReturnValue(NOW); });
afterEach(() => { jest.restoreAllMocks(); });

describe('ExternalRefreshScheduler', () => {
  it('skips hosts that are not active — a removed host is never reconnected to', async () => {
    const g = graph([{ id: 'ssh:gone', name: 'gone', environment: 'production', ssh_last_sync_at: null, is_active: 0 }]);
    // The SQL filters is_active, so an inactive row must not even be returned;
    // assert the query text carries the filter.
    let captured = '';
    (g as any).getDb = () => ({ prepare: (sql: string) => { captured = sql; return { all: () => [], get: () => undefined, run: () => {} }; } });
    const s = new ExternalRefreshScheduler({ graphService: g as any, services: {} as any, logger });
    await s.runCycleNow();
    expect(captured).toMatch(/is_active\s*=\s*1/);
  });

  it('skips a host synced more recently than the staleness threshold', async () => {
    const g = graph([{ id: 'ssh:hostinger-test/fresh', name: 'fresh', account_id: 'hostinger-test', environment: 'production', ssh_last_sync_at: NOW - 1000 }]);
    const s = new ExternalRefreshScheduler({
      graphService: g as any, services: {} as any, logger, stalenessThresholdMs: 60_000,
    });
    const r = await s.runCycleNow();
    expect(r.skipped).toBe(1);
    expect(resolveTransport).not.toHaveBeenCalled();
  });

  it('includes a host that has never been synced', async () => {
    const g = graph([{ id: 'ssh:hostinger-test/new', name: 'new', account_id: 'hostinger-test', environment: 'production', ssh_last_sync_at: null }]);
    (resolveTransport as jest.Mock).mockResolvedValue(okTransport());
    const s = new ExternalRefreshScheduler({ graphService: g as any, services: {} as any, logger });
    const r = await s.runCycleNow();
    expect(r.scanned).toBe(1);
  });

  it('counts a permission refusal as skipped, not failed', async () => {
    const g = graph([{ id: 'ssh:hostinger-test/denied', name: 'denied', account_id: 'hostinger-test', environment: 'production', ssh_last_sync_at: null }]);
    (resolveTransport as jest.Mock).mockResolvedValue({ content: [{ type: 'text', text: 'Operation blocked' }] });
    const s = new ExternalRefreshScheduler({ graphService: g as any, services: {} as any, logger });
    const r = await s.runCycleNow();
    expect(r.skipped).toBe(1);
    expect(r.failed).toBe(0);
  });

  it('one host throwing does not abort the cycle', async () => {
    const g = graph([
      { id: 'ssh:hostinger-test/bad',  name: 'bad',  account_id: 'hostinger-test', environment: 'production', ssh_last_sync_at: null },
      { id: 'ssh:linode-prod/good', name: 'good', account_id: 'linode-prod', environment: 'production', ssh_last_sync_at: null },
    ]);
    (resolveTransport as jest.Mock)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(okTransport());
    const s = new ExternalRefreshScheduler({ graphService: g as any, services: {} as any, logger });
    const r = await s.runCycleNow();
    expect(r.failed).toBe(1);
    expect(r.scanned).toBe(1);
  });

  it('addresses the host with its registered environment', async () => {
    const g = graph([{ id: 'ssh:hostinger-test/stg', name: 'stg', account_id: 'hostinger-test', environment: 'staging', ssh_last_sync_at: null }]);
    (resolveTransport as jest.Mock).mockResolvedValue(okTransport());
    const s = new ExternalRefreshScheduler({ graphService: g as any, services: {} as any, logger });
    await s.runCycleNow();
    expect(resolveTransport).toHaveBeenCalledWith(
      { ssh_target: 'ssh:hostinger-test/stg@staging' }, expect.anything(), 'wpcli_read');
  });

  it('start() is idempotent', () => {
    const s = new ExternalRefreshScheduler({ graphService: graph([]) as any, services: {} as any, logger });
    s.start(); s.start();
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Already running'));
    s.stop();
  });

  it('tolerates getDb() returning null during startup', async () => {
    const g = { getDb: () => null, upsertSite: jest.fn(), upsertPlugin: jest.fn(), upsertTheme: jest.fn() };
    const s = new ExternalRefreshScheduler({ graphService: g as any, services: {} as any, logger });
    await expect(s.runCycleNow()).resolves.toEqual({ scanned: 0, skipped: 0, failed: 0 });
  });

  it('reconstructs the target from account_id and name, not name alone — regression pin for the multi-site case', async () => {
    const g = graph([{ id: 'ssh:hostinger-test/site-a', name: 'site-a', account_id: 'hostinger-test', environment: 'production', ssh_last_sync_at: null }]);
    (resolveTransport as jest.Mock).mockResolvedValue(okTransport());
    const s = new ExternalRefreshScheduler({ graphService: g as any, services: {} as any, logger });
    await s.runCycleNow();
    expect(resolveTransport).toHaveBeenCalledWith(
      { ssh_target: 'ssh:hostinger-test/site-a@production' }, expect.anything(), 'wpcli_read');
  });
});
