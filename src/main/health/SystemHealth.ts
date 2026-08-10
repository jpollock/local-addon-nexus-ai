/**
 * "Is Nexus working?" — the header health pill.
 *
 * Distinct from HealthScoreCalculator / nexusFleetHealth, which score how healthy
 * an individual *site* is. This scores the addon itself.
 *
 * The rule that matters: a health indicator that can be confidently wrong is
 * worse than none. Today's implementation reads only `event_queue`, whose sole
 * writer is the MU-plugin webhook on Local sites, so "All Systems Healthy"
 * currently means "no failed WordPress webhook events on local sites" and is
 * structurally blind to a failing agent.
 */

export type HealthState = 'ok' | 'degraded' | 'failing' | 'unknown';

export interface HealthSignal {
  state: HealthState;
  /** Plain-language cause. Null only when state is 'ok'. */
  reason: string | null;
}

export interface SystemHealthInputs {
  agentRuns: HealthSignal;
  syncStaleness: HealthSignal;
  credentials: HealthSignal;
  eventQueue: HealthSignal;
}

export interface SystemHealth {
  overall: HealthState;
  inputs: SystemHealthInputs;
  /** Reasons from every non-ok input, most severe first. */
  reasons: string[];
}

/** Most severe first. Order is the precedence used for `overall`. */
const SEVERITY: HealthState[] = ['failing', 'unknown', 'degraded', 'ok'];

const INPUT_ORDER: (keyof SystemHealthInputs)[] = [
  'agentRuns', 'syncStaleness', 'credentials', 'eventQueue',
];

export function rollUpSystemHealth(inputs: SystemHealthInputs): SystemHealth {
  const states = INPUT_ORDER.map((k) => inputs[k].state);

  // `ok` is last in SEVERITY, so it wins only when every input is ok. An input
  // that could not be read reports `unknown` and drags the pill off green — it
  // is never treated as "fine".
  const overall = SEVERITY.find((s) => states.includes(s)) ?? 'unknown';

  const reasons: string[] = [];
  for (const severity of SEVERITY) {
    if (severity === 'ok') continue;
    for (const key of INPUT_ORDER) {
      const signal = inputs[key];
      if (signal.state === severity && signal.reason) reasons.push(signal.reason);
    }
  }

  return { overall, inputs, reasons };
}
