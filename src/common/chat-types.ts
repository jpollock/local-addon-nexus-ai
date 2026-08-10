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
 * Both fields are optional and must stay that way: several providers report nothing (Ollama), and
 * some report output tokens without input. A missing count is missing — never coerce it to 0,
 * which reads as "this call was free" and is a lie about a real cost.
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
