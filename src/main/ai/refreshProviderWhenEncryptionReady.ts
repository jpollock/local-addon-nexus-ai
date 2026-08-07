/**
 * refreshProviderWhenEncryptionReady — fixes a startup race where
 * `safeStorage.isEncryptionAvailable()` is still false at the moment `getAIProvider()`
 * resolves the agent runtime's provider (index.ts, once per process at startup).
 *
 * When encryption isn't available yet, KeyVault.decrypt() falls back to "already
 * plaintext" and hands back the still-encrypted ciphertext as if it were the real key.
 * That wrong value then gets cached on AgentRunner/AgentDispatcher for the process's
 * lifetime — every agent LLM call 401s ("invalid or expired token") while chat, which
 * decrypts fresh per message well after startup, works fine with the identical stored
 * key. A restart doesn't help: it reproduces the same early-timing race every time.
 *
 * This polls until encryption comes up, then re-resolves the provider once and pushes
 * it through the same setProvider() hook onSettingsUpdated already uses for key rotation.
 */
export interface RefreshProviderDeps<T> {
  isEncryptionAvailable: () => boolean;
  resolveProvider: () => T;
  setProviders: (provider: T) => void;
  onGiveUp?: () => void;
  intervalMs?: number;
  maxAttempts?: number;
}

/** Returns a canceller. No-ops (and returns a no-op canceller) if encryption is already available. */
export function refreshProviderWhenEncryptionReady<T>(deps: RefreshProviderDeps<T>): () => void {
  const {
    isEncryptionAvailable,
    resolveProvider,
    setProviders,
    onGiveUp,
    intervalMs = 1000,
    maxAttempts = 30, // 30 x 1s = 30s ceiling
  } = deps;

  if (isEncryptionAvailable()) return () => {};

  let attempts = 0;
  const timer = setInterval(() => {
    attempts += 1;
    if (isEncryptionAvailable()) {
      clearInterval(timer);
      setProviders(resolveProvider());
    } else if (attempts >= maxAttempts) {
      clearInterval(timer);
      onGiveUp?.();
    }
  }, intervalMs);

  return () => clearInterval(timer);
}
