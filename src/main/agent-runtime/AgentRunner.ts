import * as os from 'os';
import * as path from 'path';
import { createLogger } from '../logging/Logger';
import type { AgentDefinition, NexusEvent, AgentResult, AgentContext, Finding } from '../agent-sdk/types';
import type { AgentStateStore } from './AgentStateStore';
import type { ResolvedAIProvider } from '../ai/getAIProvider';
import type { ToolRegistry } from '../mcp/tool-registry';
import type { NexusServices } from '../mcp/types';
import type { AgentDbManager } from './AgentDbManager';
import { buildAgentContext } from './buildAgentContext';
import { newRunId } from '../logging/runId';
import { EventLog } from '../logging/eventLog';
import { openAgentTask } from '../intelligence-host/agentTaskFrame';
import { assembleForAgentRun } from '../intelligence-host/agentAssembly';

const logger = createLogger('AgentRunner');
const DEFAULT_TIMEOUT_MS = 300_000;

class TimeoutError extends Error {
  constructor() {
    super('Agent timeout');
    this.name = 'TimeoutError';
  }
}

export class AgentRunner {
  private stateStore: AgentStateStore;
  private toolRegistry: ToolRegistry;
  private services: NexusServices;
  private resolvedProvider: ResolvedAIProvider;
  private dbManager?: AgentDbManager;

  constructor(
    stateStore: AgentStateStore,
    toolRegistry: ToolRegistry,
    services: NexusServices,
    resolvedProvider: ResolvedAIProvider,
    dbManager?: AgentDbManager,
    private readonly eventLog?: EventLog,
  ) {
    this.stateStore = stateStore;
    this.toolRegistry = toolRegistry;
    this.services = services;
    this.resolvedProvider = resolvedProvider;
    this.dbManager = dbManager;
  }

  /**
   * Update the AI provider used for subsequent agent runs.
   * Called from onSettingsUpdated so agents pick up provider/key changes
   * without requiring a Local restart.
   */
  setProvider(provider: ResolvedAIProvider): void {
    this.resolvedProvider = provider;
  }

  async run(
    agent: AgentDefinition,
    event?: NexusEvent,
    options?: { fullRun?: boolean; logFileName?: string; trigger?: 'manual' | 'cron' | 'event' },
  ): Promise<AgentResult> {
    const startedAt = Date.now();
    const timeoutMs = agent.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const agentName = agent.name;

    const runId = newRunId('agent');
    // The caller's explicit `trigger` always wins. Inference from event/logFileName is only a
    // fallback for the (shrinking) set of callers that don't state it yet — AGENT_RUN_NOW passes
    // BOTH a scoped `event` (to target one site) and a `logFileName`, so inferring from either
    // one alone mislabels an ad-hoc "Run Now" as `event` or leaves `manual` unreachable. Only the
    // caller genuinely knows why it's running.
    const trigger = options?.trigger ?? (event ? 'event' : options?.logFileName ? 'manual' : 'cron');

    this.eventLog?.write({
      level: 'INFO', source: agentName, sourceKind: 'agent', runId,
      event: 'run.start', fields: { trigger, fullRun: options?.fullRun ?? false },
    });

    // WP-57 · the run's frame on the ledger, opened beside the log's own
    // bracket and for the same reason: a run that cannot be found is a run
    // nobody can answer questions about. `trigger` is the caller's stated one,
    // already resolved above — the frame derives ADR-7's autonomy class from
    // it rather than reading the SDK's ceremony setting.
    //
    // Optional by construction: `openAgentTask` returns undefined when the
    // intelligence core is absent, and every use below is guarded.
    const frame = openAgentTask({ agentName, trigger, startedAt, runId });

    let status: AgentResult['status'] = 'success';
    let error: string | undefined;
    let ctx: AgentContext | undefined;
    let accFindings: Finding[] = [];
    let accSites: Record<string, { status: string; findings: Finding[] }> = {};
    let agentReturnValue: unknown;
    let toolProvider: import('./NexusToolProvider').NexusToolProvider | undefined;

    // buildAgentContext is inside this try (not before it, as before) so that a context-
    // construction failure still produces a run.end and a recordRun row instead of rejecting
    // run() outright — an unclosed run.start bracket is exactly the "why did this agent not
    // finish?" case this whole mechanism exists to answer.
    try {
      // WP-59 · assemble this run's context, as the agent itself.
      //
      // `assemble()` had exactly one caller before this — the docked-panel
      // chat — so every agent ran with nothing the layer knew. Gated on the
      // frame because the frame is where the actor id, the task id and ADR-7's
      // autonomy class come from; without a core there is neither, and
      // assembling with a fabricated actor would be worse than not assembling.
      //
      // The site is the triggering event's, which is the only target the
      // RUNNER knows: an agent's own `scope.siteIds` is read per tool call by
      // the agent, not here. A cron run therefore assembles about no
      // particular site, and that is the honest answer rather than a gap.
      //
      // Awaited, and that is a real cost admitted rather than hidden: the run
      // does not start until assembly returns. It is reads only, it never
      // throws (a fault yields `undefined`), and it is the same work the chat
      // surface already does on every single turn.
      const contextBundle = frame
        ? await assembleForAgentRun({
            agent,
            frame,
            trigger,
            siteId: event?.siteId,
            services: this.services,
          })
        : undefined;

      const built = buildAgentContext({
        agent,
        event,
        toolRegistry: this.toolRegistry,
        services: this.services,
        stateStore: this.stateStore,
        resolvedProvider: this.resolvedProvider,
        logDir: path.join(os.homedir(), 'Library', 'Application Support', 'Local', 'nexus-ai', 'agents', agentName, 'logs'),
        dbManager: this.dbManager,
        fullRun: options?.fullRun ?? false,
        logFileName: options?.logFileName,
        eventLog: this.eventLog,
        runId,
        // WP-57 · so the tool provider can thread the task and note gated acts,
        // and so `ctx.task` exists for the agent itself.
        ...(frame ? { frame } : {}),
        // WP-59 · offered to the agent, consumed by none of them yet — this
        // packet is additive by design; see `AgentContext.contextBundle`.
        ...(contextBundle ? { contextBundle } : {}),
      });
      ctx = built.ctx;
      accFindings = built.accFindings;
      accSites = built.accSites;
      toolProvider = built.toolProvider;

      let timeoutHandle: NodeJS.Timeout | undefined;
      try {
        await Promise.race([
          agent.run(ctx).then((rv) => { agentReturnValue = rv; }),
          new Promise<never>((_, reject) => {
            timeoutHandle = setTimeout(() => reject(new TimeoutError()), timeoutMs);
          }),
        ]);
      } finally {
        if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
      }
    } catch (err: unknown) {
      if (err instanceof TimeoutError) {
        status = 'timeout';
        error = `Agent "${agent.name}" timed out after ${timeoutMs}ms`;
        logger.warn(error);
        // ctx only exists if buildAgentContext succeeded — a context-construction failure has
        // no ctx to hand onError, so it is skipped for that case (there was never a run to react to).
        if (agent.onError && ctx) {
          try { await agent.onError(err, ctx); } catch { /* onError must not throw */ }
        }
      } else if (err instanceof Error) {
        status = 'error';
        error = err.message;
        logger.error(`Agent "${agent.name}" failed: ${error}`);
        if (agent.onError && ctx) {
          try { await agent.onError(err, ctx); } catch { /* onError must not throw */ }
        }
      } else {
        status = 'error';
        error = String(err);
        logger.error(`Agent "${agent.name}" failed: ${error}`);
      }
    }

    const result: AgentResult = { agentName: agent.name, startedAt, finishedAt: Date.now(), status, error, runId };

    // Merge structured log events accumulated during the run
    if (accFindings.length > 0) result.findings = accFindings;
    if (Object.keys(accSites).length > 0) {
      result.sites = Object.fromEntries(
        Object.entries(accSites).map(([k, v]) => [k, { ...v, findings: accFindings.filter(f => f.site === k) }]),
      );
    }

    // If the agent returned a typed AgentResult, its domain fields take precedence
    if (agentReturnValue && typeof agentReturnValue === 'object') {
      const rv = agentReturnValue as AgentResult;
      if (rv.verdict)  result.verdict  = rv.verdict;
      if (rv.findings) result.findings = rv.findings;
      if (rv.plan)     result.plan     = rv.plan;
      if (rv.sites)    result.sites    = rv.sites;
      if (rv.summary)  result.summary  = rv.summary;
    }

    // Attach per-run log file path and write report file if summary exists
    if (options?.logFileName) {
      const logsDir = path.join(
        os.homedir(), 'Library', 'Application Support', 'Local', 'nexus-ai',
        'agents', agentName, 'logs',
      );
      result.logFile = path.join(logsDir, options.logFileName);

      if (result.summary) {
        const reportFileName = options.logFileName.replace(/\.log$/, '-report.md');
        const reportFilePath = path.join(logsDir, reportFileName);
        try {
          const fs = await import('fs');
          fs.writeFileSync(reportFilePath, result.summary, 'utf-8');
          result.reportFile = reportFilePath;
        } catch { /* non-fatal — report still accessible via DB summary */ }
      }
    }

    const failedCalls = toolProvider?.failedCallCount() ?? 0;
    this.eventLog?.write({
      level: status === 'success' ? 'INFO' : 'ERROR',
      source: agentName, sourceKind: 'agent', runId,
      event: 'run.end',
      fields: {
        status,
        dur: `${result.finishedAt - result.startedAt}ms`,
        findings: result.findings?.length ?? 0,
        ...(failedCalls > 0 && { failedCalls }),
      },
      message: error,
    });

    this.stateStore.recordRun(result);

    // Record to inbox and check auto-pause. Wrapped so an inbox fault never fails a run.
    try {
      const inboxStore = this.services?.inboxStore;
      // `this.stateStore` is the constructor-guaranteed handle — the same instance
      // as services.agentStateStore, but not optional. Reading it through the
      // optional service field would silently no-op the pause check if that field
      // were ever left unassigned, which is the declared-but-never-assigned failure
      // that once made audit logging write nothing on any machine.
      const agentStateStore = this.stateStore;

      if (inboxStore) {
        const { recordRunToInbox } = await import('../inbox/recordRun');
        // agent.name is both the inbox source key and the DB key in agent_runs.
        recordRunToInbox(inboxStore, {
          agentId: agent.name,
          status: result.status,
          error: result.error,
          sites: result.sites,
          findings: result.findings,
          // No findingsSites — AgentResult does not carry it, and sites is present.
        });
      }

      if (agentStateStore && agent.name) {
        const { pauseIfStuck } = await import('../inbox/autoPause');
        const paused = pauseIfStuck(
          agentStateStore,
          agent.name,  // Both marker write and history read use agent.name
          agentStateStore.getRunHistory(agent.name, 10),
        );
        if (paused) {
          logger.warn(`auto-paused ${agent.name} after repeated identical failures`);
        }
      }
    } catch (inboxErr: any) {
      logger.error(`inbox write failed for ${agent.name}:`, inboxErr?.message);
    }

    // WP-25 · the incident producer's sentinel tap, at the run-completion
    // chokepoint. Its OWN try block, not the inbox one: an inbox fault must not
    // also cost the ledger record, and vice versa. The producer reads this
    // result and nothing else — no sentinel behaviour is touched — and it
    // decides for itself whether this agent's findings are incidents.
    try {
      const { recordSentinelIncidents } = await import('../intelligence-host/incidentProducer');
      recordSentinelIncidents(
        {
          agentId: agent.name,
          runId: result.runId,
          // The scan's own completion time, carried from the result. The
          // producer must never stamp "now": `observed_at` is when the fact was
          // true at its source.
          observedAt: result.finishedAt,
          sites: result.sites,
          // WP-57 · the run's correlation, as a FUNCTION. Calling it is what
          // writes `task.run.assigned`, so the producer flushes the bracket
          // itself, immediately before the first incident it records — which
          // is exactly when WP-51's own `scanCorrelation` used to mint one.
          correlationId: frame ? () => frame.correlationId() : undefined,
        },
        { services: this.services },
      );
    } catch (incidentErr: any) {
      logger.error(`incident record failed for ${agent.name}:`, incidentErr?.message);
    }

    // WP-54a · the agent-failure producer's tap, at the same chokepoint and in
    // its OWN try block for the same reason: a fault in one record must not
    // cost another, and neither may cost the run.
    //
    // `timeoutMs` IS PASSED FROM THIS FUNCTION'S OWN LOCAL, deliberately. It is
    // already interpolated into `error` above, and the inbox stores it there as
    // prose — `detail: 'Agent "auth-probe" timed out after 300000ms'`. Parsing
    // a number back out of a sentence the same function composed would make the
    // record a derivation of its own output; the field is the measurement and
    // this is the one place that holds it.
    //
    // The success path is not a no-op: it is what CLOSES an open failure, so
    // a stuck agent that starts working again stops asking.
    try {
      const { recordAgentRunOutcome } = await import('../intelligence-host/agentFailureProducer');
      recordAgentRunOutcome({
        agentId: agent.name,
        status: result.status,
        // Only meaningful on a timeout, and the producer writes it only there.
        timeoutMs,
        error: result.error,
        runId: result.runId,
        // The run's own moment. The producer must never stamp "now".
        finishedAt: result.finishedAt,
      });
    } catch (failureErr: any) {
      logger.error(`agent failure record failed for ${agent.name}:`, failureErr?.message);
    }

    // WP-57 · close the frame AFTER the producer taps, and the ordering is a
    // consequence of the frame being lazy rather than a preference.
    //
    // `task.run.assigned` is flushed by whoever first needs the correlation —
    // usually the incident producer, immediately before the record it writes —
    // so the bracket already OPENS before what it explains, which is WP-51's
    // rule. `completed` must therefore close after those records exist, or a
    // clean scan that closes a prior incident would flush `assigned` here with
    // no `completed` ever written: a half-bracket, which is worse than none.
    //
    // Its OWN try, matching the two taps above: a fault in one record must not
    // cost another, and none of them may cost the run.
    try {
      frame?.close({
        status,
        finishedAt: result.finishedAt,
        findings: result.findings?.length,
        error,
      });
    } catch (frameErr: any) {
      logger.error(`run frame close failed for ${agent.name}:`, frameErr?.message);
    }

    // Surface the task id ONLY if the frame actually wrote. The frame is lazy:
    // a quiet successful run emits nothing, and recording its id in
    // `agent_runs` would store a correlation that names no events.
    // WP-57 · the frame is lazy, so `didEmit()` is not final until `close()`
    // above — which is AFTER `recordRun` persisted the row. Attach the join
    // now that it is knowable. Setting it on `result` alone left every stored
    // row NULL: found by querying the database after a live run, and pinned by
    // `AgentRunner.taskframe.test.ts`'s stored-row assertions.
    if (frame?.didEmit()) {
      result.taskId = frame.id;
      if (runId) {
        try { this.stateStore.attachTaskId(runId, frame.id); }
        catch (attachErr: any) { logger.error(`task id attach failed for ${agent.name}:`, attachErr?.message); }
      }
    }

    return result;
  }
}
