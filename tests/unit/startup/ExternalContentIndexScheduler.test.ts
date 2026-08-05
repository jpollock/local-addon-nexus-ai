import { ExternalContentIndexScheduler } from '../../../src/main/startup/ExternalContentIndexScheduler';

jest.mock('../../../src/main/transport', () => ({ resolveTransport: jest.fn() }));
import { resolveTransport } from '../../../src/main/transport';

const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
const NOW = 1_800_000_000_000;

function graph(rows: any[]) {
  return {
    getDb: () => ({
      prepare: (sql: string) => {
        if (sql.includes('pragma_table_info')) return { get: () => ({ c: 1 }) }; // column already exists
        if (sql.includes("ALTER TABLE")) return { run: () => {} };
        return { all: () => rows, get: () => undefined, run: () => {} };
      },
      exec: () => {},
    }),
  };
}
function okTransport() {
  return { kind: 'external-ssh', siteRef: { kind: 'external', alias: 'a' }, runWpCli: jest.fn(async () => ({ stdout: '[]', success: true })) };
}
function makeIndexService() {
  return { indexOne: jest.fn(async () => ({ documentCount: 0 })) };
}

beforeEach(() => { jest.clearAllMocks(); jest.spyOn(Date, 'now').mockReturnValue(NOW); });
afterEach(() => { jest.restoreAllMocks(); });

describe('ExternalContentIndexScheduler', () => {
  it('skips a host indexed more recently than the staleness threshold', async () => {
    const g = graph([{ id: 'ssh:fresh', name: 'fresh', environment: 'production', content_indexed_at: NOW - 1000 }]);
    const indexService = makeIndexService();
    const s = new ExternalContentIndexScheduler({
      graphService: g as any, services: {} as any, indexService: indexService as any,
      logger, stalenessThresholdMs: 60_000,
    });
    const r = await s.runCycleNow();
    expect(r.skipped).toBe(1);
    expect(resolveTransport).not.toHaveBeenCalled();
  });

  it('includes a host that has never been indexed', async () => {
    const g = graph([{ id: 'ssh:new', name: 'new', environment: 'production', content_indexed_at: null }]);
    (resolveTransport as jest.Mock).mockResolvedValue(okTransport());
    const indexService = makeIndexService();
    const s = new ExternalContentIndexScheduler({ graphService: g as any, services: {} as any, indexService: indexService as any, logger });
    const r = await s.runCycleNow();
    expect(r.scanned).toBe(1);
    expect(indexService.indexOne).toHaveBeenCalledWith(expect.anything(), 'ssh:new', 'new');
  });

  it('counts a permission refusal as skipped, not failed', async () => {
    const g = graph([{ id: 'ssh:denied', name: 'denied', environment: 'production', content_indexed_at: null }]);
    (resolveTransport as jest.Mock).mockResolvedValue({ content: [{ type: 'text', text: 'Operation blocked' }] });
    const indexService = makeIndexService();
    const s = new ExternalContentIndexScheduler({ graphService: g as any, services: {} as any, indexService: indexService as any, logger });
    const r = await s.runCycleNow();
    expect(r.skipped).toBe(1);
    expect(r.failed).toBe(0);
  });

  it('one host throwing does not abort the cycle', async () => {
    const g = graph([
      { id: 'ssh:bad', name: 'bad', environment: 'production', content_indexed_at: null },
      { id: 'ssh:good', name: 'good', environment: 'production', content_indexed_at: null },
    ]);
    (resolveTransport as jest.Mock).mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(okTransport());
    const indexService = makeIndexService();
    const s = new ExternalContentIndexScheduler({ graphService: g as any, services: {} as any, indexService: indexService as any, logger });
    const r = await s.runCycleNow();
    expect(r.failed).toBe(1);
    expect(r.scanned).toBe(1);
  });

  it('excludes an inactive (removed) host via the is_active filter', async () => {
    let capturedSql = '';
    const g = { getDb: () => ({ prepare: (sql: string) => { capturedSql += sql; return { get: () => ({ c: 1 }), all: () => [], run: () => {} }; }, exec: () => {} }) };
    const indexService = makeIndexService();
    const s = new ExternalContentIndexScheduler({ graphService: g as any, services: {} as any, indexService: indexService as any, logger });
    await s.runCycleNow();
    expect(capturedSql).toMatch(/is_active\s*=\s*1/);
  });

  it('start() is idempotent', () => {
    const s = new ExternalContentIndexScheduler({ graphService: graph([]) as any, services: {} as any, indexService: makeIndexService() as any, logger });
    s.start(); s.start();
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Already running'));
    s.stop();
  });

  it('tolerates getDb() returning null during startup', async () => {
    const g = { getDb: () => null };
    const s = new ExternalContentIndexScheduler({ graphService: g as any, services: {} as any, indexService: makeIndexService() as any, logger });
    await expect(s.runCycleNow()).resolves.toEqual({ scanned: 0, skipped: 0, failed: 0 });
  });

  it('adds the content_indexed_at column on first use if it does not exist', async () => {
    let alterRan = false;
    const g = {
      getDb: () => ({
        prepare: (sql: string) => {
          if (sql.includes('pragma_table_info')) return { get: () => ({ c: 0 }) }; // column missing
          return { all: () => [], get: () => undefined, run: () => {} };
        },
        exec: (sql: string) => { if (sql.includes('ADD COLUMN content_indexed_at')) alterRan = true; },
      }),
    };
    const s = new ExternalContentIndexScheduler({ graphService: g as any, services: {} as any, indexService: makeIndexService() as any, logger });
    await s.runCycleNow();
    expect(alterRan).toBe(true);
  });
});
