/**
 * Unit tests for gateway-aware provider selection in setupSiteForAI.
 *
 * Focuses ONLY on the new gateway logic introduced in Sprint 4:
 *   - Which plugin is installed based on provider vs. gateway flag
 *   - SiteAIConfig persisted with correct useLocalGateway value
 *   - Provider resolved from global settings when not specified
 */

// Mock fs before any imports so cpSync / existsSync are controlled
jest.mock('fs', () => ({
  existsSync: jest.fn().mockReturnValue(true),
  cpSync: jest.fn(),
  mkdirSync: jest.fn(),
  writeFileSync: jest.fn(),
  unlinkSync: jest.fn(),
}));
import * as fs from 'fs';

// Mock ollama status
jest.mock('../../../src/main/mcp/modules/ollama/ask-ollama', () => ({
  getOllamaStatus: jest.fn().mockReturnValue({ available: true, baseUrl: 'http://localhost:11434' }),
}));

// Mock MU plugin template
jest.mock('../../../src/main/ai-gateway/mu-plugin-template', () => ({
  generateMuPluginContent: jest.fn().mockReturnValue('<?php // mock'),
}));

// Mock credential redaction
jest.mock('../../../src/main/mcp/security/credential-redaction', () => ({
  redactCredentials: jest.fn((s: string) => s),
}));

import { setupSiteForAI } from '../../../src/main/mcp/modules/wp-connector/setup-ai';
import { getOllamaStatus } from '../../../src/main/mcp/modules/ollama/ask-ollama';
import { STORAGE_KEYS } from '../../../src/common/constants';

const mockedGetOllamaStatus = getOllamaStatus as jest.MockedFunction<typeof getOllamaStatus>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockStorage(settings: Record<string, any> = {}, siteAiConfig: Record<string, any> = {}) {
  const store = new Map<string, any>([
    [STORAGE_KEYS.SETTINGS, settings],
    [STORAGE_KEYS.SITE_AI_CONFIG, siteAiConfig],
    [STORAGE_KEYS.API_KEYS, {}],
    ['http_webhook_info', null],
    ['ai_proxy_info', null],
  ]);
  return {
    get: jest.fn((key: string) => store.get(key) ?? null),
    set: jest.fn((key: string, value: any) => store.set(key, value)),
  };
}

function createMockLocalServices(overrides?: Partial<ReturnType<typeof baseLocalServices>>) {
  return { ...baseLocalServices(), ...overrides };
}

function baseLocalServices() {
  // Default: WP 7.0, plugin list empty, all CLI calls succeed with 'healthy'
  return {
    getWpVersion: jest.fn().mockResolvedValue('7.0.0'),
    getPlugins: jest.fn().mockResolvedValue([]),
    getThemes: jest.fn().mockResolvedValue([]),
    resolveSiteObject: jest.fn().mockReturnValue({
      paths: { webRoot: '/sites/mysite/app/public' },
    }),
    wpCliRun: jest.fn().mockImplementation((_siteId: string, args: string[]) => {
      // Health checks echo 'healthy'
      if (args[0] === 'eval' && args[1]?.includes('healthy')) {
        return Promise.resolve({ success: true, stdout: 'healthy' });
      }
      // Feature enable echoes JSON with all-true
      if (args[0] === 'eval') {
        return Promise.resolve({ success: true, stdout: JSON.stringify({ global: true }) });
      }
      return Promise.resolve({ success: true, stdout: '' });
    }),
  };
}

const SITE_ID = 'site-1';
const LOGGER = { info: jest.fn(), error: jest.fn() };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('setupSiteForAI — gateway-aware provider selection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (fs.cpSync as jest.Mock).mockImplementation(() => {});
    mockedGetOllamaStatus.mockReturnValue({ available: true, baseUrl: 'http://localhost:11434' } as any);
  });

  // 1a. provider=anthropic, useLocalGateway=false → provider plugin installed, NOT gateway
  it('installs provider plugin when useLocalGateway is false', async () => {
    const storage = createMockStorage({ aiProvider: 'anthropic', useLocalGateway: false });
    const localServices = createMockLocalServices();

    const result = await setupSiteForAI(SITE_ID, localServices as any, storage as any, LOGGER);

    expect(result.success).toBe(true);
    expect(result.providerPlugins).not.toBe('skipped');

    // Provider plugin should have been installed (not gateway)
    const wpCliCalls = (localServices.wpCliRun as jest.Mock).mock.calls;
    const installCalls = wpCliCalls.filter((c: string[][]) => c[1].includes('ai-provider-for-anthropic'));
    expect(installCalls.length).toBeGreaterThan(0);

    // Gateway plugin should NOT have been installed
    const gatewayCalls = wpCliCalls.filter((c: string[][]) => c[1].includes('ai-provider-for-local-gateway'));
    expect(gatewayCalls.length).toBe(0);

    // SiteAIConfig saved with useLocalGateway=false
    expect(storage.set).toHaveBeenCalledWith(
      STORAGE_KEYS.SITE_AI_CONFIG,
      expect.objectContaining({
        [SITE_ID]: expect.objectContaining({ provider: 'anthropic', useLocalGateway: false }),
      }),
    );
  });

  // 1b. provider=anthropic, useLocalGateway=true → gateway plugin installed, provider plugin skipped
  it('installs gateway plugin instead of provider plugin when useLocalGateway is true', async () => {
    const storage = createMockStorage({ aiProvider: 'anthropic', useLocalGateway: true });
    const localServices = createMockLocalServices();

    const result = await setupSiteForAI(SITE_ID, localServices as any, storage as any, LOGGER);

    expect(result.success).toBe(true);
    expect(result.providerPlugins).toBe('skipped');
    expect(result.gatewayProvider).not.toBe('failed');

    // providerPlugin (anthropic) should NOT be in any CLI call
    const wpCliCalls = (localServices.wpCliRun as jest.Mock).mock.calls;
    const providerCalls = wpCliCalls.filter((c: string[][]) =>
      c[1].includes('ai-provider-for-anthropic'),
    );
    expect(providerCalls.length).toBe(0);

    // SiteAIConfig saved with useLocalGateway=true
    expect(storage.set).toHaveBeenCalledWith(
      STORAGE_KEYS.SITE_AI_CONFIG,
      expect.objectContaining({
        [SITE_ID]: expect.objectContaining({ provider: 'anthropic', useLocalGateway: true }),
      }),
    );
  });

  // 2. Ollama ignores gateway flag — always installs ollama plugin
  it('installs ollama plugin when provider=ollama, even if useLocalGateway=true', async () => {
    const storage = createMockStorage({ aiProvider: 'ollama', useLocalGateway: true });
    const localServices = createMockLocalServices();

    const result = await setupSiteForAI(SITE_ID, localServices as any, storage as any, LOGGER);

    expect(result.success).toBe(true);
    // Ollama step should have run
    expect(result.ollamaProvider).not.toBe('failed');

    // Gateway plugin should NOT be installed for ollama
    expect(result.gatewayProvider).toBe('skipped');

    // SiteAIConfig: useLocalGateway must be false for ollama (gateway is disabled for it)
    expect(storage.set).toHaveBeenCalledWith(
      STORAGE_KEYS.SITE_AI_CONFIG,
      expect.objectContaining({
        [SITE_ID]: expect.objectContaining({ provider: 'ollama', useLocalGateway: false }),
      }),
    );
  });

  // 3a. Provider resolved from global settings when options.provider is undefined
  it('uses global settings aiProvider when no options.provider given', async () => {
    const storage = createMockStorage({ aiProvider: 'openai', useLocalGateway: false });
    const localServices = createMockLocalServices();

    const result = await setupSiteForAI(SITE_ID, localServices as any, storage as any, LOGGER, {});

    expect(result.success).toBe(true);

    // openai provider plugin should have been used
    const wpCliCalls = (localServices.wpCliRun as jest.Mock).mock.calls;
    const openaiCalls = wpCliCalls.filter((c: string[][]) =>
      c[1].some((arg: string) => arg.includes('ai-provider-for-openai')),
    );
    expect(openaiCalls.length).toBeGreaterThan(0);

    expect(storage.set).toHaveBeenCalledWith(
      STORAGE_KEYS.SITE_AI_CONFIG,
      expect.objectContaining({
        [SITE_ID]: expect.objectContaining({ provider: 'openai' }),
      }),
    );
  });

  // 3b. Explicit options.provider overrides global settings
  it('uses options.provider over global settings when explicitly provided', async () => {
    const storage = createMockStorage({ aiProvider: 'openai', useLocalGateway: false });
    const localServices = createMockLocalServices();

    // Explicit anthropic overrides global openai
    const result = await setupSiteForAI(
      SITE_ID, localServices as any, storage as any, LOGGER, { provider: 'anthropic' },
    );

    expect(result.success).toBe(true);

    expect(storage.set).toHaveBeenCalledWith(
      STORAGE_KEYS.SITE_AI_CONFIG,
      expect.objectContaining({
        [SITE_ID]: expect.objectContaining({ provider: 'anthropic' }),
      }),
    );
  });

  // 4. SiteAIConfig is NOT saved if aiPlugin fails
  it('does not save SiteAIConfig when aiPlugin step fails', async () => {
    const storage = createMockStorage({ aiProvider: 'anthropic', useLocalGateway: false });

    // Make the AI plugin copy source "not found"
    (fs.existsSync as jest.Mock).mockReturnValue(false);

    const localServices = createMockLocalServices();

    const result = await setupSiteForAI(SITE_ID, localServices as any, storage as any, LOGGER);

    // aiPlugin failed because source not found
    expect(result.aiPlugin).toBe('failed');

    // SiteAIConfig not persisted
    expect(storage.set).not.toHaveBeenCalledWith(
      STORAGE_KEYS.SITE_AI_CONFIG,
      expect.anything(),
    );
  });

  // 5. WP version < 7.0 causes early return without installing anything
  it('returns early with failure when WP version is older than 7.0', async () => {
    const storage = createMockStorage({ aiProvider: 'anthropic' });
    const localServices = createMockLocalServices({
      getWpVersion: jest.fn().mockResolvedValue('6.7.1'),
    });

    const result = await setupSiteForAI(SITE_ID, localServices as any, storage as any, LOGGER);

    expect(result.success).toBe(false);
    expect(result.aiPlugin).toBe('failed');
    expect(result.providerPlugins).toBe('skipped');
    expect(result.message).toMatch(/7\.0/);

    // No SiteAIConfig saved
    expect(storage.set).not.toHaveBeenCalled();
  });

  // 6. Ollama not running — ollamaProvider step is skipped
  it('skips ollama provider step when ollama is not running', async () => {
    mockedGetOllamaStatus.mockReturnValue({ available: false } as any);

    const storage = createMockStorage({ aiProvider: 'ollama', useLocalGateway: false });
    const localServices = createMockLocalServices();

    const result = await setupSiteForAI(SITE_ID, localServices as any, storage as any, LOGGER);

    expect(result.success).toBe(true);
    expect(result.ollamaProvider).toBe('skipped');
  });
});
