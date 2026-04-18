/**
 * KeyVault — Encrypted API key storage using Electron's safeStorage API.
 *
 * Keys are stored in RegistryStorage under the prefix `encrypted_` and
 * base64-encoded so they survive JSON serialisation. If safeStorage is not
 * available (e.g. headless CI or unsupported OS), the vault falls back to
 * plain-text storage with a warning — this allows the addon to remain
 * functional while surfacing the degraded security posture.
 *
 * Migration path: on first read, if no `encrypted_` key exists for a given
 * name the vault checks for a legacy plain-text value stored under the old
 * key name and migrates it transparently.
 */

import type { RegistryStorage } from '../content/IndexRegistry';
import { STORAGE_KEYS } from '../../common/constants';

// Electron is only available in the main process. We import it lazily so
// that jest.config.js moduleNameMapper can substitute the mock in tests.
import { safeStorage } from 'electron';

const ENCRYPTED_PREFIX = 'encrypted_';

export class KeyVault {
  private storage: RegistryStorage;
  private legacyStorageKey: string;

  /**
   * @param storage          - RegistryStorage instance (Local's userData wrapper)
   * @param legacyStorageKey - The plain-text storage key that was used before
   *                           encryption was introduced (e.g. STORAGE_KEYS.API_KEYS).
   *                           Used for migration on first read.
   */
  constructor(storage: RegistryStorage, legacyStorageKey: string) {
    this.storage = storage;
    this.legacyStorageKey = legacyStorageKey;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private get encryptionAvailable(): boolean {
    try {
      return safeStorage.isEncryptionAvailable();
    } catch {
      return false;
    }
  }

  /** Returns the storage key for a named API key. */
  private storageKey(keyName: string): string {
    return `${ENCRYPTED_PREFIX}${keyName}`;
  }

  /** Encrypt a string and return a base64-encoded representation. */
  private encrypt(value: string): string {
    if (!this.encryptionAvailable) {
      return value; // Fallback: plain text
    }
    const buf = safeStorage.encryptString(value);
    return buf.toString('base64');
  }

  /** Decrypt a base64-encoded ciphertext. Returns null on failure. */
  private decrypt(stored: string): string | null {
    if (!this.encryptionAvailable) {
      return stored; // Fallback: plain text
    }
    try {
      const buf = Buffer.from(stored, 'base64');
      return safeStorage.decryptString(buf);
    } catch {
      // The stored data may be a legacy plain-text value or otherwise corrupt.
      // Return null so the caller can handle the fallback.
      return null;
    }
  }

  /**
   * Attempt to read from the legacy plain-text storage blob and migrate the
   * value into encrypted storage. Returns the migrated value, or null.
   */
  private migrateFromLegacy(keyName: string): string | null {
    try {
      const blob = (this.storage.get(this.legacyStorageKey) ?? {}) as Record<string, string>;
      const plainValue = blob[keyName];
      if (plainValue) {
        // Write encrypted version
        this.setKey(keyName, plainValue);
        // Remove the plain-text value from the legacy blob
        delete blob[keyName];
        this.storage.set(this.legacyStorageKey, blob as any);
        return plainValue;
      }
    } catch {
      // Best-effort migration — never throws
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Encrypt and store an API key.
   */
  setKey(keyName: string, value: string): void {
    if (!this.encryptionAvailable) {
      console.warn(
        '[KeyVault] safeStorage encryption is not available on this system. ' +
        `Key "${keyName}" will be stored in plain text.`,
      );
    }

    const stored = this.encrypt(value);
    const key = this.storageKey(keyName);
    const blob = (this.storage.get(key) ?? {}) as Record<string, string>;
    blob[keyName] = stored;
    this.storage.set(key, blob as any);
  }

  /**
   * Retrieve and decrypt an API key. Returns null if not set.
   * Transparently migrates legacy plain-text keys on first access.
   */
  getKey(keyName: string): string | null {
    const key = this.storageKey(keyName);
    const blob = (this.storage.get(key) ?? {}) as Record<string, string>;
    const stored = blob[keyName];

    if (!stored) {
      // Attempt to migrate from legacy plain-text storage
      return this.migrateFromLegacy(keyName);
    }

    const decrypted = this.decrypt(stored);
    if (decrypted === null) {
      // Decryption failed — the value may have been written on a different
      // system or with a different user session key. Attempt legacy fallback.
      return this.migrateFromLegacy(keyName);
    }

    return decrypted;
  }

  /**
   * Returns true if a key has been stored (does not decrypt).
   */
  hasKey(keyName: string): boolean {
    const key = this.storageKey(keyName);
    const blob = (this.storage.get(key) ?? {}) as Record<string, string>;
    if (blob[keyName]) return true;

    // Also check legacy storage
    try {
      const legacyBlob = (this.storage.get(this.legacyStorageKey) ?? {}) as Record<string, string>;
      return Boolean(legacyBlob[keyName]);
    } catch {
      return false;
    }
  }

  /**
   * Delete a stored key from encrypted storage and legacy storage.
   */
  deleteKey(keyName: string): void {
    const key = this.storageKey(keyName);
    const blob = (this.storage.get(key) ?? {}) as Record<string, string>;
    delete blob[keyName];
    this.storage.set(key, blob as any);

    // Also clean up any residual plain-text value
    try {
      const legacyBlob = (this.storage.get(this.legacyStorageKey) ?? {}) as Record<string, string>;
      if (legacyBlob[keyName]) {
        delete legacyBlob[keyName];
        this.storage.set(this.legacyStorageKey, legacyBlob as any);
      }
    } catch {
      // Best-effort cleanup
    }
  }

  /**
   * Return a safe-for-display masked version of a key.
   * Shows the first 10 characters + "..." + the last 4 characters.
   * For short keys (< 15 chars) shows only asterisks.
   *
   * @example
   *   maskKey('sk-ant-api03_ABCDEF1234') // => 'sk-ant-api0...234'
   */
  maskKey(value: string): string {
    if (!value || value.length < 15) {
      return '****';
    }
    const head = value.slice(0, 10);
    const tail = value.slice(-4);
    return `${head}...${tail}`;
  }

  /**
   * Convenience: get a masked version of a stored key.
   * Returns null if the key is not set.
   */
  getMasked(keyName: string): { maskedKey: string; isSet: true } | { maskedKey: null; isSet: false } {
    const value = this.getKey(keyName);
    if (!value) {
      return { maskedKey: null, isSet: false };
    }
    return { maskedKey: this.maskKey(value), isSet: true };
  }
}

// ---------------------------------------------------------------------------
// Module-level convenience helpers for non-class callers
// ---------------------------------------------------------------------------

/**
 * Convenience: get a decrypted API key for a provider from the standard storage.
 * Handles migration from legacy plain-text storage transparently.
 */
export function getApiKey(storage: RegistryStorage, providerId: string): string | null {
  const vault = new KeyVault(storage, STORAGE_KEYS.API_KEYS);
  return vault.getKey(providerId);
}

/**
 * Convenience: check whether an API key exists for a provider.
 * Handles migration from legacy plain-text storage transparently.
 */
export function hasApiKey(storage: RegistryStorage, providerId: string): boolean {
  const vault = new KeyVault(storage, STORAGE_KEYS.API_KEYS);
  return vault.hasKey(providerId);
}
