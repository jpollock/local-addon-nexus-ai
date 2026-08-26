import type { AIProvider } from './types';
import { OllamaProvider } from './ollama';
import { OpenAIProvider } from './openai';
import { AnthropicProvider } from './anthropic';
import { GoogleProvider } from './google';
import { LocalGatewayProvider } from './local-gateway';
import { PowerProvider } from './power';
import { PowerAiSdkProvider } from './power-aisdk';
import { AnthropicAiSdkProvider } from './anthropic-aisdk';

// ---------------------------------------------------------------------------
// Provider Registry
// ---------------------------------------------------------------------------

const providers = new Map<string, AIProvider>();

export function initializeProviders(): void {
  const all: AIProvider[] = [
    new OllamaProvider(),
    // FLIPPED 2026-08-26 after the live parity drive: the AI SDK
    // implementation (with the cache breakpoints — cacheRead=59,455/turn
    // measured live) is the DEFAULT. NEXUS_ANTHROPIC_AISDK=0 is the escape
    // hatch to the hand-rolled client, kept one release cycle then deleted.
    process.env.NEXUS_ANTHROPIC_AISDK === '0' ? new AnthropicProvider() : new AnthropicAiSdkProvider(),
    new OpenAIProvider(),
    new GoogleProvider(),
    new LocalGatewayProvider(),
    // FLIPPED 2026-08-26 after the live parity drive (streamed chat with
    // tool calls against real Power): the AI SDK implementation is the
    // DEFAULT. NEXUS_POWER_AISDK=0 is the escape hatch to the hand-rolled
    // client, kept one release cycle then deleted.
    process.env.NEXUS_POWER_AISDK === '0' ? new PowerProvider() : new PowerAiSdkProvider(),
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
