import { IPC_CHANNELS, STORAGE_KEYS, CHAT_DEFAULTS } from '../../common/constants';
import type { RegistryStorage } from '../content/IndexRegistry';
import type { ChatService } from './ChatService';
import { getProvider, listProviders } from './providers/index';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { ipcMain } = require('electron');

export interface ChatIpcHandlerDeps {
  chatService: ChatService;
  registryStorage: RegistryStorage;
  localLogger: { info(...args: unknown[]): void; error(...args: unknown[]): void };
}

export function registerChatIpcHandlers(deps: ChatIpcHandlerDeps): void {
  const { chatService, registryStorage, localLogger } = deps;

  // -----------------------------------------------------------------------
  // Chat
  // -----------------------------------------------------------------------

  ipcMain.handle(
    IPC_CHANNELS.CHAT_SEND,
    async (
      _event: any,
      sessionId: string,
      message: string,
      providerId: string,
      model: string,
      siteId?: string,
    ) => {
      try {
        const apiKey = getStoredApiKey(registryStorage, providerId);
        await chatService.sendMessage(sessionId, message, {
          providerId,
          model,
          apiKey: apiKey ?? undefined,
        }, siteId);
        return { success: true };
      } catch (err) {
        localLogger.error('[NexusAI] chat-send failed:', (err as Error).message);
        return { success: false, error: (err as Error).message };
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.CHAT_TOOL_APPROVE,
    (_event: any, sessionId: string, toolCallId: string, approved: boolean) => {
      chatService.resolveApproval(sessionId, toolCallId, approved);
      return { success: true };
    },
  );

  ipcMain.handle(IPC_CHANNELS.CHAT_STOP, (_event: any, sessionId: string) => {
    chatService.stopGeneration(sessionId);
    return { success: true };
  });

  ipcMain.handle(IPC_CHANNELS.CHAT_CLEAR, (_event: any, sessionId: string) => {
    chatService.clearSession(sessionId);
    return { success: true };
  });

  // -----------------------------------------------------------------------
  // Provider Management
  // -----------------------------------------------------------------------

  ipcMain.handle(IPC_CHANNELS.GET_PROVIDERS, () => {
    return listProviders();
  });

  ipcMain.handle(
    IPC_CHANNELS.GET_MODELS,
    async (_event: any, providerId: string) => {
      const provider = getProvider(providerId);
      if (!provider) return [];

      const apiKey = getStoredApiKey(registryStorage, providerId);
      try {
        return await provider.listModels({
          apiKey: apiKey ?? undefined,
          model: '',
        });
      } catch {
        return provider.defaultModels;
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.VALIDATE_API_KEY,
    async (_event: any, providerId: string, apiKey: string) => {
      const provider = getProvider(providerId);
      if (!provider) {
        return { valid: false, error: 'Unknown provider' };
      }

      const error = await provider.validateKey(apiKey);
      if (!error) {
        // Store the key on successful validation
        storeApiKey(registryStorage, providerId, apiKey);
        setKeyStatus(registryStorage, providerId, 'valid');
        return { valid: true };
      }

      setKeyStatus(registryStorage, providerId, 'invalid');
      return { valid: false, error };
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.SAVE_API_KEY,
    (_event: any, providerId: string, apiKey: string) => {
      storeApiKey(registryStorage, providerId, apiKey);
      setKeyStatus(registryStorage, providerId, 'unchecked');
      return { success: true };
    },
  );

  ipcMain.handle(IPC_CHANNELS.GET_API_KEY_STATUS, () => {
    return getKeyStatuses(registryStorage);
  });
}

// ---------------------------------------------------------------------------
// API Key Storage Helpers
// ---------------------------------------------------------------------------

function getStoredApiKey(storage: RegistryStorage, providerId: string): string | null {
  const keys = (storage.get(STORAGE_KEYS.API_KEYS) ?? {}) as Record<string, string>;
  return keys[providerId] ?? null;
}

function storeApiKey(storage: RegistryStorage, providerId: string, apiKey: string): void {
  const keys = (storage.get(STORAGE_KEYS.API_KEYS) ?? {}) as Record<string, string>;
  keys[providerId] = apiKey;
  storage.set(STORAGE_KEYS.API_KEYS, keys as any);
}

function getKeyStatuses(storage: RegistryStorage): Record<string, string> {
  return (storage.get(STORAGE_KEYS.API_KEY_STATUS) ?? {}) as Record<string, string>;
}

function setKeyStatus(storage: RegistryStorage, providerId: string, status: string): void {
  const statuses = getKeyStatuses(storage);
  statuses[providerId] = status;
  storage.set(STORAGE_KEYS.API_KEY_STATUS, statuses as any);
}
