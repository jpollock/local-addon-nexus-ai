import type { AgentResult } from '../agent-sdk/types';

/**
 * The run ids a single "Run Now" produced — one per site, because the handler loops the runner
 * per selected site.
 *
 * The UI used to show a `run-${Date.now()}` string it minted itself, which appeared in no log
 * line anywhere. Broadcasting the runner's own ids is what makes `grep run=<id>` reachable from
 * the app rather than only from reading the log first.
 */
export function collectRunIds(runs: Array<{ site: string; result: Partial<AgentResult> }>): string[] {
  return runs.map(r => r.result?.runId).filter((id): id is string => typeof id === 'string' && id !== '');
}
