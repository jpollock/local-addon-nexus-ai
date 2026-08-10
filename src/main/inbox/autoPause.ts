import { shouldAutoPause, type FailureRun } from '../agents/failureAggregation';
import type { AgentRunRow } from '../agent-runtime/AgentStateStore';

/**
 * The failures since the agent's most recent success, newest first.
 *
 * `shouldAutoPause` takes `FailureRun[]`, which cannot represent a success, so
 * it cannot tell "three failures in a row" from "three failures with successes
 * between them". Handing it every failed run would pause a flaky agent as if
 * it were stuck. Closing that gap is this function's whole job.
 */
export function trailingFailures(runs: AgentRunRow[]): FailureRun[] {
  // `id` is a monotonic autoincrement, so it settles same-millisecond ties
  // deterministically. Without it, a success and a failure stamped in the same
  // millisecond could scan in either order, and the order decides whether the
  // streak breaks.
  const newestFirst = [...runs].sort(
    (a, b) => b.finishedAt - a.finishedAt || b.id - a.id,
  );
  const out: FailureRun[] = [];
  for (const r of newestFirst) {
    if (r.status === 'success') break;
    out.push({
      agentId: r.agentName,
      at: r.finishedAt,
      message: r.error ?? `status:${r.status}`,
    });
  }
  return out;
}

/** True when the agent's most recent runs are an unbroken identical failure streak. */
export function shouldPauseAgent(runs: AgentRunRow[]): boolean {
  return shouldAutoPause(trailingFailures(runs));
}

/** Just the slice of AgentStateStore this needs, so tests need no database. */
export interface PauseMarkerWriter {
  set(agentName: string, key: string, value: unknown): void;
}

export const AUTO_PAUSED_KEY = '_autoPausedAt';

/** Mark the agent paused when its recent runs are an unbroken identical failure streak. */
export function pauseIfStuck(
  store: PauseMarkerWriter,
  agentId: string,
  runs: AgentRunRow[],
  now: number = Date.now(),
): boolean {
  if (!shouldPauseAgent(runs)) return false;
  store.set(agentId, AUTO_PAUSED_KEY, now);
  return true;
}

/** Just the slice of AgentStateStore the resume path needs. */
export interface PauseMarkerClearer {
  delete(agentName: string, key: string): void;
}

/**
 * Clear an auto-pause so the agent may run automatically again.
 *
 * Without this, `pauseIfStuck` is a one-way door: nothing else deletes the
 * marker, so a paused agent would never run on a schedule again and no surface
 * could undo it. Keyed by agentId (the slug), matching where the marker is
 * written and where `canAutoRun` reads it.
 */
export function resumeAgent(store: PauseMarkerClearer, agentId: string): void {
  store.delete(agentId, AUTO_PAUSED_KEY);
}

/** Whether an agent is currently auto-paused. */
export function isAutoPaused(
  store: { get<T>(agentName: string, key: string): T | undefined },
  agentId: string,
): boolean {
  return store.get<number>(agentId, AUTO_PAUSED_KEY) !== undefined;
}
