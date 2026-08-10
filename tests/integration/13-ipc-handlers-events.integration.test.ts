/**
 * Integration tests for Event Tracking IPC handlers (Sprint 1)
 */
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { GraphService } from '../../src/main/events/GraphService';
import { EventProcessor } from '../../src/main/events/EventProcessor';
import { SqliteVecStore } from '../../src/main/vector-store/SqliteVecStore';
import { EmbeddingService } from '../../src/main/embeddings/EmbeddingService';
import { IPC_CHANNELS, STORAGE_KEYS, EMBEDDING_MODELS } from '../../src/common/constants';
import type { EventTimelineEntry, EventStats, StartupStatus } from '../../src/common/types';

const PROJECT_ROOT = path.join(__dirname, '..', '..');
const MODELS_DIR = path.join(PROJECT_ROOT, 'models', 'all-MiniLM-L6-v2-quantized');

/**
 * Mock ipcMain that stores handlers we can call manually
 */
class MockIpcMain {
  private handlers: Map<string, Function> = new Map();
  private syncHandlers: Map<string, Function> = new Map();

  handle(channel: string, handler: Function) {
    this.handlers.set(channel, handler);
  }

  on(channel: string, handler: Function) {
    this.syncHandlers.set(channel, handler);
  }

  // Pre-existing drift (unrelated to this task): registerIpcHandlers now calls
  // ipcMain.removeAllListeners(ACTIVITY_FILTER) before re-registering it
  // (hot-reload guard), which this mock didn't implement.
  removeAllListeners(channel: string) {
    this.syncHandlers.delete(channel);
  }

  async invokeHandler(channel: string, ...args: any[]): Promise<any> {
    const handler = this.handlers.get(channel);
    if (!handler) throw new Error(`No handler registered for ${channel}`);
    return handler({}, ...args);
  }

  hasHandler(channel: string): boolean {
    return this.handlers.has(channel) || this.syncHandlers.has(channel);
  }
}

// Mock electron before importing ipc-handlers.
// `virtual: true` because 'electron' is a peerDependency (never installed in
// node_modules — this addon runs inside Local's own Electron, it doesn't
// bundle one) and the integration jest config has no moduleNameMapper for it
// (unlike the unit config, which maps it to tests/__mocks__/electron.ts).
// Pre-existing gap, unrelated to this task: without `virtual: true` this mock
// fails to resolve and the whole suite fails to even load.
const mockIpc = new MockIpcMain();
jest.mock('electron', () => ({
  ipcMain: mockIpc,
}), { virtual: true });

// NOW import the module that depends on electron
import { registerIpcHandlers, IpcHandlerDeps } from '../../src/main/ipc-handlers';

describe('Event Tracking IPC Handlers (Sprint 1)', () => {
  let tmpDir: string;
  let graphDbPath: string;
  let vectorDbPath: string;
  let graphService: GraphService;
  let eventProcessor: EventProcessor;
  let vectorStore: SqliteVecStore;
  let embeddingService: EmbeddingService;
  // Hoisted out of beforeAll (rather than a local const there) so individual
  // tests can mutate it in place to prove the refreshEnabled *mapping* itself
  // — not just a value that happens to move in lockstep with it. mockStorage.get
  // below always returns this same object reference.
  let mockSettings: Record<string, unknown>;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-ipc-events-'));
    graphDbPath = path.join(tmpDir, 'graph.db');
    vectorDbPath = path.join(tmpDir, 'vectors.db');

    // Initialize services
    graphService = new GraphService(graphDbPath);
    await graphService.initialize();

    vectorStore = new SqliteVecStore(vectorDbPath);
    await vectorStore.initialize();

    // Pre-existing drift (unrelated to this task): EmbeddingService's constructor
    // gained `dimensions`/`contextWindow` params when per-site embedding model
    // choice was added (see NexusSettings.embeddingModel). MODELS_DIR points at
    // the 'minilm' model directory, so its config is the correct match.
    embeddingService = new EmbeddingService(
      MODELS_DIR,
      EMBEDDING_MODELS.minilm.dimensions,
      EMBEDDING_MODELS.minilm.contextWindow,
    );
    await embeddingService.initialize();

    eventProcessor = new EventProcessor({
      graphService,
      vectorStore,
      embeddingService,
      logger: console,
    });
    await eventProcessor.initialize();

    // Create mock dependencies
    const mockSiteData = {
      getSite: (id: string) => ({ id, name: `Site ${id}`, domain: `${id}.local` }),
      getSites: () => ({}),
    };

    const mockBridge = {
      getAllSiteStatuses: () => ({}),
      isCAPIAvailable: () => false,
      startSite: async () => {},
      stopSite: async () => {},
    };

    const mockRegistry = {
      listAll: () => [],
      get: () => null,
      update: () => {},
    };

    const mockContentPipeline = {
      indexSite: async () => ({ documentsIndexed: 0, chunksIndexed: 0, durationMs: 0, errors: [] }),
    };

    // EVENTS_GET_STATS now rolls up four health signals (see collectSystemHealth),
    // not just the event queue. `autoIndex: true` here is the REAL gate on the
    // `siteStarted` lifecycle hook that writes `sites.last_sync_at` for local
    // sites — it's what makes the local `test-site` inserted by the tests below
    // count as "refresh enabled" for the sync-staleness signal, so tests can
    // reach an 'ok' baseline and isolate the event-queue-driven state changes
    // they're actually about.
    //
    // `localContentIndexAutoEnabled` is deliberately left `false` here, NOT
    // because it should be off in practice, but so the baseline itself pins the
    // mapping: `getSyncAges` in ipc-handlers.ts must read `autoIndex`, not
    // `localContentIndexAutoEnabled` (which gates a different scheduler,
    // `OpportunisticScheduler`, that never touches `last_sync_at` at all — see
    // the comment above `getSyncAges`). If that mapping ever regresses back to
    // `localContentIndexAutoEnabled`, refreshEnabled goes false for `test-site`
    // and every test below that expects a clean 'ok'/'degraded'/'failing'
    // baseline (not just the two dedicated mapping tests) fails immediately.
    //
    // Everything else in ipc-handlers.ts that reads STORAGE_KEYS.SETTINGS via
    // this mock (none of the six handler groups exercised in this file do) is
    // unaffected — non-SETTINGS keys still read null.
    mockSettings = {
      autoIndex: true,
      excludedSiteIds: [],
      localContentIndexAutoEnabled: false,
    };
    const mockStorage = {
      get: (key: string) => (key === STORAGE_KEYS.SETTINGS ? mockSettings : null),
      set: () => {},
    };

    // Minimal agent registry / state store so `getAgents` resolves to a single
    // successful run ('ok') instead of throwing ('unknown') — same shape the
    // real `agentStatus` GraphQL resolver and the EVENTS_GET_STATS handler
    // both consume (registry.list() + store.getLastRun(name)).
    const mockAgentRegistry = {
      list: () => [{ name: 'test-agent', triggers: [] }],
    };
    const mockAgentStateStore = {
      getLastRun: () => ({ status: 'success', startedAt: Date.now() - 1000, finishedAt: Date.now() }),
    };
    // No configured connections — collectSystemHealth's credentials gatherer
    // treats zero rows as 'ok' ("vacuously nothing is broken"), deliberately
    // distinct from the zero-agents / zero-sites 'unknown' cases.
    const mockCredentialManager = {
      listConnections: () => [],
      listApiKeyConnections: () => [],
    };

    const deps: IpcHandlerDeps = {
      siteData: mockSiteData,
      localServicesBridge: mockBridge as any,
      indexRegistry: mockRegistry as any,
      embeddingService,
      contentPipeline: mockContentPipeline as any,
      vectorStore,
      registryStorage: mockStorage,
      localLogger: console,
      getMcpServer: () => null,
      // Pre-existing drift (unrelated to this task): IpcHandlerDeps gained this
      // required field for the startup-status dashboard hint.
      getStartupStatus: (): StartupStatus => ({ ready: true, phase: null, error: null }),
      graphService,
      eventProcessor,
      vectorDbPath,
      nexusServices: {
        agentRegistry: mockAgentRegistry,
        agentStateStore: mockAgentStateStore,
        credentialManager: mockCredentialManager,
      },
    };

    // Register handlers
    registerIpcHandlers(deps);
  }, 120000);

  afterAll(async () => {
    await graphService?.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // Clean up database after each test
  afterEach(async () => {
    const db = (graphService as any).db;
    db.prepare('DELETE FROM event_queue').run();
    db.prepare('DELETE FROM sites').run();
  });

  describe('EVENTS_GET_TIMELINE', () => {
    beforeEach(async () => {
      // Insert test site
      await graphService.upsertSite({
        id: 'test-site',
        name: 'Test Site',
        domain: 'test.local',
        is_active: true,
        created_at: Date.now(),
        updated_at: Date.now(),
      });
    });

    test('should return empty timeline when no events', async () => {
      const result = await mockIpc.invokeHandler(IPC_CHANNELS.EVENTS_GET_TIMELINE);

      expect(result.success).toBe(true);
      expect(result.events).toEqual([]);
    });

    test('should return timeline with events', async () => {
      // Insert events directly into graph service
      const db = (graphService as any).db;
      db.prepare(`
        INSERT INTO event_queue (site_id, event_type, payload, status, created_at, retry_count)
        VALUES (?, ?, ?, ?, ?, 0)
      `).run('test-site', 'plugin_activated', JSON.stringify({ slug: 'akismet' }), 'processed', Date.now());

      const result = await mockIpc.invokeHandler(IPC_CHANNELS.EVENTS_GET_TIMELINE);

      expect(result.success).toBe(true);
      expect(result.events).toHaveLength(1);
      expect(result.events[0].eventType).toBe('plugin_activated');
      expect(result.events[0].siteName).toBe('Site test-site');
      expect(result.events[0].summary).toContain('Plugin Activated');
    });

    test('should filter by event type', async () => {
      const db = (graphService as any).db;
      const now = Date.now();

      db.prepare(`
        INSERT INTO event_queue (site_id, event_type, payload, status, created_at, retry_count)
        VALUES (?, ?, ?, ?, ?, 0)
      `).run('test-site', 'plugin_activated', JSON.stringify({ slug: 'test' }), 'processed', now);

      db.prepare(`
        INSERT INTO event_queue (site_id, event_type, payload, status, created_at, retry_count)
        VALUES (?, ?, ?, ?, ?, 0)
      `).run('test-site', 'post_created', JSON.stringify({ post_id: 1 }), 'processed', now + 1000);

      const result = await mockIpc.invokeHandler(IPC_CHANNELS.EVENTS_GET_TIMELINE, {
        filter: 'plugin_activated',
      });

      expect(result.success).toBe(true);
      expect(result.events).toHaveLength(1);
      expect(result.events[0].eventType).toBe('plugin_activated');
    });

    test('should filter by status', async () => {
      const db = (graphService as any).db;
      const now = Date.now();

      db.prepare(`
        INSERT INTO event_queue (site_id, event_type, payload, status, created_at, retry_count)
        VALUES (?, ?, ?, ?, ?, 0)
      `).run('test-site', 'post_created', JSON.stringify({}), 'pending', now);

      db.prepare(`
        INSERT INTO event_queue (site_id, event_type, payload, status, created_at, retry_count)
        VALUES (?, ?, ?, ?, ?, 0)
      `).run('test-site', 'post_updated', JSON.stringify({}), 'processed', now + 1000);

      const result = await mockIpc.invokeHandler(IPC_CHANNELS.EVENTS_GET_TIMELINE, {
        status: 'pending',
      });

      expect(result.success).toBe(true);
      expect(result.events).toHaveLength(1);
      expect(result.events[0].status).toBe('pending');
    });

    test('should respect limit parameter', async () => {
      const db = (graphService as any).db;
      const now = Date.now();

      for (let i = 0; i < 10; i++) {
        db.prepare(`
          INSERT INTO event_queue (site_id, event_type, payload, status, created_at, retry_count)
          VALUES (?, ?, ?, ?, ?, 0)
        `).run('test-site', 'post_created', JSON.stringify({ post_id: i }), 'processed', now + i);
      }

      const result = await mockIpc.invokeHandler(IPC_CHANNELS.EVENTS_GET_TIMELINE, {
        limit: 5,
      });

      expect(result.success).toBe(true);
      expect(result.events).toHaveLength(5);
    });

    // Task 12 (nexus-ux-foundation): pins the REAL row shape end to end.
    // event_queue has no post_type/action column — only event_type and a
    // JSON `payload`. isNoiseEvent's own unit tests (timeline-filter.test.ts)
    // can only prove the pure function is correct for whatever shape they're
    // handed; they cannot catch a bug in ipc-handlers.ts's extraction glue
    // (e.g. reading e.post_type instead of e.payload.post_type). This test
    // inserts a raw event_queue row exactly as the WP MU plugin's webhook
    // would, and asserts on EVENTS_GET_TIMELINE's actual output — so a
    // regression in the handler's field extraction fails HERE, not silently.
    test('filters WordPress background churn (auto-draft, revision) but keeps real content changes', async () => {
      const db = (graphService as any).db;
      const now = Date.now();

      const autoDraftPayload = {
        post_id: 1,
        post_type: 'post',
        title: '',
        status: 'auto-draft',
        author_id: 1,
        created_at: now,
        updated_at: now,
      };
      const revisionPayload = {
        post_id: 2,
        post_type: 'revision',
        title: 'Hello World',
        status: 'inherit',
        author_id: 1,
        created_at: now,
        updated_at: now,
      };
      const publishedPayload = {
        post_id: 3,
        post_type: 'post',
        title: 'A Real Published Post',
        status: 'publish',
        author_id: 1,
        created_at: now,
        updated_at: now,
      };
      const pagePayload = {
        post_id: 4,
        post_type: 'page',
        title: 'About Us',
        status: 'publish',
        author_id: 1,
        created_at: now,
        updated_at: now,
      };

      db.prepare(`
        INSERT INTO event_queue (site_id, event_type, payload, status, created_at, retry_count)
        VALUES (?, ?, ?, ?, ?, 0)
      `).run('test-site', 'post_created', JSON.stringify(autoDraftPayload), 'processed', now);

      db.prepare(`
        INSERT INTO event_queue (site_id, event_type, payload, status, created_at, retry_count)
        VALUES (?, ?, ?, ?, ?, 0)
      `).run('test-site', 'post_created', JSON.stringify(revisionPayload), 'processed', now + 1000);

      db.prepare(`
        INSERT INTO event_queue (site_id, event_type, payload, status, created_at, retry_count)
        VALUES (?, ?, ?, ?, ?, 0)
      `).run('test-site', 'post_published', JSON.stringify(publishedPayload), 'processed', now + 2000);

      db.prepare(`
        INSERT INTO event_queue (site_id, event_type, payload, status, created_at, retry_count)
        VALUES (?, ?, ?, ?, ?, 0)
      `).run('test-site', 'post_updated', JSON.stringify(pagePayload), 'processed', now + 3000);

      const result = await mockIpc.invokeHandler(IPC_CHANNELS.EVENTS_GET_TIMELINE);

      expect(result.success).toBe(true);
      // Only the two real content changes survive — the auto-draft and the
      // revision are filtered. If the handler read e.post_type/e.action
      // (columns that don't exist on the row) instead of
      // e.payload?.post_type/e.payload?.status, this would be 4, not 2.
      expect(result.events).toHaveLength(2);
      const titles = result.events.map((ev: any) => ev.details.title).sort();
      expect(titles).toEqual(['A Real Published Post', 'About Us']);
    });
  });

  describe('EVENTS_GET_STATS', () => {
    beforeEach(async () => {
      await graphService.upsertSite({
        id: 'test-site',
        name: 'Test Site',
        domain: 'test.local',
        is_active: true,
        // Fresh sync timestamp — combined with `localContentIndexAutoEnabled:
        // true` in mockSettings above, this makes the sync-staleness signal
        // read 'ok' rather than 'degraded'/'unknown', so these tests isolate
        // the event-queue-driven state.
        last_sync_at: Date.now(),
        created_at: Date.now(),
        updated_at: Date.now(),
      });
    });

    test('should return stats with zero counts when no events', async () => {
      const result = await mockIpc.invokeHandler(IPC_CHANNELS.EVENTS_GET_STATS);

      expect(result.success).toBe(true);
      expect(result.stats.total).toBe(0);
      expect(result.stats.today).toBe(0);
      expect(result.stats.yesterday).toBe(0);
      expect(result.stats.pending).toBe(0);
      expect(result.stats.failed).toBe(0);
      // All four signals resolve ('ok') given the mocked agent/credential/sync
      // deps above, so the rollup reaches 'ok' — not just the event queue.
      expect(result.stats.healthStatus).toBe('ok');
      expect(result.stats.systemHealth.overall).toBe('ok');
    });

    test('EVENTS_GET_STATS returns a systemHealth rollup with all four signal inputs', async () => {
      const result = await mockIpc.invokeHandler(IPC_CHANNELS.EVENTS_GET_STATS);

      expect(result.success).toBe(true);
      expect(result.stats.systemHealth).toBeDefined();
      expect(result.stats.systemHealth.overall).toBe(result.stats.healthStatus);
      expect(result.stats.systemHealth.inputs.agentRuns.state).toBe('ok');
      expect(result.stats.systemHealth.inputs.syncStaleness.state).toBe('ok');
      expect(result.stats.systemHealth.inputs.credentials.state).toBe('ok');
      expect(result.stats.systemHealth.inputs.eventQueue.state).toBe('ok');
      expect(Array.isArray(result.stats.systemHealth.reasons)).toBe(true);
    });

    test('should count events correctly', async () => {
      const db = (graphService as any).db;
      const now = Date.now();

      // Add events
      db.prepare(`
        INSERT INTO event_queue (site_id, event_type, payload, status, created_at, retry_count)
        VALUES (?, ?, ?, ?, ?, 0)
      `).run('test-site', 'plugin_activated', JSON.stringify({}), 'processed', now);

      db.prepare(`
        INSERT INTO event_queue (site_id, event_type, payload, status, created_at, retry_count)
        VALUES (?, ?, ?, ?, ?, 0)
      `).run('test-site', 'post_created', JSON.stringify({}), 'pending', now);

      db.prepare(`
        INSERT INTO event_queue (site_id, event_type, payload, status, created_at, retry_count, error)
        VALUES (?, ?, ?, ?, ?, 0, ?)
      `).run('test-site', 'user_created', JSON.stringify({}), 'failed', now, 'Test error');

      const result = await mockIpc.invokeHandler(IPC_CHANNELS.EVENTS_GET_STATS);

      expect(result.success).toBe(true);
      expect(result.stats.total).toBe(3);
      expect(result.stats.pending).toBe(1);
      expect(result.stats.failed).toBe(1);
    });

    test('should set health status to failing when failed events exist', async () => {
      const db = (graphService as any).db;

      db.prepare(`
        INSERT INTO event_queue (site_id, event_type, payload, status, created_at, retry_count, error)
        VALUES (?, ?, ?, ?, ?, 0, ?)
      `).run('test-site', 'post_created', JSON.stringify({}), 'failed', Date.now(), 'Error');

      const result = await mockIpc.invokeHandler(IPC_CHANNELS.EVENTS_GET_STATS);

      expect(result.success).toBe(true);
      // 'failing' is the most severe state and wins the rollup regardless of
      // the other three signals.
      expect(result.stats.healthStatus).toBe('failing');
      expect(result.stats.systemHealth.inputs.eventQueue.state).toBe('failing');
    });

    test('should set health status to degraded when many pending events', async () => {
      const db = (graphService as any).db;
      const now = Date.now();

      for (let i = 0; i < 15; i++) {
        db.prepare(`
          INSERT INTO event_queue (site_id, event_type, payload, status, created_at, retry_count)
          VALUES (?, ?, ?, ?, ?, 0)
        `).run('test-site', 'post_created', JSON.stringify({}), 'pending', now + i);
      }

      const result = await mockIpc.invokeHandler(IPC_CHANNELS.EVENTS_GET_STATS);

      expect(result.success).toBe(true);
      expect(result.stats.pending).toBe(15);
      // The other three signals resolve 'ok' via the mocked deps, so 'degraded'
      // from the event queue is what drives the rollup here.
      expect(result.stats.healthStatus).toBe('degraded');
      expect(result.stats.systemHealth.inputs.eventQueue.state).toBe('degraded');
    });

    test('should group events by type', async () => {
      const db = (graphService as any).db;
      const now = Date.now();

      db.prepare(`
        INSERT INTO event_queue (site_id, event_type, payload, status, created_at, retry_count)
        VALUES (?, ?, ?, ?, ?, 0)
      `).run('test-site', 'plugin_activated', JSON.stringify({}), 'processed', now);

      db.prepare(`
        INSERT INTO event_queue (site_id, event_type, payload, status, created_at, retry_count)
        VALUES (?, ?, ?, ?, ?, 0)
      `).run('test-site', 'plugin_activated', JSON.stringify({}), 'processed', now + 1000);

      db.prepare(`
        INSERT INTO event_queue (site_id, event_type, payload, status, created_at, retry_count)
        VALUES (?, ?, ?, ?, ?, 0)
      `).run('test-site', 'post_created', JSON.stringify({}), 'processed', now + 2000);

      const result = await mockIpc.invokeHandler(IPC_CHANNELS.EVENTS_GET_STATS);

      expect(result.success).toBe(true);
      expect(result.stats.byType.plugin_activated).toBe(2);
      expect(result.stats.byType.post_created).toBe(1);
    });

    // These two tests deliberately DIVERGE autoIndex and localContentIndexAutoEnabled
    // (the shared baseline above keeps them apart on purpose, but these make the
    // divergence the entire point of the assertion) — the review that prompted
    // this fix round found that no existing test could distinguish "refreshEnabled
    // is gated by autoIndex" from "gated by localContentIndexAutoEnabled" because
    // every fixture moved the two together. These pin the mapping itself: each
    // fails if getSyncAges in ipc-handlers.ts is reading the wrong setting.
    describe('refreshEnabled mapping for local sites — pins autoIndex, not localContentIndexAutoEnabled', () => {
      afterEach(() => {
        // Restore the shared baseline so later tests in this file aren't affected.
        mockSettings.autoIndex = true;
        mockSettings.excludedSiteIds = [];
        mockSettings.localContentIndexAutoEnabled = false;
      });

      test('real gate OFF + wrong-mapping gate ON -> unknown, not ok (would be ok under the old, wrong mapping)', async () => {
        mockSettings.autoIndex = false; // real gate: off
        mockSettings.localContentIndexAutoEnabled = true; // wrong-mapping gate: on

        // test-site's last_sync_at is fresh (stamped Date.now() in this describe's
        // beforeEach) — under the WRONG mapping (localContentIndexAutoEnabled) this
        // would read refreshEnabled: true and syncStaleness: 'ok'. Under the correct
        // mapping (autoIndex) it must read unknown: nobody's actually refreshing it.
        const result = await mockIpc.invokeHandler(IPC_CHANNELS.EVENTS_GET_STATS);

        expect(result.stats.systemHealth.inputs.syncStaleness.state).toBe('unknown');
        expect(result.stats.systemHealth.inputs.syncStaleness.state).not.toBe('ok');
        expect(result.stats.systemHealth.inputs.syncStaleness.reason).toMatch(/background refresh is off/i);
      });

      test('real gate ON + wrong-mapping gate OFF, stale site -> degraded, not unknown (would be unknown under the old, wrong mapping)', async () => {
        mockSettings.autoIndex = true; // real gate: on
        mockSettings.localContentIndexAutoEnabled = false; // wrong-mapping gate: off

        // Make the site stale (2 days old) rather than fresh, so a correct
        // 'ok' vs 'degraded' distinction is visible too, not just presence/absence.
        const twoDaysAgo = Date.now() - 2 * 24 * 60 * 60 * 1000;
        await graphService.upsertSite({
          id: 'test-site',
          name: 'Test Site',
          domain: 'test.local',
          is_active: true,
          last_sync_at: twoDaysAgo,
          created_at: Date.now(),
          updated_at: Date.now(),
        });

        // Under the WRONG mapping (localContentIndexAutoEnabled: false) this would
        // read refreshEnabled: false and syncStaleness: 'unknown' ("background
        // refresh is off"). Under the correct mapping (autoIndex: true) it must
        // read 'degraded': something IS supposed to be refreshing it, and it hasn't.
        const result = await mockIpc.invokeHandler(IPC_CHANNELS.EVENTS_GET_STATS);

        expect(result.stats.systemHealth.inputs.syncStaleness.state).toBe('degraded');
        expect(result.stats.systemHealth.inputs.syncStaleness.state).not.toBe('unknown');
        expect(result.stats.systemHealth.inputs.syncStaleness.reason).toMatch(/not checked in over a day/i);
      });
    });
  });

  describe('STORAGE_GET_HEALTH', () => {
    test('should return storage health metrics', async () => {
      const result = await mockIpc.invokeHandler(IPC_CHANNELS.STORAGE_GET_HEALTH);

      expect(result.success).toBe(true);
      expect(result.health).toBeDefined();
      expect(result.health.graphDb).toBeDefined();
      expect(result.health.vectorDb).toBeDefined();
      expect(typeof result.health.graphDb.sizeBytes).toBe('number');
      expect(typeof result.health.pendingEvents).toBe('number');
      expect(typeof result.health.failedEvents).toBe('number');
    });
  });

  describe('ISSUES_DETECT', () => {
    beforeEach(async () => {
      await graphService.upsertSite({
        id: 'test-site',
        name: 'Test Site',
        domain: 'test.local',
        is_active: true,
        created_at: Date.now(),
        updated_at: Date.now(),
      });
    });

    test('should return empty issues when everything is healthy', async () => {
      const result = await mockIpc.invokeHandler(IPC_CHANNELS.ISSUES_DETECT);

      expect(result.success).toBe(true);
      expect(result.issues).toEqual([]);
    });

    test('should detect failed events', async () => {
      const db = (graphService as any).db;

      db.prepare(`
        INSERT INTO event_queue (site_id, event_type, payload, status, created_at, retry_count, error)
        VALUES (?, ?, ?, ?, ?, 0, ?)
      `).run('test-site', 'post_created', JSON.stringify({}), 'failed', Date.now(), 'Test error');

      const result = await mockIpc.invokeHandler(IPC_CHANNELS.ISSUES_DETECT);

      expect(result.success).toBe(true);
      expect(result.issues.length).toBeGreaterThan(0);
      const failedIssue = result.issues.find((i: any) => i.type === 'failed_events');
      expect(failedIssue).toBeDefined();
      expect(failedIssue.severity).toBe('error');
    });

    test('should detect stale sites', async () => {
      const eightDaysAgo = Date.now() - (8 * 24 * 60 * 60 * 1000);

      await graphService.upsertSite({
        id: 'stale-site',
        name: 'Stale Site',
        domain: 'stale.local',
        is_active: true,
        last_sync_at: eightDaysAgo,
        created_at: Date.now(),
        updated_at: Date.now(),
      });

      const result = await mockIpc.invokeHandler(IPC_CHANNELS.ISSUES_DETECT);

      expect(result.success).toBe(true);
      const staleIssue = result.issues.find((i: any) => i.type === 'stale_sites');
      expect(staleIssue).toBeDefined();
      expect(staleIssue.severity).toBe('warning');
    });
  });

  describe('STORAGE_CLEANUP', () => {
    beforeEach(async () => {
      await graphService.upsertSite({
        id: 'test-site',
        name: 'Test Site',
        domain: 'test.local',
        is_active: true,
        created_at: Date.now(),
        updated_at: Date.now(),
      });
    });

    test('should cleanup old events', async () => {
      const db = (graphService as any).db;
      const now = Date.now();
      const fortyDaysAgo = now - (40 * 24 * 60 * 60 * 1000);

      // Insert old event
      db.prepare(`
        INSERT INTO event_queue (site_id, event_type, payload, status, created_at, retry_count)
        VALUES (?, ?, ?, ?, ?, 0)
      `).run('test-site', 'post_created', JSON.stringify({}), 'processed', fortyDaysAgo);

      // Insert recent event
      db.prepare(`
        INSERT INTO event_queue (site_id, event_type, payload, status, created_at, retry_count)
        VALUES (?, ?, ?, ?, ?, 0)
      `).run('test-site', 'post_updated', JSON.stringify({}), 'processed', now);

      const result = await mockIpc.invokeHandler(IPC_CHANNELS.STORAGE_CLEANUP, {
        retentionDays: 30,
      });

      expect(result.success).toBe(true);
      expect(result.deletedCount).toBe(1);

      // Verify recent event still exists
      const remaining = db.prepare('SELECT COUNT(*) as count FROM event_queue').get() as any;
      expect(remaining.count).toBe(1);
    });

    test('should use default retention of 30 days', async () => {
      const result = await mockIpc.invokeHandler(IPC_CHANNELS.STORAGE_CLEANUP);

      expect(result.success).toBe(true);
      expect(typeof result.deletedCount).toBe('number');
    });
  });

  describe('EVENTS_RETRY_FAILED', () => {
    beforeEach(async () => {
      await graphService.upsertSite({
        id: 'test-site',
        name: 'Test Site',
        domain: 'test.local',
        is_active: true,
        created_at: Date.now(),
        updated_at: Date.now(),
      });
    });

    test('should return zero when no failed events', async () => {
      const result = await mockIpc.invokeHandler(IPC_CHANNELS.EVENTS_RETRY_FAILED);

      expect(result.success).toBe(true);
      expect(result.retriedCount).toBe(0);
    });

    test('should retry failed events', async () => {
      const db = (graphService as any).db;

      db.prepare(`
        INSERT INTO event_queue (site_id, event_type, payload, status, created_at, retry_count, error)
        VALUES (?, ?, ?, ?, ?, 0, ?)
      `).run('test-site', 'post_created', JSON.stringify({}), 'failed', Date.now(), 'Test error');

      const result = await mockIpc.invokeHandler(IPC_CHANNELS.EVENTS_RETRY_FAILED);

      expect(result.success).toBe(true);
      expect(result.retriedCount).toBe(1);
    });
  });

  test('All 6 Sprint 1 IPC channels are registered', () => {
    expect(mockIpc.hasHandler(IPC_CHANNELS.EVENTS_GET_TIMELINE)).toBe(true);
    expect(mockIpc.hasHandler(IPC_CHANNELS.EVENTS_GET_STATS)).toBe(true);
    expect(mockIpc.hasHandler(IPC_CHANNELS.STORAGE_GET_HEALTH)).toBe(true);
    expect(mockIpc.hasHandler(IPC_CHANNELS.ISSUES_DETECT)).toBe(true);
    expect(mockIpc.hasHandler(IPC_CHANNELS.STORAGE_CLEANUP)).toBe(true);
    expect(mockIpc.hasHandler(IPC_CHANNELS.EVENTS_RETRY_FAILED)).toBe(true);
  });
});
