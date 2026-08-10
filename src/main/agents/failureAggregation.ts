/**
 * The activity log printed five identical "(s.evidence || []).map is not a
 * function" entries verbatim, with no aggregation, no cause and no action.
 * Collapse them, and stop an agent that is only producing noise.
 */

export interface FailureRun {
  agentId: string;
  at: number;
  message: string;
}

export interface AggregatedFailure {
  agentId: string;
  message: string;
  count: number;
  firstAt: number;
  lastAt: number;
}

/** Consecutive identical failures before an agent pauses itself. */
export const AUTO_PAUSE_THRESHOLD = 3;

export function aggregateFailures(runs: FailureRun[]): AggregatedFailure[] {
  const byKey = new Map<string, AggregatedFailure>();

  for (const r of runs) {
    const key = `${r.agentId}|${r.message}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.count++;
      existing.firstAt = Math.min(existing.firstAt, r.at);
      existing.lastAt = Math.max(existing.lastAt, r.at);
    } else {
      byKey.set(key, {
        agentId: r.agentId, message: r.message, count: 1, firstAt: r.at, lastAt: r.at,
      });
    }
  }

  return [...byKey.values()].sort((a, b) => b.lastAt - a.lastAt);
}

/** True when the most recent AUTO_PAUSE_THRESHOLD runs all failed the same way. */
export function shouldAutoPause(runs: FailureRun[]): boolean {
  if (runs.length < AUTO_PAUSE_THRESHOLD) return false;
  const recent = [...runs].sort((a, b) => a.at - b.at).slice(-AUTO_PAUSE_THRESHOLD);
  return recent.every((r) => r.message === recent[0].message);
}
