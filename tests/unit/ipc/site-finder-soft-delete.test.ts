/**
 * SITE_FINDER_APPLY must not surface soft-deleted remote sites.
 *
 * `nexus host remove` (and WPE deactivation) set `is_active = 0` and reset
 * `domain` back to the alias — there is no per-site delete in GraphService.
 * `GraphService.listSites` only applies `is_active = 1` when it is *asked* to
 * (`active_only: true`); it returns everything otherwise. Site Finder was not
 * asking, so a removed host still rendered in the renderer's "External Hosts"
 * section, with the alias showing where the domain should be.
 *
 * These tests use a fake graphService rather than a real GraphService so they
 * do not depend on better-sqlite3's native ABI.
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

import { registerIpcHandlers } from '../../../src/main/ipc-handlers';
import { IPC_CHANNELS } from '../../../src/common/constants';

type Row = {
  id: string;
  name: string;
  source: 'wpe' | 'external';
  domain: string;
  is_active: boolean;
  wp_version?: string;
  php_version?: string;
};

const ROWS: Row[] = [
  { id: 'ssh:live-host', name: 'live-host', source: 'external', domain: 'live.example.com', is_active: true, wp_version: '6.7', php_version: '8.2' },
  // Soft-deleted by `nexus host remove`: is_active = 0 and domain reset to the alias.
  { id: 'ssh:removed-host', name: 'removed-host', source: 'external', domain: 'removed-host', is_active: false, wp_version: '6.7', php_version: '8.2' },
  { id: 'wpe-live', name: 'live-install', source: 'wpe', domain: 'live-install.wpengine.com', is_active: true, wp_version: '6.7', php_version: '8.2' },
  { id: 'wpe-gone', name: 'gone-install', source: 'wpe', domain: 'gone-install.wpengine.com', is_active: false, wp_version: '6.7', php_version: '8.2' },
];

describe('SITE_FINDER_APPLY — soft-deleted remote sites', () => {
  let listSites: jest.Mock;

  beforeEach(() => {
    mockIpc.handlers.clear();

    listSites = jest.fn(async (opts: { source?: string; active_only?: boolean } = {}) =>
      ROWS.filter((r) => (!opts.source || r.source === opts.source) && (!opts.active_only || r.is_active)),
    );

    const noop = () => {};
    const deps: any = {
      siteData: { getSite: () => null, getSites: () => ({}) },
      localServicesBridge: { getAllSiteStatuses: () => ({}) },
      indexRegistry: { listAll: () => [], get: () => null, update: noop },
      embeddingService: {},
      contentPipeline: {},
      vectorStore: {},
      registryStorage: { get: () => null, set: noop },
      localLogger: { info: noop, warn: noop, error: noop, debug: noop },
      getMcpServer: () => null,
      getStartupStatus: () => ({ ready: true, phase: 'ready' }),
      graphService: {
        listSites,
        // No SQL-backed filters are exercised by these tests; the text-search
        // path never touches the db handle.
        getDb: () => null,
      },
      eventProcessor: {},
      vectorDbPath: '/tmp/nexus-test-vectors.db',
      nexusServices: { twinService: { getAll: () => [] } },
    };
    registerIpcHandlers(deps);
  });

  it('asks listSites for active rows only, for both remote sources', async () => {
    await mockIpc.invoke(IPC_CHANNELS.SITE_FINDER_APPLY, { searchText: 'host' });

    expect(listSites).toHaveBeenCalled();
    for (const call of listSites.mock.calls) {
      expect(call[0]).toEqual(expect.objectContaining({ active_only: true }));
    }
    // Both remote sources were consulted.
    const sources = listSites.mock.calls.map((c) => c[0]?.source);
    expect(sources).toEqual(expect.arrayContaining(['external', 'wpe']));
  });

  it('excludes a removed external host from the results', async () => {
    const result: any = await mockIpc.invoke(IPC_CHANNELS.SITE_FINDER_APPLY, { searchText: 'host' });

    expect(result.success).toBe(true);
    expect(result.siteIds).toContain('ssh:live-host');
    expect(result.siteIds).not.toContain('ssh:removed-host');
  });

  it('excludes a deactivated WPE install from the results', async () => {
    const result: any = await mockIpc.invoke(IPC_CHANNELS.SITE_FINDER_APPLY, { searchText: 'install' });

    expect(result.success).toBe(true);
    expect(result.siteIds).toContain('wpe-live');
    expect(result.siteIds).not.toContain('wpe-gone');
  });
});
