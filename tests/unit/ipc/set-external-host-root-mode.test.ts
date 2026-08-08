const upsertExternalProfileMock = jest.fn();
const getExternalProfileMock = jest.fn();
jest.mock('../../../src/main/external/externalSiteStore', () => ({
  ...jest.requireActual('../../../src/main/external/externalSiteStore'),
  upsertExternalProfile: (...args: any[]) => upsertExternalProfileMock(...args),
  getExternalProfile: (...args: any[]) => getExternalProfileMock(...args),
}));

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

function register() {
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
    graphService: { getDb: () => null },
    eventProcessor: {},
    vectorDbPath: '/tmp/nexus-test-vectors.db',
    nexusServices: {},
  };
  registerIpcHandlers(deps);
}

beforeEach(() => {
  upsertExternalProfileMock.mockReset();
  getExternalProfileMock.mockReset();
  register();
});

describe('SET_EXTERNAL_HOST_ROOT_MODE', () => {
  it('persists allowRoot: true for the given alias', async () => {
    getExternalProfileMock.mockReturnValue({ alias: 'root-host', firstSeenAt: 1, lastSeenAt: 1 });
    const result = await mockIpc.invoke(IPC_CHANNELS.SET_EXTERNAL_HOST_ROOT_MODE, 'root-host', true);
    expect(result.success).toBe(true);
    expect(upsertExternalProfileMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ alias: 'root-host', allowRoot: true }),
    );
  });

  it('persists allowRoot: false to turn it back off', async () => {
    getExternalProfileMock.mockReturnValue({ alias: 'root-host', firstSeenAt: 1, lastSeenAt: 1, allowRoot: true });
    const result = await mockIpc.invoke(IPC_CHANNELS.SET_EXTERNAL_HOST_ROOT_MODE, 'root-host', false);
    expect(result.success).toBe(true);
    expect(upsertExternalProfileMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ allowRoot: false }),
    );
  });

  it('reports failure when upsertExternalProfile throws, without crashing the handler', async () => {
    getExternalProfileMock.mockReturnValue(null);
    upsertExternalProfileMock.mockImplementation(() => { throw new Error('disk full'); });
    const result = await mockIpc.invoke(IPC_CHANNELS.SET_EXTERNAL_HOST_ROOT_MODE, 'x', true);
    expect(result.success).toBe(false);
    expect(result.error).toContain('disk full');
  });
});
