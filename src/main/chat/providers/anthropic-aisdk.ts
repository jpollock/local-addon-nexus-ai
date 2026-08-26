import { streamText, dynamicTool, jsonSchema } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import type { ChatMessage, ProviderStreamEvent, TokenUsage } from '../../../common/chat-types';
import type { AIProvider, ChatProviderConfig, ProviderToolDefinition } from './types';
import { splitModelMessages, errorText } from './aisdk-shared';
import { apiRequest } from './http-utils';

// P4.2 (docs/planning/2026-08-26-chat-harness-plan.md) — Anthropic behind the
// Vercel AI SDK, and the provider that BANKS the caching win P3 set up.
//
// Same AIProvider contract as anthropic.ts (which stays the default; this
// class is selected only when NEXUS_ANTHROPIC_AISDK=1 — providers/index.ts).
// Parity claims are pinned by tests/main/anthropic-aisdk-provider.test.ts,
// including the two contracts the hand-rolled client carries that Power's
// never did: token usage on `done` and max_tokens 4096.
//
// What is NEW here, not parity: two cache_control breakpoints per request —
//   tools[last]  — caches the entire tool block (~36.8k tokens measured
//                  2026-08-25, the dominant per-turn cost). Stable across
//                  turns, so this one is the guaranteed hit.
//   system       — opportunistic: hits whenever the volatile tail (fleet
//                  context, moved there by P3) hasn't churned since the
//                  previous turn.
// Two of the API's four allowed breakpoints; the message history is left
// uncached (it grows every turn and would thrash).
const ANTHROPIC_BASE = 'https://api.anthropic.com/v1';
const ANTHROPIC_VERSION = '2023-06-01';

const CACHE_EPHEMERAL = { anthropic: { cacheControl: { type: 'ephemeral' as const } } };

const FINISH_MAP: Record<string, 'end_turn' | 'tool_use' | 'max_tokens' | 'error'> = {
  'stop': 'end_turn',
  'tool-calls': 'tool_use',
  'length': 'max_tokens',
  'error': 'error',
};

export class AnthropicAiSdkProvider implements AIProvider {
  readonly id = 'anthropic';
  readonly displayName = 'Anthropic';
  readonly requiresApiKey = true;
  readonly defaultModels = ['claude-fable-5', 'claude-opus-4-8', 'claude-sonnet-5', 'claude-sonnet-4-6', 'claude-opus-4-6', 'claude-haiku-4-5-20251001'];

  /** fetch override is the test seam — the SDK's own SSE parser runs against it. */
  constructor(private readonly fetchImpl?: typeof fetch) {}

  async *streamChat(
    messages: ChatMessage[],
    tools: ProviderToolDefinition[],
    config: ChatProviderConfig,
    signal: AbortSignal,
  ): AsyncGenerator<ProviderStreamEvent> {
    const provider = createAnthropic({
      apiKey: config.apiKey,
      ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
      ...(this.fetchImpl ? { fetch: this.fetchImpl } : {}),
    });

    // No execute on any tool: ChatService owns the loop (registry.call,
    // tiers, audit). The LAST tool carries the cache breakpoint — Anthropic
    // caches the prefix up to and including it, i.e. the whole tool block.
    //
    // ⚠ P5 interaction (charter, tool-context design review 2026-08-26):
    // when tool deferral lands, this placement becomes a 400 — the API
    // rejects cache_control and defer_loading on the SAME tool, and under a
    // resident/deferred split the last tool is almost certainly deferred.
    // The breakpoint must then move to the last RESIDENT (non-deferred)
    // tool, and a test must pin that no deferred tool ever carries
    // cache_control.
    const aiTools = Object.fromEntries(
      tools.map((t, i) => [t.name, dynamicTool({
        description: t.description,
        inputSchema: jsonSchema(t.parameters as Parameters<typeof jsonSchema>[0]),
        ...(i === tools.length - 1 ? { providerOptions: CACHE_EPHEMERAL } : {}),
      })]),
    );

    const { system, messages: modelMessages } = splitModelMessages(messages, {
      systemProviderOptions: CACHE_EPHEMERAL,
    });
    const result = streamText({
      model: provider(config.model),
      ...(system ? { system: system as never } : {}),
      messages: modelMessages,
      ...(tools.length > 0 ? { tools: aiTools } : {}),
      ...(config.forceTool ? { toolChoice: { type: 'tool' as const, toolName: config.forceTool } } : {}),
      // Parity with anthropic.ts: 4096, and exactly one attempt — errors reach
      // the user through the stream, not after a hidden retry stall.
      maxOutputTokens: 4096,
      abortSignal: signal,
      maxRetries: 0,
      onError: () => { /* surfaced via the fullStream error part below */ },
    });

    let usage: TokenUsage | undefined;
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
            yield { type: 'done', stopReason: 'end_turn', usage };
            return;
          case 'error':
            yield { type: 'error', message: `Anthropic error: ${errorText(part.error)}` };
            return;
          case 'finish': {
            const u = part.totalUsage;
            if (u && (u.inputTokens !== undefined || u.outputTokens !== undefined)) {
              usage = {
                ...(u.inputTokens !== undefined ? { inputTokens: u.inputTokens } : {}),
                ...(u.outputTokens !== undefined ? { outputTokens: u.outputTokens } : {}),
              };
              // The cache breakpoints are unverifiable without this: the live
              // parity drive's second turn should show cacheRead > 0 (grep
              // local-lightning.log for "anthropic-aisdk usage").
              const details = (u as { inputTokenDetails?: { cacheReadTokens?: number; cacheWriteTokens?: number } }).inputTokenDetails;
              console.log(
                `[NexusAI] chat: anthropic-aisdk usage in=${u.inputTokens ?? '?'} out=${u.outputTokens ?? '?'} ` +
                `cacheRead=${details?.cacheReadTokens ?? 0} cacheWrite=${details?.cacheWriteTokens ?? 0}`,
              );
            }
            yield { type: 'done', stopReason: FINISH_MAP[part.finishReason] ?? 'end_turn', usage };
            return;
          }
          default:
            break;
        }
      }
      yield { type: 'done', stopReason: 'end_turn', usage };
    } catch (err) {
      if (signal.aborted) {
        yield { type: 'done', stopReason: 'end_turn', usage };
        return;
      }
      yield { type: 'error', message: `Anthropic error: ${errorText(err)}` };
    }
  }

  // listModels / validateKey: identical to anthropic.ts — plain requests with
  // no streaming and no SDK leverage.
  async listModels(_config: ChatProviderConfig): Promise<string[]> {
    return this.defaultModels;
  }

  async validateKey(apiKey: string): Promise<string | null> {
    try {
      await apiRequest({
        url: `${ANTHROPIC_BASE}/messages`,
        method: 'POST',
        headers: { 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_VERSION },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'hi' }],
        }),
      });
      return null;
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes('401')) return 'Invalid API key';
      if (msg.includes('429') || msg.includes('529')) return null;
      return `Validation failed: ${msg}`;
    }
  }
}
