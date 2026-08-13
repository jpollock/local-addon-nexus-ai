import { safeStorage } from 'electron';
import { isKeyStorageEncrypted } from '../../../src/main/security/KeyVault';

const storage = { get: () => undefined, set: () => {} } as any;

describe('isKeyStorageEncrypted (P1-7 doctor check)', () => {
  afterEach(() => {
    (safeStorage.isEncryptionAvailable as jest.Mock).mockReturnValue(true);
  });

  it('true when safeStorage encryption is available', () => {
    (safeStorage.isEncryptionAvailable as jest.Mock).mockReturnValue(true);
    expect(isKeyStorageEncrypted(storage)).toBe(true);
  });

  it('false when safeStorage falls back to plain text', () => {
    (safeStorage.isEncryptionAvailable as jest.Mock).mockReturnValue(false);
    expect(isKeyStorageEncrypted(storage)).toBe(false);
  });

  it('false (fail-safe) when safeStorage throws', () => {
    (safeStorage.isEncryptionAvailable as jest.Mock).mockImplementation(() => {
      throw new Error('unavailable');
    });
    expect(isKeyStorageEncrypted(storage)).toBe(false);
  });
});
