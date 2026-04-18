/**
 * KeyVault unit tests
 *
 * The electron module is mocked via jest.config.js moduleNameMapper:
 *   '^electron$' → '<rootDir>/tests/__mocks__/electron.ts'
 *
 * The mock provides safeStorage with deterministic encrypt/decrypt:
 *   encryptString(s)  → Buffer.from(`enc:${s}`)
 *   decryptString(b)  → b.toString().slice(4)   // strips "enc:" prefix
 */
import { KeyVault, getApiKey, hasApiKey } from '../../../src/main/security/KeyVault';
import { safeStorage } from 'electron';

// ---------------------------------------------------------------------------
// Helper: in-memory RegistryStorage
// ---------------------------------------------------------------------------

function makeStorage(): { store: Map<string, any>; get: (k: string) => any; set: (k: string, v: any) => void } {
  const store = new Map<string, any>();
  return {
    store,
    get: (k: string) => store.get(k) ?? null,
    set: (k: string, v: any) => store.set(k, v),
  };
}

const LEGACY_KEY = 'nexus-ai_api_keys';

// ---------------------------------------------------------------------------
// Mocked safeStorage
// ---------------------------------------------------------------------------

const mockSafeStorage = safeStorage as jest.Mocked<typeof safeStorage>;

beforeEach(() => {
  jest.clearAllMocks();
  // Default: encryption is available
  mockSafeStorage.isEncryptionAvailable.mockReturnValue(true);
  mockSafeStorage.encryptString.mockImplementation((s: string) => Buffer.from(`enc:${s}`));
  mockSafeStorage.decryptString.mockImplementation((b: Buffer) => {
    const str = b.toString();
    return str.startsWith('enc:') ? str.slice(4) : str;
  });
});

// ---------------------------------------------------------------------------
// setKey / getKey round-trip
// ---------------------------------------------------------------------------

describe('KeyVault.setKey / getKey', () => {
  it('encrypts and stores the key, then decrypts on retrieval', () => {
    const storage = makeStorage();
    const vault = new KeyVault(storage, LEGACY_KEY);

    vault.setKey('anthropic', 'sk-ant-api03_testkey');
    expect(mockSafeStorage.encryptString).toHaveBeenCalledWith('sk-ant-api03_testkey');

    const retrieved = vault.getKey('anthropic');
    expect(retrieved).toBe('sk-ant-api03_testkey');
    expect(mockSafeStorage.decryptString).toHaveBeenCalled();
  });

  it('stores key under encrypted_ prefix, not the legacy key', () => {
    const storage = makeStorage();
    const vault = new KeyVault(storage, LEGACY_KEY);

    vault.setKey('openai', 'sk-openai-test');

    // The raw storage should have an `encrypted_openai` blob, not the legacy key
    const encryptedBlob = storage.get('encrypted_openai');
    expect(encryptedBlob).toBeDefined();
    expect(encryptedBlob.openai).toBeDefined();

    // The legacy storage blob should remain untouched
    const legacy = storage.get(LEGACY_KEY);
    expect(legacy).toBeNull();
  });

  it('returns null for an unset key', () => {
    const storage = makeStorage();
    const vault = new KeyVault(storage, LEGACY_KEY);
    expect(vault.getKey('google')).toBeNull();
  });

  it('round-trips multiple keys independently', () => {
    const storage = makeStorage();
    const vault = new KeyVault(storage, LEGACY_KEY);

    vault.setKey('anthropic', 'key-anthropic');
    vault.setKey('openai', 'key-openai');

    expect(vault.getKey('anthropic')).toBe('key-anthropic');
    expect(vault.getKey('openai')).toBe('key-openai');
    expect(vault.getKey('google')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// hasKey
// ---------------------------------------------------------------------------

describe('KeyVault.hasKey', () => {
  it('returns false when no key is stored', () => {
    const storage = makeStorage();
    const vault = new KeyVault(storage, LEGACY_KEY);
    expect(vault.hasKey('anthropic')).toBe(false);
  });

  it('returns true after a key is set', () => {
    const storage = makeStorage();
    const vault = new KeyVault(storage, LEGACY_KEY);
    vault.setKey('anthropic', 'sk-ant-api03_testkey');
    expect(vault.hasKey('anthropic')).toBe(true);
  });

  it('returns true for a key in legacy storage', () => {
    const storage = makeStorage();
    // Pre-populate legacy storage
    storage.set(LEGACY_KEY, { google: 'AIza-legacy-key' });
    const vault = new KeyVault(storage, LEGACY_KEY);
    expect(vault.hasKey('google')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// deleteKey
// ---------------------------------------------------------------------------

describe('KeyVault.deleteKey', () => {
  it('removes an encrypted key', () => {
    const storage = makeStorage();
    const vault = new KeyVault(storage, LEGACY_KEY);
    vault.setKey('anthropic', 'sk-ant-api03_testkey');
    expect(vault.hasKey('anthropic')).toBe(true);

    vault.deleteKey('anthropic');
    expect(vault.hasKey('anthropic')).toBe(false);
    expect(vault.getKey('anthropic')).toBeNull();
  });

  it('also removes a residual legacy plain-text key', () => {
    const storage = makeStorage();
    storage.set(LEGACY_KEY, { openai: 'sk-openai-legacy' });
    const vault = new KeyVault(storage, LEGACY_KEY);

    vault.deleteKey('openai');

    const legacy = storage.get(LEGACY_KEY) as Record<string, string>;
    expect(legacy?.openai).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// maskKey
// ---------------------------------------------------------------------------

describe('KeyVault.maskKey', () => {
  const vault = new KeyVault(makeStorage(), LEGACY_KEY);

  it('masks an Anthropic-style key (first 10 + ... + last 4)', () => {
    const masked = vault.maskKey('sk-ant-api03_ABCDEF1234XXXX');
    expect(masked).toBe('sk-ant-api...XXXX');
  });

  it('masks an OpenAI-style key', () => {
    const masked = vault.maskKey('sk-openai-ABCDEFGHIJKlmnop1234');
    expect(masked).toBe('sk-openai-...1234');
  });

  it('returns asterisks for short keys (< 15 chars)', () => {
    expect(vault.maskKey('short')).toBe('****');
    expect(vault.maskKey('')).toBe('****');
    expect(vault.maskKey('12345678901234')).toBe('****'); // exactly 14 chars
  });

  it('handles exactly 15-char keys', () => {
    const masked = vault.maskKey('123456789012345');
    expect(masked).toBe('1234567890...2345');
  });
});

// ---------------------------------------------------------------------------
// getMasked
// ---------------------------------------------------------------------------

describe('KeyVault.getMasked', () => {
  it('returns isSet=false and maskedKey=null when no key stored', () => {
    const vault = new KeyVault(makeStorage(), LEGACY_KEY);
    const result = vault.getMasked('anthropic');
    expect(result.isSet).toBe(false);
    expect(result.maskedKey).toBeNull();
  });

  it('returns isSet=true and a masked string when key is stored', () => {
    const storage = makeStorage();
    const vault = new KeyVault(storage, LEGACY_KEY);
    vault.setKey('anthropic', 'sk-ant-api03_ABCDEF1234XXXX');

    const result = vault.getMasked('anthropic');
    expect(result.isSet).toBe(true);
    expect(result.maskedKey).toBe('sk-ant-api...XXXX');
  });
});

// ---------------------------------------------------------------------------
// Fallback when encryption is unavailable
// ---------------------------------------------------------------------------

describe('KeyVault fallback (encryption unavailable)', () => {
  beforeEach(() => {
    mockSafeStorage.isEncryptionAvailable.mockReturnValue(false);
  });

  it('stores plain text when encryption unavailable', () => {
    const storage = makeStorage();
    const vault = new KeyVault(storage, LEGACY_KEY);
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    vault.setKey('anthropic', 'sk-ant-api03_plaintext');

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('safeStorage encryption is not available'),
    );

    // encryptString should NOT have been called
    expect(mockSafeStorage.encryptString).not.toHaveBeenCalled();

    // Value should still be retrievable
    const retrieved = vault.getKey('anthropic');
    expect(retrieved).toBe('sk-ant-api03_plaintext');

    consoleSpy.mockRestore();
  });

  it('retrieves plain text correctly when encryption unavailable', () => {
    const storage = makeStorage();
    const vault = new KeyVault(storage, LEGACY_KEY);
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    vault.setKey('openai', 'sk-openai-plain');
    expect(vault.getKey('openai')).toBe('sk-openai-plain');

    consoleSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Legacy migration
// ---------------------------------------------------------------------------

describe('KeyVault legacy migration', () => {
  it('reads from legacy plain-text storage if no encrypted key exists', () => {
    const storage = makeStorage();
    storage.set(LEGACY_KEY, { anthropic: 'sk-ant-api03_legacy' });

    const vault = new KeyVault(storage, LEGACY_KEY);
    const key = vault.getKey('anthropic');
    expect(key).toBe('sk-ant-api03_legacy');
  });

  it('migrates legacy key into encrypted storage on first read', () => {
    const storage = makeStorage();
    storage.set(LEGACY_KEY, { anthropic: 'sk-ant-api03_legacy' });

    const vault = new KeyVault(storage, LEGACY_KEY);
    vault.getKey('anthropic');

    // After migration: encrypted blob should exist
    expect(vault.hasKey('anthropic')).toBe(true);

    // Legacy blob should be cleared
    const legacy = storage.get(LEGACY_KEY) as Record<string, string>;
    expect(legacy?.anthropic).toBeUndefined();
  });

  it('returns null if neither encrypted nor legacy key exists', () => {
    const storage = makeStorage();
    const vault = new KeyVault(storage, LEGACY_KEY);
    expect(vault.getKey('anthropic')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Module-level helpers
// ---------------------------------------------------------------------------

describe('getApiKey / hasApiKey module helpers', () => {
  it('getApiKey returns the decrypted key', () => {
    const storage = makeStorage();
    const vault = new KeyVault(storage, LEGACY_KEY);
    vault.setKey('google', 'AIza-google-key-12345678');

    const key = getApiKey(storage, 'google');
    expect(key).toBe('AIza-google-key-12345678');
  });

  it('getApiKey returns null for unset key', () => {
    const storage = makeStorage();
    expect(getApiKey(storage, 'anthropic')).toBeNull();
  });

  it('hasApiKey returns true for a set key', () => {
    const storage = makeStorage();
    const vault = new KeyVault(storage, LEGACY_KEY);
    vault.setKey('openai', 'sk-openai-12345678');
    expect(hasApiKey(storage, 'openai')).toBe(true);
  });

  it('hasApiKey returns false for an unset key', () => {
    const storage = makeStorage();
    expect(hasApiKey(storage, 'openai')).toBe(false);
  });

  it('hasApiKey returns true for a legacy plain-text key', () => {
    const storage = makeStorage();
    storage.set(LEGACY_KEY, { anthropic: 'sk-ant-legacy' });
    expect(hasApiKey(storage, 'anthropic')).toBe(true);
  });
});
