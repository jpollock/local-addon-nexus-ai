import type { ChatMessage, ProviderStreamEvent } from '../../../common/chat-types';
import type { AIProvider, ChatProviderConfig, ProviderToolDefinition } from './types';

/**
 * Local AI Gateway — provider for the locally-hosted AI gateway.
 */
export class LocalGatewayProvider implements AIProvider {
  readonly id = 'local-gateway';
  readonly displayName = 'Local AI Gateway';
  readonly requiresApiKey = false;
  readonly defaultModels: string[] = [];

  async *streamChat(
    _messages: ChatMessage[],
    _tools: ProviderToolDefinition[],
    _config: ChatProviderConfig,
    _signal: AbortSignal,
  ): AsyncGenerator<ProviderStreamEvent> {
    yield {
      type: 'error',
      message: 'Local AI Gateway is coming soon. Please select a different provider.',
    };
  }

  async listModels(_config: ChatProviderConfig): Promise<string[]> {
    return [];
  }

  async validateKey(_apiKey: string): Promise<string | null> {
    return 'Local AI Gateway is not yet available.';
  }
}
