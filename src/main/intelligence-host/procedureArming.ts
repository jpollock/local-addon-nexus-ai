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

/** Test/`chat clear` hook: forget requests nobody will deliver. */
export function clearArmingRequests(): void {
  pending = [];
}
