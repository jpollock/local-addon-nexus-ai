import { CredentialTokenVault } from '../../../src/main/credentials/CredentialTokenVault';
import { SafeStorageUnavailableError } from '../../../src/main/credentials/types';
import { safeStorage } from 'electron';

const mockSS = safeStorage as jest.Mocked<typeof safeStorage>;

function makeStorage() {
  const store = new Map<string, any>();
  return { get: (k: string) => store.get(k) ?? null, set: (k: string, v: any) => store.set(k, v) };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSS.isEncryptionAvailable.mockReturnValue(true);
  mockSS.encryptString.mockImplementation((s: string) => Buffer.from(`enc:${s}`));
  mockSS.decryptString.mockImplementation((b: Buffer) => b.toString().slice(4));
});

describe('CredentialTokenVault', () => {
  it('stores and retrieves a refresh token', () => {
    const vault = new CredentialTokenVault(makeStorage());
    vault.store('conn-1', 'google', 'rt_abc123');
    expect(vault.retrieve('conn-1', 'google')).toBe('rt_abc123');
  });

  it('returns null for a key that was never stored', () => {
    const vault = new CredentialTokenVault(makeStorage());
    expect(vault.retrieve('conn-x', 'google')).toBeNull();
  });

  it('delete removes the token; subsequent retrieve returns null', () => {
    const vault = new CredentialTokenVault(makeStorage());
    vault.store('conn-2', 'google', 'rt_xyz');
    vault.delete('conn-2', 'google');
    expect(vault.retrieve('conn-2', 'google')).toBeNull();
  });

  it('throws SafeStorageUnavailableError when encryption is unavailable', () => {
    mockSS.isEncryptionAvailable.mockReturnValue(false);
    const vault = new CredentialTokenVault(makeStorage());
    expect(() => vault.store('conn-3', 'google', 'rt_abc')).toThrow(SafeStorageUnavailableError);
  });

  it('tokens for different connections are independent', () => {
    const vault = new CredentialTokenVault(makeStorage());
    vault.store('conn-a', 'google', 'token-a');
    vault.store('conn-b', 'google', 'token-b');
    expect(vault.retrieve('conn-a', 'google')).toBe('token-a');
    expect(vault.retrieve('conn-b', 'google')).toBe('token-b');
    vault.delete('conn-a', 'google');
    expect(vault.retrieve('conn-a', 'google')).toBeNull();
    expect(vault.retrieve('conn-b', 'google')).toBe('token-b');
  });
});
