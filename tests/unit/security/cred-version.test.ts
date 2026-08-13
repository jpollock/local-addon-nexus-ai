import { KeyVault, credentialVersion } from '../../../src/main/security/KeyVault';
import { STORAGE_KEYS } from '../../../src/common/constants';

function memStorage() {
  const data: Record<string, any> = {};
  return { get: (k: string) => data[k], set: (k: string, v: any) => { data[k] = v; }, _data: data } as any;
}

describe('KeyVault credential version (P1-7 creds rotate)', () => {
  it('starts at 0 for an unset provider', () => {
    const s = memStorage();
    expect(credentialVersion(s, 'anthropic')).toBe(0);
  });

  it('bumps to 1 on first setKey', () => {
    const s = memStorage();
    const v = new KeyVault(s, STORAGE_KEYS.API_KEYS);
    v.setKey('anthropic', 'sk-ant-first');
    expect(credentialVersion(s, 'anthropic')).toBe(1);
  });

  it('increments when the key value actually changes (a rotation)', () => {
    const s = memStorage();
    const v = new KeyVault(s, STORAGE_KEYS.API_KEYS);
    v.setKey('anthropic', 'sk-ant-first');
    v.setKey('anthropic', 'sk-ant-rotated');
    expect(credentialVersion(s, 'anthropic')).toBe(2);
  });

  it('does NOT bump when the same value is re-set (a re-sync, not a rotation)', () => {
    const s = memStorage();
    const v = new KeyVault(s, STORAGE_KEYS.API_KEYS);
    v.setKey('anthropic', 'sk-ant-same');
    v.setKey('anthropic', 'sk-ant-same');
    expect(credentialVersion(s, 'anthropic')).toBe(1);
  });

  it('tracks versions per provider independently', () => {
    const s = memStorage();
    const v = new KeyVault(s, STORAGE_KEYS.API_KEYS);
    v.setKey('anthropic', 'a1');
    v.setKey('anthropic', 'a2');
    v.setKey('openai', 'o1');
    expect(credentialVersion(s, 'anthropic')).toBe(2);
    expect(credentialVersion(s, 'openai')).toBe(1);
  });
});
