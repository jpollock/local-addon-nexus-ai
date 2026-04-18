/**
 * Unit tests for src/main/ipc/handlers/credentials.ts
 *
 * Verifies that registerCredentialHandlers correctly registers IPC channels
 * and that each handler behaves as expected given mocked deps.
 */
import { ipcMain } from 'electron';
import { registerCredentialHandlers } from '../../../src/main/ipc/handlers/credentials';
import { IPC_CHANNELS } from '../../../src/common/constants';

// Helpers ------------------------------------------------------------------

function createMockBridge(overrides?: any) {
  return {
    wpeGetApiCredentialsStatus: jest.fn().mockResolvedValue({ configured: false }),
    wpeSetApiCredentials: jest.fn().mockResolvedValue(undefined),
    wpeClearApiCredentials: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function createMockDeps(bridgeOverrides?: any): any {
  return {
    localServicesBridge: createMockBridge(bridgeOverrides),
    localLogger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
    // remaining deps unused by credential handlers
    siteData: {},
    indexRegistry: {},
    embeddingService: {},
    contentPipeline: {},
    vectorStore: {},
    registryStorage: { get: jest.fn(), set: jest.fn() },
    getMcpServer: jest.fn().mockReturnValue(null),
    graphService: {},
    eventProcessor: {},
    vectorDbPath: '/tmp/test-vectors',
  };
}

/** Extract the handler function registered for a given channel. */
function captureHandler(channel: string): (...args: any[]) => any {
  const calls = (ipcMain.handle as jest.Mock).mock.calls;
  const found = calls.find(([ch]: [string]) => ch === channel);
  if (!found) throw new Error(`No handler registered for ${channel}`);
  return found[1];
}

// ---------------------------------------------------------------------------

describe('registerCredentialHandlers', () => {
  beforeEach(() => {
    (ipcMain.handle as jest.Mock).mockClear();
    (ipcMain.removeHandler as jest.Mock).mockClear();
  });

  // 1. All four channels are registered
  it('registers WPE_GET_API_CREDENTIALS_STATUS handler', () => {
    registerCredentialHandlers(createMockDeps());
    const channels = (ipcMain.handle as jest.Mock).mock.calls.map(([ch]: [string]) => ch);
    expect(channels).toContain(IPC_CHANNELS.WPE_GET_API_CREDENTIALS_STATUS);
  });

  it('registers WPE_GET_API_CREDENTIALS handler', () => {
    registerCredentialHandlers(createMockDeps());
    const channels = (ipcMain.handle as jest.Mock).mock.calls.map(([ch]: [string]) => ch);
    expect(channels).toContain(IPC_CHANNELS.WPE_GET_API_CREDENTIALS);
  });

  it('registers WPE_SET_API_CREDENTIALS handler', () => {
    registerCredentialHandlers(createMockDeps());
    const channels = (ipcMain.handle as jest.Mock).mock.calls.map(([ch]: [string]) => ch);
    expect(channels).toContain(IPC_CHANNELS.WPE_SET_API_CREDENTIALS);
  });

  it('registers WPE_CLEAR_API_CREDENTIALS handler', () => {
    registerCredentialHandlers(createMockDeps());
    const channels = (ipcMain.handle as jest.Mock).mock.calls.map(([ch]: [string]) => ch);
    expect(channels).toContain(IPC_CHANNELS.WPE_CLEAR_API_CREDENTIALS);
  });

  // 2. GET_API_CREDENTIALS_STATUS — returns configured=false when not set
  it('WPE_GET_API_CREDENTIALS_STATUS returns configured=false when not configured', async () => {
    const deps = createMockDeps();
    registerCredentialHandlers(deps);
    const handler = captureHandler(IPC_CHANNELS.WPE_GET_API_CREDENTIALS_STATUS);
    const result = await handler();
    expect(result).toEqual({ configured: false, username: null });
  });

  // 3. GET_API_CREDENTIALS_STATUS — returns username when configured
  it('WPE_GET_API_CREDENTIALS_STATUS returns username when configured', async () => {
    const deps = createMockDeps({
      wpeGetApiCredentialsStatus: jest.fn().mockResolvedValue({ configured: true, username: 'admin' }),
    });
    registerCredentialHandlers(deps);
    const handler = captureHandler(IPC_CHANNELS.WPE_GET_API_CREDENTIALS_STATUS);
    const result = await handler();
    expect(result).toEqual({ configured: true, username: 'admin' });
  });

  // 4. GET_API_CREDENTIALS — returns empty strings when not configured
  it('WPE_GET_API_CREDENTIALS returns empty credentials when not configured', async () => {
    const deps = createMockDeps({
      wpeGetApiCredentialsStatus: jest.fn().mockResolvedValue({ configured: false }),
    });
    registerCredentialHandlers(deps);
    const handler = captureHandler(IPC_CHANNELS.WPE_GET_API_CREDENTIALS);
    const result = await handler();
    expect(result).toEqual({ username: '', password: '' });
  });

  // 5. GET_API_CREDENTIALS — returns username (no password) when configured
  it('WPE_GET_API_CREDENTIALS returns username but not password', async () => {
    const deps = createMockDeps({
      wpeGetApiCredentialsStatus: jest.fn().mockResolvedValue({ configured: true, username: 'myuser' }),
    });
    registerCredentialHandlers(deps);
    const handler = captureHandler(IPC_CHANNELS.WPE_GET_API_CREDENTIALS);
    const result = await handler();
    expect(result.username).toBe('myuser');
    expect(result.password).toBe('');
  });

  // 6. SET_API_CREDENTIALS — calls bridge and returns success
  it('WPE_SET_API_CREDENTIALS stores credentials and returns success', async () => {
    const deps = createMockDeps();
    registerCredentialHandlers(deps);
    const handler = captureHandler(IPC_CHANNELS.WPE_SET_API_CREDENTIALS);
    const result = await handler(null, 'testuser', 'testpass');
    expect(deps.localServicesBridge.wpeSetApiCredentials).toHaveBeenCalledWith('testuser', 'testpass');
    expect(result).toEqual({ success: true });
  });

  // 7. CLEAR_API_CREDENTIALS — calls bridge and returns success
  it('WPE_CLEAR_API_CREDENTIALS clears credentials and returns success', async () => {
    const deps = createMockDeps();
    registerCredentialHandlers(deps);
    const handler = captureHandler(IPC_CHANNELS.WPE_CLEAR_API_CREDENTIALS);
    const result = await handler();
    expect(deps.localServicesBridge.wpeClearApiCredentials).toHaveBeenCalled();
    expect(result).toEqual({ success: true });
  });

  // 8. Error handling — GET_API_CREDENTIALS_STATUS returns safe default on error
  it('WPE_GET_API_CREDENTIALS_STATUS returns safe default on bridge error', async () => {
    const deps = createMockDeps({
      wpeGetApiCredentialsStatus: jest.fn().mockRejectedValue(new Error('Bridge down')),
    });
    registerCredentialHandlers(deps);
    const handler = captureHandler(IPC_CHANNELS.WPE_GET_API_CREDENTIALS_STATUS);
    const result = await handler();
    expect(result).toEqual({ configured: false, username: null });
  });
});
