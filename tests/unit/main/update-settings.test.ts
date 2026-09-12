/**
 * UPDATE_SETTINGS must not reject a save because the on-disk settings file carries fields from
 * a DIFFERENT branch's addon build.
 *
 * Reproduced live: `nexus-ai_settings.json` was last written by feat/non-wpe-host-support's
 * addon and carries `enableHubBridge`, `externalRefreshAutoEnabled`,
 * `externalRefreshIntervalHours` — fields feat/sentinel-fixes's UpdateSettingsSchema has never
 * declared. The renderer round-trips whatever GET_SETTINGS returned on every Apply, so those
 * three fields rode along with an ordinary aiModel change. UpdateSettingsSchema.strict()
 * rejected the whole payload with "Unrecognized key(s)", and nothing in the renderer's onApply
 * caught the rejection — every setting on the panel appeared to save while nothing reached disk.
 *
 * The fix drops keys the schema doesn't recognize from the INCOMING partial before validating.
 * It must not touch the *existing* stored object: another branch's fields must survive on disk
 * even though this branch doesn't act on them.
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
import { registerIpcHandlers } from '../../../src/main/ipc-handlers';
import { IPC_CHANNELS, STORAGE_KEYS } from '../../../src/common/constants';

function register(store: Record<string, any>) {
  const noop = () => {};
  const deps: any = {
    siteData: { getSite: () => null, getSites: () => ({}) },
    localServicesBridge: {},
    indexRegistry: { listAll: () => [], get: () => null, update: noop },
    embeddingService: {},
    contentPipeline: {},
    vectorStore: {},
    registryStorage: {
      get: (key: string) => store[key] ?? null,
      set: (key: string, value: any) => { store[key] = value; },
    },
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

describe('UPDATE_SETTINGS — cross-branch field tolerance', () => {
  it('saves a recognized field even when the payload also carries fields this schema does not know', () => {
    const store: Record<string, any> = {
      [STORAGE_KEYS.SETTINGS]: {
        autoIndex: true,
        excludedSiteIds: [],
        aiProvider: 'anthropic',
        aiModel: 'anthropic/claude-haiku-4-5',
        // Written by a different branch's addon build sharing this settings file.
        enableHubBridge: true,
        externalRefreshAutoEnabled: true,
        externalRefreshIntervalHours: 1,
      },
    };
    register(store);

    // The renderer round-trips the full GET_SETTINGS payload on every Apply, unchanged fields
    // included — so a plain model change carries the unknown fields right along with it.
    const payload = {
      ...store[STORAGE_KEYS.SETTINGS],
      aiModel: 'anthropic/claude-opus-5',
    };

    const result = mockIpc.invoke(IPC_CHANNELS.UPDATE_SETTINGS, payload);
    return Promise.resolve(result).then((r: any) => {
      expect(r._error).toBeUndefined();
      expect(r.aiModel).toBe('anthropic/claude-opus-5');
      expect(store[STORAGE_KEYS.SETTINGS].aiModel).toBe('anthropic/claude-opus-5');
      // The other branch's fields survive untouched — this branch just doesn't act on them.
      expect(store[STORAGE_KEYS.SETTINGS].enableHubBridge).toBe(true);
      expect(store[STORAGE_KEYS.SETTINGS].externalRefreshAutoEnabled).toBe(true);
      expect(store[STORAGE_KEYS.SETTINGS].externalRefreshIntervalHours).toBe(1);
    });
  });

  it('still rejects a genuinely invalid value for a recognized field, without wiping current settings', () => {
    const store: Record<string, any> = {
      [STORAGE_KEYS.SETTINGS]: { autoIndex: true, excludedSiteIds: [], aiModel: 'keep-me' },
    };
    register(store);

    const result = mockIpc.invoke(IPC_CHANNELS.UPDATE_SETTINGS, { wpeSyncIntervalHours: 9999 });
    return Promise.resolve(result).then((r: any) => {
      expect(r._error).toBeDefined();
      // A failed validation must not fall back to bare DEFAULT_SETTINGS — that would report
      // every real setting as reset even though registryStorage.set was never called.
      expect(r.aiModel).toBe('keep-me');
      // Nothing was actually written to disk.
      expect(store[STORAGE_KEYS.SETTINGS].aiModel).toBe('keep-me');
      expect(store[STORAGE_KEYS.SETTINGS].wpeSyncIntervalHours).toBeUndefined();
    });
  });
});
