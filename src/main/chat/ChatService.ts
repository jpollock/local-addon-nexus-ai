import type { ChatMessage, ChatStreamEvent, ToolCallRequest } from '../../common/chat-types';
import { CHAT_DEFAULTS, IPC_CHANNELS } from '../../common/constants';
import type { ToolRegistry } from '../mcp/tool-registry';
import type { NexusServices } from '../mcp/types';
import { getToolSafety, requiresHumanApproval } from '../mcp/safety';
import { maskToolResultsForProvider, UNTRUSTED_DATA_DIRECTIVE } from '../mcp/pii';
import { resolveSite } from '../mcp/site-resolver';
import type { SiteStructure } from '../../common/types';
import { getProvider } from './providers/index';
import type { ChatProviderConfig } from './providers/types';
import { adaptToolsForChat } from './tool-adapter';
import { buildFleetContext } from '../assistant/AssistantService';
import { buildWordPressSystemPrompt } from '../assistant/wordpress-knowledge';
import { getSession, deleteAllSessions } from '../ipc/chat-sessions';
import { assembleForChatTurn } from '../intelligence-host/chatAssembly';
import { recordApprovalRationale } from '../intelligence-host/actionProducer';
import { procedureApprovalContext, setProcedureStreamSink } from '../intelligence-host/procedureStream';
import { checkCheckpointSequence } from '../intelligence-host/sequenceGuard';
import type { CanaryPolicy } from '../intelligence-host/procedureView';

// ---------------------------------------------------------------------------
// Site Lifecycle — tools that require a running local site
// ---------------------------------------------------------------------------

interface SiteToolConfig {
  argKey: 'site' | 'site_ids';
  /**
   * true  → stop sites after tool returns (synchronous tools that wait for completion)
   * false → leave sites running (async tools that queue background work)
   */
  autoStop: boolean;
}

/**
 * Tools that require running local sites.
 * autoStop=false means the background task needs sites alive after the tool call returns.
 */
const NEEDS_RUNNING_SITE: Record<string, SiteToolConfig> = {
  // Synchronous — tool awaits completion, safe to stop after
  reindex_site:          { argKey: 'site',     autoStop: true },
  scan_database_health:  { argKey: 'site',     autoStop: true },
  clean_database_items:  { argKey: 'site',     autoStop: true },
  get_site_structure:    { argKey: 'site',     autoStop: true },
  nexus_site_audit:      { argKey: 'site',     autoStop: true },
  nexus_site_refresh:    { argKey: 'site',     autoStop: true },
  wp_plugin_list:        { argKey: 'site',     autoStop: true },
  wp_plugin_update:      { argKey: 'site',     autoStop: true },
  wp_plugin_activate:    { argKey: 'site',     autoStop: true },
  wp_plugin_deactivate:  { argKey: 'site',     autoStop: true },
  wp_plugin_install:     { argKey: 'site',     autoStop: true },
  wp_core_version:       { argKey: 'site',     autoStop: true },
  wp_core_update:        { argKey: 'site',     autoStop: true },
  wp_eval:               { argKey: 'site',     autoStop: true },
  wp_search_replace:     { argKey: 'site',     autoStop: true },
  wp_site_health:        { argKey: 'site',     autoStop: true },
  wp_option_get:         { argKey: 'site',     autoStop: true },
  wp_post_create:        { argKey: 'site',     autoStop: true },
  wp_post_update:        { argKey: 'site',     autoStop: true },
  wp_post_delete:        { argKey: 'site',     autoStop: true },
  wp_user_list:          { argKey: 'site',     autoStop: true },
  wp_theme_list:         { argKey: 'site',     autoStop: true },
  wp_theme_activate:     { argKey: 'site',     autoStop: true },
  wp_db_export:          { argKey: 'site',     autoStop: true },
  wp_import_database:    { argKey: 'site',     autoStop: true },
  wp_run_ability:        { argKey: 'site',     autoStop: true },
  wp_list_abilities:     { argKey: 'site',     autoStop: true },
  wp_setup_ai:           { argKey: 'site',     autoStop: true },
  wp_sync_ai_credentials:{ argKey: 'site',     autoStop: true },

  // Async — queues background work; sites must stay running until indexing completes
  bulk_reindex:          { argKey: 'site_ids', autoStop: false },
};

// ---------------------------------------------------------------------------
// Session State
// ---------------------------------------------------------------------------

/**
 * WP-26 · what the human's click carries back.
 *
 * The policy rides WITH the decision rather than being read from somewhere
 * afterwards, because it is part of the same act: the card offered two values
 * and the person chose one. Absent means they were offered none, or chose none.
 */
interface ApprovalDecision {
  approved: boolean;
  canaryPolicy?: CanaryPolicy;
}

interface ChatSession {
  id: string;
  messages: ChatMessage[];
  abortController: AbortController;
  pendingApprovals: Map<string, {
    resolve: (decision: ApprovalDecision) => void;
    toolName: string;
    args: Record<string, unknown>;
  }>;
}

// ---------------------------------------------------------------------------
// Chat Service
// ---------------------------------------------------------------------------

export interface ChatServiceDeps {
  registry: ToolRegistry;
  services: NexusServices;
  sendToRenderer: (channel: string, ...args: unknown[]) => void;
}

export class ChatService {
  private sessions = new Map<string, ChatSession>();
  private readonly registry: ToolRegistry;
  private readonly services: NexusServices;
  private readonly sendToRenderer: (channel: string, ...args: unknown[]) => void;

  constructor(deps: ChatServiceDeps) {
    this.registry = deps.registry;
    this.services = deps.services;
    this.sendToRenderer = deps.sendToRenderer;
    // WP-26 · the procedure stream's one consumer. Registered here rather than
    // at bootstrap because the sink IS this service's `emit` — the events are
    // per-session and the chat stream is the channel a session already has.
    setProcedureStreamSink((sessionId, event) => this.emit(sessionId, event));
  }

  /**
   * Entry point from IPC. Starts or continues a chat session.
   */
  async sendMessage(
    sessionId: string,
    userMessage: string,
    providerConfig: { providerId: string; model: string; apiKey?: string },
    siteId?: string,
  ): Promise<void> {
    const provider = getProvider(providerConfig.providerId);
    if (!provider) {
      this.emit(sessionId, { type: 'error', message: `Unknown provider: ${providerConfig.providerId}` });
      return;
    }

    let session = this.sessions.get(sessionId);

    // WP-11 · context assembler. Runs on EVERY turn, before the user message is
    // pushed, regardless of which branch below built the session — that is what
    // makes "the bundle was present" a property of the turn rather than of how
    // the session happened to start (recon §4.2). Returns null whenever the
    // intelligence layer is absent or degraded; every use below is guarded, so
    // a null result leaves this method byte-identical to the pre-WP-11 build.
    // The adapter already swallows its own failures and returns null. This
    // second guard is deliberate defence in depth: the layer invariant is that
    // nothing on this seam can throw into a caller that predates it, and this
    // await is the one place a regression inside the adapter could.
    let assembly = null;
    try {
      assembly = await assembleForChatTurn({
        services: this.services,
        sessionId,
        userMessage,
        siteId,
        buildingSystemPrompt: !session,
      });
    } catch { /* context assembly is never worth a lost chat turn */ }

    if (!session) {
      const abortController = new AbortController();
      const pendingApprovals: ChatSession['pendingApprovals'] = new Map();

      // Attempt to restore persisted history so Claude remembers prior turns
      const db = this.services.graphService?.getDb();
      const persisted = db ? getSession(db, sessionId) : null;

      if (persisted && persisted.messages.length > 0) {
        // Reconstruct message array from persisted records.
        // Persisted system rows are deliberately DROPPED: the renderer never writes
        // one (PanelChat.persistSession filters them), so any that exists is from an
        // older build and is stale — fleet context is current-state. The prompt is
        // rebuilt below instead, which also guarantees exactly one system message.
        const history = persisted.messages
          .filter((m: any) => !m.incomplete)
          .filter((m: any) => m.content !== '')
          .filter((m: any) => m.role === 'user' || m.role === 'assistant')
          .map((m: any) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

        // Rebuild the system prompt — without it a reopened session runs with no
        // fleet context, no tool doctrine, and no UNTRUSTED_DATA_DIRECTIVE.
        const systemPrompt = await this.buildSystemPrompt(siteId, assembly?.ambientBlock);

        session = {
          id: sessionId,
          messages: [{ role: 'system', content: systemPrompt }, ...history],
          abortController,
          pendingApprovals,
        };
      } else {
        // Fresh session — build system prompt
        const systemPrompt = await this.buildSystemPrompt(siteId, assembly?.ambientBlock);
        session = {
          id: sessionId,
          messages: [{ role: 'system', content: systemPrompt }],
          abortController,
          pendingApprovals,
        };
      }

      this.sessions.set(sessionId, session);
    } else {
      // Reset abort controller for new turn
      session.abortController = new AbortController();
    }

    // Add user message
    session.messages.push({ role: 'user', content: userMessage });

    // WP-11 · the per-turn carrier, delivered as a USER-role message.
    // Never a second system message: anthropic.ts and google.ts keep the FIRST
    // system message and discard the rest with no error (recon R3), so an
    // appended system message is a provider-dependent no-op. Never a `tool`
    // message either: those are truncated to 600 chars after two assistant
    // turns (compressStaleToolResults) and wrapped as untrusted data, which
    // would tell the model to ignore the very policy it carries (R5, R7).
    if (assembly?.turnBlock) {
      session.messages.push({ role: 'user', content: assembly.turnBlock });
    }

    const config: ChatProviderConfig = {
      apiKey: providerConfig.apiKey,
      model: providerConfig.model,
    };

    // Compress stale tool results to prevent context bloat
    session.messages = this.compressStaleToolResults(session.messages);

    // WP-19 · the turn's TaskId rides down to both dispatch paths, so every
    // gated act this turn produces joins the assembly manifest on one
    // `WHERE correlation = ?`. Undefined whenever the layer contributed
    // nothing, which is the pre-WP-19 behaviour exactly.
    await this.runAgentLoop(session, providerConfig.providerId, config, assembly?.grants, assembly?.taskId);
  }

  /**
   * Agent loop: stream → collect tool calls → execute → continue.
   * Max iterations prevent infinite loops.
   */
  private async runAgentLoop(
    session: ChatSession,
    providerId: string,
    config: ChatProviderConfig,
    grants?: string[],
    taskId?: string,
  ): Promise<void> {
    const provider = getProvider(providerId);
    if (!provider) return;

    for (let iteration = 0; iteration < CHAT_DEFAULTS.MAX_AGENT_ITERATIONS; iteration++) {
      if (session.abortController.signal.aborted) break;

      // WP-11 edit #3: grants pass-through. Recomputed every iteration, so a
      // grant set could change mid-task without touching the message array.
      // Signature only in v0 — `grants` is always undefined (unrestricted),
      // which is today's behaviour exactly.
      const tools = adaptToolsForChat(this.registry, this.services, grants);

      // Stream the LLM response
      let assistantContent = '';
      const toolCalls: ToolCallRequest[] = [];

      try {
        const stream = provider.streamChat(
          // P0-5: mask emails/IPs in tool results on the way OUT to the provider. A copy — the
          // stored session (and the rendered transcript) keep real values; only the provider-bound
          // messages are scrubbed.
          maskToolResultsForProvider(session.messages),
          tools,
          config,
          session.abortController.signal,
        );

        let stopReason: string = 'end_turn';

        for await (const event of stream) {
          if (session.abortController.signal.aborted) break;

          // Forward provider events to renderer
          if (event.type === 'token') {
            assistantContent += event.text;
            this.emit(sessionId(session), event);
          } else if (event.type === 'tool_call_start' || event.type === 'tool_call_args_delta') {
            this.emit(sessionId(session), event);
          } else if (event.type === 'tool_call_end') {
            toolCalls.push({
              id: event.id,
              name: event.name,
              arguments: event.arguments,
            });
            this.emit(sessionId(session), event);
          } else if (event.type === 'done') {
            stopReason = event.stopReason;
          } else if (event.type === 'error') {
            this.emit(sessionId(session), event);
            this.emit(sessionId(session), { type: 'done', stopReason: 'error' });
            return;
          }
        }

        // Record assistant message
        const assistantMsg: ChatMessage = {
          role: 'assistant',
          content: assistantContent,
          ...(toolCalls.length > 0 ? { toolCalls } : {}),
        };
        session.messages.push(assistantMsg);

        // If no tool calls, we're done
        if (stopReason !== 'tool_use' || toolCalls.length === 0) {
          this.emit(sessionId(session), { type: 'done', stopReason: stopReason as any });
          return;
        }

        // Execute tool calls and add results to messages
        for (const tc of toolCalls) {
          if (session.abortController.signal.aborted) break;

          const result = await this.executeToolCall(session, tc, taskId);

          // Add tool result message
          session.messages.push({
            role: 'tool',
            content: result.text,
            toolCallId: tc.id,
            toolName: tc.name,
          });

          // Only count Tier 2/3 (state-changing) ops as actions — Tier 1 reads are invisible
          const actionSafety = getToolSafety(tc.name);
          if (actionSafety.tier >= 2) {
            try {
              const db = this.services.graphService?.getDb();
              if (db) {
                db.prepare('UPDATE chat_sessions SET action_count = action_count + 1 WHERE id = ?').run(session.id);
                const row = db.prepare('SELECT action_count FROM chat_sessions WHERE id = ?').get(session.id) as any;
                this.sendToRenderer(IPC_CHANNELS.CHAT_SESSION_ACTION_RECORDED, session.id, {
                  sessionId: session.id,
                  actionCount: row?.action_count ?? 1,
                });
              }
            } catch { /* non-fatal — badge will refresh on next save */ }
          }
        }

        // Continue loop — LLM will see tool results and respond
      } catch (err) {
        if (!session.abortController.signal.aborted) {
          this.emit(sessionId(session), {
            type: 'error',
            message: `Chat error: ${(err as Error).message}`,
          });
        }
        this.emit(sessionId(session), { type: 'done', stopReason: 'error' });
        return;
      }
    }

    // Max iterations reached
    this.emit(sessionId(session), {
      type: 'error',
      message: 'Maximum tool call iterations reached. Stopping.',
    });
    this.emit(sessionId(session), { type: 'done', stopReason: 'end_turn' });
  }

  /**
   * Execute a single tool call with safety-tier awareness.
   */
  private async executeToolCall(
    session: ChatSession,
    toolCall: ToolCallRequest,
    taskId?: string,
  ): Promise<{ text: string; isError?: boolean }> {
    // Contributed agent tools (agent__<agentName>__<toolName>) bypass the built-in
    // registry and route directly through AgentDispatcher.
    if (toolCall.name.startsWith('agent__')) {
      const dispatcher = (this.services as any).dispatcher;
      const contributedRegistry = (this.services as any).contributedRegistry;
      if (dispatcher && contributedRegistry) {
        const registered = contributedRegistry.getByMcpName(toolCall.name);
        if (registered) {
          this.emit(sessionId(session), {
            type: 'tool_call_executing', id: toolCall.id, name: toolCall.name,
          });
          // WP-19 · the bypass carries the turn's task frame. The EMISSION
          // lives inside `AgentDispatcher.dispatch` (audit chokepoint two),
          // not here: this branch is one of two callers of that dispatcher —
          // McpServer is the other — and instrumenting the caller would leave
          // the other one silently unrecorded, which is the same shape of gap
          // the registry-only wiring would have had.
          const result = await dispatcher.dispatch(
            registered.agentName, registered.toolName, toolCall.arguments ?? {},
            { id: taskId },
          );
          const text = result.content.map((c: { text: string }) => c.text).join('\n');
          this.emit(sessionId(session), {
            type: 'tool_call_result', id: toolCall.id, name: toolCall.name,
            result: text, isError: result.isError,
          });
          return { text, isError: result.isError };
        }
      }
      return { text: `Agent tool ${toolCall.name} not found or dispatcher unavailable.`, isError: true };
    }

    const safety = getToolSafety(toolCall.name);

    // Requires human approval: every Tier-3 tool, plus the freeform/overwrite Tier-2 tools
    // (wp_eval, wp_search_replace) that a prompt-injected model — fed untrusted site content — could
    // be steered into calling (T-INJECTION). Both route through the same approval card below.
    // WP-26 · an armed strict runbook can REQUIRE an approval the tool's own
    // tier does not.
    //
    // `bulk_plugin_update` is Tier 2, so nothing here ever showed a card for
    // it — while `rb.bulk-plugin-update` declares `cp.approval` as the
    // checkpoint a human decision attests, and the sequence guard refuses the
    // tool until it is. With no card there is no producer for that decision,
    // so the guard refuses the anchor capability FOREVER and the run
    // deadlocks. The condition is the guard's OWN answer, not a second rule:
    // it fires only when the guard is already refusing this call on exactly
    // the checkpoint the approval would attest. It can only ADD a gate.
    const procedure = procedureApprovalContext(sessionId(session));
    const gatedOnApproval =
      !!procedure &&
      checkCheckpointSequence(toolCall.name, taskId)?.checkpoint === procedure.checkpointId;

    if (requiresHumanApproval(toolCall.name) || gatedOnApproval) {
      // TWO STRINGS, one card, and the split is the point (WP-28 finding 2).
      //
      // `warning` is the card's own message line. `procedure` travels beside it
      // and the card renders the runbook, its version and the checkpoint from
      // those fields as a styled block — so a warning that opened with the same
      // sentence printed the reference twice on one card, which is what the
      // first live run showed.
      //
      // `cardText` is what the ledger records, and it stays whole. The recorded
      // rationale's `prompt` is "the card the human was shown" — the whole card,
      // block included — and a rationale event that could not name the document
      // the decision was taken under would be a worse record for a cosmetic win.
      // Composed from the declaration's own fields; naming a document is not
      // inventing a rationale.
      const cardMessage = procedure
        ? safety.confirmationMessage ?? 'Approve this step to let the runbook continue.'
        : safety.confirmationMessage ?? 'This action may have significant consequences.';
      const cardText = procedure
        ? `Runbook ${procedure.runbookId} v${procedure.version}, marked strict — ` +
          `checkpoint ${procedure.checkpointId}. ${cardMessage}`
        : cardMessage;
      // REGISTER BEFORE EMITTING. `emit` is synchronous all the way into
      // `sendToRenderer`, so a caller that answers the card inside that call —
      // any headless approver, and the eval sitting harness is one — resolved
      // an approval that was not yet pending, and the await below then hung
      // forever. Production never saw it because a real renderer answers over
      // IPC on a later tick; that is luck, not design.
      const pending = this.waitForApproval(session, toolCall.id, toolCall.name, toolCall.arguments);
      this.emit(sessionId(session), {
        type: 'tool_call_approval_needed',
        id: toolCall.id,
        name: toolCall.name,
        arguments: toolCall.arguments,
        warning: cardMessage,
        ...(procedure ? { procedure } : {}),
      });

      const decision = await pending;
      const approved = decision.approved;

      // WP-19 · task.rationale.recorded v0 — the card the human was shown and
      // the arguments they ruled on, VERBATIM. No prose is composed here: the
      // actor produced a decision, not an explanation, and inventing one would
      // be the boilerplate rationale E-02 forbids wearing a better disguise.
      // Recorded on BOTH decisions — a denial with no record leaves "did it
      // proceed anyway?" with only one side of the comparison.
      const rationaleId = recordApprovalRationale({
        toolName: toolCall.name,
        args: toolCall.arguments ?? {},
        cardText,
        decision: approved ? 'approved' : 'denied',
        taskId,
        services: this.services,
        // WP-26: the canary policy is part of the approval, not a separate act.
        // The producer validates it and drops it on a denial — nothing is
        // authored here, and absence stays meaningful.
        ...(decision.canaryPolicy ? { canaryPolicy: decision.canaryPolicy } : {}),
      });

      if (!approved) {
        const denialText = `Tool "${toolCall.name}" was denied by user.`;
        this.emit(sessionId(session), {
          type: 'tool_call_result',
          id: toolCall.id,
          name: toolCall.name,
          result: denialText,
          isError: false,
        });
        return { text: denialText };
      }

      // User approved via the tool_call_approval_needed UI card above -- that
      // click IS the real human confirmation, so pass requireConfirmation:
      // false to skip ToolRegistry.call()'s own Tier-3 gate. Without this,
      // the registry would intercept this call and return the
      // requiresConfirmation JSON instead of executing, since no
      // _confirmationToken is (or should be) generated for a UI-approved
      // chat action.
      this.emit(sessionId(session), {
        type: 'tool_call_executing',
        id: toolCall.id,
        name: toolCall.name,
      });

      const { startedIds: _s3, autoStop: _as3 } = await this.prepareSiteLifecycle(toolCall.name, toolCall.arguments);
      // The approval is this act's cause: `causation` makes the chain
      // approval -> action -> outcome readable straight off the ledger.
      const result3 = await this.registry.call(
        toolCall.name, toolCall.arguments, this.services, 'mcp', false, undefined,
        { id: taskId, causation: rationaleId },
      );
      const _note3 = await this.teardownSiteLifecycle(_s3, _as3);
      const text3 = result3.content.map((c) => c.text).join('\n') + _note3;

      this.emit(sessionId(session), {
        type: 'tool_call_result',
        id: toolCall.id,
        name: toolCall.name,
        result: text3,
        isError: result3.isError,
      });

      return { text: text3, isError: result3.isError };
    }

    // Tier 1 & 2: execute directly
    this.emit(sessionId(session), {
      type: 'tool_call_executing',
      id: toolCall.id,
      name: toolCall.name,
    });

    const { startedIds: _s, autoStop: _as } = await this.prepareSiteLifecycle(toolCall.name, toolCall.arguments);
    // No approval preceded this one, so no causation rides with it — the
    // absence is the honest record of a call that needed no human decision.
    const result = await this.registry.call(
      toolCall.name, toolCall.arguments, this.services, 'mcp', true, undefined, { id: taskId },
    );
    const _note = await this.teardownSiteLifecycle(_s, _as);
    const text = result.content.map((c) => c.text).join('\n') + _note;

    this.emit(sessionId(session), {
      type: 'tool_call_result',
      id: toolCall.id,
      name: toolCall.name,
      result: text,
      isError: result.isError,
    });

    return { text, isError: result.isError };
  }

  /**
   * Starts any halted local sites required by the tool.
   * Returns IDs of sites we started so teardown knows what to stop.
   */
  private async prepareSiteLifecycle(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<{ startedIds: string[]; autoStop: boolean }> {
    const config = NEEDS_RUNNING_SITE[toolName];
    const bail = { startedIds: [], autoStop: true };

    if (!config) return bail;
    if (!this.services.localServices) {
      return bail;
    }

    const targets: Array<{ id: string; name: string }> = [];

    if (config.argKey === 'site') {
      const siteArg = args.site as string | undefined;
      if (!siteArg) return { startedIds: [], autoStop: config.autoStop };
      const site = resolveSite(siteArg, this.services.siteData);
      if (site) targets.push({ id: site.id, name: site.name });
    } else {
      const ids = (args.site_ids as string[]) ?? [];
      for (const id of ids) {
        const site = this.services.siteData.getSite(id);
        if (site) targets.push({ id: site.id, name: site.name });
      }
    }

    const toStart = targets.filter((t) => {
      try {
        return this.services.localServices!.getSiteStatus(t.id) === 'halted';
      } catch {
        return false;
      }
    });

    if (toStart.length === 0) return { startedIds: [], autoStop: config.autoStop };

    try {
      await this.services.localServices.startSites(toStart.map((t) => t.id));
    } catch (err) {
      // startSites failure is non-fatal — proceed with whatever sites did start
    }

    const startedIds = toStart
      .filter((t) => {
        try { return this.services.localServices!.getSiteStatus(t.id) === 'running'; } catch { return false; }
      })
      .map((t) => t.id);

    return { startedIds, autoStop: config.autoStop };
  }

  /**
   * Stops sites we auto-started (sync tools only). For async tools (bulk_reindex etc.),
   * sites must stay running until background indexing completes — autoStop=false skips this.
   */
  private async teardownSiteLifecycle(
    startedIds: string[],
    autoStop: boolean,
  ): Promise<string> {
    if (startedIds.length === 0 || !this.services.localServices) return '';

    const names = startedIds.map((id) => this.services.siteData.getSite(id)?.name ?? id);

    if (!autoStop) {
      return `\n\n[Auto-lifecycle: started ${names.join(', ')} — left running for background task]`;
    }

    await this.services.localServices.stopSites(startedIds);
    return `\n\n[Auto-lifecycle: started and stopped ${names.join(', ')}]`;
  }

  /**
   * Wait for user approval of a tier 3 tool call.
   */
  private waitForApproval(
    session: ChatSession,
    toolCallId: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<ApprovalDecision> {
    return new Promise((resolve) => {
      session.pendingApprovals.set(toolCallId, { resolve, toolName, args });
    });
  }

  /**
   * Resolve a pending tier 3 approval (called from IPC handler).
   */
  resolveApproval(
    sessionId: string,
    toolCallId: string,
    approved: boolean,
    canaryPolicy?: CanaryPolicy,
  ): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const pending = session.pendingApprovals.get(toolCallId);
    if (pending) {
      pending.resolve({ approved, ...(canaryPolicy ? { canaryPolicy } : {}) });
      session.pendingApprovals.delete(toolCallId);
    }
  }

  /**
   * Stop generation for a session.
   */
  stopGeneration(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.abortController.abort();
      // Reject all pending approvals
      for (const [, pending] of session.pendingApprovals) {
        pending.resolve({ approved: false });
      }
      session.pendingApprovals.clear();
    }
  }

  /**
   * Clear a session's conversation history.
   */
  clearSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  /**
   * Clear all chat history (in-memory sessions and database).
   * Returns { success: false, error } if database is not available.
   * Emits CHAT_ALL_CLEARED to renderer to invalidate UI state.
   */
  clearAllSessions(): { success: boolean; error?: string } {
    this.sessions.clear();
    const db = this.services.graphService?.getDb();
    if (!db) {
      return { success: false, error: 'Database not available' };
    }
    deleteAllSessions(db);
    // Notify renderer to invalidate chat state (active sessions, sidebar)
    this.sendToRenderer(IPC_CHANNELS.CHAT_ALL_CLEARED);
    return { success: true };
  }

  /**
   * Build the system prompt with optional site context.
   *
   * `ambientBlock` (WP-11 edit #1) is the assembler's policy set. Its placement
   * below is deliberate: AFTER the untrusted-data directive, so injected policy
   * is unambiguously on the trusted side of that boundary, and BEFORE the tool
   * doctrine, so policy outranks tool enthusiasm. Null/undefined inserts
   * nothing at all — the additive-parity pin.
   */
  private async buildSystemPrompt(siteId?: string, ambientBlock?: string | null): Promise<string> {
    // Build WordPress-aware fleet context (PHP EOL, site counts, insights)
    let fleetContextSection = '';
    try {
      const fleetCtx = buildFleetContext(
        this.services.siteData,
        (this.services as any).metadataCache,
        this.services.indexRegistry,
        (this.services as any).graphService,
      );
      // agentMode=true: omits JSON output format, keeps WordPress domain knowledge
      fleetContextSection = buildWordPressSystemPrompt(fleetCtx, true);
    } catch { /* fleet context unavailable — proceed without it */ }

    const lines = [
      fleetContextSection,
      '',
      'You are Nexus AI, a WordPress site management assistant built into the Local development environment.',
      'You have access to tools for managing WordPress sites, checking plugin status, running WP-CLI commands, and more.',
      'Be concise and helpful. When using tools, explain what you are doing.',
      '',
      UNTRUSTED_DATA_DIRECTIVE,
      '',
      ...(ambientBlock ? [ambientBlock, ''] : []),
      'IMPORTANT: Always use your tools to get real data. Never fabricate or guess site names, plugin lists, version numbers, or other information.',
      'If asked about sites, call local_list_sites or nexus_list_sites first. If asked about plugins, call wp_plugin_list with the site name.',
      'If asked about WordPress versions, call wp_core_version. If you cannot answer using your available tools, say so.',
      'For complex multi-step queries (e.g. "admin users across recipe sites"), chain multiple tool calls together.',
      '',
      'Fleet management tools:',
      '- fleet_health_summary: Get health scores for all indexed sites',
      '- get_site_health: Get detailed health breakdown for a specific site',
      '- fleet_search: Search across all indexed site content',
      '- fleet_filter: Apply smart filters (e.g., outdated-php, no-ssl) across the fleet',
      '- bulk_reindex: Reindex multiple sites at once (pass an array of site_ids)',
      '- bulk_plugin_update: Update a plugin across multiple sites',
      '- list_site_groups: List all site groups',
      '- manage_site_group: Create, rename, delete groups or move sites between groups',
      '',
      'When asked to reindex sites, use the bulk_reindex tool with site IDs from local_list_sites.',
      'Never suggest manual WP-CLI commands when a tool exists for the task.',
      '',
      '## Content search (finding posts/pages/products/etc.)',
      'Choosing the tool:',
      '- A question about ONE named site\'s content → use search_site_content with that site.',
      '  Do NOT use search_across_sites or fleet_search for a single named site — those search the ENTIRE fleet and will return unrelated sites.',
      '- "Which of my sites has X?" (genuinely cross-fleet) → search_across_sites / fleet_search.',
      'Attribute / constraint questions (comparatives, ranges, categories — e.g. "easy", "cheap", "under $20", "over 10 miles", "in <region>", "beginner", "most/least X", a season/status):',
      '  1. FIRST call describe_site_fields(site) to see that site\'s indexed structured fields and their types/ranges/enums. Do not assume field names.',
      '  2. Map the user\'s words to a field by reading the field names and values (e.g. a word like "easy" against a numeric field like difficulty where low = easier → that field with a low upper bound; "under $N" against a price field → that field lte N; "in <place>" against an enum region/category field → eq/contains).',
      '  3. Call search_site_content with searchMode:"hybrid", the relevant postType, and metadataFilters:[{field,op,value}] (op ∈ eq|ne|lt|lte|gt|gte|contains; numeric ops need a number field; use contains for array/text fields). Multiple constraints → multiple filters (they AND).',
      '  4. If too few results, relax the query TEXT (not the filters) or widen a numeric bound by one step, and say what you changed. If no field matches the constraint, fall back to semantic search and say the site has no structured field for it.',
      'For purely topical questions (no attributes), plain search_site_content (semantic) is fine.',
      'search_site_content returns a "fields:" line per result — cite the concrete field values (e.g. "difficulty 1, 3.1 miles") so the user sees why each result qualifies. This workflow is domain-agnostic: it works whether the site is about trails, products, lawyers, or recipes.',
      '',
      '## Task completion protocol',
      'When you finish a multi-step task (updated plugins, started a site, ran an audit, etc.), begin your final response with:',
      '  ✓ Done: [one sentence past-tense summary of what was accomplished]',
      '',
      'Example: "✓ Done: Updated 3 plugins on pm-bulletin (Elementor, WooCommerce, ACF). Site is still running."',
      '',
      'For follow-up questions, treat previously completed work as resolved unless the user explicitly revisits it.',
      '',
      '## Async / long-running operations (pulls, pushes, exports, backups)',
      'Some operations take 1–5 minutes: site pulls from WP Engine, pushes, exports, bulk reindex.',
      'Correct behaviour for these:',
      '  1. Start the operation.',
      '  2. Check local_operation_status 2–3 times to confirm it is running.',
      '  3. If still "in_progress" after 3 checks, STOP polling and tell the user:',
      '     "The [operation] is running in the background. Ask me again in a few minutes to check if it\'s done."',
      '  4. Do NOT call local_operation_status more than 3 times in one turn — this wastes context budget.',
      'If the user asks "is it done yet?", check once and report.',
      '',
      '## Site lifecycle',
      'Tools that require a running site (wp_*, reindex_site, scan_database_health, etc.) handle',
      'start/stop automatically in the background. You will see [Auto-lifecycle: ...] notes in tool',
      'results confirming which sites were started and stopped. You do not need to manage this yourself.',
    ];

    if (siteId) {
      const site = resolveSite(siteId, this.services.siteData);
      if (site) {
        let structure: SiteStructure | null = null;
        const indexEntry = this.services.indexRegistry.get(site.id);
        if (indexEntry?.structure) {
          structure = indexEntry.structure;
        } else {
          try {
            structure = await this.services.fileScanner.scan(site.path);
          } catch {
            // Site may not be running
          }
        }

        lines.push('');
        lines.push(`Current site: ${site.name}${site.domain ? ` (${site.domain})` : ''}`);

        if (structure) {
          const activeTheme = structure.themes.find((t) => t.isActive);
          const activePlugins = structure.plugins.filter((p) => p.isActive);
          lines.push(`WordPress: ${structure.wpVersion} | PHP: ${structure.phpVersion}`);
          lines.push(`Active theme: ${activeTheme?.name ?? 'unknown'}`);
          lines.push(`Active plugins: ${activePlugins.map((p) => p.name).join(', ') || 'none'}`);
        }
      }
    }

    return lines.join('\n');
  }

  /**
   * Compress stale tool results to reduce context bloat.
   * Tool results older than 2 assistant messages get trimmed to 600 chars.
   * Recent results (from the last tool-use cycle) are preserved in full.
   */
  private compressStaleToolResults(messages: ChatMessage[]): ChatMessage[] {
    const COMPRESS_THRESHOLD = 800;
    const COMPRESS_TO = 600;

    let assistantCount = 0;
    let compressBefore = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') {
        assistantCount++;
        if (assistantCount >= 2) {
          compressBefore = i;
          break;
        }
      }
    }

    if (compressBefore < 0) return messages;

    return messages.map((msg, idx) => {
      if (idx >= compressBefore) return msg;
      if (msg.role !== 'tool') return msg;
      const content = typeof msg.content === 'string' ? msg.content : '';
      if (content.length <= COMPRESS_THRESHOLD) return msg;
      return {
        ...msg,
        content: content.slice(0, COMPRESS_TO) +
          `\n[…compressed for context efficiency — ${content.length} chars total]`,
      };
    });
  }

  /**
   * Emit a stream event to the renderer for a specific session.
   */
  private emit(sessionId: string, event: ChatStreamEvent): void {
    this.sendToRenderer(IPC_CHANNELS.CHAT_STREAM, sessionId, event);
  }
}

function sessionId(session: ChatSession): string {
  return session.id;
}
