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
    // P4.2 — same dark pattern as Power below: hand-rolled default, the AI
    // SDK implementation (with cache_control breakpoints) behind the flag.
    process.env.NEXUS_ANTHROPIC_AISDK === '1' ? new AnthropicAiSdkProvider() : new AnthropicProvider(),
    new OpenAIProvider(),
    new GoogleProvider(),
    new LocalGatewayProvider(),
    // spike/power-ai-sdk — same 'power' id either way, so ChatService and the
    // renderer see no difference. Ships dark: hand-rolled adapter stays the
    // default until the AI SDK implementation is proven against live Power.
    process.env.NEXUS_POWER_AISDK === '1' ? new PowerAiSdkProvider() : new PowerProvider(),
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
