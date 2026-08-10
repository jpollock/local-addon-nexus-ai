import type { ChatMessage, ProviderStreamEvent, TokenUsage } from '../../../common/chat-types';
import type { AIProvider, ChatProviderConfig, ProviderToolDefinition } from './types';
import { streamingRequest, apiRequest } from './http-utils';

const OPENAI_BASE = 'https://api.openai.com/v1';

const finiteNumber = (v: unknown): number | undefined =>
  (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/**
 * Token usage from one OpenAI stream chunk, or undefined if it carries none.
 *
 * OpenAI reports usage only on a final chunk, and only when the request set
 * `stream_options: { include_usage: true }` — see the request body below. Exported for test.
 */
export function extractOpenAiUsage(chunk: any): TokenUsage | undefined {
  const inputTokens = finiteNumber(chunk?.usage?.prompt_tokens);
  const outputTokens = finiteNumber(chunk?.usage?.completion_tokens);
  if (inputTokens === undefined && outputTokens === undefined) return undefined;
  // Only the keys actually found: returning `outputTokens: undefined` alongside a real
  // inputTokens lets the caller's spread-merge overwrite a count it already had.
  return { ...(inputTokens !== undefined && { inputTokens }), ...(outputTokens !== undefined && { outputTokens }) };
}

export class OpenAIProvider implements AIProvider {
  readonly id = 'openai';
  readonly displayName = 'OpenAI';
  readonly requiresApiKey = true;
  readonly defaultModels = ['gpt-5.6', 'gpt-5.5', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano', 'gpt-4o', 'gpt-4o-mini', 'o4-mini', 'o3'];

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
      stream_options: { include_usage: true },
      ...(openaiTools ? { tools: openaiTools } : {}),
    });

    // Accumulated across the stream: OpenAI reports usage only on a final chunk (and only because
    // stream_options.include_usage is set above), so this merges in whatever arrives and is
    // attached to every `done` this generator yields, including the abort/error paths below —
    // which is why it is declared outside the try block rather than alongside the per-request
    // tool-call accumulator.
    let usage: TokenUsage | undefined;

    try {
      const stream = streamingRequest({
        url: `${baseUrl}/chat/completions`,
        headers: { Authorization: `Bearer ${config.apiKey}` },
        body,
        signal,
      });

      // Track in-progress tool calls by index
      const activeToolCalls = new Map<number, { id: string; name: string; argsBuf: string }>();

      // Captured once the finish_reason chunk arrives, but NOT returned on immediately: with
      // stream_options.include_usage set above, OpenAI sends the usage totals in a further chunk
      // (choices: [], usage: {...}) strictly AFTER the finish_reason chunk, right before [DONE].
      // Returning as soon as finish_reason is seen — the previous behavior — would end this
      // generator before that trailing chunk is ever read, so usage would silently never arrive
      // even with stream_options set. Let the loop run to the stream's real end instead.
      let stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | undefined;

      for await (const line of stream) {
        if (signal.aborted) break;

        let data: any;
        try {
          data = JSON.parse(line);
        } catch {
          continue;
        }

        const chunkUsage = extractOpenAiUsage(data);
        if (chunkUsage) usage = { ...usage, ...chunkUsage };

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

        if (finishReason && !stopReason) {
          // Finalize any pending tool calls
          for (const [, tc] of activeToolCalls) {
            let args: Record<string, unknown> = {};
            try {
              args = JSON.parse(tc.argsBuf);
            } catch { /* empty args */ }
            yield { type: 'tool_call_end', id: tc.id, name: tc.name, arguments: args };
          }
          activeToolCalls.clear();

          stopReason = finishReason === 'tool_calls' ? 'tool_use'
            : finishReason === 'length' ? 'max_tokens'
            : 'end_turn';
          // Do not return here — see the comment above the `stopReason` declaration.
        }
      }

      yield { type: 'done', stopReason: stopReason ?? 'end_turn', usage };
    } catch (err) {
      if (signal.aborted) {
        yield { type: 'done', stopReason: 'end_turn', usage };
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
        .filter((id: string) => id.startsWith('gpt-') || id.startsWith('o') || id.startsWith('dall-e'))
        .filter((id: string) => !id.includes('instruct') && !id.includes('vision-preview') && !id.includes('0301') && !id.includes('0613') && !id.includes('32k'))
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
