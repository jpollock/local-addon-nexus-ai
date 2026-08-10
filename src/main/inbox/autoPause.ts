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
