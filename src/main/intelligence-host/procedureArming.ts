/**
 * WP-20b · What the model asked for, waiting for the turn that can deliver it.
 *
 * P1's path B has two halves. `nexus_load_procedure` acknowledges the request —
 * it must not carry the procedure, because R7 forbids a runbook riding a
 * `role: 'tool'` message the platform has told the model to distrust. The other
 * half is the host injecting the document into the next iteration's user-role
 * carrier, which is WP-20c's seam. This tiny store is the join between them.
 *
 * WHY IT IS PROCESS-WIDE AND NOT SESSION-KEYED. `McpToolHandler.execute` is
 * `(args, services)`: a tool handler has no task id and no session id, and
 * `ToolRegistry.call` keeps the task moment to itself. Threading it down is a
 * locked-file change (`tool-registry.ts` is audit chokepoint one), so v0 records
 * the request without a session and 20c/20d thread identity when they have a
 * reason to open that file. Stated rather than hidden, because the consequence
 * is real: two concurrent chats asking for procedures in the same second cannot
 * be told apart here.
 *
 * BOUNDED, and drained by its reader. A request nobody consumes is a request
 * that would arm a procedure on some later, unrelated turn — so the queue is
 * small, and `takeArmingRequests` empties it.
 */

import { armByPredicate, armByRequest, ProcedureRequest, RunbookRegistry } from '../../intelligence';
import { getCapabilityGrants, grantedRunbooks, ResolvedGrant } from './capabilityGrants';
import type { ProcedureScope } from './procedureScope';

export interface ArmingRequest {
  capability: string;
  /** ISO 8601 — when the model asked. */
  at: string;
  /**
   * WP-32 · THE SCOPE THE ARMING CARRIES (XD-15's headline requirement).
   *
   * The cells a human selected at a comparator, split by authority before the
   * gate ever sees them. It rides HERE, on the request, because this queue is
   * the only thing that survives the gap between `nexus_load_procedure`'s
   * acknowledgement and the next turn's delivery — and that gap is precisely
   * where a re-derivation would slip in unobserved.
   *
   * **Optional, and absent means absent.** A request recorded without a
   * selection carries no `scope` key at all, not a `scope: undefined` — the
   * parity floor is that everything predating WP-32 is byte-identical, and a
   * present-but-undefined field is not byte-identical to a missing one.
   */
  scope?: ProcedureScope;
  /**
   * WP-51 item 3 · THE INCIDENTS THIS ARMING ANSWERS, as ledger event ids.
   *
   * The designer's Q1: *"The containment run folds IF AND ONLY IF its arming
   * names the incidents it answers"* — with the reason stated as a preference
   * about honesty rather than about rows: *"I'd rather have four honest rows
   * than three where one join was inferred from a timestamp."* A run and the
   * incidents it was launched over are joinable by anyone willing to infer from
   * a target and a clock; the join is RECORDED only where the armer, which
   * knows, writes it down.
   *
   * The shape is WP-25's `source: abort:<task>/<abort>` one field over: the
   * record an act came out of, named in full.
   *
   * **Optional, and absent means absent** — same rule, same reason, as `scope`.
   */
  answers?: string[];
}

/**
 * An incident is an EVENT, so an answer is an event id. Nothing else is written.
 *
 * The gate matters more here than a format check usually does, because the
 * value's whole purpose is to be a JOIN: an id that cannot name an incident
 * produces a `cause` the fold silently fails to resolve, which reads as "the
 * run answers something the ledger has lost" rather than "a caller passed the
 * wrong thing". WP-48a's finding is the same shape one field over — a sentinel
 * RUN id (`r_msz8afwx00`) is not an event id, and does not become one by being
 * written somewhere that accepts strings.
 *
 * Mirrors the envelope validator's own `causation` rule (`evt_<ULID>`) rather
 * than inventing a looser one: the ids this carries are the ids that field
 * holds, and two spellings of "an event id" is how they drift.
 */
const INCIDENT_EVENT_ID = /^evt_[0-9A-HJKMNP-TV-Z]{16,26}$/;

function answeredIncidents(ids: readonly string[] | undefined): string[] | undefined {
  if (!Array.isArray(ids)) return undefined;
  // De-duplicated: the same incident named twice is one answer, and a repeated
  // id would double-count the thing the row is about.
  const kept = [...new Set(ids.filter((id) => typeof id === 'string' && INCIDENT_EVENT_ID.test(id)))];
  // Nothing usable ⇒ NO key. An empty array would say the arming answered, and
  // that what it answered was nothing.
  return kept.length > 0 ? kept : undefined;
}

/**
 * Deliberately small: the queue exists to survive the gap between one tool call
 * and the next assembly, not to be a history. Anything older than that is
 * already stale, and the ledger is where history lives.
 */
const MAX_PENDING = 8;

let pending: ArmingRequest[] = [];

/**
 * Record that the model asked for a capability by name. Never throws.
 *
 * `scope` is spread conditionally rather than assigned: see `ArmingRequest.scope`
 * — the parity pin asserts the KEY is absent, which an unconditional assignment
 * would defeat while still passing a `toEqual`.
 */
export function recordArmingRequest(
  capability: string,
  at: Date = new Date(),
  scope?: ProcedureScope,
  answers?: readonly string[]
): void {
  if (!capability) return;
  const answered = answeredIncidents(answers);
  pending.push({
    capability,
    at: at.toISOString(),
    ...(scope ? { scope } : {}),
    ...(answered ? { answers: answered } : {}),
  });
  // Oldest first out: a full queue means requests are not being consumed, and
  // the newest is the one a live turn is most likely waiting on.
  if (pending.length > MAX_PENDING) pending = pending.slice(-MAX_PENDING);
}

/**
 * Take everything pending, leaving the queue empty.
 *
 * Drain rather than peek: the turn that delivers a procedure has consumed the
 * request, and leaving it behind would re-deliver on the following turn.
 */
export function takeArmingRequests(): ArmingRequest[] {
  const out = pending;
  pending = [];
  return out;
}

/**
 * WP-31 · look without taking — the ARMING GAP's only window onto itself.
 *
 * `nexus_load_procedure` acknowledges a request and the platform delivers the
 * body on the NEXT turn (R7). Between those two moments no run exists, so
 * `runForTask` sees nothing and the sequence guard is not in the path at all.
 * That gap is where the 2026-08-18 incident happened in its entirety: the model
 * asked, read the acknowledgement's class labels as a progress report, and
 * wrote.
 *
 * The guard therefore reads this queue directly — and it must PEEK. Draining
 * here would refuse the write AND cancel the arming it was protecting: the next
 * turn would carry no procedure, and the turn after that would be ungoverned.
 * A refusal that disarms the thing doing the refusing is worse than the hole.
 */
export function peekArmingRequests(): readonly ArmingRequest[] {
  return pending;
}

/** Test/`chat clear` hook: forget requests nobody will deliver. */
export function clearArmingRequests(): void {
  pending = [];
}

/**
 * WP-37 · what the turn is owed on the procedure plane, AND what the arming it
 * honoured carried with it.
 *
 * The `ProcedureRequest` is a CORE type and must stay one: `ProcedureScope`
 * lives here in the host, and the seam (ADR-16) forbids the core knowing about
 * it. So the scope travels beside the request rather than inside it, and this
 * wrapper is what the assembler unpacks.
 *
 * **`scope` is present only when the honoured arming carried one**, and it is
 * spread conditionally for the same reason `ArmingRequest.scope` is: an absent
 * key and a present-undefined one are not the same fact, and only the first is
 * byte-identical to every turn that predates WP-32.
 */
export interface TurnProcedure {
  request: ProcedureRequest;
  scope?: ProcedureScope;
  /**
   * WP-51 · the incidents the honoured arming answers. Present only when that
   * arming carried them, for the same reason `scope` is: a cause belongs to the
   * arming that named it, and handing it to a later turn's arming would be the
   * re-derivation this seam exists to stop.
   */
  answers?: string[];
}

/**
 * What this turn's assembly is owed on the procedure plane — the decision WP-20c
 * left to this packet in `ChatAssemblyRequest.procedure`'s own comment.
 *
 * Two P1 paths are resolved here, in this order:
 *
 *   B · a capability the model ASKED for by name (`nexus_load_procedure`) — it
 *       outranks the predicate, because an explicit request is evidence and a
 *       lexical match is an inference.
 *   A · the runbook's own authored `arms_on:` predicate over the turn text.
 *
 * Path C (the late arm at the gate) is not here: it fires at a tool call, not at
 * assembly, and WP-20d owns that guard.
 *
 * Returns `undefined` when no grant is live, and that is the parity floor P2's
 * additive-only ruling rests on: no grants ⇒ no `procedure` field ⇒ no index, no
 * section, and a turn block identical to the pre-WP-20 build.
 *
 * A request for a capability that is not granted arms nothing. The tool refuses
 * to record one, so this is defence in depth — a queue is not an authority.
 */
export function procedureRequestForTurn(opts: {
  runbooks?: RunbookRegistry;
  userMessage: string;
  /** Defaults to the live set. Injected by tests and by any caller holding its own. */
  grants?: ResolvedGrant[];
}): TurnProcedure | undefined {
  try {
    const grants = opts.grants ?? getCapabilityGrants();
    if (grants.length === 0) return undefined;

    const request: ProcedureRequest = { grants };
    const runbooks = opts.runbooks;
    if (!runbooks) return { request }; // grants without a registry: index only

    const granted = grantedRunbooks(runbooks, grants);

    // Path B. Drained either way: a request that cannot be honoured must not sit
    // in the queue arming some later, unrelated turn.
    const asked = takeArmingRequests();
    for (const req of [...asked].reverse()) {
      const outcome = armByRequest(req.capability, granted);
      if (outcome.armed) {
        return {
          request: {
            ...request,
            armed: { capability: outcome.armed.runbook.capability, armedBy: 'model-request' },
          },
          // WP-37 · THE CARRIER'S ONE JOB, COLLECTED. The scope rides out on the
          // request that honoured it and on no other: a selection belongs to the
          // arming that carried it, and handing it to a later turn's arming would
          // be the re-derivation-by-another-name this whole seam exists to stop.
          ...(req.scope ? { scope: req.scope } : {}),
          // WP-51 · and the CAUSE with it, on exactly the same terms.
          ...(req.answers ? { answers: req.answers } : {}),
        };
      }
    }

    // Path A. `armByPredicate` refuses to pick between two matches, and that
    // refusal arrives here as "nothing armed" — the index still names both.
    const byPredicate = armByPredicate(opts.userMessage, granted);
    if (byPredicate.armed) {
      // No scope: a predicate arms from the turn's own words, and nobody
      // selected anything for it to carry.
      return {
        request: {
          ...request,
          armed: { capability: byPredicate.armed.runbook.capability, armedBy: 'predicate' },
        },
      };
    }
    return { request };
  } catch {
    // Arming is additive: a fault here costs the procedure, never the turn.
    return undefined;
  }
}
