// ---------------------------------------------------------------------------
// Chat Types — shared between main and renderer
// ---------------------------------------------------------------------------

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ChatMessage {
  role: ChatRole;
  content: string;
  toolCalls?: ToolCallRequest[];
  toolCallId?: string;
  toolName?: string;
}

export interface ToolCallRequest {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Stream Events — sent from main → renderer via CHAT_STREAM IPC channel
// ---------------------------------------------------------------------------

export type ChatStreamEvent =
  | { type: 'token'; text: string }
  | { type: 'tool_call_start'; id: string; name: string }
  | { type: 'tool_call_args_delta'; id: string; argsDelta: string }
  | { type: 'tool_call_end'; id: string; name: string; arguments: Record<string, unknown> }
  | { type: 'tool_call_executing'; id: string; name: string }
  | { type: 'tool_call_result'; id: string; name: string; result: string; isError?: boolean }
  | { type: 'tool_call_approval_needed'; id: string; name: string; arguments: Record<string, unknown>; warning: string }
  | { type: 'done'; stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'error' }
  | { type: 'error'; message: string };

// ---------------------------------------------------------------------------
// Provider-level stream events (subset emitted by providers)
// ---------------------------------------------------------------------------

/**
 * Tokens a single model call consumed, as reported by the provider.
 *
 * Both fields are optional and must stay that way. Two adapters report nothing at all —
 * `local-gateway` because it never yields a `done` event for usage to ride on, and `power`
 * because its chunks carry no usage field and its request never asks for one — and a provider
 * may report one direction without the other. A missing count is missing: never coerce it to 0,
 * which reads as "this call was free" and is a lie about a real cost.
 *
 * An extractor must also return ONLY the keys it actually found. Returning
 * `{ inputTokens: 1204, outputTokens: undefined }` lets a caller's spread-merge overwrite a count
 * it already had, which corrupts a real number rather than merely omitting it.
 */
export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
}

export type ProviderStreamEvent =
  | { type: 'token'; text: string }
  | { type: 'tool_call_start'; id: string; name: string }
  | { type: 'tool_call_args_delta'; id: string; argsDelta: string }
  | { type: 'tool_call_end'; id: string; name: string; arguments: Record<string, unknown> }
  | { type: 'done'; stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'error'; usage?: TokenUsage }
  | { type: 'error'; message: string };
