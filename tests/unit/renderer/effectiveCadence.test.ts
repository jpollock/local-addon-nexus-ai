import { effectiveCadenceExpression, isUserChosenCadence, describeCron } from '../../../src/renderer/components/agents/effectiveCadence';
import { resolveAgentCron } from '../../../src/main/agent-runtime/schedule';

const isValid = (e: string) => /^(\S+\s+){4}\S+$/.test(e.trim());

describe('effectiveCadenceExpression', () => {
  it('shows the manifest schedule when the user has not picked one', () => {
    // The bug this fixes: the UI read settings.cadence and announced "every 15 minutes" for an
    // agent the scheduler was running on Mondays at 07:00.
    expect(effectiveCadenceExpression({ cadence: '*/15 * * * *' }, '0 7 * * 1')).toBe('0 7 * * 1');
  });

  it('shows the picked schedule once the user picks one', () => {
    expect(effectiveCadenceExpression({ cadence: '0 */6 * * *', cadenceSetAt: 1 }, '0 7 * * 1'))
      .toBe('0 */6 * * *');
  });

  it('shows the manifest schedule when there are no settings yet', () => {
    expect(effectiveCadenceExpression(undefined, '0 3 * * *')).toBe('0 3 * * *');
  });

  it('reports no schedule for an agent with no cron trigger, whatever is stored', () => {
    expect(effectiveCadenceExpression({ cadence: '*/15 * * * *', cadenceSetAt: 1 }, null)).toBeNull();
    expect(effectiveCadenceExpression({ cadence: '*/15 * * * *', cadenceSetAt: 1 }, '')).toBeNull();
  });

  it('ignores a blank picked cadence', () => {
    expect(effectiveCadenceExpression({ cadence: '  ', cadenceSetAt: 1 }, '0 7 * * 1')).toBe('0 7 * * 1');
  });
});

describe('isUserChosenCadence', () => {
  it('is false when the manifest is what runs', () => {
    expect(isUserChosenCadence({ cadence: '*/15 * * * *' }, '0 7 * * 1')).toBe(false);
    expect(isUserChosenCadence(undefined, '0 7 * * 1')).toBe(false);
  });

  it('is true only when a picked cadence differs from the manifest', () => {
    expect(isUserChosenCadence({ cadence: '0 */6 * * *', cadenceSetAt: 1 }, '0 7 * * 1')).toBe(true);
    // Picking the value the manifest already uses is not an override worth labelling.
    expect(isUserChosenCadence({ cadence: '0 7 * * 1', cadenceSetAt: 1 }, '0 7 * * 1')).toBe(false);
  });
});

describe('describeCron', () => {
  it('phrases the five cadences the picker offers', () => {
    expect(describeCron('*/15 * * * *')).toBe('Every 15 minutes');
    expect(describeCron('0 * * * *')).toBe('Hourly');
    expect(describeCron('0 */6 * * *')).toBe('Every 6 hours');
    expect(describeCron('0 0 * * *')).toBe('Daily at 00:00');
    expect(describeCron('0 0 * * 0')).toBe('Sundays at 00:00');
  });

  it('phrases the real manifest schedules that used to read "Custom schedule"', () => {
    // These are the live values: seo-insights, web-analytics, log-processor, auth-probe.
    expect(describeCron('0 7 * * 1')).toBe('Mondays at 07:00');
    expect(describeCron('0 8 * * 1')).toBe('Mondays at 08:00');
    expect(describeCron('0 3 * * *')).toBe('Daily at 03:00');
    expect(describeCron('*/2 * * * *')).toBe('Every 2 minutes');
  });

  it('falls back to the expression rather than inventing a phrase', () => {
    // Raw cron is less friendly than a sentence and more useful than a wrong one.
    expect(describeCron('15,45 2 * * 1-5')).toBe('15,45 2 * * 1-5');
    expect(describeCron('not a cron')).toBe('not a cron');
    expect(describeCron('0 0 1 * *')).toBe('0 0 1 * *');
  });
});

describe('the renderer copy agrees with the scheduler', () => {
  // Two implementations of one rule, in bundles that cannot import each other. This table is what
  // stops them drifting: if either side changes its mind about a case, this fails. The precedent
  // is normalizeLogPrefix, whose agent and renderer copies are pinned the same way.
  const CASES: Array<{ name: string; settings: any; manifest: string | null }> = [
    { name: 'seeded cadence, never picked',      settings: { cadence: '*/15 * * * *' },                  manifest: '0 7 * * 1' },
    { name: 'picked cadence',                    settings: { cadence: '0 */6 * * *', cadenceSetAt: 1 },  manifest: '0 7 * * 1' },
    { name: 'no settings',                       settings: undefined,                                    manifest: '0 3 * * *' },
    { name: 'blank picked cadence',              settings: { cadence: '   ', cadenceSetAt: 1 },          manifest: '0 7 * * 1' },
    { name: 'cadenceSetAt of 0',                 settings: { cadence: '*/15 * * * *', cadenceSetAt: 0 }, manifest: '0 7 * * 1' },
    { name: 'agent with no cron trigger',        settings: { cadence: '*/15 * * * *', cadenceSetAt: 1 }, manifest: null },
    { name: 'picked cadence equal to manifest',  settings: { cadence: '0 7 * * 1', cadenceSetAt: 1 },    manifest: '0 7 * * 1' },
  ];

  for (const c of CASES) {
    it(`agrees on: ${c.name}`, () => {
      const renderer = effectiveCadenceExpression(c.settings, c.manifest);
      const scheduler = resolveAgentCron(c.manifest ? [c.manifest] : [], c.settings, isValid);
      // The scheduler yields a list; for a single manifest expression the running schedule is its
      // first entry, or nothing at all.
      expect(renderer).toEqual(scheduler.expressions[0] ?? null);
    });
  }
});
