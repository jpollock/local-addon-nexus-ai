import type { ChatProvider } from './types';
import { OllamaProvider } from './ollama';
import { OpenAIProvider } from './openai';
import { AnthropicProvider } from './anthropic';
import { GoogleProvider } from './google';
import { WpeGatewayProvider } from './wpe-gateway';

// ---------------------------------------------------------------------------
// Provider Registry
// ---------------------------------------------------------------------------

const providers = new Map<string, ChatProvider>();

export function initializeProviders(): void {
  const all: ChatProvider[] = [
    new OllamaProvider(),
    new AnthropicProvider(),
    new OpenAIProvider(),
    new GoogleProvider(),
    new WpeGatewayProvider(),
  ];
  for (const p of all) {
    providers.set(p.id, p);
  }
}

export function getProvider(id: string): ChatProvider | null {
  return providers.get(id) ?? null;
}

export function listProviders(): Array<{ id: string; displayName: string; requiresApiKey: boolean }> {
  return Array.from(providers.values()).map((p) => ({
    id: p.id,
    displayName: p.displayName,
    requiresApiKey: p.requiresApiKey,
  }));
}
