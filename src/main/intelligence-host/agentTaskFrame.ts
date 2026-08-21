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
  /** `task_<ULID>` — the ledger correlator. Distinct from the log's runId. */
  id: string;
  actor: { id: string; kind: 'agent' };
  autonomy: Autonomy;
  /**
   * Record that a gated act happened under this run. The FIRST wins.
   *
   * This is the measurable end of R2's arm-to-first-write. The arm does not
   * exist until capability grants land, so shipping the interval now would
   * ship a permanently-null field; this is the end the platform can observe
   * today, and the interval derives with no schema change once the arm stamps
   * the other.
   */
  noteGatedAct(at: number): void;
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

    core.emitter.emit({
      // The run's own start, carried in. Never the emitter's clock.
      observed_at: new Date(opts.startedAt).toISOString(),
      topic: RUN_ASSIGNED_TOPIC,
      schema: RUN_ASSIGNED_SCHEMA,
      // Deliberately empty, and it is `actionProducer`'s own rule: an entity
      // map naming ONE of several targets would misattribute the run to that
      // site. A run spans every site in its scope; the per-site entity rides
      // on the acts and findings, where it is true.
      entity: {},
      actor,
      // `emitted`, matching WP-51's scan act: this is a fact the runtime
      // reports about its own activity, not one it observed in the estate.
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

    return {
      id,
      actor,
      autonomy,
      noteGatedAct(at: number): void {
        if (firstGatedActAt === undefined) firstGatedActAt = at;
      },
      close(outcome): void {
        try {
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
