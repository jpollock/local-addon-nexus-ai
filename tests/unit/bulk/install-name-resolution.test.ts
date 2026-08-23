/**
 * WP-68 — what reaches the SSH transport is the install name, never the site id.
 *
 * On 2026-08-22 all 365 WP Engine installs were handed their own graph id as an
 * install name and SSH'd to hosts that do not exist: 3.8 seconds for 365
 * installs, ~96 per second, nothing reaching WP Engine.
 *
 * These tests assert on the value that actually reaches `WpeSshTransport`'s
 * constructor — not on a mock's call args one layer above it, and not on a
 * return value that would look identical either way.
 *
 * Two operations x three scopes. All three scopes end at
 * `indexOneWpeContent`, so if one of them can be handed an id, all of them can.
 */
const transportTargets: string[] = [];
const closed: string[] = [];
jest.mock('../../../src/main/transport/WpeSshTransport', () => ({
  WpeSshTransport: jest.fn().mockImplementation((installName: string) => {
    transportTargets.push(installName);
    return {
      siteRef: { kind: 'wpe', installName },
      runWpCli: jest.fn(),
      closeMaster: jest.fn(async () => { closed.push(installName); }),
    };
  }),
}));

import Database from 'better-sqlite3';
import { WPESyncService } from '../../../src/main/events/WPESyncService';
import { BulkOperationManager } from '../../../src/main/bulk/BulkOperationManager';
import { IndexRegistry } from '../../../src/main/content/IndexRegistry';

const ID_A = 'wpe-e5944134-c8e7-4f23-aaab-a38d472f2c1f';
const NAME_A = 'dbrains';
const ID_B = 'wpe-9564d013-757d-4b18-8aa0-93bdd5fb9d99';
const NAME_B = 'sprntndntchmbr';

/** A real SQLite `sites` table — the lookup under test is a real query. */
function makeGraph(rows: Array<{ id: string; name: string | null; accountId?: string }>) {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE sites (
    id TEXT PRIMARY KEY, name TEXT, source TEXT, is_active INTEGER,
    php_version TEXT, domain TEXT, account_id TEXT, remote_install_id TEXT, environment TEXT
  )`);
  db.exec(`CREATE TABLE wpe_accounts (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, nickname TEXT,
    ssh_gateway TEXT, ssh_gateway_checked_at INTEGER
  )`);
  const ins = db.prepare(
    "INSERT INTO sites (id,name,source,is_active,domain,environment,account_id) VALUES (?,?,'wpe',1,'x.wpengine.com','production',?)",
  );
  for (const r of rows) ins.run(r.id, r.name, r.accountId ?? null);
  return db;
}

function makeService(
  rows: Array<{ id: string; name: string | null; accountId?: string }>,
  extract: () => Promise<any> = async () => ({
    posts: [{
      id: 1, postType: 'post', title: 'Hello', postStatus: 'publish',
      author: '1', date: '2026-01-01T00:00:00Z', cleanedContent: 'body text', excerpt: '',
    }],
  }),
) {
  const db = makeGraph(rows);
  const graphService: any = {
    getDb: () => db,
    upsertContent: jest.fn().mockResolvedValue(undefined),
    upsertSite: jest.fn().mockResolvedValue(undefined),
  };
  const service = new WPESyncService({
    graphService,
    localServices: { remoteWpCliRun: jest.fn().mockResolvedValue({ stdout: '', success: true }) } as any,
    remoteContentExtractor: { extract: jest.fn(extract) } as any,
    embeddingService: { embedBatch: jest.fn(async (xs: any[]) => xs.map(() => [0.1, 0.2])) } as any,
    vectorStore: { upsert: jest.fn().mockResolvedValue(undefined) } as any,
    indexRegistry: new IndexRegistry({ get: () => undefined, set: () => undefined } as any),
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  });
  return { service, graphService };
}

/**
 * The bulk manager wired exactly as `ipc-handlers.ts` wires it — the adapter is
 * one line there and it is reproduced here rather than mocked, because the
 * adapter's signature IS the fix.
 */
function makeManager(service: WPESyncService) {
  return new BulkOperationManager({
    contentPipeline: { indexSite: jest.fn() },
    siteDataBridge: {
      resolveSiteObject: () => null, getSiteStatus: () => 'running',
      startSite: jest.fn(), stopSite: jest.fn(), wpCliRun: jest.fn(),
      getPlugins: jest.fn(), getThemes: jest.fn(), getWpVersion: jest.fn(), getOption: jest.fn(),
    } as any,
    healthCalculator: { calculateScore: jest.fn() } as any,
    onProgress: jest.fn(),
    wpeOps: {
      syncSingleSite: jest.fn(),
      indexOne: (siteId: string) => service.indexOneWpeContent(siteId),
    },
  });
}

async function runBulk(manager: BulkOperationManager, siteIds: string[]) {
  // siteNames deliberately EMPTY — this is the condition that produced the
  // incident, and it is the normal condition in the main process:
  // `buildSiteNames` reads Local's store only, so a WP Engine id never gets an
  // entry there at all.
  const id = manager.execute({ type: 'reindex', siteIds, siteNames: {} });
  await manager.waitForCompletion(id);
  return manager.getStatus(id)!;
}

beforeEach(() => { transportTargets.length = 0; closed.length = 0; });

describe('WP-68 — the install name reaches the transport, for all three scopes', () => {
  test('scope: all sites', async () => {
    const { service } = makeService([{ id: ID_A, name: NAME_A }, { id: ID_B, name: NAME_B }]);

    const result = await service.indexAllWpeContent();

    expect(transportTargets.sort()).toEqual([NAME_A, NAME_B].sort());
    expect(transportTargets).not.toContain(ID_A);
    expect(result.indexed).toBe(2);
  });

  test('scope: selected sites', async () => {
    const { service } = makeService([{ id: ID_A, name: NAME_A }, { id: ID_B, name: NAME_B }]);

    const status = await runBulk(makeManager(service), [ID_A, ID_B]);

    expect(transportTargets.sort()).toEqual([NAME_A, NAME_B].sort());
    expect(transportTargets).not.toContain(ID_A);
    expect(status.siteResults[ID_A].status).toBe('completed');
    expect(status.siteResults[ID_B].status).toBe('completed');
  });

  test('scope: one site', async () => {
    const { service } = makeService([{ id: ID_A, name: NAME_A }]);

    const status = await runBulk(makeManager(service), [ID_A]);

    expect(transportTargets).toEqual([NAME_A]);
    expect(status.siteResults[ID_A].status).toBe('completed');
  });
});

/**
 * The counterpart cases. Without the three above, "throw on every name" would
 * pass every test in this block; without this block, "never validate" passes
 * the three above.
 */
describe('WP-68 — an unusable install name is refused, never substituted', () => {
  test('a missing name is an error, and nothing is dialled', async () => {
    const { service } = makeService([{ id: ID_A, name: null }]);

    await expect(service.indexOneWpeContent(ID_A)).rejects.toThrow('no install name in the graph');
    expect(transportTargets).toEqual([]);
  });

  // The measured failure: the graph's own `name` column held the site id.
  // Resolving "from the graph" is not sufficient on its own — the value has to
  // be checked, which is why removing the UI fallback alone would not have
  // caught this.
  test('a name equal to the site id is an error, and nothing is dialled', async () => {
    const { service } = makeService([{ id: ID_A, name: ID_A }]);

    await expect(service.indexOneWpeContent(ID_A)).rejects.toThrow('holds the site id as its install name');
    expect(transportTargets).toEqual([]);
  });

  test('a name equal to the bare install UUID is an error too', async () => {
    const { service } = makeService([{ id: ID_A, name: ID_A.replace(/^wpe-/, '') }]);

    await expect(service.indexOneWpeContent(ID_A)).rejects.toThrow('holds the site id as its install name');
    expect(transportTargets).toEqual([]);
  });

  test('an id with no active row is an error, not a guess', async () => {
    const { service } = makeService([]);

    await expect(service.indexOneWpeContent(ID_A)).rejects.toThrow('no active WP Engine install');
    expect(transportTargets).toEqual([]);
  });

  test('through the bulk seam, a refused name is a failure — not a silent success', async () => {
    const { service } = makeService([{ id: ID_A, name: ID_A }]);

    const status = await runBulk(makeManager(service), [ID_A]);

    expect(status.siteResults[ID_A].status).toBe('failed');
    expect(status.siteResults[ID_A].error).toContain('install name');
    expect(transportTargets).toEqual([]);
  });
});

/**
 * WP Engine allows FIVE concurrent SSH connections PER USER, account-wide, and
 * `ControlPersist` is ten minutes. A sweep visits each install once, so every
 * master it leaves open is quota it will never reuse. Measured 2026-08-23: 82
 * live sockets against a limit of 5, after which every further install was
 * refused at authentication in under 100ms.
 */
describe('WP-68 — a content sync hands its connection back', () => {
  test('the master is closed after a successful index', async () => {
    const { service } = makeService([{ id: ID_A, name: NAME_A }]);

    await service.indexOneWpeContent(ID_A);

    expect(closed).toEqual([NAME_A]);
  });

  test('the master is closed even when the read fails', async () => {
    const { service } = makeService([{ id: ID_A, name: NAME_A }], async () => {
      throw new Error('SSH connection refused');
    });

    await expect(service.indexOneWpeContent(ID_A)).rejects.toThrow();

    // A failure is exactly when the socket must not be left behind: a sweep
    // that leaks one per failure exhausts the quota fastest at its worst moment.
    expect(closed).toEqual([NAME_A]);
  });

  test('one connection is closed per install across a fleet sweep', async () => {
    const { service } = makeService([{ id: ID_A, name: NAME_A }, { id: ID_B, name: NAME_B }]);

    await service.indexAllWpeContent();

    expect(closed.sort()).toEqual([NAME_A, NAME_B].sort());
  });
});

/**
 * D15 — an install on a gateway-less account is a stated absence, not an
 * attempted-and-failed SSH connection. The AutoscaleAlpha account's 73
 * installs re-learned NXDOMAIN on every sweep before this.
 */
describe('D15 — a confirmed-absent SSH gateway is a skip, and nothing is dialled', () => {
  test('skip with the account named; no transport constructed', async () => {
    const { service, graphService } = makeService([{ id: ID_A, name: NAME_A, accountId: 'acct-auto' }]);
    graphService.getDb().prepare(
      "INSERT INTO wpe_accounts VALUES ('acct-auto','esm5z2bl7u8vqk','AutoscaleAlpha','unavailable',999)",
    ).run();

    const outcome = await service.indexOneWpeContent(ID_A);

    expect(outcome.ran).toBe(false);
    expect((outcome as { reason?: string }).reason).toContain('AutoscaleAlpha');
    expect((outcome as { reason?: string }).reason).toMatch(/no SSH gateway/i);
    expect(transportTargets).toEqual([]); // stated, not probed
  });

  // The counterpart: an UNKNOWN gateway status must not suppress work — only
  // a confirmed absence does, or a fresh install never gets its first try.
  test('an account with no verdict proceeds normally', async () => {
    const { service } = makeService([{ id: ID_A, name: NAME_A, accountId: 'acct-new' }]);

    const outcome = await service.indexOneWpeContent(ID_A);

    expect(outcome).toEqual({ ran: true });
    expect(transportTargets).toEqual([NAME_A]);
  });

  test('syncAllWPESites probes one install per account and records the verdict', async () => {
    const { service, graphService } = makeService([{ id: ID_A, name: NAME_A, accountId: 'acct-auto' }]);
    const db = graphService.getDb();
    db.prepare("INSERT INTO wpe_accounts VALUES ('acct-auto','esm5z2bl7u8vqk','AutoscaleAlpha',NULL,NULL)").run();

    const probed: string[] = [];
    const svc = new WPESyncService({
      graphService,
      localServices: {
        isCAPIAvailable: () => true,
        capiGetInstalls: async () => [
          { id: 'u1', name: 'jpmeautoscale', environment: 'production', account: { id: 'acct-auto' } },
          { id: 'u2', name: 'cnryws84as1', environment: 'production', account: { id: 'acct-auto' } },
        ],
        capiGetAccounts: async () => [],
        remoteWpCliRun: jest.fn().mockResolvedValue({ stdout: '', success: true }),
      } as never,
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
      dnsResolve: async (host: string) => {
        probed.push(host);
        throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' });
      },
    });

    await svc.syncAllWPESites(undefined, 100000);

    expect(probed).toEqual(['jpmeautoscale.ssh.wpengine.net']); // ONE probe per account
    const row = db.prepare("SELECT ssh_gateway FROM wpe_accounts WHERE id='acct-auto'").get() as { ssh_gateway: string };
    expect(row.ssh_gateway).toBe('unavailable');
  });
});
