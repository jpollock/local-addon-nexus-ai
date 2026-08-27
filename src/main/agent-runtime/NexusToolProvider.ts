import type { ToolRegistry } from '../mcp/tool-registry';
import type { NexusServices } from '../mcp/types';
import type { ToolProvider } from '../agent-sdk/types';
import type { ProviderToolDefinition } from '../chat/providers/types';
import type { EventLog } from '../logging/eventLog';
import { getToolSafety, APPROVAL_REQUIRED_TOOLS } from '../mcp/safety';
import { isMutatingTool, mutationTarget } from './toolEvents';
import { agentNameFromActorId } from '../intelligence-host/agentTaskFrame';

/** What an agent run needs in order for its tool calls to appear in the structured log. */
export interface ToolEventContext {
  eventLog?: EventLog;
  runId?: string;
  agentName: string;
}

/**
 * Implements ToolProvider by wrapping ToolRegistry with scope enforcement.
 * Enforces that agents can only invoke tools declared in their tools list.
 */
export class NexusToolProvider implements ToolProvider {
  private registry: ToolRegistry;
  private services: NexusServices;
  private allowedTools: Set<string> | undefined;
  /** Site IDs this provider may target with wp_eval. Empty = any site allowed (MCP mode). */
  private sandboxSiteIds: Set<string> = new Set();

  /** Absent in MCP mode and in tests; tool events are simply not written then. */
  private events: ToolEventContext | undefined;

  /** Counts how many tool calls threw — either failed or refused. */
  private _failedCallCount = 0;

  /**
   * WP-57 · every tool this run REACHED, in call order — the run's citable
   * universe (ADR-24 P1's "trace" half).
   *
   * Collected past the gates, beside `reached.tool`, for the reason the
   * `mutation` event uses the same boundary: a call refused by scope, by the
   * Tier-3 gate or by the sequence guard OBSERVED NOTHING, and letting a
   * finding cite it would warrant a claim with a non-event.
   */
  private readonly _trace: string[] = [];

  /**
   * WP-57 · this run's ledger frame. Absent on the MCP path and in tests.
   *
   * Structural, not the whole `AgentTaskFrame`: this class needs the id to
   * thread and the act to note, and nothing else. Narrowing it here keeps the
   * tool provider from acquiring an opinion about the frame's lifecycle.
   */
  private readonly frame?: {
    id: string;
    actor: { id: string; kind: 'agent' };
    noteGatedAct(at: number): void;
    /**
     * WP-59 · flush the bracket for a run that was BOUND. See `refusal` below —
     * a run stopped from acting is not a quiet run, and must be findable.
     */
    correlationId(): string | undefined;
  };

  /**
   * WP-59 · this run's context was assembled FAIL-CLOSED, and why.
   *
   * `assemble()` refuses an autonomous actor with no policy set (ADR-7), or one
   * whose granted procedure will not load or does not hash to the document it
   * was granted against. The bundle says so in prose — and prose is advice a
   * prompt-injected model can ignore, which is why the bind lives here, at the
   * tier gate, instead.
   *
   * Absent for every run that assembled normally, and absent for a run whose
   * assembly FAULTED: a fault degrades, only a refusal binds. Collapsing those
   * two would turn fail-closed into fail-open-on-exception in one direction and
   * into a fleet-wide agent outage in the other.
   */
  private readonly refusal?: { reason: string };

  constructor(
    registry: ToolRegistry,
    services: NexusServices,
    tools: string[] | undefined,
    events?: ToolEventContext,
    frame?: {
      id: string;
      actor: { id: string; kind: 'agent' };
      noteGatedAct(at: number): void;
      correlationId(): string | undefined;
    },
    refusal?: { reason: string },
  ) {
    this.frame = frame;
    this.refusal = refusal;
    this.registry = registry;
    this.services = services;
    this.allowedTools = tools !== undefined ? new Set(tools) : undefined;
    this.events = events;
  }

  /** Returns how many tool calls failed or were refused. */
  failedCallCount(): number {
    return this._failedCallCount;
  }

  /**
   * The tools this run reached, in order. Feed to `supplyFromAgentRun`.
   *
   * A copy, not the live array: a caller that mutated it would be editing what
   * the run is allowed to have cited, after the fact.
   */
  toolTrace(): string[] {
    return [...this._trace];
  }

  /**
   * Record what the agent just did.
   *
   * `tool.call` for every invocation, so no action an agent takes is invisible. `mutation`
   * additionally for the tools that change a site — but only once the call actually reached the
   * tool: a call refused by scope enforcement changed nothing, and labelling it a mutation would
   * put a non-event in the one query someone runs after an unexpected change.
   *
   * A failed execution still emits `mutation ok=false`: "it tried to update the plugin and
   * failed" is a different fact from "it never tried", and both matter when reconstructing a run.
   *
   * Never throws. `EventLog.write` is already fault-isolated; the guard here covers the field
   * derivation, which touches caller-supplied argument values.
   */
  private emitToolEvents(
    name: string,
    args: Record<string, unknown>,
    durationMs: number,
    ok: boolean,
    reachedTool: boolean,
    error?: string,
  ): void {
    const ctx = this.events;
    if (!ctx?.eventLog) return;
    try {
      const target = mutationTarget(args);
      const base = {
        level: ok ? ('INFO' as const) : ('WARN' as const),
        source: ctx.agentName,
        sourceKind: 'agent' as const,
        runId: ctx.runId,
      };
      ctx.eventLog.write({
        ...base,
        event: 'tool.call',
        fields: { tool: name, target, tier: getToolSafety(name).tier, dur: `${durationMs}ms`, ok },
        message: ok ? undefined : error,
      } as any);

      if (reachedTool && isMutatingTool(name)) {
        ctx.eventLog.write({
          ...base,
          event: 'mutation',
          fields: { op: name, target, ok },
          message: ok ? undefined : error,
        } as any);
      }
    } catch { /* a logging fault must never fail the tool call that succeeded */ }
  }

  /** Register a sandbox site ID so wp_eval may target it. Agent calls this once after sandbox creation. */
  registerSandbox(siteId: string): void {
    this.sandboxSiteIds.add(siteId);
  }

  getProviderToolDefinitions(): ProviderToolDefinition[] {
    const all = this.registry.list(this.services);
    return all
      .filter(tool => !this.allowedTools || this.allowedTools.has(tool.name))
      // Tier 3 (destructive) tools are never offered to an agent's model. The hard gate is in
      // invoke() below; not advertising them keeps a prompt-injected model from being steered
      // toward a tool it cannot run anyway, and shrinks the attack surface of the tool list.
      .filter(tool => getToolSafety(tool.name).tier !== 3)
      .map(tool => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      }));
  }

  /**
   * Every agent tool call passes through here, so this is where the structured log learns what
   * an agent did. `invokeInner` holds the original logic untouched; wrapping it means the scope
   * refusals, the contributed-tool fallback and both error paths are all recorded from one
   * place rather than four.
   */
  async invoke(name: string, args: Record<string, unknown>): Promise<unknown> {
    const started = Date.now();
    // Distinguishes "refused before it ran" from "ran and failed" — only the latter may be
    // called a mutation.
    const reached = { tool: false };
    try {
      const value = await this.invokeInner(name, args, reached);
      this.emitToolEvents(name, args, Date.now() - started, true, reached.tool);
      return value;
    } catch (err: unknown) {
      this._failedCallCount++;
      const message = err instanceof Error ? err.message : String(err);
      this.emitToolEvents(name, args, Date.now() - started, false, reached.tool, message);
      throw err;
    }
  }

  private async invokeInner(
    name: string,
    args: Record<string, unknown>,
    reached: { tool: boolean },
  ): Promise<unknown> {
    // Enforce tool scope: if allowedTools is defined, only those tools are permitted
    if (this.allowedTools && !this.allowedTools.has(name)) {
      throw new Error(`Tool "${name}" is not declared in this agent's tools list`);
    }

    // Refuse Tier 3 (destructive) tools outright for agent callers. The Tier-3 confirmation
    // token is returned inside the tool result, and an agent loop hands that result back to the
    // model, which can simply re-issue the call with the token itself -- no human ever sees it
    // (see checkTierThreeConfirmation in mcp/safety.ts). Passing requireConfirmation=true to the
    // registry only inserts a round-trip the model completes on its own; it is not a human gate.
    // For an agent there is no human to confirm, so the only real gate is to refuse here. This
    // closes the injection->production chain: destructive tools (wpe_delete_install,
    // local_wpe_push, local_delete_site, ...) cannot be driven by a prompt-injected model.
    if (getToolSafety(name).tier === 3) {
      throw new Error(
        `Tool "${name}" is destructive (Tier 3) and cannot be run by an agent. ` +
        `Tier 3 operations require human confirmation, which an autonomous agent cannot provide.`,
      );
    }

    // WP-59 · the refusal BINDS. R3, and the half `agentAssembly.ts` deferred.
    //
    // Tier is the boundary, and it is the same one `noteGatedAct` and the
    // durable audit write already use: Tier 1 is a read, and the refusal's own
    // words are "run read-only diagnostics only". So a bound run keeps every
    // read it had and loses every act — which is the behaviour the bundle
    // describes, enforced rather than requested.
    //
    // AFTER the Tier-3 gate, deliberately. Tier 3 is refused for an agent
    // permanently and for a different reason; leading with this message would
    // tell a user that restoring the policy set makes `wpe_delete_install`
    // work, which is false.
    //
    // The refusal makes the run REAL. A run that was stopped from acting is
    // not a quiet run, and `close()`'s laziness would otherwise leave the whole
    // episode unrecorded — the manifest carrying `fail_closed: true` drains on
    // this flush, so "why was it bound" is on the ledger and not only in the
    // log. `correlationId()` is the frame's own flush-and-name call; the id it
    // returns goes into the message so the agent's report, the event log's
    // `run=` lines and the ledger's correlation all name the same episode.
    if (this.refusal && getToolSafety(name).tier >= 2) {
      let task: string | undefined;
      try { task = this.frame?.correlationId(); } catch { /* never throw into a tool call */ }
      throw new Error(
        `Tool "${name}" refused: this run's context was assembled fail-closed — ` +
        `${this.refusal.reason}. Take no action that changes any site, run read-only ` +
        `(Tier 1) diagnostics only, and report that operating policy could not be supplied` +
        `${task ? ` (task ${task})` : ''}.`,
      );
    }

    // Enforce sandbox site scope for the freeform/overwrite tools (wp_eval, wp_search_replace):
    // restrict them to registered sandbox sites so prompt-injected code cannot target unrelated
    // sites (T-INJECTION — chat gates these behind human approval; agents have no human, so the
    // gate is a hard sandbox scope). This must NOT be conditioned on `allowedTools`:
    // NexusToolProvider is only ever the agent path (constructed solely in buildAgentContext), and
    // an agent that declares no tools list is the MORE privileged caller (every tool allowed), so
    // it is exactly the one that must still be scoped. Shipped agents that use these declare a
    // tools list AND registerSandbox(), so they are unaffected.
    if (APPROVAL_REQUIRED_TOOLS.has(name)) {
      // No sandbox registered means no site is authorized at all -- this must refuse, not fall
      // through to "any site is fine" the way an empty sandboxSiteIds set used to.
      if (this.sandboxSiteIds.size === 0) {
        throw new Error(`${name} refused: no sandbox site registered for this agent`);
      }
      const targetSite = args.site as string | undefined;
      if (targetSite && !this.sandboxSiteIds.has(targetSite)) {
        throw new Error(`${name}: site "${targetSite}" is not in this agent's registered sandbox scope`);
      }
    }

    // Audit: agents bypass McpSafetyWrapper, so we log tool calls here instead.
    const startTime = Date.now();

    // Past every gate — from here on a failure means the tool ran and failed, not that it was
    // refused, which is what decides whether a `mutation` event is honest.
    reached.tool = true;

    // WP-57 · the measurable end of R2's arm-to-first-write, and one of the two
    // things that make a run REAL for the lazy frame.
    //
    // Tier 2 is the floor, matching `actionProducer`'s `GATED_TIER_FLOOR` and
    // the durable audit write: a Tier-1 read is not an act. A browsing agent
    // therefore never flushes a bracket, which is what keeps auth-probe's 720
    // clean runs a day out of an uncompactable substrate.
    //
    // Placed AFTER `reached.tool`, deliberately: a call refused by scope or by
    // the Tier-3 gate changed nothing, and making the run real on the strength
    // of a refusal would be the same dishonesty as logging it as a mutation.
    // WP-57 · the citable trace. EVERY reached call, not only gated ones: a
    // read is exactly what warrants a finding ("I saw this in the plugin
    // list"), so the citation universe is wider than the act record.
    this._trace.push(name);

    if (getToolSafety(name).tier >= 2) {
      try { this.frame?.noteGatedAct(Date.now()); } catch { /* never throw into a tool call */ }
    }

    // Call the registry with 'agent' as the access method and the run ID for audit trail joining.
    // requireConfirmation stays true as belt-and-suspenders: Tier 3 is already refused above for
    // agents, so no destructive call reaches here, but if a tool's tier ever changes this keeps
    // the registry-level gate armed rather than silently waived.
    const result = await this.registry.call(
      name, args, this.services, 'agent', true, this.events?.runId,
      // WP-57 · the run's task, so every gated act joins the run that made it.
      // Absent when unframed — the pre-WP-57 shape, byte-identical.
      this.frame ? { id: this.frame.id, actor: this.frame.actor } : undefined,
    );

    // Audit log the invocation (mirrors McpSafetyWrapper.auditLog for the agent path)
    const duration_ms = Date.now() - startTime;
    if (result.isError) {
      // Built-in registry didn't find the tool — try contributed tool routing.
      // Agents can call contributed tools from other agents (e.g. get_log_aggregates from
      // log-processor) by declaring them in their tools[] list. The dispatcher builds a
      // full agent context for the contributing agent and executes the handler.
      const contributed = this.services.contributedRegistry?.list().find(t => t.toolName === name);
      if (contributed && this.services.dispatcher) {
        // §D.7 · the caller is THIS run's agent, taken from the frame's actor
        // (kind-gated, then inverted) — the same derivation ToolRegistry uses,
        // so one identity reaches the gate by one route. Unframed means
        // unattributable, which holds nothing: honest, and fail closed.
        // The frame also goes through now, so a dispatched act joins the run
        // that caused it instead of arriving detached.
        const callerAgent = this.frame?.actor?.kind === 'agent'
          ? agentNameFromActorId(this.frame.actor.id)
          : undefined;
        const dispatchResult = await this.services.dispatcher.dispatch(
          contributed.agentName, contributed.toolName, args,
          this.frame ? { id: this.frame.id } : undefined,
          callerAgent,
        );
        const dispatchDuration = Date.now() - startTime;
        if (dispatchResult.isError) {
          const errText = dispatchResult.content.find((c: any) => c.type === 'text')?.text ?? 'Dispatch error';
          this.services.auditLogger?.log({
            timestamp: new Date().toISOString(), toolName: `${contributed.agentName}/${name}`,
            tier: contributed.permissionTier as 1 | 2 | 3, params: args,
            confirmed: null, result: 'error', error: errText, duration_ms: dispatchDuration,
          });
          throw new Error(errText);
        }
        this.services.auditLogger?.log({
          timestamp: new Date().toISOString(), toolName: `${contributed.agentName}/${name}`,
          tier: contributed.permissionTier as 1 | 2 | 3, params: args,
          confirmed: null, result: 'success', error: undefined, duration_ms: dispatchDuration,
        });
        const dispatchText = dispatchResult.content.find((c: any) => c.type === 'text')?.text;
        if (!dispatchText) return undefined;
        try { return JSON.parse(dispatchText); } catch { return dispatchText; }
      }

      const errorText = result.content.find((c: any) => c.type === 'text')?.text ?? 'Tool error';
      this.services.auditLogger?.log({
        timestamp: new Date().toISOString(),
        toolName: name,
        tier: 1,
        params: args,
        confirmed: null,
        result: 'error',
        error: errorText,
        duration_ms,
      });
      throw new Error(errorText);
    }

    this.services.auditLogger?.log({
      timestamp: new Date().toISOString(),
      toolName: name,
      tier: 1,
      params: args,
      confirmed: null,
      result: 'success',
      error: undefined,
      duration_ms,
    });

    // Parse JSON content if possible, otherwise return raw text
    const textContent = result.content.find((c: any) => c.type === 'text')?.text;
    if (!textContent) return undefined;
    try {
      return JSON.parse(textContent);
    } catch {
      return textContent;
    }
  }
}
