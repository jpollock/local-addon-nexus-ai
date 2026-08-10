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
  // Use nested Map to avoid key collisions: Map<agentId, Map<message, AggregatedFailure>>
  const byAgent = new Map<string, Map<string, AggregatedFailure>>();

  for (const r of runs) {
    if (!byAgent.has(r.agentId)) {
      byAgent.set(r.agentId, new Map());
    }

    const messageMap = byAgent.get(r.agentId)!;
    const existing = messageMap.get(r.message);

    if (existing) {
      existing.count++;
      existing.firstAt = Math.min(existing.firstAt, r.at);
      existing.lastAt = Math.max(existing.lastAt, r.at);
    } else {
      messageMap.set(r.message, {
        agentId: r.agentId, message: r.message, count: 1, firstAt: r.at, lastAt: r.at,
      });
    }
  }

  // Flatten and sort by lastAt descending
  const result: AggregatedFailure[] = [];
  for (const messageMap of byAgent.values()) {
    for (const agg of messageMap.values()) {
      result.push(agg);
    }
  }

  return result.sort((a, b) => b.lastAt - a.lastAt);
}

/** True when any agent has AUTO_PAUSE_THRESHOLD consecutive identical failures among its own runs. */
export function shouldAutoPause(runs: FailureRun[]): boolean {
  // Group runs by agentId
  const byAgent = new Map<string, FailureRun[]>();
  for (const run of runs) {
    if (!byAgent.has(run.agentId)) {
      byAgent.set(run.agentId, []);
    }
    byAgent.get(run.agentId)!.push(run);
  }

  // Check if any agent has AUTO_PAUSE_THRESHOLD consecutive identical failures
  for (const agentRuns of byAgent.values()) {
    if (agentRuns.length < AUTO_PAUSE_THRESHOLD) continue;

    // Sort this agent's runs by time
    const sorted = [...agentRuns].sort((a, b) => a.at - b.at);

    // Check the most recent AUTO_PAUSE_THRESHOLD runs for this agent
    const recent = sorted.slice(-AUTO_PAUSE_THRESHOLD);
    if (recent.every((r) => r.message === recent[0].message)) {
      return true;
    }
  }

  return false;
}
