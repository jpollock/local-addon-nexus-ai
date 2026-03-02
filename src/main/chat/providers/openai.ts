import type { ChatMessage, ProviderStreamEvent } from '../../../common/chat-types';
import type { ChatProvider, ChatProviderConfig, ProviderToolDefinition } from './types';
import { streamingRequest, apiRequest } from './http-utils';

const OPENAI_BASE = 'https://api.openai.com/v1';

export class OpenAIProvider implements ChatProvider {
  readonly id = 'openai';
  readonly displayName = 'OpenAI';
  readonly requiresApiKey = true;
  readonly defaultModels = ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'];

  async *streamChat(
    messages: ChatMessage[],
    tools: ProviderToolDefinition[],
    config: ChatProviderConfig,
    signal: AbortSignal,
  ): AsyncGenerator<ProviderStreamEvent> {
    const baseUrl = config.baseUrl || OPENAI_BASE;

    // Convert messages to OpenAI format
    const openaiMessages = messages.map((m) => {
      if (m.role === 'tool') {
        return {
          role: 'tool' as const,
          content: m.content,
          tool_call_id: m.toolCallId ?? '',
        };
      }
      if (m.role === 'assistant' && m.toolCalls?.length) {
        return {
          role: 'assistant' as const,
          content: m.content || null,
          tool_calls: m.toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function' as const,
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.arguments),
            },
          })),
        };
      }
      return { role: m.role, content: m.content };
    });

    const openaiTools = tools.length > 0 ? tools.map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    })) : undefined;

    const body = JSON.stringify({
      model: config.model,
      messages: openaiMessages,
      stream: true,
      ...(openaiTools ? { tools: openaiTools } : {}),
    });

    try {
      const stream = streamingRequest({
        url: `${baseUrl}/chat/completions`,
        headers: { Authorization: `Bearer ${config.apiKey}` },
        body,
        signal,
      });

      // Track in-progress tool calls by index
      const activeToolCalls = new Map<number, { id: string; name: string; argsBuf: string }>();

      for await (const line of stream) {
        if (signal.aborted) break;

        let data: any;
        try {
          data = JSON.parse(line);
        } catch {
          continue;
        }

        const delta = data.choices?.[0]?.delta;
        const finishReason = data.choices?.[0]?.finish_reason;

        if (delta?.content) {
          yield { type: 'token', text: delta.content };
        }

        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;

            if (tc.id) {
              // New tool call
              activeToolCalls.set(idx, { id: tc.id, name: tc.function?.name ?? '', argsBuf: '' });
              yield { type: 'tool_call_start', id: tc.id, name: tc.function?.name ?? '' };
            }

            if (tc.function?.arguments) {
              const active = activeToolCalls.get(idx);
              if (active) {
                active.argsBuf += tc.function.arguments;
                yield { type: 'tool_call_args_delta', id: active.id, argsDelta: tc.function.arguments };
              }
            }
          }
        }

        if (finishReason) {
          // Finalize any pending tool calls
          for (const [, tc] of activeToolCalls) {
            let args: Record<string, unknown> = {};
            try {
              args = JSON.parse(tc.argsBuf);
            } catch { /* empty args */ }
            yield { type: 'tool_call_end', id: tc.id, name: tc.name, arguments: args };
          }
          activeToolCalls.clear();

          const stopReason = finishReason === 'tool_calls' ? 'tool_use'
            : finishReason === 'length' ? 'max_tokens'
            : 'end_turn';
          yield { type: 'done', stopReason };
          return;
        }
      }

      yield { type: 'done', stopReason: 'end_turn' };
    } catch (err) {
      if (signal.aborted) {
        yield { type: 'done', stopReason: 'end_turn' };
        return;
      }
      yield { type: 'error', message: `OpenAI error: ${(err as Error).message}` };
    }
  }

  async listModels(config: ChatProviderConfig): Promise<string[]> {
    const baseUrl = config.baseUrl || OPENAI_BASE;
    try {
      const response = await apiRequest({
        url: `${baseUrl}/models`,
        headers: { Authorization: `Bearer ${config.apiKey}` },
      });
      const data = JSON.parse(response);
      const models = (data.data ?? [])
        .map((m: any) => m.id as string)
        .filter((id: string) => id.startsWith('gpt-'))
        .sort();
      return models.length > 0 ? models : this.defaultModels;
    } catch {
      return this.defaultModels;
    }
  }

  async validateKey(apiKey: string): Promise<string | null> {
    try {
      await apiRequest({
        url: `${OPENAI_BASE}/models`,
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      return null;
    } catch (err) {
      return `Invalid API key: ${(err as Error).message}`;
    }
  }
}
