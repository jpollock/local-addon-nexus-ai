/**
 * Credential IPC Handlers
 *
 * Handles WPE API credential storage/retrieval. AI provider credentials
 * (VALIDATE_API_KEY, SAVE_API_KEY, GET_API_KEY, etc.) live in
 * src/main/chat/chat-ipc-handlers.ts.
 */
import { IPC_CHANNELS } from '../../../common/constants';
import type { IpcHandlerDeps } from '../../types/ipc-handler-deps';
import { safeHandle } from '../safe-handle';

export function registerCredentialHandlers(deps: IpcHandlerDeps): void {
  const { localServicesBridge, localLogger } = deps;

  // =========================================================================
  // WPE API Credentials (for backup creation via basic auth)
  // =========================================================================

  safeHandle(IPC_CHANNELS.WPE_GET_API_CREDENTIALS_STATUS, async () => {
    try {
      const status = await localServicesBridge.wpeGetApiCredentialsStatus();
      return { configured: status.configured, username: status.username ?? null };
    } catch (err: any) {
      localLogger.error(`[NexusAI] Failed to get WPE credentials status: ${err.message}`);
      return { configured: false, username: null };
    }
  });

  safeHandle(IPC_CHANNELS.WPE_GET_API_CREDENTIALS, async () => {
    try {
      const status = await localServicesBridge.wpeGetApiCredentialsStatus();
      if (!status.configured) {
        return { username: '', password: '' };
      }
      // Return username only for display, password stays encrypted
      return { username: status.username ?? '', password: '' };
    } catch (err: any) {
      localLogger.error(`[NexusAI] Failed to get WPE credentials: ${err.message}`);
      return { username: '', password: '' };
    }
  });

  safeHandle(IPC_CHANNELS.WPE_SET_API_CREDENTIALS, async (_event: any, username: string, password: string) => {
    try {
      await localServicesBridge.wpeSetApiCredentials(username, password);
      localLogger.info(`[NexusAI] WPE API credentials stored for user: ${username}`);
      return { success: true };
    } catch (err: any) {
      localLogger.error(`[NexusAI] Failed to store WPE credentials: ${err.message}`);
      throw err;
    }
  });

  safeHandle(IPC_CHANNELS.WPE_CLEAR_API_CREDENTIALS, async () => {
    try {
      await localServicesBridge.wpeClearApiCredentials();
      localLogger.info(`[NexusAI] WPE API credentials cleared`);
      return { success: true };
    } catch (err: any) {
      localLogger.error(`[NexusAI] Failed to clear WPE credentials: ${err.message}`);
      throw err;
    }
  });
}
