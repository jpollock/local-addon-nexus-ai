import { resolveAgentCron } from '../../../src/main/agent-runtime/schedule';

// A stand-in for node-cron's validate. The real one is used in production; these tests only need
// to distinguish "parses" from "does not".
const isValid = (e: string) => /^(\S+\s+){4}\S+$/.test(e.trim());

describe('resolveAgentCron', () => {
  const MANIFEST = ['0 7 * * 1'];

  it('uses the manifest when there are no settings at all', () => {
    expect(resolveAgentCron(MANIFEST, undefined, isValid))
      .toEqual({ expressions: ['0 7 * * 1'], source: 'manifest' });
  });

  it('IGNORES a cadence the user never chose — the upgrade-safety case', () => {
    // agent-settings.json is full of cadence values the renderer seeded as defaults
    // (getDefaultSettings → '*/15 * * * *'). Honouring those would silently move seo-insights
    // from Mondays at 07:00 to every fifteen minutes — 672x more often — on a value nobody picked.
    // Only an explicit choice, marked by cadenceSetAt, may override the agent author's schedule.
    expect(resolveAgentCron(MANIFEST, { cadence: '*/15 * * * *' }, isValid))
      .toEqual({ expressions: ['0 7 * * 1'], source: 'manifest' });
  });

  it('honours a cadence the user did choose', () => {
    expect(resolveAgentCron(MANIFEST, { cadence: '0 */6 * * *', cadenceSetAt: 1_754_000_000_000 }, isValid))
      .toEqual({ expressions: ['0 */6 * * *'], source: 'user' });
  });

  it('falls back to the manifest when the chosen cadence does not parse, and says why', () => {
    // Never leave an agent unscheduled because a stored expression went bad: a silently
    // unscheduled agent is indistinguishable from a broken one, and this is the schedule for
    // something that runs against production.
    const r = resolveAgentCron(MANIFEST, { cadence: 'every tuesday', cadenceSetAt: 1 }, isValid);
    expect(r.expressions).toEqual(['0 7 * * 1']);
    expect(r.source).toBe('manifest');
    expect(r.ignoredCadence).toBe('every tuesday');
  });

  it('falls back when the chosen cadence is blank', () => {
    expect(resolveAgentCron(MANIFEST, { cadence: '   ', cadenceSetAt: 1 }, isValid))
      .toEqual({ expressions: ['0 7 * * 1'], source: 'manifest' });
  });

  it('replaces EVERY manifest cron with the one the user chose', () => {
    // An agent may declare several cron triggers; the picker offers a single cadence. The user's
    // choice is the whole schedule, not an addition to it — otherwise turning an agent down to
    // weekly would leave its other triggers firing at the original rate.
    const r = resolveAgentCron(['0 3 * * *', '0 15 * * *'], { cadence: '0 0 * * 0', cadenceSetAt: 1 }, isValid);
    expect(r.expressions).toEqual(['0 0 * * 0']);
    expect(r.source).toBe('user');
  });

  it('does not invent a schedule for an agent that declares no cron trigger', () => {
    // No cron trigger in the manifest means the agent was not built to run on a timer. A cadence
    // stored against it (the renderer seeds one for every agent) must not start scheduling it.
    expect(resolveAgentCron([], { cadence: '*/15 * * * *', cadenceSetAt: 1 }, isValid))
      .toEqual({ expressions: [], source: 'manifest' });
  });

  it('drops manifest expressions that do not parse, keeping the rest', () => {
    const r = resolveAgentCron(['0 3 * * *', 'nonsense'], undefined, isValid);
    expect(r.expressions).toEqual(['0 3 * * *']);
    expect(r.source).toBe('manifest');
  });

  it('treats cadenceSetAt of 0 as never chosen', () => {
    // 0 is a falsy timestamp and also the epoch; either way it is not evidence of a choice.
    expect(resolveAgentCron(MANIFEST, { cadence: '*/15 * * * *', cadenceSetAt: 0 }, isValid))
      .toEqual({ expressions: ['0 7 * * 1'], source: 'manifest' });
  });
});
