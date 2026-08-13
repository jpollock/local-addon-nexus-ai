import type { ToolRegistry } from '../mcp/tool-registry';
import type { NexusServices } from '../mcp/types';
import type { ToolProvider } from '../agent-sdk/types';
import type { ProviderToolDefinition } from '../chat/providers/types';
import type { EventLog } from '../logging/eventLog';
import { getToolSafety, APPROVAL_REQUIRED_TOOLS } from '../mcp/safety';
import { isMutatingTool, mutationTarget } from './toolEvents';

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

  constructor(
    registry: ToolRegistry,
    services: NexusServices,
    tools: string[] | undefined,
    events?: ToolEventContext,
  ) {
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

    // Call the registry with 'agent' as the access method and the run ID for audit trail joining.
    // requireConfirmation stays true as belt-and-suspenders: Tier 3 is already refused above for
    // agents, so no destructive call reaches here, but if a tool's tier ever changes this keeps
    // the registry-level gate armed rather than silently waived.
    const result = await this.registry.call(name, args, this.services, 'agent', true, this.events?.runId);

    // Audit log the invocation (mirrors McpSafetyWrapper.auditLog for the agent path)
    const duration_ms = Date.now() - startTime;
    if (result.isError) {
      // Built-in registry didn't find the tool — try contributed tool routing.
      // Agents can call contributed tools from other agents (e.g. get_log_aggregates from
      // log-processor) by declaring them in their tools[] list. The dispatcher builds a
      // full agent context for the contributing agent and executes the handler.
      const contributed = this.services.contributedRegistry?.list().find(t => t.toolName === name);
      if (contributed && this.services.dispatcher) {
        const dispatchResult = await this.services.dispatcher.dispatch(
          contributed.agentName, contributed.toolName, args,
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
