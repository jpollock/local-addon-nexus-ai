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
import { IPC_CHANNELS, STORAGE_KEYS } from '../../../src/common/constants';

function register(
  rows: Array<{ id: string; name: string; account_id?: string; environment: string | null; domain: string | null; wp_path?: string | null; is_active: number }>,
  profiles: Record<string, any> = {}
) {
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
    registryStorage: {
      get: (key: string) => key === STORAGE_KEYS.EXTERNAL_SITE_PROFILES ? profiles : null,
      set: noop
    },
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
      { id: 'ssh:hostinger-test/site-a', name: 'site-a', account_id: 'hostinger-test', environment: 'production', domain: 'example.com', wp_path: '/home/u/site-a', is_active: 1 },
    ]);
    const result = mockIpc.invoke(IPC_CHANNELS.GET_EXTERNAL_HOSTS);
    expect(result).toEqual([{ alias: 'hostinger-test', site: 'site-a', environment: 'production', domain: 'example.com', wpPath: '/home/u/site-a', allowRoot: false }]);
  });

  it('excludes a removed (inactive) host', () => {
    register([
      { id: 'ssh:gone', name: 'gone', environment: 'production', domain: 'x.com', is_active: 0 },
    ]);
    expect(mockIpc.invoke(IPC_CHANNELS.GET_EXTERNAL_HOSTS)).toEqual([]);
  });

  it('defaults a missing environment to production and a missing domain to empty string', () => {
    register([
      { id: 'ssh:hostinger-test/bare', name: 'bare', account_id: 'hostinger-test', environment: null, domain: null, wp_path: null, is_active: 1 },
    ]);
    expect(mockIpc.invoke(IPC_CHANNELS.GET_EXTERNAL_HOSTS)).toEqual([
      { alias: 'hostinger-test', site: 'bare', environment: 'production', domain: '', wpPath: '', allowRoot: false },
    ]);
  });

  it('falls back to the site name as the alias for a legacy single-site row with no account_id', () => {
    register([
      { id: 'ssh:hostinger-test', name: 'hostinger-test', account_id: undefined, environment: 'production', domain: 'example.hostingersite.com', wp_path: '/home/u/public_html', is_active: 1 },
    ]);
    expect(mockIpc.invoke(IPC_CHANNELS.GET_EXTERNAL_HOSTS)).toEqual([
      { alias: 'hostinger-test', site: 'hostinger-test', environment: 'production', domain: 'example.hostingersite.com', wpPath: '/home/u/public_html', allowRoot: false },
    ]);
  });

  it('includes allowRoot from the external profile when available', () => {
    register(
      [{ id: 'ssh:hostinger-test/site-a', name: 'site-a', account_id: 'hostinger-test', environment: 'production', domain: 'example.com', wp_path: '/home/u/site-a', is_active: 1 }],
      { 'hostinger-test': { alias: 'hostinger-test', allowRoot: true, firstSeenAt: 1000, lastSeenAt: 2000 } }
    );
    const result = mockIpc.invoke(IPC_CHANNELS.GET_EXTERNAL_HOSTS);
    expect(result).toEqual([{ alias: 'hostinger-test', site: 'site-a', environment: 'production', domain: 'example.com', wpPath: '/home/u/site-a', allowRoot: true }]);
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
