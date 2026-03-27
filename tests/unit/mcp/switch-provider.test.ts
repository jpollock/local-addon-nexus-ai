/**
 * Unit tests for switchProviderForSite
 */

jest.mock('fs', () => ({
  existsSync: jest.fn().mockReturnValue(true),
  cpSync: jest.fn(),
}));
import * as fs from 'fs';

import { switchProviderForSite } from '../../../src/main/mcp/modules/wp-connector/switch-provider';
import { STORAGE_KEYS } from '../../../src/common/constants';

function createMockServices(overrides?: any) {
  return {
    localServices: {
      wpCliRun: jest.fn().mockResolvedValue({ success: true, stdout: '' }),
      resolveSiteObject: jest.fn().mockReturnValue({
        paths: { webRoot: '/sites/mysite/app/public' },
      }),
      ...overrides?.localServices,
    },
    registryStorage: {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === STORAGE_KEYS.SITE_AI_CONFIG) return {};
        if (key === STORAGE_KEYS.API_KEYS) return {};
        return null;
      }),
      set: jest.fn(),
      ...overrides?.registryStorage,
    },
    logger: { info: jest.fn(), error: jest.fn(), ...overrides?.logger },
  };
}

describe('switchProviderForSite', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (fs.cpSync as jest.Mock).mockImplementation(() => {});
  });

  // 1. Switches from one external provider to another (gateway off)
  it('deactivates old slug, installs new from wp.org, updates SiteAIConfig', async () => {
    const mocks = createMockServices({
      registryStorage: {
        get: jest.fn().mockImplementation((key: string) => {
          if (key === STORAGE_KEYS.SITE_AI_CONFIG) {
            return { 'site-1': { provider: 'openai', configuredAt: 0 } };
          }
          if (key === STORAGE_KEYS.API_KEYS) return {};
          return null;
        }),
        set: jest.fn(),
      },
    });

    const result = await switchProviderForSite(
      'site-1',
      'anthropic',
      mocks.localServices as any,
      mocks.registryStorage as any,
      mocks.logger as any,
    );

    expect(result.success).toBe(true);
    expect(result.previousProvider).toBe('openai');
    expect(result.newProvider).toBe('anthropic');

    // Deactivated old slug
    expect(mocks.localServices.wpCliRun).toHaveBeenCalledWith('site-1', [
      'plugin', 'deactivate', 'ai-provider-for-openai', '--quiet',
    ]);

    // Activated new slug (already installed path)
    expect(mocks.localServices.wpCliRun).toHaveBeenCalledWith('site-1', [
      'plugin', 'activate', 'ai-provider-for-anthropic', '--quiet',
    ]);

    // SiteAIConfig updated
    expect(mocks.registryStorage.set).toHaveBeenCalledWith(
      STORAGE_KEYS.SITE_AI_CONFIG,
      expect.objectContaining({
        'site-1': expect.objectContaining({ provider: 'anthropic' }),
      }),
    );
  });

  // 2. Switches to Ollama (bundled plugin, already installed)
  it('activates ollama plugin on first try (already installed), no install step', async () => {
    const mocks = createMockServices();

    const result = await switchProviderForSite(
      'site-1',
      'ollama',
      mocks.localServices as any,
      mocks.registryStorage as any,
      mocks.logger as any,
    );

    expect(result.success).toBe(true);
    expect(result.newProvider).toBe('ollama');

    // Activate was called
    expect(mocks.localServices.wpCliRun).toHaveBeenCalledWith('site-1', [
      'plugin', 'activate', 'ai-provider-for-ollama', '--quiet',
    ]);

    // No install from wp.org
    expect(mocks.localServices.wpCliRun).not.toHaveBeenCalledWith(
      'site-1',
      expect.arrayContaining(['install']),
    );

    // No file copy needed (activate succeeded first try)
    expect(fs.cpSync).not.toHaveBeenCalled();

    // SiteAIConfig updated
    expect(mocks.registryStorage.set).toHaveBeenCalledWith(
      STORAGE_KEYS.SITE_AI_CONFIG,
      expect.objectContaining({
        'site-1': expect.objectContaining({ provider: 'ollama' }),
      }),
    );
  });

  // 3. Switches to Ollama (bundled plugin, NOT installed) — activate fails, copies then activates
  it('copies bundled ollama plugin when activate fails first time', async () => {
    const wpCliRun = jest.fn()
      .mockResolvedValueOnce({ success: false, stdout: 'Plugin not installed.' }) // activate fails
      .mockResolvedValueOnce({ success: true, stdout: '' }); // activate after copy succeeds

    const mocks = createMockServices({
      localServices: { wpCliRun, resolveSiteObject: jest.fn().mockReturnValue({ paths: { webRoot: '/sites/mysite/app/public' } }) },
    });

    const result = await switchProviderForSite(
      'site-1',
      'ollama',
      mocks.localServices as any,
      mocks.registryStorage as any,
      mocks.logger as any,
    );

    expect(result.success).toBe(true);

    // fs.existsSync checked plugin source
    expect(fs.existsSync).toHaveBeenCalled();

    // Plugin was copied
    expect(fs.cpSync).toHaveBeenCalledWith(
      expect.stringContaining('ai-provider-for-ollama'),
      expect.stringContaining('ai-provider-for-ollama'),
      { recursive: true },
    );

    // Second activate call was made after copy
    expect(wpCliRun).toHaveBeenCalledTimes(2);
    expect(wpCliRun).toHaveBeenLastCalledWith('site-1', [
      'plugin', 'activate', 'ai-provider-for-ollama', '--quiet',
    ]);
  });

  // 4. Deactivation of old plugin fails non-fatally
  it('continues when deactivation of old plugin fails', async () => {
    const wpCliRun = jest.fn()
      .mockResolvedValueOnce({ success: false, stdout: 'Plugin not active.' }) // deactivate fails
      .mockResolvedValueOnce({ success: true, stdout: '' }); // new activate succeeds

    const mocks = createMockServices({
      localServices: { wpCliRun, resolveSiteObject: jest.fn().mockReturnValue({ paths: { webRoot: '/sites/mysite/app/public' } }) },
      registryStorage: {
        get: jest.fn().mockImplementation((key: string) => {
          if (key === STORAGE_KEYS.SITE_AI_CONFIG) {
            return { 'site-1': { provider: 'openai', configuredAt: 0 } };
          }
          if (key === STORAGE_KEYS.API_KEYS) return {};
          return null;
        }),
        set: jest.fn(),
      },
    });

    const result = await switchProviderForSite(
      'site-1',
      'anthropic',
      mocks.localServices as any,
      mocks.registryStorage as any,
      mocks.logger as any,
    );

    // Should still succeed despite deactivation failure
    expect(result.success).toBe(true);
    expect(result.newProvider).toBe('anthropic');

    // SiteAIConfig still updated
    expect(mocks.registryStorage.set).toHaveBeenCalledWith(
      STORAGE_KEYS.SITE_AI_CONFIG,
      expect.objectContaining({
        'site-1': expect.objectContaining({ provider: 'anthropic' }),
      }),
    );
  });

  // 5. Install of new external plugin fails → returns failure, SiteAIConfig NOT updated
  it('returns failure when external plugin install fails', async () => {
    const wpCliRun = jest.fn()
      .mockResolvedValueOnce({ success: false, stdout: 'Plugin not installed.' }) // activate fails
      .mockResolvedValueOnce({ success: false, stdout: 'Install failed.' }); // install also fails

    const mocks = createMockServices({
      localServices: { wpCliRun, resolveSiteObject: jest.fn().mockReturnValue({ paths: { webRoot: '/sites/mysite/app/public' } }) },
    });

    const result = await switchProviderForSite(
      'site-1',
      'anthropic',
      mocks.localServices as any,
      mocks.registryStorage as any,
      mocks.logger as any,
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Failed to install provider plugin/);

    // SiteAIConfig NOT updated
    expect(mocks.registryStorage.set).not.toHaveBeenCalled();
  });

  // 6. No previous provider (site not yet configured)
  it('installs new provider with no deactivation step when site is unconfigured', async () => {
    const mocks = createMockServices();

    const result = await switchProviderForSite(
      'site-new',
      'openai',
      mocks.localServices as any,
      mocks.registryStorage as any,
      mocks.logger as any,
    );

    expect(result.success).toBe(true);
    expect(result.previousProvider).toBeUndefined();
    expect(result.newProvider).toBe('openai');

    // No deactivate call — no previous provider
    expect(mocks.localServices.wpCliRun).not.toHaveBeenCalledWith(
      'site-new',
      expect.arrayContaining(['deactivate']),
    );

    // Activate called for new provider
    expect(mocks.localServices.wpCliRun).toHaveBeenCalledWith('site-new', [
      'plugin', 'activate', 'ai-provider-for-openai', '--quiet',
    ]);

    // SiteAIConfig created
    expect(mocks.registryStorage.set).toHaveBeenCalledWith(
      STORAGE_KEYS.SITE_AI_CONFIG,
      expect.objectContaining({
        'site-new': expect.objectContaining({ provider: 'openai' }),
      }),
    );
  });

  // 7. Syncs API key for providers that need one (anthropic)
  it('syncs API key when provider has a key stored', async () => {
    const mocks = createMockServices({
      registryStorage: {
        get: jest.fn().mockImplementation((key: string) => {
          if (key === STORAGE_KEYS.SITE_AI_CONFIG) return {};
          if (key === STORAGE_KEYS.API_KEYS) return { anthropic: 'sk-ant-test-key' };
          return null;
        }),
        set: jest.fn(),
      },
    });

    await switchProviderForSite(
      'site-1',
      'anthropic',
      mocks.localServices as any,
      mocks.registryStorage as any,
      mocks.logger as any,
    );

    // wp eval should have been called with the credential sync PHP
    const evalCalls = (mocks.localServices.wpCliRun as jest.Mock).mock.calls.filter(
      (call: any[]) => call[1][0] === 'eval',
    );
    expect(evalCalls.length).toBeGreaterThan(0);
  });

  // 7b. Ollama does not sync an API key
  it('does not sync API key for ollama provider', async () => {
    const mocks = createMockServices({
      registryStorage: {
        get: jest.fn().mockImplementation((key: string) => {
          if (key === STORAGE_KEYS.SITE_AI_CONFIG) return {};
          // Even if a key were stored, ollama has no PROVIDER_TO_WP_OPTION entry
          if (key === STORAGE_KEYS.API_KEYS) return { ollama: 'some-token' };
          return null;
        }),
        set: jest.fn(),
      },
    });

    await switchProviderForSite(
      'site-1',
      'ollama',
      mocks.localServices as any,
      mocks.registryStorage as any,
      mocks.logger as any,
    );

    // No eval call for credential sync (ollama has no wp option mapping)
    const evalCalls = (mocks.localServices.wpCliRun as jest.Mock).mock.calls.filter(
      (call: any[]) => call[1][0] === 'eval',
    );
    expect(evalCalls.length).toBe(0);
  });

  // Edge: bundled plugin source not found
  it('returns failure when bundled ollama plugin source does not exist', async () => {
    (fs.existsSync as jest.Mock).mockReturnValue(false);

    const wpCliRun = jest.fn()
      .mockResolvedValueOnce({ success: false, stdout: 'Plugin not installed.' }); // activate fails

    const mocks = createMockServices({
      localServices: { wpCliRun, resolveSiteObject: jest.fn().mockReturnValue({ paths: { webRoot: '/sites/mysite/app/public' } }) },
    });

    const result = await switchProviderForSite(
      'site-1',
      'ollama',
      mocks.localServices as any,
      mocks.registryStorage as any,
      mocks.logger as any,
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Bundled plugin not found/);
    expect(mocks.registryStorage.set).not.toHaveBeenCalled();
  });
});
