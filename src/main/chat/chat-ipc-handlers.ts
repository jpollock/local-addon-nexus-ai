import { IPC_CHANNELS, STORAGE_KEYS, CHAT_DEFAULTS } from '../../common/constants';
import type { RegistryStorage } from '../content/IndexRegistry';
import type { ChatService } from './ChatService';
import type { CredentialSyncBroadcaster } from '../credentials/CredentialSyncBroadcaster';
import { getProvider, listProviders } from './providers/index';
import { KeyVault } from '../security/KeyVault';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { ipcMain } = require('electron');

export interface ChatIpcHandlerDeps {
  chatService: ChatService;
  registryStorage: RegistryStorage;
  localLogger: { info(...args: unknown[]): void; error(...args: unknown[]): void };
  credentialBroadcaster?: CredentialSyncBroadcaster;
}

export function registerChatIpcHandlers(deps: ChatIpcHandlerDeps): void {
  const { chatService, registryStorage, localLogger, credentialBroadcaster } = deps;

  // Create a KeyVault scoped to API key storage, with migration support for
  // the legacy plain-text API_KEYS storage blob.
  const keyVault = new KeyVault(registryStorage, STORAGE_KEYS.API_KEYS);

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
        // Use KeyVault to retrieve decrypted key — stays server-side only
        const apiKey = keyVault.getKey(providerId);
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

      // Decrypt key server-side — never send to renderer
      const apiKey = keyVault.getKey(providerId);
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
        // Store the key encrypted on successful validation
        keyVault.setKey(providerId, apiKey);
        setKeyStatus(registryStorage, providerId, 'valid');
        return { valid: true };
      }

      setKeyStatus(registryStorage, providerId, 'invalid');
      return { valid: false, error };
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.SAVE_API_KEY,
    async (_event: any, providerId: string, apiKey: string) => {
      keyVault.setKey(providerId, apiKey.trim());
      setKeyStatus(registryStorage, providerId, 'unchecked');

      // Broadcast key change to all running WordPress sites (fire-and-forget)
      if (credentialBroadcaster) {
        credentialBroadcaster.broadcastKeyChange(providerId).catch((err) => {
          localLogger.error('[NexusAI] Credential broadcast failed:', (err as Error).message);
        });
      }

      return { success: true };
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.GET_API_KEY,
    (_event: any, providerId: string) => {
      // Return a masked representation — the full key stays in the main process.
      // The renderer uses this to display "key is set" state without receiving
      // the actual secret.
      return keyVault.getMasked(providerId);
    },
  );

  ipcMain.handle(IPC_CHANNELS.GET_API_KEY_STATUS, () => {
    return getKeyStatuses(registryStorage);
  });

  // -----------------------------------------------------------------------
  // Credential Sync (Sprint 4)
  // -----------------------------------------------------------------------

  ipcMain.handle(IPC_CHANNELS.SYNC_ALL_CREDENTIALS, async () => {
    if (!credentialBroadcaster) {
      return { success: false, error: 'Credential broadcaster not available' };
    }
    try {
      // Collect all provider IDs that have stored keys (check both encrypted
      // and any remaining legacy storage so no providers are skipped).
      const legacyKeys = (registryStorage.get(STORAGE_KEYS.API_KEYS) ?? {}) as Record<string, string>;
      const providerIds = new Set<string>(Object.keys(legacyKeys).filter((k) => legacyKeys[k]));

      // Also check encrypted storage
      const knownProviders = listProviders().map((p) => p.id);
      for (const pid of knownProviders) {
        if (keyVault.hasKey(pid)) {
          providerIds.add(pid);
        }
      }

      const allResults = [];
      for (const providerId of providerIds) {
        const results = await credentialBroadcaster.broadcastKeyChange(providerId);
        allResults.push(...results);
      }

      // Deduplicate by siteId (keep last result per site)
      const bySite = new Map<string, typeof allResults[0]>();
      for (const r of allResults) {
        bySite.set(r.siteId, r);
      }
      return { success: true, results: Array.from(bySite.values()) };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.GET_CREDENTIAL_SYNC_STATUS, () => {
    if (!credentialBroadcaster) {
      return {};
    }
    return credentialBroadcaster.getSyncStatus();
  });
}

// ---------------------------------------------------------------------------
// Key Status Helpers (status flags remain plain text — not secrets)
// ---------------------------------------------------------------------------

function getKeyStatuses(storage: RegistryStorage): Record<string, string> {
  return (storage.get(STORAGE_KEYS.API_KEY_STATUS) ?? {}) as Record<string, string>;
}

function setKeyStatus(storage: RegistryStorage, providerId: string, status: string): void {
  const statuses = getKeyStatuses(storage);
  statuses[providerId] = status;
  storage.set(STORAGE_KEYS.API_KEY_STATUS, statuses as any);
}

// ---------------------------------------------------------------------------
// Re-export KeyVault factory so other parts of the main process can obtain a
// decrypted key without going through IPC.
// ---------------------------------------------------------------------------

/**
 * Build a KeyVault instance backed by the given storage object.
 * Use this in non-IPC code (e.g. CredentialSyncBroadcaster) to decrypt keys.
 */
export function createKeyVault(storage: RegistryStorage): KeyVault {
  return new KeyVault(storage, STORAGE_KEYS.API_KEYS);
}
