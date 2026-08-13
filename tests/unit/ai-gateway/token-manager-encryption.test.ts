import {
  storeSiteToken,
  getSiteIdFromToken,
  revokeSiteToken,
} from '../../../src/main/ai-gateway/token-manager';

const KEY = 'nexus_ai_gateway_tokens';

function memStorage() {
  const store: Record<string, any> = {};
  return {
    store,
    get: (k: string) => store[k] ?? null,
    set: (k: string, v: any) => {
      store[k] = v;
    },
  } as any;
}

/**
 * P1-4: gateway bearer tokens were persisted as a plaintext object in registryStorage, beside the
 * safeStorage-encrypted API keys they sit next to. Encrypt the map at rest (safeStorage, mirroring
 * KeyVault), with a one-time migration for any legacy plaintext blob.
 *
 * The electron mock (tests/__mocks__/electron.ts) makes safeStorage "available" and prefixes
 * ciphertext with `enc:`, so the encryption path is exercised here.
 */
describe('token-manager — bearer tokens encrypted at rest (P1-4)', () => {
  it('persists the token map as an encrypted string, not a plaintext object', () => {
    const storage = memStorage();
    storeSiteToken(storage, 'site-1', 'Site One', 'tok-abc');

    const raw = storage.store[KEY];
    expect(typeof raw).toBe('string');
    // Went through safeStorage.encryptString (mock marks ciphertext with `enc:`).
    expect(Buffer.from(raw, 'base64').toString()).toMatch(/^enc:/);
    // The plaintext token / site id must not be readable in the stored blob.
    expect(raw).not.toContain('tok-abc');
    expect(raw).not.toContain('site-1');
  });

  it('round-trips: a stored token still resolves to its site id', () => {
    const storage = memStorage();
    storeSiteToken(storage, 'site-1', 'Site One', 'tok-abc');
    expect(getSiteIdFromToken(storage, 'tok-abc')).toBe('site-1');
  });

  it('migrates a legacy plaintext object to the encrypted string form on read', () => {
    const storage = memStorage();
    storage.store[KEY] = {
      'tok-legacy': { siteId: 'site-9', siteName: 'Old', token: 'tok-legacy', createdAt: 1 },
    };

    expect(getSiteIdFromToken(storage, 'tok-legacy')).toBe('site-9');
    // The read migrated it in place.
    expect(typeof storage.store[KEY]).toBe('string');
  });

  it('revoke removes the token and keeps the store encrypted', () => {
    const storage = memStorage();
    storeSiteToken(storage, 'site-1', 'Site One', 'tok-abc');
    revokeSiteToken(storage, 'site-1');

    expect(getSiteIdFromToken(storage, 'tok-abc')).toBeNull();
    expect(typeof storage.store[KEY]).toBe('string');
  });
});
