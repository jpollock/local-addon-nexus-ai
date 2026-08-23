/**
 * Deactivating graph rows for WP Engine installs that no longer exist.
 *
 * Every writer in WPESyncService upserts and none reconcile, so a row for a
 * deleted install stays `is_active = 1` indefinitely and fails on every sweep
 * forever.
 *
 * This was prompted by 73 of 365 active rows having no SSH host (NXDOMAIN),
 * assumed to be deleted installs. That assumption was WRONG: CAPI still lists
 * all 365, this code correctly deactivated zero on its first live run, and the
 * 73 are one entire account with no SSH endpoint (D15). The tests below keep
 * that distinction: CAPI membership is the only signal, because a missing DNS
 * record is not a missing install.
 *
 * The danger runs the other way. A partial or empty CAPI response would
 * deactivate a live fleet, so most of this file is about when NOT to act.
 */
import Database from 'better-sqlite3';
import { WPESyncService } from '../../../src/main/events/WPESyncService';

function makeGraph(rows: Array<{ id: string; name: string; installId: string | null; active?: number }>) {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE sites (
    id TEXT PRIMARY KEY, name TEXT, source TEXT, is_active INTEGER,
    remote_install_id TEXT, domain TEXT, environment TEXT, last_sync_at INTEGER
  )`);
  const ins = db.prepare(
    "INSERT INTO sites (id,name,source,is_active,remote_install_id,domain,environment,last_sync_at) "
    + "VALUES (?,?,'wpe',?,?,'x.wpengine.com','production',?)",
  );
  for (const r of rows) ins.run(r.id, r.name, r.active ?? 1, r.installId, Date.now());
  return db;
}

function makeService(db: any) {
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  const service = new WPESyncService({
    graphService: { getDb: () => db, upsertSite: jest.fn(), upsertAccount: jest.fn() } as any,
    localServices: {} as any,
    logger,
  });
  return { service, logger };
}

const active = (db: any) =>
  db.prepare("SELECT name FROM sites WHERE source='wpe' AND is_active=1 ORDER BY name")
    .all().map((r: any) => r.name);

describe('reconcileMissingInstalls — a row for an install that no longer exists', () => {
  test('is deactivated when CAPI does not list it', () => {
    const db = makeGraph([
      { id: 'wpe-1', name: 'liveinstall', installId: 'id-1' },
      { id: 'wpe-2', name: 'jpmeautoscale', installId: 'id-gone' },
    ]);
    const { service } = makeService(db);

    const n = (service as any).reconcileMissingInstalls(new Set(['id-1']));

    expect(n).toBe(1);
    expect(active(db)).toEqual(['liveinstall']);
  });

  // The counterpart. Without it, "deactivate everything" passes the case above
  // and one sync would empty the fleet.
  test('is left alone when CAPI still lists it', () => {
    const db = makeGraph([
      { id: 'wpe-1', name: 'liveinstall', installId: 'id-1' },
      { id: 'wpe-2', name: 'alsolive', installId: 'id-2' },
    ]);
    const { service } = makeService(db);

    const n = (service as any).reconcileMissingInstalls(new Set(['id-1', 'id-2']));

    expect(n).toBe(0);
    expect(active(db)).toEqual(['alsolive', 'liveinstall']);
  });
});

/**
 * The refusals. Deactivating a live fleet because a fetch came back thin is a
 * far worse failure than leaving 73 dead rows in place, so each of these is a
 * hard stop rather than a heuristic.
 */
describe('reconcileMissingInstalls — when not to act', () => {
  test('an empty CAPI list deactivates nothing', () => {
    const db = makeGraph([
      { id: 'wpe-1', name: 'liveinstall', installId: 'id-1' },
      { id: 'wpe-2', name: 'alsolive', installId: 'id-2' },
    ]);
    const { service, logger } = makeService(db);

    const n = (service as any).reconcileMissingInstalls(new Set());

    expect(n).toBe(0);
    expect(active(db)).toHaveLength(2);
    // The half-the-fleet breaker would also refuse this, so the message is
    // what distinguishes the two: an empty list means the FETCH is suspect,
    // not that the fleet shrank. Someone reading the log needs to know which.
    const said = logger.warn.mock.calls.flat().join(' ');
    expect(said).toMatch(/CAPI returned no installs/i);
    expect(said).not.toMatch(/truncated response/i);
  });

  test('a row with no remote_install_id is never judged', () => {
    // Nothing to match against CAPI, so absence proves nothing about it.
    const db = makeGraph([
      { id: 'wpe-1', name: 'liveinstall', installId: 'id-1' },
      { id: 'wpe-2', name: 'noidrow', installId: null },
    ]);
    const { service } = makeService(db);

    const n = (service as any).reconcileMissingInstalls(new Set(['id-1']));

    expect(n).toBe(0);
    expect(active(db)).toContain('noidrow');
  });

  test('refuses when it would deactivate more than half the fleet', () => {
    // The signature of a truncated CAPI response, not of a shrinking fleet.
    const db = makeGraph([
      { id: 'wpe-1', name: 'a', installId: 'id-1' },
      { id: 'wpe-2', name: 'b', installId: 'id-2' },
      { id: 'wpe-3', name: 'c', installId: 'id-3' },
      { id: 'wpe-4', name: 'd', installId: 'id-4' },
    ]);
    const { service, logger } = makeService(db);

    const n = (service as any).reconcileMissingInstalls(new Set(['id-1']));

    expect(n).toBe(0);
    expect(active(db)).toHaveLength(4);
    expect(logger.warn.mock.calls.flat().join(' ')).toMatch(/refus/i);
  });

  test('an already-inactive row is not recounted', () => {
    const db = makeGraph([
      { id: 'wpe-1', name: 'liveinstall', installId: 'id-1' },
      { id: 'wpe-2', name: 'alreadygone', installId: 'id-gone', active: 0 },
    ]);
    const { service } = makeService(db);

    expect((service as any).reconcileMissingInstalls(new Set(['id-1']))).toBe(0);
  });
});

/**
 * Wiring. A private method that is never called is the failure mode this
 * codebase has been bitten by before (`services.operationAuditLog` was
 * declared and never assigned, so every `?.log()` silently no-opped and no
 * audit file was ever written). These drive the real `syncAllWPESites`.
 */
describe('syncAllWPESites — reconciliation is actually wired in', () => {
  function harness(db: any, capiInstalls: any[], opts: any = {}) {
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    const service = new WPESyncService({
      graphService: {
        getDb: () => db,
        upsertSite: jest.fn().mockResolvedValue(undefined),
        upsertAccount: jest.fn().mockResolvedValue(undefined),
      } as any,
      localServices: {
        isCAPIAvailable: () => true,
        capiGetInstalls: async () => capiInstalls,
        capiGetAccounts: async () => [],
        remoteWpCliRun: jest.fn().mockResolvedValue({ stdout: '', success: true }),
      } as any,
      logger,
      ...opts,
    });
    return { service, logger };
  }

  const capi = (id: string, name: string) => ({
    id, name, environment: 'production', account: { id: 'acct-1' },
  });

  test('a deleted install is retired by a real fleet sync, and reported', async () => {
    const db = makeGraph([
      { id: 'wpe-1', name: 'liveinstall', installId: 'id-1' },
      { id: 'wpe-2', name: 'jpmeautoscale', installId: 'id-gone' },
    ]);
    const { service } = harness(db, [capi('id-1', 'liveinstall')]);

    // A huge staleness threshold keeps the sync loop from doing remote work;
    // reconciliation runs before that filter and is what is under test.
    const res = await service.syncAllWPESites(undefined, 100000);

    expect(res.deactivated).toBe(1);
    expect(active(db)).toEqual(['liveinstall']);
  });

  /**
   * The one that matters most. `installs` is narrowed by the account filter a
   * few lines after the fetch; reconciling from the narrowed list would retire
   * every install belonging to any other account.
   */
  test('an account-filtered sync does not retire other accounts installs', async () => {
    const db = makeGraph([
      { id: 'wpe-1', name: 'acctone', installId: 'id-1' },
      { id: 'wpe-2', name: 'accttwo', installId: 'id-2' },
    ]);
    const { service } = harness(db, [
      { id: 'id-1', name: 'acctone', environment: 'production', account: { id: 'acct-1' } },
      { id: 'id-2', name: 'accttwo', environment: 'production', account: { id: 'acct-2' } },
    ]);

    const res = await service.syncAllWPESites(undefined, 100000, ['acct-1']);

    expect(res.deactivated).toBe(0);
    expect(active(db)).toEqual(['acctone', 'accttwo']);
  });
});
