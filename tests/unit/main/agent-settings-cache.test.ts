/**
 * AGENT_SETTINGS_UPDATE silently drops any field beyond enabled/scheduleEnabled/
 * eventsEnabled/autonomy — both the disk-load block and the update handler in
 * ipc-handlers.ts rebuild the cached object by hand-listing exactly those four keys.
 *
 * Reproduced: security-sentinel's agent.js reads `ctx.settings.scanScope` (resolveScanScope)
 * expecting a persisted scope to be there. A user setting a scope in the Settings UI has it
 * silently discarded before it ever reaches the agent — getAgentSettings() only ever returns
 * what the cache holds, and the cache never held scanScope in the first place.
 */

class MockIpcMain {
  handlers = new Map<string, Function>();
  handle(channel: string, handler: Function) { this.handlers.set(channel, handler); }
  on() { /* sync channels are irrelevant here */ }
  removeHandler(channel: string) { this.handlers.delete(channel); }
  removeAllListeners() { /* no-op */ }
  invoke(channel: string, ...args: any[]) {
    const handler = this.handlers.get(channel);
    if (!handler) throw new Error(`No handler registered for ${channel}`);
    return handler({}, ...args);
  }
}
const mockIpc = new MockIpcMain();
jest.mock('electron', () => ({ ipcMain: mockIpc, shell: { openPath: jest.fn() }, app: { getPath: () => '/tmp' } }));

// ts-jest does not hoist jest.mock() above imports the way babel-jest does — these must come
// after the mock setup above, or `require('electron')` resolves before `mockIpc` exists.
import { registerIpcHandlers, getAgentSettings } from '../../../src/main/ipc-handlers';
import { IPC_CHANNELS } from '../../../src/common/constants';

function register() {
  const noop = () => {};
  const deps: any = {
    siteData: { getSite: () => null, getSites: () => ({}) },
    localServicesBridge: {},
    indexRegistry: { listAll: () => [], get: () => null, update: noop },
    embeddingService: {},
    contentPipeline: {},
    vectorStore: {},
    registryStorage: { get: () => null, set: () => {} },
    localLogger: { info: noop, warn: noop, error: noop, debug: noop },
    getMcpServer: () => null,
    getStartupStatus: () => ({ ready: true, phase: 'ready' }),
    graphService: { getDb: () => null },
    eventProcessor: {},
    vectorDbPath: '/tmp/nexus-test-vectors.db',
    nexusServices: {},
  };
  registerIpcHandlers(deps);
}

describe('AGENT_SETTINGS_UPDATE — cache must not narrow to four hardcoded fields', () => {
  it('preserves scanScope through the update handler, not just the four core toggles', () => {
    register();

    mockIpc.invoke(IPC_CHANNELS.AGENT_SETTINGS_UPDATE, {
      'security-sentinel': {
        enabled: true,
        scheduleEnabled: true,
        eventsEnabled: false,
        autonomy: 'ask',
        scanScope: { mode: 'explicit', siteIds: ['site-a', 'site-b'] },
      },
    });

    const settings = getAgentSettings('security-sentinel');
    expect(settings.scanScope).toEqual({ mode: 'explicit', siteIds: ['site-a', 'site-b'] });
  });

  it('preserves an arbitrary new field (scope/savedScopes) alongside the core toggles', () => {
    register();

    mockIpc.invoke(IPC_CHANNELS.AGENT_SETTINGS_UPDATE, {
      'security-sentinel': {
        enabled: true,
        scheduleEnabled: true,
        eventsEnabled: true,
        autonomy: 'auto',
        scope: { siteIds: ['a', 'b', 'c'] },
        savedScopes: [{ name: 'Non-prod sweep', siteIds: ['a', 'b'] }],
      },
    });

    const settings = getAgentSettings('security-sentinel');
    expect(settings.scope).toEqual({ siteIds: ['a', 'b', 'c'] });
    expect(settings.savedScopes).toEqual([{ name: 'Non-prod sweep', siteIds: ['a', 'b'] }]);
    // The core toggles must still be present and correct — widening must not lose them.
    expect(settings.enabled).toBe(true);
    expect(settings.autonomy).toBe('auto');
  });

  it('still defaults the four core toggles when a caller omits them entirely', () => {
    register();

    mockIpc.invoke(IPC_CHANNELS.AGENT_SETTINGS_UPDATE, {
      'log-processor': { scope: { siteIds: ['x'] } },
    });

    const settings = getAgentSettings('log-processor');
    expect(settings.enabled).toBe(true);
    expect(settings.scheduleEnabled).toBe(true);
    expect(settings.eventsEnabled).toBe(true);
    expect(settings.autonomy).toBe('ask');
    expect(settings.scope).toEqual({ siteIds: ['x'] });
  });
});
