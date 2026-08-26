import type { ModelMessage } from 'ai';
import type { ChatMessage } from '../../../common/chat-types';

// Shared plumbing for the AI SDK providers (power-aisdk, anthropic-aisdk).
// One mapper, one error flattener — the per-provider files keep only what
// genuinely differs (base URL, auth, max_tokens, cache breakpoints, the
// provider-specific actionable error sentences).

/** Provider-scoped options attached to the system message (e.g. Anthropic cache_control). */
export interface ToModelMessagesOptions {
  systemProviderOptions?: Record<string, Record<string, unknown>>;
}

/**
 * AI SDK v7 REJECTS role:'system' inside `messages` ("Use the instructions
 * option instead") — and ChatService always sends exactly one system message,
 * first. Split it out for streamText's `system` option; everything else maps
 * through toModelMessages. The optional providerOptions ride on the system
 * message (Anthropic's cache_control breakpoint).
 */
export function splitModelMessages(
  messages: ChatMessage[],
  opts?: ToModelMessagesOptions,
): { system?: { role: 'system'; content: string; providerOptions?: never } | ModelMessage; messages: ModelMessage[] } {
  const sys = messages.find((m) => m.role === 'system');
  const rest = messages.filter((m) => m.role !== 'system');
  const system = sys
    ? {
        role: 'system' as const,
        content: sys.content,
        ...(opts?.systemProviderOptions ? { providerOptions: opts.systemProviderOptions as never } : {}),
      }
    : undefined;
  return { system, messages: toModelMessages(rest) };
}

export function toModelMessages(messages: ChatMessage[], opts?: ToModelMessagesOptions): ModelMessage[] {
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
    if (m.role === 'system' && opts?.systemProviderOptions) {
      return { role: 'system', content: m.content, providerOptions: opts.systemProviderOptions as never };
    }
    return { role: m.role as 'system' | 'user' | 'assistant', content: m.content };
  });
}

/** Flatten an AI SDK stream error (APICallError carries the response body) into one searchable string. */
export function errorText(err: unknown): string {
  const e = err as { message?: string; responseBody?: string; data?: unknown };
  return [e?.message, e?.responseBody, e?.data ? JSON.stringify(e.data) : '']
    .filter(Boolean)
    .join(' ');
}
