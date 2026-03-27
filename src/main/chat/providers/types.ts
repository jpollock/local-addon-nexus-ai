import type { ChatMessage, ProviderStreamEvent } from '../../../common/chat-types';

// ---------------------------------------------------------------------------
// Provider Tool Definition — provider-agnostic, converted per-provider
// ---------------------------------------------------------------------------

export interface ProviderToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;  // JSON Schema
}

// ---------------------------------------------------------------------------
// Provider Configuration
// ---------------------------------------------------------------------------

export interface ChatProviderConfig {
  apiKey?: string;
  model: string;
  baseUrl?: string;
}

// ---------------------------------------------------------------------------
// Provider Interface
// ---------------------------------------------------------------------------

export interface AIProvider {
  readonly id: string;
  readonly displayName: string;
  readonly requiresApiKey: boolean;
  readonly defaultModels: string[];

  streamChat(
    messages: ChatMessage[],
    tools: ProviderToolDefinition[],
    config: ChatProviderConfig,
    signal: AbortSignal,
  ): AsyncGenerator<ProviderStreamEvent>;

  listModels(config: ChatProviderConfig): Promise<string[]>;
  validateKey(apiKey: string): Promise<string | null>;
}
