/**
 * Which cron expressions an agent actually runs on.
 *
 * There are two sources and they disagreed silently for a long time. `AgentScheduler` scheduled
 * the cron expressions declared in the agent's manifest; the Preferences cadence picker wrote
 * `cadence` into `agent-settings.json`, where **nothing in the main process ever read it**. The
 * schedule a user set in the UI was not the schedule that ran — measured live: `auth-probe`
 * displayed hourly and fired every two minutes; `seo-insights` displayed every fifteen minutes
 * and fired on Mondays at 07:00.
 *
 * The rule now: **the manifest is the default, an explicit user choice overrides it.**
 *
 * That "explicit" is load-bearing. The renderer seeds a fifteen-minute cadence into the settings
 * of every agent it has never seen (`AgentStore.getDefaultSettings`), so a stored cadence is not
 * evidence that anyone chose it. Honouring those seeded values would have moved `seo-insights`
 * from weekly to every fifteen minutes — 672x more often, against a value the user never picked.
 * `cadenceSetAt` is written only when the picker is actually used, and is the sole thing that
 * grants a cadence authority over the agent author's schedule.
 */

export interface CadenceSettings {
  /** The cron expression chosen in the Preferences picker. */
  cadence?: string;
  /**
   * Unix ms of the moment the user last chose a cadence. Absent means the value in `cadence` was
   * seeded by the renderer rather than picked by a person, and carries no authority.
   */
  cadenceSetAt?: number;
}

export interface ResolvedSchedule {
  /** The expressions to schedule. Empty means this agent does not run on a timer. */
  expressions: string[];
  /** Where `expressions` came from — for the log line, so a surprising schedule is explainable. */
  source: 'user' | 'manifest';
  /** Set when a user-chosen cadence was refused, carrying the value that was refused. */
  ignoredCadence?: string;
}

/**
 * @param manifestExpressions cron expressions from the agent's own `triggers`.
 * @param settings the agent's persisted settings, or undefined if it has none.
 * @param isValid cron validator — `nodeCron.validate` in production, injected so this stays pure.
 */
export function resolveAgentCron(
  manifestExpressions: string[],
  settings: CadenceSettings | undefined,
  isValid: (expression: string) => boolean,
): ResolvedSchedule {
  const manifest = manifestExpressions.filter(isValid);

  // No cron trigger in the manifest means the agent was not built to run on a timer. A cadence
  // stored against it must not start scheduling it — the renderer seeds one for every agent,
  // including those that only ever run on events or on demand.
  if (manifest.length === 0) return { expressions: [], source: 'manifest' };

  const chosen = settings?.cadenceSetAt ? (settings.cadence ?? '').trim() : '';
  if (chosen === '') return { expressions: manifest, source: 'manifest' };

  // A stored expression that no longer parses must not leave the agent unscheduled: silence is
  // indistinguishable from a broken agent, and this is the schedule for something that runs
  // against production. Fall back, and name what was refused so the log can say so.
  if (!isValid(chosen)) {
    return { expressions: manifest, source: 'manifest', ignoredCadence: chosen };
  }

  // The user's choice is the whole schedule, not an addition to it. An agent declaring several
  // cron triggers collapses to the single chosen cadence — otherwise turning an agent down to
  // weekly would leave its other triggers firing at the original rate.
  return { expressions: [chosen], source: 'user' };
}
