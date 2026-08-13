/**
 * Whether an *automatic* trigger — cron or event — may start an agent.
 *
 * `enabled` is the master switch in the agent settings UI, but until now no automatic trigger
 * consulted it. AgentScheduler checked `scheduleEnabled` alone and the event bridge checked
 * `eventsEnabled` alone, while `enabled` gated only the paths a human drives: Run Now
 * (ipc-handlers), chat and contributed tools (index.ts `isAgentEnabled`, AgentDispatcher).
 *
 * So an agent could be off and still running. security-sentinel sat at
 * `{ enabled: false, scheduleEnabled: true }` on a real machine and swept hundreds of sites
 * unattended on its 15-minute cron. The user had switched it off; the switch never reached the
 * scheduler.
 *
 * Kept as a pure function, separate from the settings cache, so both trigger paths share one
 * definition and it can be tested without loading Electron.
 */

export interface AgentTriggerSettings {
  enabled?: boolean;
  scheduleEnabled?: boolean;
  eventsEnabled?: boolean;
  /**
   * Set by pauseIfStuck when an agent's recent runs are an unbroken identical
   * failure streak. Deliberately separate from `enabled` — that switch belongs
   * to the user, and overwriting it would make "did I turn this off, or did
   * Nexus?" unanswerable.
   */
  autoPausedAt?: number;
}

export type AutoRunKind = 'schedule' | 'event';

/**
 * Trigger kind recorded in a run.skip event.
 *
 * Wider than AutoRunKind — includes 'manual' for Run Now refusals, which are not automatic
 * triggers and cannot be passed to canAutoRunWith (whose ternary is only total over the two
 * automatic kinds).
 */
export type SkipTrigger = AutoRunKind | 'manual';

/**
 * Why an automatic trigger was, or was not, allowed to start an agent.
 *
 * `reason` is only present on refusal, and the values are exactly the three gates
 * `canAutoRunWith` consults, so a caller can log or display which one fired without
 * re-deriving it from the settings object.
 *
 * `auto-paused` is deliberately distinct from `agent-disabled`: the user set one and Nexus
 * set the other, and collapsing them makes "did I turn this off, or did Nexus?"
 * unanswerable in the log as well as in the UI.
 */
export type AutoRunDecision =
  | { allowed: true }
  | { allowed: false; reason: 'remotely-disabled' | 'agent-disabled' | 'auto-paused' | 'trigger-disabled' };

/**
 * @param settings the agent's persisted settings, or undefined when nothing is known.
 *
 * An explicit `false` on EITHER the master switch or the per-trigger switch blocks the run.
 * Absent flags stay permissive, matching `getAgentSetting`'s long-standing `?? true` contract —
 * the cache is pre-populated from disk at startup so that window should never open, and
 * narrowing it here would silently change behaviour for every agent rather than fix this bug.
 */
export function canAutoRunWith(
  settings: AgentTriggerSettings | undefined,
  kind: AutoRunKind,
  agentsRemotelyDisabled = false,
): AutoRunDecision {
  // The remote kill switch (T-KILLSWITCH) overrides every local switch — it exists precisely to
  // stop autonomous production activity when the running version is blocked or the release policy
  // sets disableAgents. Ranked first so it is the reported reason when it fires. Default false, so
  // a caller that cannot reach the release policy (or an old caller) is fail-safe: agents run.
  if (agentsRemotelyDisabled) return { allowed: false, reason: 'remotely-disabled' };
  // Order matters: with several gates closed, the master switch is the fact worth reporting —
  // it is the one the user set most recently and the one that explains every trigger at once.
  if (settings?.enabled === false) return { allowed: false, reason: 'agent-disabled' };
  // Ranked below the user's own switch for the same reason, and above the per-trigger one
  // because an auto-paused agent is refused on every trigger, not just this one.
  if (settings?.autoPausedAt !== undefined) return { allowed: false, reason: 'auto-paused' };
  const perTrigger = kind === 'schedule' ? settings?.scheduleEnabled : settings?.eventsEnabled;
  if (perTrigger === false) return { allowed: false, reason: 'trigger-disabled' };
  return { allowed: true };
}
