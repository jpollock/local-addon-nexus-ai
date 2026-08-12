/**
 * Regression coverage for Task 6: GET_DASHBOARD_STATS must return the
 * canonical `counts` figures from collectFleetCounts, and `remoteSites` must
 * carry a `scope` label explaining where `total` comes from (the last WPE sync),
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

  it('labels remoteSites.total with the sync it came from, not a live API claim', async () => {
    registerDeps({ getSites: () => ({}) });

    const r: any = await mockIpc.invoke(IPC_CHANNELS.GET_DASHBOARD_STATS);

    expect(r.remoteSites).toBeDefined();
    expect(r.remoteSites.scope).toEqual(expect.any(String));
    expect(r.remoteSites.scope.length).toBeGreaterThan(0);
    // Must name what makes it different from counts.wpe, not just be non-empty.
    expect(r.remoteSites.scope.toLowerCase()).toContain('wp engine');
  });

  it('never calls CAPI — the dashboard must not block on the network', async () => {
    // This is the whole point of the change. GET_DASHBOARD_STATS sits inside the
    // dashboard's twelve-way Promise.all, so a live round trip here delayed EVERY
    // panel behind it on first load. WPESyncService already persists what is needed.
    let capiCalls = 0;
    const noop = () => {};
    registerIpcHandlers({
      siteData: { getSite: () => null, getSites: () => ({}) },
      localServicesBridge: {
        getAllSiteStatuses: () => ({}),
        // Available and authenticated — the pre-change handler would have called out.
        isCAPIAvailable: () => true,
        isWPEAuthenticated: () => true,
        capiGetInstalls: async () => { capiCalls += 1; return []; },
      },
      indexRegistry: { listAll: () => [], get: () => null, update: noop },
      embeddingService: { isReady: () => true },
      contentPipeline: {}, vectorStore: {},
      registryStorage: { get: () => null, set: noop },
      localLogger: { info: noop, warn: noop, error: noop, debug: noop },
      getMcpServer: () => null,
      getStartupStatus: () => ({ ready: true, phase: 'ready' }),
      graphService,
      eventProcessor: {},
      vectorDbPath: '/tmp/nexus-test-vectors.db',
      nexusServices: { twinService: { getAll: () => [] } },
    } as any);

    const r: any = await mockIpc.invoke(IPC_CHANNELS.GET_DASHBOARD_STATS);

    expect(capiCalls).toBe(0);
    // And it still produces the figure, from the graph: one active WPE row in the fixture.
    expect(r.remoteSites.total).toBe(1);
  });

  it('counts an install as linked when a local site points at its wpe_site_id', async () => {
    // The linkage test compares hostConnections[].remoteSiteId against the install's
    // site UUID. That used to come from CAPI's `install.site.id`; it now comes from
    // the `wpe_site_id` column WPESyncService writes from the same field.
    await graphService.upsertSite({
      id: 'wpe-linked', name: 'linked', source: 'wpe', host: 'wpe', domain: 'linked.wpengine.com',
      remote_install_id: 'wpe-linked', wpe_site_id: 'site-uuid-1', is_active: true,
      created_at: Date.now(), updated_at: Date.now(),
    } as any);

    registerDeps({
      getSites: () => ({
        local1: { id: 'local1', name: 'local1', hostConnections: [{ hostId: 'wpe', remoteSiteId: 'site-uuid-1' }] },
      }),
    });

    const r: any = await mockIpc.invoke(IPC_CHANNELS.GET_DASHBOARD_STATS);

    // Two active WPE rows in the graph now; one of them is linked, so one is unlinked.
    expect(r.remoteSites.total).toBe(2);
    expect(r.remoteSites.unlinked).toBe(1);
  });
});
