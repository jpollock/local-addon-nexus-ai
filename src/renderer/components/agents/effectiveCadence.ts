/**
 * What schedule this agent actually runs on, for display.
 *
 * The renderer used to label the schedule straight from `settings.cadence`, which is not what
 * runs: the scheduler takes the agent's manifest cron unless the user explicitly picked a
 * cadence. Labelling the picked-or-seeded value made the UI state a schedule that was never
 * used — `auth-probe` read "every hour" while firing every two minutes.
 *
 * This mirrors `resolveAgentCron` in `src/main/agent-runtime/schedule.ts`. The two are separate
 * because main and renderer do not share a bundle; `effectiveCadence.test.ts` pins them to the
 * same table of cases so they cannot drift apart silently.
 */

export interface CadenceLike {
  cadence?: string;
  /** Present only when a person used the picker — see AgentSettings.cadenceSetAt. */
  cadenceSetAt?: number;
}

/**
 * @param settings the agent's settings, or undefined before they load.
 * @param manifestCron `AgentStatus.cronExpression` — the agent's own schedule. Null for an agent
 *        that declares no cron trigger, which no cadence may override into existence.
 * @returns the cron expression that actually runs, or null if this agent is not on a timer.
 */
export function effectiveCadenceExpression(
  settings: CadenceLike | undefined,
  manifestCron: string | null | undefined,
): string | null {
  const manifest = (manifestCron ?? '').trim();
  // No manifest cron means the agent was not built to run on a timer; a stored cadence must not
  // conjure a schedule for it.
  if (manifest === '') return null;

  const chosen = settings?.cadenceSetAt ? (settings.cadence ?? '').trim() : '';
  return chosen === '' ? manifest : chosen;
}

const DAYS = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];

/**
 * A human label for any cron expression, not only the five the picker offers.
 *
 * The picker's label table covered its own five values and rendered everything else as "Custom
 * schedule" — which, now that manifest schedules are displayed, would have hidden `0 7 * * 1`
 * and `*​/2 * * * *` behind the same uninformative phrase. Anything this cannot phrase falls back
 * to the expression itself: raw cron is less friendly than a sentence but is at least true.
 */
export function describeCron(expression: string): string {
  const e = expression.trim();
  const parts = e.split(/\s+/);
  if (parts.length !== 5) return e;
  const [min, hour, dom, mon, dow] = parts;

  const at = (h: string, m: string) => `${h.padStart(2, '0')}:${m.padStart(2, '0')}`;
  const everyN = (field: string) => (/^\*\/\d+$/.test(field) ? Number(field.slice(2)) : null);

  if (dom === '*' && mon === '*') {
    const perMin = everyN(min);
    if (perMin && hour === '*' && dow === '*') {
      return perMin === 1 ? 'Every minute' : `Every ${perMin} minutes`;
    }
    const perHour = everyN(hour);
    if (perHour && /^\d+$/.test(min) && dow === '*') {
      return perHour === 1 ? 'Hourly' : `Every ${perHour} hours`;
    }
    if (/^\d+$/.test(min) && hour === '*' && dow === '*') return 'Hourly';
    if (/^\d+$/.test(min) && /^\d+$/.test(hour)) {
      const time = at(hour, min);
      if (dow === '*') return `Daily at ${time}`;
      if (/^[0-6]$/.test(dow)) return `${DAYS[Number(dow)]} at ${time}`;
    }
  }
  return e;
}

/** True when the running schedule came from the user rather than the agent's manifest. */
export function isUserChosenCadence(
  settings: CadenceLike | undefined,
  manifestCron: string | null | undefined,
): boolean {
  const effective = effectiveCadenceExpression(settings, manifestCron);
  return effective !== null && effective !== (manifestCron ?? '').trim();
}
