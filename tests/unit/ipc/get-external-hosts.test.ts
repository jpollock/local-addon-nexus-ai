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

import { registerIpcHandlers } from '../../../src/main/ipc-handlers';
import { IPC_CHANNELS } from '../../../src/common/constants';

function register(rows: Array<{ id: string; name: string; environment: string | null; domain: string | null; is_active: number }>) {
  const noop = () => {};
  const db = {
    prepare: (sql: string) => ({
      all: () => sql.includes("source = 'external'") ? rows.filter(r => r.is_active === 1) : [],
    }),
  };
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
    graphService: { getDb: () => db },
    eventProcessor: {},
    vectorDbPath: '/tmp/nexus-test-vectors.db',
    nexusServices: {},
  };
  registerIpcHandlers(deps);
}

describe('GET_EXTERNAL_HOSTS', () => {
  it('returns registered active external hosts', () => {
    register([
      { id: 'ssh:myhost', name: 'myhost', environment: 'production', domain: 'example.com', is_active: 1 },
    ]);
    const result = mockIpc.invoke(IPC_CHANNELS.GET_EXTERNAL_HOSTS);
    expect(result).toEqual([{ alias: 'myhost', environment: 'production', domain: 'example.com' }]);
  });

  it('excludes a removed (inactive) host', () => {
    register([
      { id: 'ssh:gone', name: 'gone', environment: 'production', domain: 'x.com', is_active: 0 },
    ]);
    expect(mockIpc.invoke(IPC_CHANNELS.GET_EXTERNAL_HOSTS)).toEqual([]);
  });

  it('defaults a missing environment to production and a missing domain to empty string', () => {
    register([
      { id: 'ssh:bare', name: 'bare', environment: null, domain: null, is_active: 1 },
    ]);
    expect(mockIpc.invoke(IPC_CHANNELS.GET_EXTERNAL_HOSTS)).toEqual([
      { alias: 'bare', environment: 'production', domain: '' },
    ]);
  });

  it('returns an empty array when the graph is not ready', () => {
    const deps: any = {
      siteData: { getSite: () => null, getSites: () => ({}) },
      localServicesBridge: {},
      indexRegistry: { listAll: () => [], get: () => null, update: () => {} },
      embeddingService: {}, contentPipeline: {}, vectorStore: {},
      registryStorage: { get: () => null, set: () => {} },
      localLogger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
      getMcpServer: () => null,
      getStartupStatus: () => ({ ready: true, phase: 'ready' }),
      graphService: { getDb: () => null },
      eventProcessor: {},
      vectorDbPath: '/tmp/nexus-test-vectors.db',
      nexusServices: {},
    };
    registerIpcHandlers(deps);
    expect(mockIpc.invoke(IPC_CHANNELS.GET_EXTERNAL_HOSTS)).toEqual([]);
  });
});
