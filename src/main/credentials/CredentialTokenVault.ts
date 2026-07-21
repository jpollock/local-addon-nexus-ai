import { safeStorage } from 'electron';
import { KeyVault } from '../security/KeyVault';
import type { RegistryStorage } from '../content/IndexRegistry';
import { SafeStorageUnavailableError } from './types';
import { STORAGE_KEYS } from '../../common/constants';

// Key pattern: google-connection:{connectionId}:refresh_token
// Stored as a named key inside KeyVault, using OAUTH_CONNECTIONS as the legacy key name
// (no actual legacy data — just satisfies KeyVault constructor signature).

export class CredentialTokenVault {
  private vault: KeyVault;

  constructor(storage: RegistryStorage) {
    this.vault = new KeyVault(storage, STORAGE_KEYS.OAUTH_VAULT);
  }

  private key(connectionId: string, provider: string): string {
    return `${provider}-connection:${connectionId}:refresh_token`;
  }

  private assertEncryptionAvailable(): void {
    let available = false;
    try { available = safeStorage.isEncryptionAvailable(); } catch { /* noop */ }
    if (!available) throw new SafeStorageUnavailableError();
  }

  store(connectionId: string, provider: string, refreshToken: string): void {
    this.assertEncryptionAvailable();
    this.vault.setKey(this.key(connectionId, provider), refreshToken);
  }

  retrieve(connectionId: string, provider: string): string | null {
    return this.vault.getKey(this.key(connectionId, provider));
  }

  delete(connectionId: string, provider: string): void {
    this.vault.deleteKey(this.key(connectionId, provider));
  }
}
