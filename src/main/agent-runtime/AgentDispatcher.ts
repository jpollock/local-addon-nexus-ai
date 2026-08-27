import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import type { McpToolResult } from '../mcp/types';
import type { NexusServices } from '../mcp/types';
import type { ToolRegistry } from '../mcp/tool-registry';
import type { ContributedToolRegistry, RegisteredTool } from './ContributedToolRegistry';
import type { AgentDefinition } from '../agent-sdk/types';
import type { ResolvedAIProvider } from '../ai/getAIProvider';
import type { AgentStateStore } from './AgentStateStore';
import type { AgentDbManager } from './AgentDbManager';
import { buildAgentContext } from './buildAgentContext';
import { getAgentSetting } from '../ipc-handlers';
import type { EventLog } from '../logging/eventLog';
import { newRunId } from '../logging/runId';
import { recordGatedAction } from '../intelligence-host/actionProducer';
import { agentActorId } from '../intelligence-host/agentTaskFrame';
import { checkCheckpointSequence } from '../intelligence-host/sequenceGuard';

// Ban consecutive underscores so the __ MCP delimiter is unambiguous.
const VALID_AGENT_NAME = /^[a-z0-9](?:[a-z0-9]|_(?!_)|-)*[a-z0-9]$|^[a-z0-9]$/;

const DEFAULT_AGENTS_DIR = path.join(
  os.homedir(),
  'Library',
  'Application Support',
  'Local',
  'nexus-ai',
  'agents',
);

const HANDLER_TIMEOUT_MS = 300_000; // 5 minutes — long-running tools (sync_access_logs, fetch_log_window) need more than 30s

export class AgentDispatcher {
  private moduleCache = new Map<string, AgentDefinition>();

  constructor(
    private readonly contributedRegistry: ContributedToolRegistry,
    private readonly toolRegistry: ToolRegistry,
    private readonly services: NexusServices,
    private readonly agentsDir: string = DEFAULT_AGENTS_DIR,
    private resolvedProvider: ResolvedAIProvider,
    private readonly stateStore: AgentStateStore,
    private readonly dbManager?: AgentDbManager,
    private readonly eventLog?: EventLog,
  ) {}

  clearCache(agentName: string): void {
    this.moduleCache.delete(agentName);
  }

  /**
   * Same fix as AgentRunner.setProvider — this dispatcher's resolvedProvider was captured once
   * at construction (Local startup) and never touched again, so a contributed tool invoked
   * through here (e.g. security-sentinel's `scan`, the Tier-3-gated MCP tool) kept using
   * whatever API key existed at that moment, even after a key rotation. AgentRunner.run() (the
   * "Run Now" / scheduled path) already had this fixed; dispatch() did not.
   */
  setProvider(provider: ResolvedAIProvider): void {
    this.resolvedProvider = provider;
  }

  /**
   * @param task - optional task moment (WP-19). The caller's turn id becomes
   *   the ledger `correlation`; only ChatService has one, so an MCP client
   *   calling the same tool records the act with no correlation, honestly,
   *   rather than with an invented one.
   */
  async dispatch(
    agentName: string,
    toolName: string,
    args: unknown,
    task?: { id?: string; causation?: string },
    /**
     * §D.7 (ruled 2026-08-26, C): WHO initiated this call — an agent name,
     * `chat`, or `mcp-client`. `agentName` above is the tool's OWNER, never
     * the caller: `contributedRegistry.get(agentName, toolName)` requires the
     * pair to match, so the two coincide only when an agent calls its own
     * tool. Omitting it is UNATTRIBUTED, not "the contributor asked" — a
     * caller the platform cannot establish holds nothing, and crediting the
     * contributor is the escape this ruling closes.
     * Spec: docs/planning/2026-08-26-cross-agent-reach.md
     */
    caller?: string,
  ): Promise<McpToolResult> {
    // A disabled agent must not run via ANY path — checked before tool lookup so a
    // disabled agent never leaks which tools it has. This mirrors the guard already
    // in the AGENT_RUN_NOW IPC handler. Without this, an MCP tool call (e.g. from the
    // chat assistant) bypasses the cron/event 'enabled' checks entirely, since
    // contributed tools otherwise have no gate of their own.
    if (getAgentSetting(agentName, 'enabled') === false) {
      return {
        content: [{ type: 'text', text: `Agent "${agentName}" is disabled — enable it in Agent settings before calling its tools.` }],
        isError: true,
      };
    }

    const registered = this.contributedRegistry.get(agentName, toolName);
    if (!registered) {
      return {
        content: [{ type: 'text', text: `Tool ${agentName}/${toolName} not found` }],
        isError: true,
      };
    }

    // WP-20d · chokepoint TWO gets the same sequence gate as chokepoint one.
    // No shipped runbook claims a contributed tool today, so this refuses
    // nothing — and that is exactly why it is here: `McpServer`'s `tools/call`
    // routes `agent__*` names straight past `ToolRegistry.call`, so a guard
    // wired only there would be a guard with a documented bypass. The name is
    // the QUALIFIED one, matching what the audit and the ledger record, so a
    // runbook claiming a contributed tool must name it the same way.
    // Phase 2 (fixes-082526): the dispatcher is TOLD who is asking. It cannot
    // infer it — this comment used to claim it knew, while passing the tool's
    // owner, which is the §D.7 default nobody ruled (corrected 2026-08-26).
    // Both parties go to the gate; it requires one capability held by all.
    const parties = caller === agentName ? [agentName] : [caller, agentName];
    const sequence = checkCheckpointSequence(`${agentName}/${toolName}`, task?.id, parties);
    if (sequence) {
      try {
        this.services.operationAuditLog?.log({
          operation: `${agentName}/${toolName}`,
          // The compliance record's question is "who asked", and until this
          // packet a cross-agent act read as if the contributor did it
          // unprompted. Only when they differ: a same-agent call gains nothing
          // from repeating itself. (The LEDGER's `actor` is deliberately left
          // as the executor — executor-vs-initiator has ADR weight and is
          // unruled; see the spec's Scope section.)
          ...(caller && caller !== agentName ? { initiatedBy: caller } : {}),
          target: args && typeof args === 'object'
            ? String((args as Record<string, unknown>).site ?? 'unknown')
            : 'unknown',
          parameters: args && typeof args === 'object' ? (args as Record<string, unknown>) : {},
          outcome: 'failure',
          error: sequence.message,
        });
      } catch { /* never throw from an audit path */ }
      return { content: [{ type: 'text', text: sequence.message }], isError: true };
    }

    // Mint a run id so this dispatch is discoverable in the event log, and thread it through
    // buildAgentContext so transcripts work on this path (when the agent opts in). A contributed
    // tool that makes no model call still emits at least the tool.call line below, so
    // `grep run=<id>` always finds something.
    const runId = newRunId('agent');

    const start = Date.now();
    let outcome: 'ok' | 'error' = 'ok';

    const result =
      registered.executionMode === 'run'
        ? await this.dispatchRun(registered, args, runId)
        : await this.dispatchFunction(registered, args, runId);

    if (result.isError) outcome = 'error';

    const durationMs = Date.now() - start;

    // Write the tool.call event so the run id is discoverable. Matches the shape
    // NexusToolProvider.logToolCall uses — same word, same fields — so both agent-internal calls
    // (via NexusToolProvider) and contributed-tool dispatches (here) produce identical lines.
    // Never throws: wrapping the whole block so an event-log fault cannot turn a successful
    // dispatch into an error result.
    try {
      if (this.eventLog) {
        const target = args && typeof args === 'object' && 'site' in args
          ? String((args as any).site)
          : undefined;
        this.eventLog.write({
          level: outcome === 'ok' ? 'INFO' : 'WARN',
          source: agentName,
          sourceKind: 'agent',
          runId,
          event: 'tool.call',
          fields: {
            tool: `${agentName}/${toolName}`,
            target,
            tier: registered.permissionTier,
            dur: `${durationMs}ms`,
            ok: outcome === 'ok',
          },
          message: outcome === 'error' ? (result.content?.[0]?.text || 'Unknown error') : undefined,
        } as any);
      }
    } catch { /* never throw from a logging path */ }

    // The whole audit block is wrapped: agent handlers are the least-trusted
    // code in the system (cyclic args, absent `content` arrays), and a throw
    // here would surface as a dispatch failure for a tool that already ran.
    try {
      this.services.auditLogger?.log({
        timestamp: new Date().toISOString(),
        toolName: `${agentName}/${toolName}`,
        tier: registered.permissionTier as 1 | 2 | 3,
        params: args && typeof args === 'object' ? (args as Record<string, unknown>) : {},
        confirmed: null,
        result: outcome === 'ok' ? 'success' : 'error',
        duration_ms: durationMs,
      });

      // Durable trail for agent-contributed tools. This path bypasses
      // McpSafetyWrapper entirely — it is the path the security-sentinel incident
      // used — so it needs its own write or agent tool calls stay unaudited.
      if (registered.permissionTier >= 2) {
        this.services.operationAuditLog?.log({
          operation: `${agentName}/${toolName}`,
          target: args && typeof args === 'object'
            ? String((args as Record<string, unknown>).site ?? 'unknown')
            : 'unknown',
          parameters: {
            ...(args && typeof args === 'object' ? (args as Record<string, unknown>) : {}),
            _tier: registered.permissionTier,
            _durationMs: durationMs,
          },
          outcome: outcome === 'ok' ? 'success' : 'failure',
          error: outcome === 'error' ? (result.content?.[0]?.text || 'Unknown error') : undefined,
          runId,
        });
      }
    } catch { /* never throw from an audit path */ }

    // WP-19 · the same act, on the episodic spine.
    //
    // This is chokepoint TWO, and it is instrumented HERE rather than at its
    // callers for the reason CLAUDE.md gives for the audit write beside it:
    // contributed tools reach `ToolRegistry.call` never, and they have two
    // callers (ChatService's `agent__*` branch and McpServer's), so a producer
    // wired at one caller would leave the other silently unrecorded.
    //
    // `registered.permissionTier` is the tool's DECLARED tier — the same value
    // the durable audit above gates on — so both records cover exactly the
    // same population. The safety table cannot answer for these names.
    recordGatedAction({
      toolName: `${agentName}/${toolName}`,
      // WP-57 · the CONTRIBUTING agent — the one whose code ran. Without this
      // every contributed-tool act collapsed into `act_agent_runtime`, and
      // this chokepoint reaches neither ToolRegistry.call nor its audit write,
      // so nothing else could supply it.
      //
      // `taskId` below is PASSED THROUGH and never minted here: ruling request
      // 2 (is a dispatch its own run?) is unruled, and minting would answer it
      // by accident.
      actor: { id: agentActorId(agentName), kind: 'agent' },
      args: args && typeof args === 'object' ? (args as Record<string, unknown>) : {},
      services: this.services,
      accessMethod: 'agent',
      dispatch: 'contributed',
      tier: registered.permissionTier,
      taskId: task?.id,
      causation: task?.causation,
      outcome: outcome === 'ok' ? 'success' : 'failure',
      error: outcome === 'error' ? (result.content?.[0]?.text || 'Unknown error') : undefined,
      durationMs,
    });

    return result;
  }

  private loadModule(agentName: string): AgentDefinition {
    if (this.moduleCache.has(agentName)) return this.moduleCache.get(agentName)!;
    if (!VALID_AGENT_NAME.test(agentName)) {
      throw new Error(`Invalid agent name: '${agentName}'`);
    }
    // Prefer compiled .js; fall back to .ts via the ts-node registration
    // that AgentRegistry already wired (Module._resolveFilename patch + ts-node register)
    const jsPath = path.join(this.agentsDir, agentName, 'agent.js');
    const tsPath = path.join(this.agentsDir, agentName, 'agent.ts');
    const agentPath = fs.existsSync(jsPath) ? jsPath : tsPath;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(agentPath) as { default?: AgentDefinition } | AgentDefinition;
    const def = (mod as { default?: AgentDefinition }).default ?? (mod as AgentDefinition);
    this.moduleCache.set(agentName, def);
    return def;
  }

  private async dispatchFunction(registered: RegisteredTool, args: unknown, runId: string): Promise<McpToolResult> {
    try {
      const def = this.loadModule(registered.agentName);
      const handler = def.contributes?.tools?.[registered.toolName]?.handler;
      if (!handler) {
        return {
          content: [{ type: 'text', text: `Handler for ${registered.toolName} not found` }],
          isError: true,
        };
      }
      const { ctx } = buildAgentContext({
        agent: def,
        toolRegistry: this.toolRegistry,
        services: this.services,
        stateStore: this.stateStore,
        resolvedProvider: this.resolvedProvider,
        logDir: path.join(
          os.homedir(),
          'Library',
          'Application Support',
          'Local',
          'nexus-ai',
          'agents',
          registered.agentName,
          'logs',
        ),
        dbManager: this.dbManager,
        eventLog: this.eventLog,
        runId,
      });
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(
          () => reject(new Error('Agent tool handler timed out')),
          HANDLER_TIMEOUT_MS,
        );
      });
      // `finally`, not the resolve path: a handler that throws used to skip the
      // clear and leave the 5-minute timer armed after dispatch had already
      // returned.
      try {
        const result = await Promise.race([handler(args, ctx), timeoutPromise]);
        return { content: result.content, isError: result.isError };
      } finally {
        clearTimeout(timeoutHandle);
      }
    } catch (err: any) {
      return {
        content: [{ type: 'text', text: `Error: ${err?.message ?? String(err)}` }],
        isError: true,
      };
    }
  }

  private async dispatchRun(registered: RegisteredTool, args: unknown, runId: string): Promise<McpToolResult> {
    try {
      const def = this.loadModule(registered.agentName);
      const { ctx } = buildAgentContext({
        agent: def,
        event: {
          namespace: 'nexus',
          type: 'tool-call',
          key: 'nexus:tool-call',
          payload: args && typeof args === 'object' ? (args as Record<string, unknown>) : {},
          createdAt: Date.now(),
        },
        toolRegistry: this.toolRegistry,
        services: this.services,
        stateStore: this.stateStore,
        resolvedProvider: this.resolvedProvider,
        logDir: path.join(
          os.homedir(),
          'Library',
          'Application Support',
          'Local',
          'nexus-ai',
          'agents',
          registered.agentName,
          'logs',
        ),
        dbManager: this.dbManager,
        eventLog: this.eventLog,
        runId,
      });
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(
          () => reject(new Error(`Agent run() timed out after ${HANDLER_TIMEOUT_MS}ms`)),
          HANDLER_TIMEOUT_MS,
        );
      });
      // Same `finally` as dispatchFunction — a throwing run() left the timer armed.
      try {
        const runResult = await Promise.race([def.run(ctx), timeoutPromise]);
        const text = runResult?.findings ? JSON.stringify(runResult) : 'Run complete';
        return { content: [{ type: 'text', text }] };
      } finally {
        clearTimeout(timeoutHandle);
      }
    } catch (err: any) {
      return {
        content: [{ type: 'text', text: `Run error: ${err?.message ?? String(err)}` }],
        isError: true,
      };
    }
  }
}
