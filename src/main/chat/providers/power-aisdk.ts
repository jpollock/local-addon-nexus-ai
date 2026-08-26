import { streamText, dynamicTool, jsonSchema } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { ModelMessage } from 'ai';
import type { ChatMessage, ProviderStreamEvent } from '../../../common/chat-types';
import type { AIProvider, ChatProviderConfig, ProviderToolDefinition } from './types';
import { apiRequest } from './http-utils';

// spike/power-ai-sdk — Power behind the Vercel AI SDK.
//
// Same AIProvider contract as power.ts (which stays the default; this class is
// selected only when NEXUS_POWER_AISDK=1 — see providers/index.ts). The spike's
// claim is parity: identical ProviderStreamEvent sequences for identical wire
// traffic, so ChatService needs zero changes. What the SDK replaces is the
// hand-rolled layer power.ts shares with four sibling providers: SSE parsing,
// tool-call assembly by chunk index, finish-reason mapping, and the
// OpenAI-compatible request shape. What it deliberately does NOT replace:
// max_tokens 8192 (Power backends have small implicit defaults — see
// power.ts), the forceTool → tool_choice mapping generateObject depends on,
// and the actionable "incompatible with the selected model" sentence
// (pinned by powerModelError.test.ts on the original; re-pinned here).
const POWER_BASE = 'https://api.ai.wpengine.com/v1';

const FINISH_MAP: Record<string, 'end_turn' | 'tool_use' | 'max_tokens' | 'error'> = {
  'stop': 'end_turn',
  'tool-calls': 'tool_use',
  'length': 'max_tokens',
  'error': 'error',
};

/** Flatten an AI SDK stream error (APICallError carries the response body) into one searchable string. */
function errorText(err: unknown): string {
  const e = err as { message?: string; responseBody?: string; data?: unknown };
  return [e?.message, e?.responseBody, e?.data ? JSON.stringify(e.data) : '']
    .filter(Boolean)
    .join(' ');
}

function toModelMessages(messages: ChatMessage[]): ModelMessage[] {
  return messages.map((m): ModelMessage => {
    if (m.role === 'tool') {
      return {
        role: 'tool',
        content: [{
          type: 'tool-result',
          toolCallId: m.toolCallId ?? '',
          toolName: m.toolName ?? '',
          output: { type: 'text', value: m.content },
        }],
      };
    }
    if (m.role === 'assistant' && m.toolCalls?.length) {
      return {
        role: 'assistant',
        content: [
          ...(m.content ? [{ type: 'text' as const, text: m.content }] : []),
          ...m.toolCalls.map((tc) => ({
            type: 'tool-call' as const,
            toolCallId: tc.id,
            toolName: tc.name,
            input: tc.arguments,
          })),
        ],
      };
    }
    return { role: m.role as 'system' | 'user' | 'assistant', content: m.content };
  });
}

export class PowerAiSdkProvider implements AIProvider {
  readonly id = 'power';
  readonly displayName = 'WP Engine Power';
  readonly requiresApiKey = true;
  // Fallback only — the live list comes from listModels() -> GET /v1/models.
  readonly defaultModels = [
    'anthropic/claude-haiku-4-5',
    'anthropic/claude-sonnet-4-5',
    'openai/gpt-4o',
    'google/gemini-2.5-flash',
  ];

  /** fetch override is the test seam — the SDK's own SSE parser runs against it. */
  constructor(private readonly fetchImpl?: typeof fetch) {}

  async *streamChat(
    messages: ChatMessage[],
    tools: ProviderToolDefinition[],
    config: ChatProviderConfig,
    signal: AbortSignal,
  ): AsyncGenerator<ProviderStreamEvent> {
    const provider = createOpenAICompatible({
      name: 'power',
      baseURL: config.baseUrl || POWER_BASE,
      // Bearer only — no WPEngine-Project header (see power.ts file header note).
      apiKey: config.apiKey,
      ...(this.fetchImpl ? { fetch: this.fetchImpl } : {}),
    });

    // No execute on any tool: ChatService owns the loop (registry.call, tiers,
    // audit). The SDK just surfaces the calls and stops, exactly like power.ts.
    const aiTools = Object.fromEntries(
      tools.map((t) => [t.name, dynamicTool({
        description: t.description,
        inputSchema: jsonSchema(t.parameters as Parameters<typeof jsonSchema>[0]),
      })]),
    );

    const result = streamText({
      model: provider(config.model),
      messages: toModelMessages(messages),
      ...(tools.length > 0 ? { tools: aiTools } : {}),
      ...(config.forceTool ? { toolChoice: { type: 'tool' as const, toolName: config.forceTool } } : {}),
      maxOutputTokens: 8192,
      abortSignal: signal,
      // Parity: power.ts makes exactly one attempt. The SDK's default (2
      // retries with backoff) turned a 429 into a silent 6-second stall
      // before the user saw anything. Errors reach the user through the
      // stream's error event instead — so the SDK's default console logging
      // in onError is noise, not signal.
      maxRetries: 0,
      onError: () => { /* surfaced via the fullStream error part below */ },
    });

    try {
      for await (const part of result.fullStream) {
        switch (part.type) {
          case 'text-delta':
            yield { type: 'token', text: part.text };
            break;
          case 'tool-input-start':
            yield { type: 'tool_call_start', id: part.id, name: part.toolName };
            break;
          case 'tool-input-delta':
            yield { type: 'tool_call_args_delta', id: part.id, argsDelta: part.delta };
            break;
          case 'tool-call':
            yield {
              type: 'tool_call_end',
              id: part.toolCallId,
              name: part.toolName,
              arguments: (part.input ?? {}) as Record<string, unknown>,
            };
            break;
          case 'abort':
            yield { type: 'done', stopReason: 'end_turn' };
            return;
          case 'error': {
            const text = errorText(part.error);
            // Same translation power.ts ships, for the same reason: the raw
            // 400 names a request id and nothing a person can act on.
            if (/incompatible with the selected model/i.test(text)) {
              yield {
                type: 'error',
                message:
                  `Power rejected this request as incompatible with "${config.model}" — ` +
                  `usually the model's route not accepting a feature the chat needs (tool calls). ` +
                  `Pick a different model in Settings → Chat.`,
              };
            } else {
              yield { type: 'error', message: `Power error: ${text}` };
            }
            return;
          }
          case 'finish':
            yield { type: 'done', stopReason: FINISH_MAP[part.finishReason] ?? 'end_turn' };
            return;
          default:
            break; // start/step/raw parts carry nothing the chat stream needs
        }
      }
      yield { type: 'done', stopReason: 'end_turn' };
    } catch (err) {
      if (signal.aborted) {
        yield { type: 'done', stopReason: 'end_turn' };
        return;
      }
      yield { type: 'error', message: `Power error: ${errorText(err)}` };
    }
  }

  // listModels / validateKey are plain GETs with no streaming and no SDK
  // leverage — kept identical to power.ts.
  async listModels(config: ChatProviderConfig): Promise<string[]> {
    const baseUrl = config.baseUrl || POWER_BASE;
    try {
      const response = await apiRequest({
        url: `${baseUrl}/models`,
        headers: { Authorization: `Bearer ${config.apiKey}` },
      });
      const data = JSON.parse(response);
      const models = (data.data ?? [])
        .map((m: { id?: unknown }) => m.id as string)
        .filter((id: string) => typeof id === 'string' && id.length > 0)
        .sort();
      return models.length > 0 ? models : this.defaultModels;
    } catch {
      return this.defaultModels;
    }
  }

  async validateKey(apiKey: string): Promise<string | null> {
    try {
      await apiRequest({
        url: `${POWER_BASE}/models`,
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      return null;
    } catch (err) {
      return `Invalid API key: ${(err as Error).message}`;
    }
  }
}
