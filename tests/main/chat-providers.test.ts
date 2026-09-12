import { OllamaProvider } from '../../src/main/chat/providers/ollama';
import { OpenAIProvider } from '../../src/main/chat/providers/openai';
import { AnthropicProvider } from '../../src/main/chat/providers/anthropic';
import { GoogleProvider } from '../../src/main/chat/providers/google';
import { LocalGatewayProvider } from '../../src/main/chat/providers/local-gateway';
import { initializeProviders, getProvider, listProviders } from '../../src/main/chat/providers/index';

// ---------------------------------------------------------------------------
// Provider Registry
// ---------------------------------------------------------------------------

describe('Provider Registry', () => {
  beforeAll(() => {
    initializeProviders();
  });

  test('initializes four user-facing providers (local-gateway excluded from list)', () => {
    // anthropic, openai, google, ollama. Was five until v0.6.0 removed WP Engine
    // Power; local-gateway is a routing layer and is filtered out of the list.
    const providers = listProviders();
    expect(providers.map((p) => p.id).sort()).toEqual(['anthropic', 'google', 'ollama', 'openai']);
  });

  test('can retrieve each provider by id', () => {
    expect(getProvider('ollama')).not.toBeNull();
    expect(getProvider('anthropic')).not.toBeNull();
    expect(getProvider('openai')).not.toBeNull();
    expect(getProvider('google')).not.toBeNull();
    expect(getProvider('local-gateway')).not.toBeNull(); // still in registry, just not in listProviders()
  });

  test('returns null for unknown provider', () => {
    expect(getProvider('nonexistent')).toBeNull();
  });

  test('lists correct metadata for each provider', () => {
    const providers = listProviders();
    const byId = Object.fromEntries(providers.map((p) => [p.id, p]));

    expect(byId['ollama'].requiresApiKey).toBe(false);
    expect(byId['anthropic'].requiresApiKey).toBe(true);
    expect(byId['openai'].requiresApiKey).toBe(true);
    expect(byId['google'].requiresApiKey).toBe(true);
    // local-gateway is excluded from listProviders() — verify it's absent
    expect(byId['local-gateway']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Ollama Provider
// ---------------------------------------------------------------------------

describe('OllamaProvider', () => {
  const provider = new OllamaProvider();

  test('has correct static properties', () => {
    expect(provider.id).toBe('ollama');
    expect(provider.requiresApiKey).toBe(false);
    expect(provider.defaultModels.length).toBeGreaterThan(0);
  });

  test('defaultModels includes llama models', () => {
    expect(provider.defaultModels.some((m) => m.includes('llama'))).toBe(true);
  });

  test('displayName indicates local', () => {
    expect(provider.displayName.toLowerCase()).toContain('local');
  });
});

// ---------------------------------------------------------------------------
// OpenAI Provider
// ---------------------------------------------------------------------------

describe('OpenAIProvider', () => {
  const provider = new OpenAIProvider();

  test('has correct static properties', () => {
    expect(provider.id).toBe('openai');
    expect(provider.requiresApiKey).toBe(true);
    expect(provider.defaultModels.length).toBeGreaterThan(0);
  });

  test('defaultModels includes gpt and o-series models', () => {
    expect(provider.defaultModels.some((m) => m.startsWith('gpt-') || m.startsWith('o'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Anthropic Provider
// ---------------------------------------------------------------------------

describe('AnthropicProvider', () => {
  const provider = new AnthropicProvider();

  test('has correct static properties', () => {
    expect(provider.id).toBe('anthropic');
    expect(provider.requiresApiKey).toBe(true);
    expect(provider.defaultModels.length).toBeGreaterThan(0);
  });

  test('defaultModels includes claude models', () => {
    expect(provider.defaultModels.every((m) => m.startsWith('claude-'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Google Provider
// ---------------------------------------------------------------------------

describe('GoogleProvider', () => {
  const provider = new GoogleProvider();

  test('has correct static properties', () => {
    expect(provider.id).toBe('google');
    expect(provider.requiresApiKey).toBe(true);
    expect(provider.defaultModels.length).toBeGreaterThan(0);
  });

  test('defaultModels includes gemini models', () => {
    expect(provider.defaultModels.some((m) => m.includes('gemini'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Local Gateway Provider
// ---------------------------------------------------------------------------

describe('LocalGatewayProvider', () => {
  const provider = new LocalGatewayProvider();

  test('has correct static properties', () => {
    expect(provider.id).toBe('local-gateway');
    expect(provider.requiresApiKey).toBe(false);
  });

  test('streamChat yields a not-configured error when gateway URL/token are absent', async () => {
    const events: any[] = [];
    const signal = new AbortController().signal;

    // No baseUrl or apiKey in config → provider must refuse before making any request.
    for await (const event of provider.streamChat([], [], { model: '' }, signal)) {
      events.push(event);
    }

    expect(events.some((e) => e.type === 'error')).toBe(true);
    expect(events.find((e: any) => e.type === 'error')?.message).toMatch(/not configured/i);
  });

  test('listModels returns empty', async () => {
    const models = await provider.listModels({ model: '' });
    expect(models).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Provider Interface Contract
// ---------------------------------------------------------------------------

describe('All providers implement AIProvider interface', () => {
  const providers = [
    new OllamaProvider(),
    new OpenAIProvider(),
    new AnthropicProvider(),
    new GoogleProvider(),
    new LocalGatewayProvider(),
  ];

  test.each(providers.map((p) => [p.id, p]))('%s has id string', (_id, provider: any) => {
    expect(typeof provider.id).toBe('string');
    expect(provider.id.length).toBeGreaterThan(0);
  });

  test.each(providers.map((p) => [p.id, p]))('%s has displayName', (_id, provider: any) => {
    expect(typeof provider.displayName).toBe('string');
    expect(provider.displayName.length).toBeGreaterThan(0);
  });

  test.each(providers.map((p) => [p.id, p]))('%s has requiresApiKey boolean', (_id, provider: any) => {
    expect(typeof provider.requiresApiKey).toBe('boolean');
  });

  test.each(providers.map((p) => [p.id, p]))('%s has defaultModels array', (_id, provider: any) => {
    expect(Array.isArray(provider.defaultModels)).toBe(true);
  });

  test.each(providers.map((p) => [p.id, p]))('%s has streamChat method', (_id, provider: any) => {
    expect(typeof provider.streamChat).toBe('function');
  });

  test.each(providers.map((p) => [p.id, p]))('%s has listModels method', (_id, provider: any) => {
    expect(typeof provider.listModels).toBe('function');
  });

  test.each(providers.map((p) => [p.id, p]))('%s has validateKey method', (_id, provider: any) => {
    expect(typeof provider.validateKey).toBe('function');
  });
});

// v0.6.0 excision. WP Engine Power is an unreleased internal inference surface
// (api.ai.wpengine.com) and must not ship in a public npm package.
describe('Power provider is absent (v0.6.0 excision)', () => {
  // Its OWN beforeAll, deliberately. The registry is populated by
  // initializeProviders() in another describe's beforeAll, and jest does not run
  // that hook when -t filtering skips every test in its block — so without this
  // the registry is empty and getProvider('power') returns null for the wrong
  // reason. Verified: an earlier version of this suite passed against a tree
  // that still had PowerProvider registered.
  beforeAll(() => { initializeProviders(); });

  it('does not resolve a power provider', () => {
    // getProvider is `(id: string) => AIProvider | null` — it returns null for
    // an unknown id, it does not throw.
    expect(getProvider('power')).toBeNull();
  });

  it('lists no provider named for WP Engine Power', () => {
    // listProviders() returns {id, displayName, requiresApiKey} only — it never
    // carries a base URL, so asserting on the endpoint would pass vacuously.
    // displayName ('WP Engine Power') is what would actually leak.
    const listed = listProviders();
    expect(listed.map((p) => p.id)).not.toContain('power');
    expect(JSON.stringify(listed)).not.toMatch(/WP Engine Power/);
  });
});
