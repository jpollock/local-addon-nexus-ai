import type { ChatMessage, ProviderStreamEvent } from '../../../common/chat-types';
import type { AIProvider, ChatProviderConfig, ProviderToolDefinition } from './types';
import { streamingRequest, apiRequest } from './http-utils';

const ANTHROPIC_BASE = 'https://api.anthropic.com/v1';
const ANTHROPIC_VERSION = '2023-06-01';

export class AnthropicProvider implements AIProvider {
  readonly id = 'anthropic';
  readonly displayName = 'Anthropic';
  readonly requiresApiKey = true;
  readonly defaultModels = ['claude-fable-5', 'claude-opus-4-8', 'claude-sonnet-5', 'claude-sonnet-4-6', 'claude-opus-4-6', 'claude-haiku-4-5-20251001'];

  async *streamChat(
    messages: ChatMessage[],
    tools: ProviderToolDefinition[],
    config: ChatProviderConfig,
    signal: AbortSignal,
  ): AsyncGenerator<ProviderStreamEvent> {
    const baseUrl = config.baseUrl || ANTHROPIC_BASE;

    // Extract system message
    const systemMessage = messages.find((m) => m.role === 'system');
    const nonSystemMessages = messages.filter((m) => m.role !== 'system');

    // Convert messages to Anthropic format
    const anthropicMessages = nonSystemMessages.map((m) => {
      if (m.role === 'tool') {
        return {
          role: 'user' as const,
          content: [{
            type: 'tool_result' as const,
            tool_use_id: m.toolCallId ?? '',
            content: m.content,
          }],
        };
      }
      if (m.role === 'assistant' && m.toolCalls?.length) {
        const content: any[] = [];
        if (m.content) {
          content.push({ type: 'text', text: m.content });
        }
        for (const tc of m.toolCalls) {
          content.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.name,
            input: tc.arguments,
          });
        }
        return { role: 'assistant' as const, content };
      }
      return { role: m.role as 'user' | 'assistant', content: m.content };
    });

    const anthropicTools = tools.length > 0 ? tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters,
    })) : undefined;

    const body = JSON.stringify({
      model: config.model,
      max_tokens: 4096,
      stream: true,
      messages: anthropicMessages,
      ...(systemMessage ? { system: systemMessage.content } : {}),
      ...(anthropicTools ? { tools: anthropicTools } : {}),
    });

    try {
      const stream = streamingRequest({
        url: `${baseUrl}/messages`,
        headers: {
          'x-api-key': config.apiKey ?? '',
          'anthropic-version': ANTHROPIC_VERSION,
        },
        body,
        signal,
      });

      // Track current tool use block
      let currentToolId = '';
      let currentToolName = '';
      let currentToolArgsBuf = '';

      for await (const line of stream) {
        if (signal.aborted) break;

        let data: any;
        try {
          data = JSON.parse(line);
        } catch {
          continue;
        }

        const eventType = data.type;

        if (eventType === 'content_block_start') {
          const block = data.content_block;
          if (block?.type === 'tool_use') {
            currentToolId = block.id;
            currentToolName = block.name;
            currentToolArgsBuf = '';
            yield { type: 'tool_call_start', id: currentToolId, name: currentToolName };
          }
        }

        if (eventType === 'content_block_delta') {
          const delta = data.delta;
          if (delta?.type === 'text_delta' && delta.text) {
            yield { type: 'token', text: delta.text };
          }
          if (delta?.type === 'input_json_delta' && delta.partial_json) {
            currentToolArgsBuf += delta.partial_json;
            yield { type: 'tool_call_args_delta', id: currentToolId, argsDelta: delta.partial_json };
          }
        }

        if (eventType === 'content_block_stop') {
          if (currentToolId) {
            let args: Record<string, unknown> = {};
            try {
              args = JSON.parse(currentToolArgsBuf);
            } catch { /* empty */ }
            yield { type: 'tool_call_end', id: currentToolId, name: currentToolName, arguments: args };
            currentToolId = '';
            currentToolName = '';
            currentToolArgsBuf = '';
          }
        }

        if (eventType === 'message_delta') {
          const stopReason = data.delta?.stop_reason;
          if (stopReason) {
            const mapped = stopReason === 'tool_use' ? 'tool_use'
              : stopReason === 'max_tokens' ? 'max_tokens'
              : 'end_turn';
            yield { type: 'done', stopReason: mapped };
            return;
          }
        }

        if (eventType === 'message_stop') {
          yield { type: 'done', stopReason: 'end_turn' };
          return;
        }

        if (eventType === 'error') {
          yield { type: 'error', message: data.error?.message ?? 'Unknown Anthropic error' };
          return;
        }
      }

      yield { type: 'done', stopReason: 'end_turn' };
    } catch (err) {
      if (signal.aborted) {
        yield { type: 'done', stopReason: 'end_turn' };
        return;
      }
      yield { type: 'error', message: `Anthropic error: ${(err as Error).message}` };
    }
  }

  async listModels(_config: ChatProviderConfig): Promise<string[]> {
    // Anthropic doesn't have a public models listing API — return defaults
    return this.defaultModels;
  }

  async validateKey(apiKey: string): Promise<string | null> {
    try {
      // Lightweight validation: send a minimal message
      await apiRequest({
        url: `${ANTHROPIC_BASE}/messages`,
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'hi' }],
        }),
      });
      return null;
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes('401')) {
        return 'Invalid API key';
      }
      // Other errors (e.g. rate limit) still mean the key is valid
      if (msg.includes('429') || msg.includes('529')) {
        return null;
      }
      return `Validation failed: ${msg}`;
    }
  }
}
