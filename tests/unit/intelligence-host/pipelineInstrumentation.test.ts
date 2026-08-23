/**
 * The chokepoints actually record (plan 2026-08-23).
 *
 * These drive the REAL services — WPESyncService, ContentPipeline — with the
 * real intelligence core installed in the registry, and assert on the ledger.
 * A producer that exists but is never called is this codebase's canonical
 * silent failure (`services.operationAuditLog` was declared, never assigned,
 * and no audit file was ever written); these tests are the guard against the
 * pipeline recorder joining it.
 */
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';
import { initIntelligenceCore, type IntelligenceCore } from '../../../src/main/intelligence-host/bootstrap';
import { setIntelligenceCore } from '../../../src/main/intelligence-host/coreRegistry';
import { WPESyncService } from '../../../src/main/events/WPESyncService';
import { ContentPipeline } from '../../../src/main/content/ContentPipeline';
import { IndexRegistry } from '../../../src/main/content/IndexRegistry';

jest.mock('../../../src/main/transport/WpeSshTransport', () => ({
  WpeSshTransport: jest.fn().mockImplementation((installName: string) => ({
    siteRef: { kind: 'wpe', installName },
    runWpCli: jest.fn(),
    closeMaster: jest.fn(async () => undefined),
  })),
}));

function makeCore(): IntelligenceCore {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intel-instr-'));
  const kv = new Map<string, unknown>();
  return initIntelligenceCore({
    storage: { get: (k) => kv.get(k) ?? null, set: (k, v) => kv.set(k, v) },
    logger: { info: () => {}, error: () => {} },
    dataDir: dir,
  })!;
}

function pipelineEvents(core: IntelligenceCore) {
  return core.ledger
    .query({ topicPrefix: 'task.run.' })
    .filter((e) => e.schema === 'pipeline.run/1')
    .map((e) => e.payload as Record<string, unknown>);
}

let core: IntelligenceCore;
beforeEach(() => {
  core = makeCore();
  setIntelligenceCore(core);
});
afterEach(() => {
  setIntelligenceCore(undefined as never);
});

// ---------------------------------------------------------------------------
// WPE — L3 chokepoint (indexOneWpeContent) + the L2 piggyback
// ---------------------------------------------------------------------------

function makeWpeGraph(rows: Array<{ id: string; name: string }>) {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE sites (
    id TEXT PRIMARY KEY, name TEXT, source TEXT, is_active INTEGER,
    php_version TEXT, domain TEXT, account_id TEXT, remote_install_id TEXT, environment TEXT
  )`);
  const ins = db.prepare(
    "INSERT INTO sites (id,name,source,is_active,domain,environment) VALUES (?,?,'wpe',1,'x.wpengine.com','production')",
  );
  for (const r of rows) ins.run(r.id, r.name);
  return db;
}

function makeWpeService(extract: () => Promise<unknown>) {
  const db = makeWpeGraph([{ id: 'wpe-abc', name: 'dbrains' }]);
  return new WPESyncService({
    graphService: {
      getDb: () => db,
      upsertContent: jest.fn().mockResolvedValue(undefined),
      upsertSite: jest.fn().mockResolvedValue(undefined),
    } as never,
    localServices: { remoteWpCliRun: jest.fn().mockResolvedValue({ stdout: '', success: true }) } as never,
    remoteContentExtractor: { extract: jest.fn(extract) } as never,
    embeddingService: { embedBatch: jest.fn(async (xs: unknown[]) => xs.map(() => [0.1])) } as never,
    vectorStore: { upsert: jest.fn().mockResolvedValue(undefined) } as never,
    indexRegistry: new IndexRegistry({ get: () => undefined, set: () => undefined } as never),
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  });
}

const POST = {
  id: 1, postType: 'post', title: 'Hello', postStatus: 'publish',
  author: '1', date: '2026-01-01T00:00:00Z', cleanedContent: 'body', excerpt: '',
};

describe('WPE instrumentation', () => {
  test('a successful index records exactly one l3 ok run, with the trigger threaded', async () => {
    const service = makeWpeService(async () => ({ posts: [POST] }));

    await service.indexOneWpeContent('wpe-abc', 'scheduled');

    const l3 = pipelineEvents(core).filter((p) => p.layer === 'l3');
    expect(l3).toHaveLength(1); // one run, one event — the double-emit failure mode
    expect(l3[0]).toMatchObject({ outcome: 'ok', trigger: 'scheduled', site_kind: 'wpe' });
    expect('reason' in l3[0]).toBe(false);
  });

  test('a zero-post site records l3 skip with the reason', async () => {
    const service = makeWpeService(async () => ({ posts: [] }));

    await service.indexOneWpeContent('wpe-abc');

    const l3 = pipelineEvents(core).filter((p) => p.layer === 'l3');
    expect(l3).toHaveLength(1);
    expect(l3[0]).toMatchObject({ outcome: 'skip', trigger: 'adhoc' });
    expect(typeof l3[0].reason).toBe('string');
  });

  test('an extraction failure records l3 fail with the transport reason', async () => {
    const service = makeWpeService(async () => { throw new Error('ssh: Connection refused'); });

    await expect(service.indexOneWpeContent('wpe-abc')).rejects.toThrow();

    const l3 = pipelineEvents(core).filter((p) => p.layer === 'l3');
    expect(l3).toHaveLength(1);
    expect(l3[0].outcome).toBe('fail');
    expect(l3[0].reason).toContain('Connection refused');
  });

  test('the fleet loop threads its trigger down to every recorded run', async () => {
    const service = makeWpeService(async () => ({ posts: [POST] }));

    await service.indexAllWpeContent('scheduled');

    const l3 = pipelineEvents(core).filter((p) => p.layer === 'l3');
    expect(l3).toHaveLength(1);
    // 'scheduled' must ARRIVE, not default — a silent fallback to 'adhoc'
    // makes every scheduler run read as a human action (the plan's named
    // failure mode).
    expect(l3[0].trigger).toBe('scheduled');
  });

  test('the content run piggybacks an l2 record on the same trigger', async () => {
    const service = makeWpeService(async () => ({ posts: [POST] }));

    await service.indexOneWpeContent('wpe-abc', 'scheduled');

    const l2 = pipelineEvents(core).filter((p) => p.layer === 'l2');
    // The piggyback metadata sync IS a real L2 run and records as one.
    expect(l2.length).toBeGreaterThanOrEqual(1);
    expect(l2[0].trigger).toBe('scheduled');
  });
});

// ---------------------------------------------------------------------------
// Local — L3 chokepoint (ContentPipeline.indexSite)
// ---------------------------------------------------------------------------

function makeLocalPipeline(over: Partial<Record<string, unknown>> = {}) {
  return new ContentPipeline({
    vectorStore: { upsert: jest.fn().mockResolvedValue(undefined) } as never,
    embeddingService: { embedBatch: jest.fn(async (xs: unknown[]) => xs.map(() => [0.1])) } as never,
    mysqlExtractor: (over.mysqlExtractor ?? {
      isAvailable: () => false,
      extract: async () => ({ posts: [] }),
    }) as never,
    fileScanner: { scan: async () => null } as never,
    indexRegistry: new IndexRegistry({ get: () => undefined, set: () => undefined } as never),
  });
}

describe('local instrumentation', () => {
  test('an error-shaped IndexResult records l3 fail — never ok (the WP-67 shape)', async () => {
    const pipeline = makeLocalPipeline(); // MySQL unavailable → errors[] populated

    await pipeline.indexSite({ siteId: 'Ck3bTFmxY', siteName: 's', sitePath: '/tmp/s' } as never, 'lifecycle');

    const l3 = pipelineEvents(core).filter((p) => p.layer === 'l3');
    expect(l3).toHaveLength(1);
    expect(l3[0]).toMatchObject({ outcome: 'fail', trigger: 'lifecycle', site_kind: 'local' });
    expect(l3[0].reason).toContain('MySQL not available');
  });

  test('a cancelled run records skip, not fail', async () => {
    // Cancellation is checked after the file scan, so the cancel must land
    // there — cancelling later (e.g. during extract) is unobserved until the
    // next checkpoint, which the zero-post path never reaches.
    const pipeline: ContentPipeline = makeLocalPipeline({});
    (pipeline as never as { deps: { fileScanner: unknown } }).deps.fileScanner = {
      scan: async () => {
        await pipeline.cancelSite('Ck3bTFmxY');
        return null;
      },
    };

    await pipeline.indexSite({ siteId: 'Ck3bTFmxY', siteName: 's', sitePath: '/tmp/s' } as never);

    const l3 = pipelineEvents(core).filter((p) => p.layer === 'l3');
    expect(l3).toHaveLength(1);
    expect(l3[0]).toMatchObject({ outcome: 'skip', reason: 'cancelled' });
  });
});

// ---------------------------------------------------------------------------
// The failure mode that kills observability silently: no core.
// ---------------------------------------------------------------------------

test('with no core installed, every chokepoint still works — recording is never load-bearing', async () => {
  setIntelligenceCore(undefined as never);
  const service = makeWpeService(async () => ({ posts: [POST] }));

  await expect(service.indexOneWpeContent('wpe-abc')).resolves.toEqual({ ran: true });
});
