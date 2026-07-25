import { getAIProvider } from '../../src/main/ai/getAIProvider';
import type { NexusSettings } from '../../src/common/types';

// getAIProvider reads the decrypted key via KeyVault — mock it so no
// OS keychain / Electron safeStorage is touched under Jest.
jest.mock('../../src/main/security/KeyVault', () => ({
  getApiKey: jest.fn(() => 'wpe_test'),
}));

describe('getAIProvider — Power default model', () => {
  it('falls back to the Power default model when aiModel is unset', () => {
    const settings = { aiProvider: 'power' } as unknown as NexusSettings;
    const resolved = getAIProvider({} as any, settings);

    expect(resolved.provider).toBe('power');
    expect(resolved.model).toBe('anthropic/claude-haiku-4-5');
    expect(resolved.isAvailable).toBe(true); // key present via mocked KeyVault
  });
});
