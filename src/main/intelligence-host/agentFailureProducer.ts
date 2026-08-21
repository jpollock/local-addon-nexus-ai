/**
 * WP-54a · The agent-failure producer — `agent.stuck` stops being a class the
 * fold cannot emit.
 *
 * THE GAP THIS CLOSES, measured before it was written (2026-08-21):
 *
 *   - `agent.stuck` is a RATIFIED template class
 *     (`from-designer/fixtures/situation-headlines.js`), carried verbatim into
 *     `situationCopy.generated.ts`, with a working selector arm in
 *     `guardHolds`. WP-52's own pin calls it "unreachable" and pinned it
 *     anyway. Nothing constructs `kind: 'agentFailure'`, so no row on any
 *     screen can report it.
 *   - auth-probe reaches the Now screen today ONLY through the old inbox
 *     rendering. When WP-54's dedup lands, it disappears from Now entirely
 *     unless the fold learns to emit it. That is why this packet must merge
 *     before or with the dedup.
 *
 * **THERE IS NO `agent.run.failed` TOPIC, AND THERE CANNOT BE ONE.** The
 * envelope's topic regex (`src/intelligence/envelope/validate.ts`) admits only
 * `state|semantic|procedure|policy|episodic|task|control` as the type prefix,
 * so an `agent.*` topic is refused at the ledger boundary. `agent.stuck` is a
 * template id, never a topic. An agent run ending badly is an EPISODIC
 * occurrence — a thing that happened, at a time, that the record should
 * remember — which is the family `episodic.incident.recorded` already belongs
 * to, and this topic sits beside it rather than inside it: the designer's own
 * note is that this is "the one class where the subject is the platform rather
 * than the fleet", and folding a platform failure into the fleet's incident
 * stream would put it in front of `situationOfIncident` and the assembler's
 * `episodicSummary` as though a site were broken.
 *
 * **THE TIMEOUT WAS A PRODUCER DEBT, AND THIS PAYS IT AT THE PRODUCER.**
 * Measured on the live `graph.db`: the failure exists in `inbox_items` as
 * `detail: 'Agent "auth-probe" timed out after 300000ms'` with
 * `payload: {"status":"timeout"}` — the agent id is structured, the timeout is
 * free text inside an error message, and nothing structured carries it.
 * `AgentRunner.run` computes `timeoutMs = agent.timeoutMs ?? DEFAULT_TIMEOUT_MS`
 * and interpolates it into that string, so the number is known at the moment of
 * failure and thrown away. It is taken here as an argument from the chokepoint
 * where it is already in scope, and written as a FIELD — never parsed back out
 * of the message, which would be composing the record from its own prose.
 *
 * FIVE RULES, transcribed from `incidentProducer`'s because they are the same
 * five and a second, divergent set would be the drift they exist to prevent:
 *
 *  1. **NEVER FABRICATE A TIME.** `observed_at` is the run's own finish time,
 *     carried in from `AgentResult.finishedAt`. A run with no usable finish
 *     time emits NOTHING rather than being stamped "now".
 *  2. **NEVER INVENT THE TIMEOUT.** Absent when the caller did not supply one.
 *     `DEFAULT_TIMEOUT_MS` is a runtime constant, not an observation, and
 *     writing it here would earn a measured field's credit for a guessed value
 *     on the one field the ratified ask reads aloud.
 *  3. **RESOLUTION IS OBSERVED, NEVER ASSUMED, AND ALWAYS SUPERSEDES.** A later
 *     SUCCESSFUL run of the same agent emits a NEW event carrying
 *     `resolved: true` and `resolved_at`, with `causation` pointing at the
 *     event it closes. Nothing is mutated; the ledger is append-only.
 *  4. **DEDUP IS DURABLE, AND IT IS A LEDGER READ.** The change gate
 *     (`changeGate.ts`) is deliberately NOT used, for the reason WP-14, WP-19
 *     and WP-25 all recorded: it compares against `twin_facts`, an episodic
 *     occurrence folds into no twin, and the gate would degrade to a
 *     process-lifetime cache — a producer that re-emits after every restart.
 *  5. **NON-FATAL BY CONSTRUCTION.** An agent run must never fail because its
 *     failure could not be recorded.
 *
 * OUT OF SCOPE, deliberately: no agent-runtime behaviour change (the tap reads
 * the result the runner already has), no inbox change (both records coexist
 * until the owner rules on the inbox's future), no renderer change.
 */
import type { EventEnvelope } from '../../intelligence';
import type { IntelligenceCore } from './bootstrap';
import { getIntelligenceCore } from './coreRegistry';

/**
 * The topic. `episodic` because this is an occurrence the record remembers;
 * `agent_run` because the subject is a RUN of an agent, not the agent itself.
 * Both segments satisfy the envelope's `[a-z0-9_]+` rule — see the header for
 * why `agent.run.failed` cannot exist.
 */
export const AGENT_FAILURE_TOPIC = 'episodic.agent_run.failed';
export const AGENT_FAILURE_SCHEMA = 'agent_run.failed/1';

/**
 * `source.system` — a CONSTANT, for the same reason the incident producer's
 * two are: `source.system` is what the health surface counts liveness by, one
 * row per system, and a value carrying an agent id would make that table grow
 * by one row per agent.
 */
export const AGENT_FAILURE_SYSTEM = 'agent:run';

/**
 * The actor is the RUNTIME, not the agent.
 *
 * The agent did not observe its own timeout — it was still running when the
 * race was lost. `AgentRunner` is what noticed, and an actor field that named
 * the agent would say the stuck thing reported itself. Which agent it was is a
 * payload fact, and the meta line reads it from there.
 */
const RUNTIME_ACTOR = { id: 'act_agent_runtime', kind: 'system' } as const;

/** Agent failures are rare; a generous bounded read costs nothing. */
const AGENT_FAILURE_READ_LIMIT = 500;

/** What an agent failure says. Every field is read by the fold or by a human. */
export interface AgentFailurePayload extends Record<string, unknown> {
  /** The agent that could not finish — `{agentId}` in the ratified sentences. */
  agent_id: string;
  /** How it ended. `success` never reaches the payload; it only ever closes. */
  status: 'timeout' | 'error';
  /**
   * The timeout it exceeded, in milliseconds, EXACTLY as the runtime raced it.
   *
   * Present only on a `timeout` whose caller supplied a real number. Absent is
   * the honest answer, and an absent value withholds the ratified ask rather
   * than shortening it — see `situationOfAgentFailure` in `sessionRegistry`.
   */
  timeout_ms?: number;
  /** The runner's `r_…` run id, when it had one. The join to the event log. */
  run_id?: string;
  /** The failure message, as the runner recorded it. Never parsed, only kept. */
  message?: string;
  resolved: boolean;
  /** ISO, on a closing event only. */
  resolved_at?: string;
}

/** One run's outcome, as `AgentRunner` already holds it at the chokepoint. */
export interface AgentRunOutcome {
  agentId: string;
  status: 'success' | 'error' | 'timeout';
  /**
   * The timeout the run was raced against, in ms. Supplied by the runner from
   * its own local; NOT read back out of `error`, which is prose.
   */
  timeoutMs?: number;
  error?: string;
  runId?: string;
  /** `AgentResult.finishedAt` — epoch ms. The run's own moment. */
  finishedAt?: number;
}

export interface AgentFailureProducerDeps {
  /** Test seam. Production reads the process-wide core, like every producer. */
  core?: IntelligenceCore;
}

/**
 * Fold one completed agent run into the record: open a failure, or close one.
 *
 * Returns how many events were emitted, so a caller can log a number rather
 * than a hope. Never throws (rule 5).
 */
export function recordAgentRunOutcome(
  outcome: AgentRunOutcome,
  deps: AgentFailureProducerDeps = {}
): number {
  try {
    const core = deps.core ?? getIntelligenceCore();
    if (!core) return 0;

    const agentId = typeof outcome?.agentId === 'string' ? outcome.agentId : '';
    if (!agentId) return 0;

    const observedAt = isoOrUndefined(outcome.finishedAt);
    if (!observedAt) return 0; // rule 1: no time, no event

    // Rule 4, and it fails CLOSED. An unreadable ledger must not read as
    // "nothing is open" — that is the one interpretation that re-opens what is
    // already open, on every call, forever.
    const open = openFailureFor(core, agentId);
    if (open === undefined) return 0;

    if (outcome.status === 'success') {
      // Rule 3. Only a success closes, and only something open can be closed.
      if (!open) return 0;
      return emit(core, {
        observedAt,
        causation: open.id,
        payload: { ...open.payload, resolved: true, resolved_at: observedAt },
      })
        ? 1
        : 0;
    }

    if (open) return 0; // already open: a second failure is not news

    const payload: AgentFailurePayload = {
      agent_id: agentId,
      status: outcome.status,
      // Rule 2. Only a timeout has one, and only when the caller measured it.
      ...(outcome.status === 'timeout' && isPositiveFinite(outcome.timeoutMs)
        ? { timeout_ms: outcome.timeoutMs as number }
        : {}),
      ...(outcome.runId ? { run_id: outcome.runId } : {}),
      ...(outcome.error ? { message: outcome.error } : {}),
      resolved: false,
    };
    if (!emit(core, { observedAt, payload })) return 0;
    core.scheduleFolds();
    return 1;
  } catch {
    return 0; // rule 5
  }
}

/** The open failure for this agent, `null` if none, `undefined` if unreadable. */
function openFailureFor(
  core: IntelligenceCore,
  agentId: string
): { id: string; payload: AgentFailurePayload } | null | undefined {
  let events: EventEnvelope[];
  try {
    events = core.ledger.query({
      topicPrefix: AGENT_FAILURE_TOPIC,
      order: 'desc',
      limit: AGENT_FAILURE_READ_LIMIT,
    });
  } catch {
    return undefined; // fail closed — see rule 4's note above
  }

  // Newest-first, first hit per agent wins: a resolution SUPERSEDES the failure
  // it closes, so the newest event for an agent IS its current state.
  for (const event of events) {
    const payload = (event.payload ?? {}) as AgentFailurePayload;
    if (payload.agent_id !== agentId) continue;
    if (payload.resolved === true) return null; // closed, and closing is the state
    return { id: event.id, payload: reopenablePayloadOf(payload) };
  }
  return null;
}

/**
 * The fields a closing event restates, so it still says WHAT it closed.
 *
 * `resolved`/`resolved_at` are set by the caller; everything else is carried
 * from the opening event rather than rebuilt, because a closing event
 * describing a different failure is a closing event about nothing.
 */
function reopenablePayloadOf(payload: AgentFailurePayload): AgentFailurePayload {
  return {
    agent_id: payload.agent_id,
    status: payload.status,
    ...(isPositiveFinite(payload.timeout_ms) ? { timeout_ms: payload.timeout_ms } : {}),
    ...(payload.run_id ? { run_id: payload.run_id } : {}),
    ...(payload.message ? { message: payload.message } : {}),
    resolved: false,
  };
}

interface EmitArgs {
  observedAt: string;
  causation?: string;
  payload: AgentFailurePayload;
}

/** One emission, wrapped: a rejected envelope costs the record, never the caller. */
function emit(core: IntelligenceCore, args: EmitArgs): string | undefined {
  try {
    return core.emitter.emit({
      observed_at: args.observedAt,
      topic: AGENT_FAILURE_TOPIC,
      schema: AGENT_FAILURE_SCHEMA,
      // NO ENTITY, and that is the honest shape rather than an omission: an
      // agent run that timed out did not fail AT a site. The inbox reached the
      // same answer independently — its row is `scope: '*'`, `scopeLabel:
      // 'This agent'`. Deriving one from whatever the run touched last would
      // put a platform failure on a site's record.
      entity: {},
      actor: RUNTIME_ACTOR,
      // A record OF WORK the platform did (a run), not a live reading of a
      // site — the same provenance the incident producer's two taps carry.
      source: { class: 'work', system: AGENT_FAILURE_SYSTEM, trust: 'emitted' },
      ...(args.causation ? { causation: args.causation } : {}),
      payload: args.payload,
    }).id;
  } catch {
    return undefined;
  }
}

function isPositiveFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/** A real source timestamp, or nothing. Epoch ms only — `finishedAt` is ms. */
function isoOrUndefined(value: unknown): string | undefined {
  return isPositiveFinite(value) ? new Date(value).toISOString() : undefined;
}
