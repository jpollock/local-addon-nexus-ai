/**
 * WP-22b · the channel itself, driven through `registerIpcHandlers`.
 *
 * The packet's whole deliverable is ONE IPC registration, so the registration is
 * what this pins — through the real handler table, not a call to the module the
 * handler wraps. A module that works and a channel nobody registered is exactly the
 * failure this repo has hit before (`services.operationAuditLog`: declared, never
 * assigned, silently no-opped on every machine).
 *
 * Same harness as `intelligence-host/__tests__/siteFinderTwins.test.ts`: a mock
 * `ipcMain` collects the handlers, `registerIpcHandlers` fills it, and the channel is
 * invoked the way the renderer invokes it.
 */
class MockIpcMain {
  handlers = new Map<string, Function>();
  handle(channel: string, handler: Function) { this.handlers.set(channel, handler); }
  on() { /* sync channels irrelevant here */ }
  removeHandler(channel: string) { this.handlers.delete(channel); }
  removeAllListeners() { /* no-op in tests */ }
  invoke(channel: string, ...args: any[]) {
    const handler = this.handlers.get(channel);
    if (!handler) throw new Error(`No handler registered for ${channel}`);
    return handler({}, ...args);
  }
}
const mockIpc = new MockIpcMain();
jest.mock('electron', () => ({ ipcMain: mockIpc, shell: { openPath: jest.fn() }, app: { getPath: () => '/tmp' } }));

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { registerIpcHandlers } from '../../../src/main/ipc-handlers';
import { IPC_CHANNELS } from '../../../src/common/constants';
import { initIntelligenceCore, IntelligenceCore } from '../../../src/main/intelligence-host/bootstrap';
import { setIntelligenceCore } from '../../../src/main/intelligence-host/coreRegistry';
import {
  provisionalEnvironmentId,
  provisionalSiteId,
} from '../../../src/main/intelligence-host/provisionalEntity';

const LOCAL_SITE = 'loc-alpine';
const COPY = provisionalEnvironmentId(LOCAL_SITE);
const SITE = provisionalSiteId(LOCAL_SITE);
const PROD = provisionalEnvironmentId('wpe-alpine-prod');
const DAY = 86_400_000;

let core: IntelligenceCore;
let dir: string;

function makeDeps() {
  const noop = () => {};
  return {
    siteData: {
      getSite: (id: string) => (id === LOCAL_SITE ? { id, name: 'Alpine Outfitters' } : null),
      getSites: () => ({ [LOCAL_SITE]: { id: LOCAL_SITE, name: 'Alpine Outfitters' } }),
    },
    localServicesBridge: { getAllSiteStatuses: () => ({}), getThemes: async () => [] },
    indexRegistry: { listAll: () => [], get: () => null, update: noop },
    embeddingService: {},
    contentPipeline: {},
    vectorStore: {},
    registryStorage: { get: () => null, set: noop },
    localLogger: { info: noop, warn: noop, error: noop, debug: noop },
    getMcpServer: () => null,
    getStartupStatus: () => ({ ready: true, phase: 'ready' }),
    graphService: {
      getDb: () => null,
      listSites: async () => [
        { id: 'wpe-alpine-prod', name: 'alpine-prod', source: 'wpe', environment: 'production' },
      ],
    },
    eventProcessor: {},
    vectorDbPath: '/tmp/nexus-test-vectors.db',
    nexusServices: {
      twinService: { getAll: () => [] },
      graphService: {
        listSites: async () => [
          { id: 'wpe-alpine-prod', name: 'alpine-prod', source: 'wpe', environment: 'production' },
        ],
      },
    },
  } as any;
}

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp22b-ipc-'));
  const kv = new Map<string, unknown>();
  core = initIntelligenceCore({
    storage: { get: (k) => kv.get(k) ?? null, set: (k, v) => kv.set(k, v) },
    logger: { info: () => {}, error: () => {} },
    dataDir: dir,
  })!;

  const e = core.entities!;
  e.ensure('env', 'local.site_id', LOCAL_SITE);
  e.ensure('site', 'local.site_id.logical', LOCAL_SITE);
  e.link(SITE, COPY, 'has_working_copy', 1.0, 'user_link');
  e.link(SITE, COPY, 'has_environment', 1.0, 'user_link');
  e.link(SITE, PROD, 'has_environment', 0.95, 'host_connection');
  core.emitter.emit({
    observed_at: new Date(Date.now() - 11 * DAY).toISOString(),
    topic: 'episodic.sync.pulled',
    schema: 'sync.observed/1',
    entity: { site: SITE, environment: PROD, working_copy: COPY },
    actor: { id: 'act_seed', kind: 'system' },
    source: { class: 'work', system: 'local:sync', trust: 'observed' },
    payload: { flow: 'full', direction: 'down', includes_db: true },
  });

  mockIpc.handlers.clear();
  registerIpcHandlers(makeDeps());
});

afterAll(() => {
  core?.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('nexus-ai:site:content-status', () => {
  it('is registered — a module nothing wired up is not a feature', () => {
    expect(mockIpc.handlers.has(IPC_CHANNELS.GET_SITE_CONTENT_STATUS)).toBe(true);
  });

  it('answers null while nothing is recording, without failing the call', async () => {
    // The core is created but NOT registered yet: this is the shipped default state
    // for a user whose intelligence layer failed to start, and the renderer must get
    // an answer rather than a rejected invoke.
    await expect(
      mockIpc.invoke(IPC_CHANNELS.GET_SITE_CONTENT_STATUS, LOCAL_SITE)
    ).resolves.toBeNull();
  });

  it('carries the content slice back once the core is recording', async () => {
    setIntelligenceCore(core);
    const status = await mockIpc.invoke(IPC_CHANNELS.GET_SITE_CONTENT_STATUS, LOCAL_SITE);

    expect(status.state).toBe('pulled');
    expect(status.sourceName).toBe('the live site');
    expect(status.behindSeconds).toBeGreaterThan(10.9 * 86_400);
  });

  it('answers null for an id Local does not know, and for no id at all', async () => {
    await expect(mockIpc.invoke(IPC_CHANNELS.GET_SITE_CONTENT_STATUS, 'nope')).resolves.toBeNull();
    await expect(mockIpc.invoke(IPC_CHANNELS.GET_SITE_CONTENT_STATUS, undefined)).resolves.toBeNull();
  });
});
