/**
 * GET_JOB_RUN_DATA IPC handler.
 *
 * Guards the "never coerced to 0" requirement at the IPC boundary: a job that
 * has never run must come back `null`, because `0 ms average` and `ran at the
 * epoch` are both readable as measurements.
 *
 * This file used to contain two vacuous cases. The first re-implemented the
 * handler's loop inside the test and asserted on its own copy — deleting the
 * handler entirely left it green. The second was literally
 * `const result = mockStore ? {} : {}`. Both now drive the REAL registration,
 * captured out of `registerIpcHandlers` through a fake `ipcMain`.
 */
import { IPC_CHANNELS } from '../../../src/common/constants';

/**
 * Register the real handlers against a fake ipcMain and return the callback
 * bound to `channel`.
 *
 * `registerIpcHandlers` touches a great deal of the main process, so every
 * dependency it reaches for during registration is stubbed. Registration is
 * side-effect-light by design: the handlers close over `deps` and do their work
 * when invoked, which is exactly what makes this possible.
 */
function getHandler(channel: string, deps: Record<string, any>): (...args: any[]) => any {
  jest.resetModules();

  const handlers = new Map<string, (...args: any[]) => any>();
  jest.doMock('electron', () => ({
    ipcMain: {
      handle: (ch: string, fn: (...args: any[]) => any) => { handlers.set(ch, fn); },
      removeHandler: (ch: string) => { handlers.delete(ch); },
      removeAllListeners: () => undefined,
      on: () => undefined,
      off: () => undefined,
    },
    app: { getPath: () => '/tmp/nexus-test', getVersion: () => '0.0.0-test', on: () => undefined },
    shell: { openExternal: jest.fn() },
    dialog: { showSaveDialog: jest.fn() },
    BrowserWindow: { getAllWindows: () => [] },
  }), { virtual: false });

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { registerIpcHandlers } = require('../../../src/main/ipc-handlers');
  registerIpcHandlers(deps);

  const fn = handlers.get(channel);
  if (!fn) {
    throw new Error(
      `No handler was registered for ${channel}. Registered: ${[...handlers.keys()].length} channels.`,
    );
  }
  return fn;
}

const noopLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

/** The minimum `deps` bag registration needs. */
const baseDeps = (over: Record<string, any> = {}): Record<string, any> => ({
  localLogger: noopLogger,
  logger: noopLogger,
  siteData: { getSites: () => ({}), getSite: () => undefined },
  localServicesBridge: {
    getAllSiteStatuses: () => ({}),
    isCAPIAvailable: () => false,
    resolveSiteObject: () => undefined,
  },
  graphService: { getDb: () => null },
  indexRegistry: { listAll: () => [], remove: jest.fn() },
  registryStorage: { get: () => undefined, set: jest.fn(), delete: jest.fn() },
  vectorStore: { dropAllTables: async () => 0 },
  vectorDbPath: '/tmp/nexus-test/vectors.db',
  getMcpServer: () => null,
  getStartupStatus: () => ({}),
  nexusServices: {},
  emitNexusState: jest.fn(),
  onSettingsUpdated: jest.fn(),
  ...over,
});

describe('GET_JOB_RUN_DATA IPC handler', () => {
  test('null averageMs and lastRunAt stay null, never coerced to 0', () => {
    const now = Date.now();
    const jobRunStore = {
      averageMs: (key: string) => (key === 'wpeRefresh' ? 1200 : null),
      lastRunAt: (key: string) => (key === 'wpeRefresh' ? now : null),
    };
    const handler = getHandler(IPC_CHANNELS.GET_JOB_RUN_DATA, baseDeps({ jobRunStore }));
    const result = handler({} as any);

    expect(result.wpeRefresh).toEqual({ averageMs: 1200, lastRunAt: now });
    for (const key of ['wpeSync', 'wpeContentIndex', 'externalRefresh',
      'externalContentIndex', 'localContentIndex', 'haltedSiteRefresh']) {
      expect(result[key]).toEqual({ averageMs: null, lastRunAt: null });
    }
  });

  test('all seven job keys are present, so no row silently loses its figures', () => {
    const jobRunStore = { averageMs: () => null, lastRunAt: () => null };
    const handler = getHandler(IPC_CHANNELS.GET_JOB_RUN_DATA, baseDeps({ jobRunStore }));
    expect(Object.keys(handler({} as any)).sort()).toEqual([
      'externalContentIndex', 'externalRefresh', 'haltedSiteRefresh',
      'localContentIndex', 'wpeContentIndex', 'wpeRefresh', 'wpeSync',
    ]);
  });

  test('when jobRunStore is unavailable, returns an empty object', () => {
    const handler = getHandler(IPC_CHANNELS.GET_JOB_RUN_DATA, baseDeps({ jobRunStore: undefined }));
    expect(handler({} as any)).toEqual({});
  });

  test('a throwing store yields {} rather than propagating out of the IPC boundary', () => {
    const jobRunStore = {
      averageMs: () => { throw new Error('corrupt entry'); },
      lastRunAt: () => null,
    };
    const handler = getHandler(IPC_CHANNELS.GET_JOB_RUN_DATA, baseDeps({ jobRunStore }));
    expect(handler({} as any)).toEqual({});
  });
});
