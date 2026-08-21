/**
 * WP-57 · An agent run is a task moment.
 *
 * `task.run.assigned` and `task.run.completed` have been in the ratified §4.2
 * taxonomy since the layer was designed and, until WP-51, had never had a
 * producer. This is the general one.
 *
 * WHY THE FRAME AND NOT THE PRODUCERS. Measured on the owner's ledger at this
 * packet's announce: `act_agent_runtime` held 58 events and **58 of 58 carried
 * no correlation**, while `act_chat_agent` carried 16 of 20. Both halves of
 * that asymmetry are properties of the RUN — which agent this is, and which
 * thread its acts belong to — and neither a tool call nor a fold can know
 * them. Only the thing that brackets the run does.
 *
 * WHY IT SUBSUMES WP-51's SCAN ACT (ruled by the owner, 2026-08-21). WP-51
 * minted a TaskId for the sentinel scan inside `incidentProducer`, lazily, and
 * only when the scan had findings. A sentinel scan IS a sentinel run, so two
 * producers of one topic would have meant one topic with two meanings — the
 * `total`-shaped collision ruled at WP-48/50/52. The frame is now the sole
 * producer and the incident producer READS this id. That is strictly better
 * than what it replaced: a scan that finds nothing now carries a correlation,
 * where before it carried none.
 *
 * AUTONOMY COMES FROM THE TRIGGER, NOT FROM A SETTING. ADR-7's own
 * justification is "a human is present to judge" — a fact about why the run
 * started. The SDK's `AgentAutonomy` ('suggest' | 'ask' | 'auto') is a ceremony
 * preference and must never govern a safety rule; they are one word over two
 * meanings and this module resolves it by deriving rather than reading.
 *
 * NON-FATAL BY CONSTRUCTION, like everything on this seam. No core, a throwing
 * emitter, a throwing close — each degrades to "this run is unframed" and none
 * of them reaches the caller. `openAgentTask` returning `undefined` is the
 * honest form of that, and every caller treats the frame as optional.
 */
import { taskId as mintTaskId } from '../../intelligence';
import { getIntelligenceCore } from './coreRegistry';

/** Topics — architecture §4.2, ratified since the layer was designed. */
export const RUN_ASSIGNED_TOPIC = 'task.run.assigned';
export const RUN_COMPLETED_TOPIC = 'task.run.completed';

export const RUN_ASSIGNED_SCHEMA = 'run.assigned/1';
export const RUN_COMPLETED_SCHEMA = 'run.completed/1';

/** `source.system` — one value, so liveness is one row in the health table. */
export const AGENT_RUN_SYSTEM = 'agent-runtime:run';

/** Why the run started. The caller's own word — `AgentRunner` already has it. */
export type RunTrigger = 'manual' | 'cron' | 'event';

/** ADR-7's actor class. Never the SDK's ceremony preference. */
export type Autonomy = 'interactive' | 'autonomous';

/**
 * ADR-7's class, derived from the trigger.
 *
 * Exported standalone so a caller can ask the question without opening a
 * frame, and so the rule has one home rather than being re-expressed wherever
 * it is needed.
 */
export function autonomyForTrigger(trigger: RunTrigger): Autonomy {
  return trigger === 'manual' ? 'interactive' : 'autonomous';
}

/**
 * The actor id for one agent.
 *
 * The agent's own name, verbatim — agent names are already validated
 * (`VALID_AGENT_NAME`: lowercase, no consecutive underscores) and are the
 * identity every other surface uses for the same thing, so translating them
 * here would create a second name for one agent.
 */
export function agentActorId(agentName: string): string {
  return `act_agent_${agentName}`;
}

export interface AgentTaskFrame {
  /**
   * `task_<ULID>` — minted in memory at open, and NOT yet written anywhere.
   *
   * Read this only to pass into something that is about to make it real; to
   * obtain an id you may safely record as a `correlation`, call
   * `correlationId()`, which flushes first.
   */
  id: string;
  actor: { id: string; kind: 'agent' };
  autonomy: Autonomy;
  /**
   * The id, with its `task.run.assigned` guaranteed on the ledger — or
   * `undefined` if that could not be written.
   *
   * This is WP-51's `scanCorrelation()`, generalized from the sentinel to
   * every agent: **an id whose assignment was refused is not written
   * anywhere**, because it would satisfy the validator's regex and name
   * nothing. Call this immediately before recording anything that carries the
   * correlation, so the bracket precedes what it explains.
   */
  correlationId(): string | undefined;
  /**
   * Record that a gated act happened under this run, and flush the bracket.
   * The FIRST timestamp wins.
   *
   * An act is by definition something worth recording, so this is one of the
   * two things that make a run real. It is also the measurable end of R2's
   * arm-to-first-write: the arm does not exist until capability grants land,
   * so shipping the interval now would ship a permanently-null field. This is
   * the end observable today; the interval derives with no schema change once
   * the arm stamps the other.
   */
  noteGatedAct(at: number): void;
  /** Whether anything was actually written for this run. */
  didEmit(): boolean;
  /**
   * Close the run.
   *
   * Emits `task.run.completed` only when this run is REAL — it already
   * flushed, or its outcome is itself worth recording (a finding, or any
   * non-success status). A quiet successful run writes nothing at all.
   */
  close(outcome: {
    status: string;
    finishedAt: number;
    findings?: number;
    error?: string;
  }): void;
}

export function openAgentTask(opts: {
  agentName: string;
  trigger: RunTrigger;
  startedAt: number;
  /** The runtime's own log correlator, when the caller has one. */
  runId?: string;
}): AgentTaskFrame | undefined {
  try {
    const core = getIntelligenceCore();
    if (!core?.emitter) return undefined;

    const id = mintTaskId();
    const actor = { id: agentActorId(opts.agentName), kind: 'agent' as const };
    const autonomy = autonomyForTrigger(opts.trigger);
    let firstGatedActAt: number | undefined;
    let flushAttempted = false;
    let flushed = false;

    /**
     * Write `task.run.assigned`, once, the first time this run turns out to be
     * real. Returns whether the bracket is on the ledger.
     */
    const flush = (): boolean => {
      if (flushAttempted) return flushed;
      flushAttempted = true;
      try {
        core.emitter.emit({
          // The run's own start, carried in. Never the emitter's clock — and
          // note this is the START even though the write happens later: the
          // fact is when the run began, not when we noticed it mattered.
          observed_at: new Date(opts.startedAt).toISOString(),
          topic: RUN_ASSIGNED_TOPIC,
          schema: RUN_ASSIGNED_SCHEMA,
          // Deliberately empty, and it is `actionProducer`'s own rule: an
          // entity map naming ONE of several targets would misattribute the
          // run to that site. A run spans every site in its scope; the
          // per-site entity rides on the acts and findings, where it is true.
          entity: {},
          actor,
          // `emitted`, matching WP-51's scan act: this is a fact the runtime
          // reports about its own activity, not one observed in the estate.
          source: { class: 'work', system: AGENT_RUN_SYSTEM, trust: 'emitted' },
          correlation: id,
          payload: {
            agent: opts.agentName,
            trigger: opts.trigger,
            autonomy,
            // Absent rather than invented, the same conditional spread the
            // incident producer's `source` uses for the same reason.
            ...(opts.runId ? { run_id: opts.runId } : {}),
          },
        });
        flushed = true;
      } catch {
        flushed = false; // and the correlation falls away with it
      }
      return flushed;
    };

    return {
      id,
      actor,
      autonomy,
      correlationId(): string | undefined {
        return flush() ? id : undefined;
      },
      didEmit(): boolean {
        return flushed;
      },
      noteGatedAct(at: number): void {
        if (firstGatedActAt === undefined) firstGatedActAt = at;
        // An act is worth recording, so the bracket becomes real here — and
        // BEFORE the act's own record, which is WP-51's ordering rule.
        flush();
      },
      close(outcome): void {
        try {
          // LAZINESS, and it is WP-51's rule rather than an optimisation.
          // `auth-probe` fires every two minutes (measured 2026-08-21), so a
          // frame emitted unconditionally would write 1,440 events a day
          // forever from one diagnostic agent — an 84% increase in this
          // ledger's total write rate, into a substrate §4.4 never deletes.
          // A quiet, successful run that touched nothing is not an act worth
          // recording, and nothing needs a correlation to point at.
          const worthRecording =
            flushed ||
            outcome.status !== 'success' ||
            (outcome.findings !== undefined && outcome.findings > 0);
          if (!worthRecording) return;
          // The bracket must precede what it explains, even when the outcome
          // is what made the run real.
          if (!flush()) return;
          core.emitter.emit({
            // The run's own finish, carried in from the result. Never "now":
            // a bracket stamped at fold time is the data laundering the
            // layer's `observed_at` invariant exists to forbid.
            observed_at: new Date(outcome.finishedAt).toISOString(),
            topic: RUN_COMPLETED_TOPIC,
            schema: RUN_COMPLETED_SCHEMA,
            entity: {},
            actor,
            source: { class: 'work', system: AGENT_RUN_SYSTEM, trust: 'emitted' },
            correlation: id,
            payload: {
              agent: opts.agentName,
              trigger: opts.trigger,
              autonomy,
              status: outcome.status,
              duration_ms: outcome.finishedAt - opts.startedAt,
              // `0` is a measurement and survives; only `undefined` is omitted.
              ...(outcome.findings !== undefined ? { findings: outcome.findings } : {}),
              ...(outcome.error ? { error: outcome.error } : {}),
              ...(firstGatedActAt !== undefined
                ? { first_gated_act_at: new Date(firstGatedActAt).toISOString() }
                : {}),
            },
          });
        } catch {
          /* a frame fault costs the record, never the run */
        }
      },
    };
  } catch {
    return undefined;
  }
}
