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

  function registerDeps() {
    const noop = () => {};
    const deps: any = {
      siteData: { getSite: () => null, getSites: () => ({}) },
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
      nexusServices: { twinService: { getAll: () => [] } },
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

  it('GET_FLEET_PLUGINS includes a plugin only installed on the external site', () => {
    registerDeps();
    const r: any = mockIpc.invoke(IPC_CHANNELS.GET_FLEET_PLUGINS);

    const entry = r.plugins.find((p: any) => p.slug === 'external-test-plugin');
    expect(entry).toBeDefined();
    expect(entry.siteCount).toBeGreaterThanOrEqual(1);
  });
});
