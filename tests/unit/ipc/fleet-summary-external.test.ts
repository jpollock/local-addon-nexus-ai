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

describe('GET_FLEET_SUMMARY / GET_FLEET_PLUGINS — external hosts', () => {
  let graphService: GraphService;
  let testDbPath: string;

  function registerDeps(overrides: { getSites?: () => Record<string, unknown>; getAllTwins?: () => any[] } = {}) {
    const noop = () => {};
    const deps: any = {
      siteData: { getSite: () => null, getSites: overrides.getSites ?? (() => ({})) },
      localServicesBridge: {},
      indexRegistry: { listAll: () => [], get: () => null, update: noop },
      embeddingService: {},
      contentPipeline: {},
      vectorStore: {},
      registryStorage: { get: () => null, set: noop },
      localLogger: { info: noop, warn: noop, error: noop, debug: noop },
      getMcpServer: () => null,
      getStartupStatus: () => ({ ready: true, phase: 'ready' }),
      graphService,
      eventProcessor: {},
      vectorDbPath: '/tmp/nexus-test-vectors.db',
      nexusServices: { twinService: { getAll: overrides.getAllTwins ?? (() => []) } },
    };
    registerIpcHandlers(deps);
  }

  beforeEach(async () => {
    testDbPath = path.join(__dirname, `test-fleet-summary-${Date.now()}-${Math.random()}.db`);
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

    await graphService.upsertPlugin({
      site_id: 'ssh:ext-host', slug: 'external-test-plugin', name: 'External Test Plugin',
      version: '1.0.0', is_active: true, author: 'Test Author',
      created_at: Date.now(), updated_at: Date.now(),
    });
  });

  afterEach(async () => {
    await graphService.close();
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  });

  it('GET_FLEET_SUMMARY counts external sites separately from WPE', () => {
    registerDeps();
    const r: any = mockIpc.invoke(IPC_CHANNELS.GET_FLEET_SUMMARY);

    expect(r.totalExternal).toBe(1);
    expect(r.totalWpe).toBe(1);
    expect(r.total).toBe(r.totalLocal + r.totalWpe + r.totalExternal);
    expect(r.externalSync.synced).toBe(1);
    expect(r.externalSync.neverSynced).toBe(0);
  });

  it('GET_FLEET_SUMMARY sources totalLocal from siteData.getSites(), not the twin cache, when the two disagree', () => {
    // Regression for a fix-round finding: before the fix, totalLocal was
    // `twins.length`. Deliberately make the two populations disagree — 3
    // sites in Local's own store, 5 entries in the twin cache (as would
    // happen if the twin cache holds stale/deleted-site entries, or entries
    // for sites the twin service hasn't reconciled yet) — so a regression
    // back to `twins.length` is caught instead of passing silently the way
    // it would if both mocks stayed consistent with each other.
    const fakeTwin = (id: string) => ({
      siteId: id,
      completeness: 'none' as const,
      asOf: Date.now(),
      wpVersion: '6.7.0',
      phpVersion: '8.2',
    });

    registerDeps({
      getSites: () => ({ 's1': {}, 's2': {}, 's3': {} }),
      getAllTwins: () => [fakeTwin('t1'), fakeTwin('t2'), fakeTwin('t3'), fakeTwin('t4'), fakeTwin('t5')],
    });
    const r: any = mockIpc.invoke(IPC_CHANNELS.GET_FLEET_SUMMARY);

    // The canonical count: 3 sites in Local's own store, not 5 twins.
    expect(r.totalLocal).toBe(3);
    expect(r.counts.local.count).toBe(3);
    // total must be built from the same canonical count, not the twin count.
    expect(r.total).toBe(r.totalLocal + r.totalWpe + r.totalExternal);

    // The twin-derived figures (completeness, staleCount's/neverScannedCount's
    // local share, WP/PHP version histograms) are still measured over the 5
    // twins — that's correct, twins is a different, legitimate population —
    // but `twinScope` must say so explicitly rather than implying 5 === totalLocal.
    expect(r.twinScope.measured).toBe(5);
    expect(r.twinScope.label).not.toBe(r.counts.local.scope);
    const completenessTotal = (Object.values(r.completeness) as number[]).reduce((a, b) => a + b, 0);
    expect(completenessTotal).toBe(5);
  });

  it('GET_FLEET_PLUGINS includes a plugin only installed on the external site', () => {
    registerDeps();
    const r: any = mockIpc.invoke(IPC_CHANNELS.GET_FLEET_PLUGINS);

    const entry = r.plugins.find((p: any) => p.slug === 'external-test-plugin');
    expect(entry).toBeDefined();
    expect(entry.siteCount).toBeGreaterThanOrEqual(1);
  });
});
