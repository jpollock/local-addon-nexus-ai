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

export interface ArmingRequest {
  capability: string;
  /** ISO 8601 — when the model asked. */
  at: string;
}

/**
 * Deliberately small: the queue exists to survive the gap between one tool call
 * and the next assembly, not to be a history. Anything older than that is
 * already stale, and the ledger is where history lives.
 */
const MAX_PENDING = 8;

let pending: ArmingRequest[] = [];

/** Record that the model asked for a capability by name. Never throws. */
export function recordArmingRequest(capability: string, at: Date = new Date()): void {
  if (!capability) return;
  pending.push({ capability, at: at.toISOString() });
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
}): ProcedureRequest | undefined {
  try {
    const grants = opts.grants ?? getCapabilityGrants();
    if (grants.length === 0) return undefined;

    const request: ProcedureRequest = { grants };
    const runbooks = opts.runbooks;
    if (!runbooks) return request; // grants without a registry: index only

    const granted = grantedRunbooks(runbooks, grants);

    // Path B. Drained either way: a request that cannot be honoured must not sit
    // in the queue arming some later, unrelated turn.
    const asked = takeArmingRequests();
    for (const req of [...asked].reverse()) {
      const outcome = armByRequest(req.capability, granted);
      if (outcome.armed) {
        return { ...request, armed: { capability: outcome.armed.runbook.capability, armedBy: 'model-request' } };
      }
    }

    // Path A. `armByPredicate` refuses to pick between two matches, and that
    // refusal arrives here as "nothing armed" — the index still names both.
    const byPredicate = armByPredicate(opts.userMessage, granted);
    if (byPredicate.armed) {
      return {
        ...request,
        armed: { capability: byPredicate.armed.runbook.capability, armedBy: 'predicate' },
      };
    }
    return request;
  } catch {
    // Arming is additive: a fault here costs the procedure, never the turn.
    return undefined;
  }
}
