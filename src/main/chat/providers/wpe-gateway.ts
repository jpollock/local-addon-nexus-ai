import type { ChatMessage, ProviderStreamEvent } from '../../../common/chat-types';
import type { ChatProvider, ChatProviderConfig, ProviderToolDefinition } from './types';

/**
 * WP Engine Gateway — placeholder provider for future WPE-managed AI gateway.
 */
export class WpeGatewayProvider implements ChatProvider {
  readonly id = 'wpe-gateway';
  readonly displayName = 'WP Engine Gateway';
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
      message: 'WP Engine AI Gateway is coming soon. Please select a different provider.',
    };
  }

  async listModels(_config: ChatProviderConfig): Promise<string[]> {
    return [];
  }

  async validateKey(_apiKey: string): Promise<string | null> {
    return 'WP Engine AI Gateway is not yet available.';
  }
}
