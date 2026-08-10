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
}

export type AutoRunKind = 'schedule' | 'event' | 'manual';

/**
 * Why an automatic trigger was, or was not, allowed to start an agent.
 *
 * `reason` is only present on refusal — the two values are exactly the two switches
 * `canAutoRunWith` consults, so a caller can log or display which one fired without
 * re-deriving it from the settings object.
 */
export type AutoRunDecision =
  | { allowed: true }
  | { allowed: false; reason: 'agent-disabled' | 'trigger-disabled' };

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
): AutoRunDecision {
  // Order matters: with both switches off, the master switch is the fact worth reporting —
  // it is the one the user set most recently and the one that explains every trigger at once.
  if (settings?.enabled === false) return { allowed: false, reason: 'agent-disabled' };
  const perTrigger = kind === 'schedule' ? settings?.scheduleEnabled : settings?.eventsEnabled;
  if (perTrigger === false) return { allowed: false, reason: 'trigger-disabled' };
  return { allowed: true };
}
