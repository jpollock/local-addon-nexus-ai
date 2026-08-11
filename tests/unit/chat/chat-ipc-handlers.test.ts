/**
 * Reproduced live: saving/rotating an API key through SAVE_API_KEY or VALIDATE_API_KEY writes
 * to KeyVault correctly (chat picks it up immediately — it reads the key fresh on every
 * CHAT_SEND) but never told the agent runtime anything changed. AgentRunner/AgentDispatcher
 * each resolve their AI provider ONCE at Local startup and cache it for the process lifetime;
 * with no onSettingsUpdated call here, a rotated key left them using the stale one until some
 * unrelated settings field also happened to change (the only other call site). Result: chat
 * worked, the security-sentinel agent's specialist calls 401'd with "invalid or expired token"
 * using the old key, in the same running process, same key, same storage.
 */

class MockIpcMain {
  handlers = new Map<string, Function>();
  handle(channel: string, handler: Function) { this.handlers.set(channel, handler); }
  removeHandler(channel: string) { this.handlers.delete(channel); }
  invoke(channel: string, ...args: any[]) {
    const handler = this.handlers.get(channel);
    if (!handler) throw new Error(`No handler registered for ${channel}`);
    return handler({}, ...args);
  }
}
const mockIpc = new MockIpcMain();
jest.mock('electron', () => ({ ipcMain: mockIpc }));

import { registerChatIpcHandlers } from '../../../src/main/chat/chat-ipc-handlers';
import { IPC_CHANNELS } from '../../../src/common/constants';

function makeStorage() {
  const store = new Map<string, any>();
  return {
    get: (key: string) => store.get(key) ?? null,
    set: (key: string, value: any) => store.set(key, value),
  };
}

describe('chat-ipc-handlers — reactive refresh on key write', () => {
  it('SAVE_API_KEY calls onSettingsUpdated after writing the key', async () => {
    const onSettingsUpdated = jest.fn();
    registerChatIpcHandlers({
      chatService: {} as any,
      registryStorage: makeStorage() as any,
      localLogger: { info: () => {}, error: () => {} },
      onSettingsUpdated,
    });

    await mockIpc.invoke(IPC_CHANNELS.SAVE_API_KEY, 'power', 'wpe_rotated-key');

    expect(onSettingsUpdated).toHaveBeenCalledTimes(1);
  });

  it('does not throw when onSettingsUpdated is not provided (optional dep)', async () => {
    registerChatIpcHandlers({
      chatService: {} as any,
      registryStorage: makeStorage() as any,
      localLogger: { info: () => {}, error: () => {} },
    });

    await expect(mockIpc.invoke(IPC_CHANNELS.SAVE_API_KEY, 'power', 'wpe_key')).resolves.toEqual({ success: true });
  });
});

describe('CHAT_CLEAR_ALL', () => {
  it('calls clearAllSessions and returns success when DB available', async () => {
    const clearAllSessions = jest.fn(() => ({ success: true }));
    registerChatIpcHandlers({
      chatService: { clearAllSessions } as any,
      registryStorage: makeStorage() as any,
      localLogger: { info: () => {}, error: () => {} },
    });

    const result = await mockIpc.invoke(IPC_CHANNELS.CHAT_CLEAR_ALL);

    expect(clearAllSessions).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ success: true });
  });

  it('returns failure when clearAllSessions returns failure (DB not ready)', async () => {
    const clearAllSessions = jest.fn(() => ({ success: false, error: 'Database not available' }));
    registerChatIpcHandlers({
      chatService: { clearAllSessions } as any,
      registryStorage: makeStorage() as any,
      localLogger: { info: () => {}, error: () => {} },
    });

    const result = await mockIpc.invoke(IPC_CHANNELS.CHAT_CLEAR_ALL);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Database not available');
  });

  it('returns failure when clearAllSessions throws', async () => {
    const clearAllSessions = jest.fn(() => { throw new Error('Unexpected error'); });
    registerChatIpcHandlers({
      chatService: { clearAllSessions } as any,
      registryStorage: makeStorage() as any,
      localLogger: { info: () => {}, error: () => {} },
    });

    const result = await mockIpc.invoke(IPC_CHANNELS.CHAT_CLEAR_ALL);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Unexpected error');
  });
});
