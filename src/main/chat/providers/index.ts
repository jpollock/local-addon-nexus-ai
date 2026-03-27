import type { AIProvider } from './types';
import { OllamaProvider } from './ollama';
import { OpenAIProvider } from './openai';
import { AnthropicProvider } from './anthropic';
import { GoogleProvider } from './google';
import { LocalGatewayProvider } from './local-gateway';

// ---------------------------------------------------------------------------
// Provider Registry
// ---------------------------------------------------------------------------

const providers = new Map<string, AIProvider>();

export function initializeProviders(): void {
  const all: AIProvider[] = [
    new OllamaProvider(),
    new AnthropicProvider(),
    new OpenAIProvider(),
    new GoogleProvider(),
    new LocalGatewayProvider(),
  ];
  for (const p of all) {
    providers.set(p.id, p);
  }
}

export function getProvider(id: string): AIProvider | null {
  return providers.get(id) ?? null;
}

export function listProviders(): Array<{ id: string; displayName: string; requiresApiKey: boolean }> {
  return Array.from(providers.values())
    .filter((p) => p.id !== 'local-gateway') // Local Gateway is a routing layer, not a user-selectable provider
    .map((p) => ({
      id: p.id,
      displayName: p.displayName,
      requiresApiKey: p.requiresApiKey,
    }));
}
