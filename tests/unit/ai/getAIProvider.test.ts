import { getAIProvider } from '../../../src/main/ai/getAIProvider';

// A RegistryStorage stub holding no keys. getApiKey() reads from it, so every
// provider resolves with an empty apiKey — which is fine: these cases are about
// WHICH provider id is resolved, not whether it can authenticate.
const storage = { get: () => undefined, set: () => {} } as any;

describe('getAIProvider — a stored provider the registry no longer serves', () => {
  // v0.6.0 removed WP Engine Power. UpdateSettingsSchema guards WRITES only;
  // nothing re-validates settings on READ, so an upgrading user keeps
  // aiProvider:'power' in storage. Without coercion it resolves to a provider
  // the registry cannot serve: buildAgentContext's null-provider branch then
  // substitutes a stub client that logs "provider unavailable — skipping AI
  // call" and returns '' on every run. The agent does not crash; it runs on its
  // cron forever and does nothing, which reads as a broken agent rather than a
  // stale setting.
  it('coerces a removed provider id to the default', () => {
    expect(getAIProvider(storage, { aiProvider: 'power' } as any).provider).toBe('anthropic');
  });

  it('coerces any unrecognised id, not just power', () => {
    expect(getAIProvider(storage, { aiProvider: 'not-a-provider' } as any).provider).toBe('anthropic');
  });

  it('does not invent a model for the removed provider', () => {
    // DEFAULT_MODELS lost its `power:` entry in the previous commit, so without
    // coercion the model falls through to the final `|| 'llama3.2'` default —
    // an Ollama model resolved against an Anthropic key.
    expect(getAIProvider(storage, { aiProvider: 'power' } as any).model)
      .toBe('claude-haiku-4-5-20251001');
  });

  it('leaves every retained provider untouched', () => {
    for (const p of ['anthropic', 'openai', 'google', 'ollama', 'local-gateway']) {
      expect(getAIProvider(storage, { aiProvider: p } as any).provider).toBe(p);
    }
  });

  it('still defaults to anthropic when no provider is set at all', () => {
    expect(getAIProvider(storage, {} as any).provider).toBe('anthropic');
    expect(getAIProvider(storage, null).provider).toBe('anthropic');
  });
});
