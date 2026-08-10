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
  const newestFirst = [...runs].sort((a, b) => b.finishedAt - a.finishedAt);
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
