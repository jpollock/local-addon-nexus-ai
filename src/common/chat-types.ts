// ---------------------------------------------------------------------------
// Chat Types — shared between main and renderer
// ---------------------------------------------------------------------------
import type {
  CheckpointChangedEvent,
  ProcedureAbortedEvent,
  ProcedureArmedEvent,
} from '../main/intelligence-host/procedureView';
import type { ProcedureApprovalContext } from '../main/intelligence-host/procedureStream';
import type { CitationDelivery } from '../main/intelligence-host/citationDelivery';

export type {
  CheckpointChangedEvent,
  CitationDelivery,
  ProcedureAbortedEvent,
  ProcedureApprovalContext,
  ProcedureArmedEvent,
};
export type { CheckpointState, DeclaredProcedure } from '../main/intelligence-host/procedureView';

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

/**
 * WP-26 · the procedure stream, joined to the chat stream.
 *
 * TYPE-ONLY imports, which TypeScript erases completely — the renderer bundle
 * gains no main-process code from them. That erasure is the whole reason these
 * three can be named here rather than restated: a structural copy of
 * `DeclaredProcedure` in `common/` would be a second definition of the shapes
 * `procedureView.ts` exists to be the single source of, and the two would drift
 * on the first field either side added.
 */
/**
 * WP-43 · what the host hands the panel so ADR-24's render can draw.
 *
 * The payload is `CitationDelivery` verbatim — one shape, named where it is
 * built, for the same reason the three procedure events above are type-only
 * imports rather than structural copies. The reply itself is deliberately NOT
 * on it: the panel already holds the streamed text, and a second copy would be
 * two strings for one reply.
 */
export interface CitationSupplyEvent extends CitationDelivery {
  type: 'citation_supply';
}

export type ChatStreamEvent =
  | { type: 'token'; text: string }
  | { type: 'tool_call_start'; id: string; name: string }
  | { type: 'tool_call_args_delta'; id: string; argsDelta: string }
  | { type: 'tool_call_end'; id: string; name: string; arguments: Record<string, unknown> }
  | { type: 'tool_call_executing'; id: string; name: string }
  | { type: 'tool_call_result'; id: string; name: string; result: string; isError?: boolean }
  | {
      type: 'tool_call_approval_needed';
      id: string;
      name: string;
      arguments: Record<string, unknown>;
      warning: string;
      /**
       * WP-26 · present ONLY when this approval is a strict runbook's approval
       * checkpoint. The platform derives it (`procedureApprovalContext`); the
       * card renders it. Absent for every other approval, which is what keeps
       * the ordinary action card byte-identical to the pre-WP-26 build.
       */
      procedure?: ProcedureApprovalContext;
    }
  | { type: 'done'; stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'error' }
  | { type: 'error'; message: string }
  // WP-43 · the turn's citation supply and manifest, delivered once, at the end
  // of the turn, immediately BEFORE `done`.
  //
  // A new event rather than a field on `done`, for two reasons that are not
  // stylistic. First, `done` fires from four places in `ChatService` and one of
  // them is the error path; a payload riding an existing event would have to be
  // threaded through all four and would be silently absent from any fifth added
  // later. Second, WP-26 set the precedent for this exact seam — the procedure
  // events joined the chat stream as new shapes, and "a renderer that does not
  // handle these ignores them, exactly as it ignored them when nothing emitted
  // them". The same property is what keeps `done` byte-identical here.
  //
  // AT THE END, not at assembly, because the supply is not complete until the
  // turn is: the universe is event ids (known at assembly), carrier lines
  // (known at assembly) and TOOL CALLS, which happen afterwards. Sending it
  // early would deliver a supply against which every `[[cite:tool:…]]` the
  // model wrote resolves to nothing — the loudest state on the surface, shown
  // for records the task really did supply.
  | CitationSupplyEvent
  // WP-26 · the procedure surfaces. A renderer that does not handle these
  // ignores them, exactly as it ignored them when nothing emitted them.
  | ProcedureArmedEvent
  | CheckpointChangedEvent
  | ProcedureAbortedEvent;

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
