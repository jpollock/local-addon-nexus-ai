/**
 * Regression coverage for Task 6: GET_DASHBOARD_STATS must return the
 * canonical `counts` figures from collectFleetCounts, and `remoteSites` must
 * carry a `scope` label explaining that `total` is CAPI-derived (link state),
 * not the graph's `counts.wpe`. Modeled on the existing
 * fleet-summary-external.test.ts harness for GET_FLEET_SUMMARY.
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

import * as path from 'path';
import * as fs from 'fs';
import { GraphService } from '../../../src/main/events/GraphService';
import { registerIpcHandlers } from '../../../src/main/ipc-handlers';
import { IPC_CHANNELS } from '../../../src/common/constants';

describe('GET_DASHBOARD_STATS — counts and remoteSites.scope', () => {
  let graphService: GraphService;
  let testDbPath: string;

  function registerDeps(overrides: { getSites?: () => Record<string, unknown> } = {}) {
    const noop = () => {};
    const deps: any = {
      siteData: { getSite: () => null, getSites: overrides.getSites ?? (() => ({})) },
      localServicesBridge: {
        getAllSiteStatuses: () => ({}),
        // Deliberately unavailable so the handler skips capiGetInstalls() —
        // this test isn't exercising the CAPI path, only counts/scope.
        isCAPIAvailable: () => false,
        isWPEAuthenticated: () => false,
        capiGetInstalls: async () => [],
      },
      indexRegistry: { listAll: () => [], get: () => null, update: noop },
      embeddingService: { isReady: () => true },
      contentPipeline: {},
      vectorStore: {},
      registryStorage: { get: () => null, set: noop },
      localLogger: { info: noop, warn: noop, error: noop, debug: noop },
      getMcpServer: () => null,
      getStartupStatus: () => ({ ready: true, phase: 'ready' }),
      graphService,
      eventProcessor: {},
      vectorDbPath: '/tmp/nexus-test-vectors.db',
      nexusServices: { twinService: { getAll: () => [] } },
    };
    registerIpcHandlers(deps);
  }

  beforeEach(async () => {
    testDbPath = path.join(__dirname, `test-dashboard-stats-${Date.now()}-${Math.random()}.db`);
    graphService = new GraphService(testDbPath);
    await graphService.initialize();

    await graphService.upsertSite({
      id: 'wpe-1', name: 'wpe-site', source: 'wpe', host: 'wpe', domain: 'wpe.wpengine.com',
      remote_install_id: 'wpe-1', is_active: true, wp_version: '6.7.0', php_version: '8.1',
      created_at: Date.now(), updated_at: Date.now(),
    });
    await graphService.upsertSite({
      id: 'ssh:ext-host', name: 'ext-host', source: 'external', host: 'external', domain: 'example.com',
      is_active: true, wp_version: '6.8.0', php_version: '8.3',
      created_at: Date.now(), updated_at: Date.now(),
    });
    // Inactive WPE row — must not be counted (is_active = 1 filter).
    await graphService.upsertSite({
      id: 'wpe-removed', name: 'wpe-removed', source: 'wpe', host: 'wpe', domain: 'wpe-removed.wpengine.com',
      remote_install_id: 'wpe-removed', is_active: false, wp_version: '6.0.0', php_version: '7.4',
      created_at: Date.now(), updated_at: Date.now(),
    });
  });

  afterEach(async () => {
    await graphService.close();
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  });

  it('returns counts.{local,wpe,external,installs}, with installs summing the other three', async () => {
    // 2 local sites, 1 active WPE row, 1 external row (the inactive WPE row excluded).
    registerDeps({ getSites: () => ({ s1: {}, s2: {} }) });

    const r: any = await mockIpc.invoke(IPC_CHANNELS.GET_DASHBOARD_STATS);

    expect(r.counts).toBeDefined();
    expect(r.counts.local.count).toBe(2);
    expect(r.counts.wpe.count).toBe(1);
    expect(r.counts.external.count).toBe(1);
    expect(r.counts.installs.count).toBe(
      r.counts.local.count + r.counts.wpe.count + r.counts.external.count,
    );
    expect(r.counts.installs.count).toBe(4);

    // Every population count carries its scope label.
    expect(r.counts.local.scope).toEqual(expect.any(String));
    expect(r.counts.local.scope.length).toBeGreaterThan(0);
    expect(r.counts.wpe.scope).toEqual(expect.any(String));
    expect(r.counts.external.scope).toEqual(expect.any(String));
    expect(r.counts.installs.scope).toEqual(expect.any(String));
  });

  it('labels remoteSites.total with its scope (CAPI, not the graph)', async () => {
    registerDeps({ getSites: () => ({}) });

    const r: any = await mockIpc.invoke(IPC_CHANNELS.GET_DASHBOARD_STATS);

    expect(r.remoteSites).toBeDefined();
    expect(r.remoteSites.scope).toEqual(expect.any(String));
    expect(r.remoteSites.scope.length).toBeGreaterThan(0);
    // Must name what makes it different from counts.wpe, not just be non-empty.
    expect(r.remoteSites.scope.toLowerCase()).toContain('wp engine');
  });
});
