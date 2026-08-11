/**
 * `null` is the product requirement, not an implementation detail: a job with
 * no recorded run renders NO duration clause. Coercing to 0 would print
 * "took 0 min" on every fresh install.
 */
import { JobRunStore } from '../../../src/main/background/JobRunStore';

const fakeStorage = () => {
  const bag: Record<string, unknown> = {};
  return {
    bag,
    get: (k: string) => bag[k] ?? null,
    set: (k: string, v: unknown) => { bag[k] = v; },
  };
};

describe('JobRunStore', () => {
  test('an unmeasured job is null, never 0', () => {
    const s = new JobRunStore(fakeStorage());
    expect(s.averageMs('wpeRefresh')).toBeNull();
    expect(s.lastRunAt('wpeRefresh')).toBeNull();
  });

  test('records a run and averages it', () => {
    const s = new JobRunStore(fakeStorage());
    s.record('wpeRefresh', 1_000, 660_000);
    expect(s.averageMs('wpeRefresh')).toBe(660_000);
    expect(s.lastRunAt('wpeRefresh')).toBe(1_000);
  });

  test('averages the last 5 and caps the stored history at 5', () => {
    const st = fakeStorage();
    const s = new JobRunStore(st);
    for (let i = 1; i <= 7; i++) s.record('wpeSync', i * 1_000, i * 1_000);
    // Runs 3..7 survive: mean of 3000,4000,5000,6000,7000 = 5000
    expect(s.averageMs('wpeSync')).toBe(5_000);
    expect((st.bag['nexus-ai:job-runs'] as any).wpeSync).toHaveLength(5);
  });

  test('lastRunAt is the most recent start, not the first', () => {
    const s = new JobRunStore(fakeStorage());
    s.record('externalRefresh', 100, 10);
    s.record('externalRefresh', 900, 10);
    expect(s.lastRunAt('externalRefresh')).toBe(900);
  });

  test('jobs are independent', () => {
    const s = new JobRunStore(fakeStorage());
    s.record('wpeRefresh', 1, 5_000);
    expect(s.averageMs('localContentIndex')).toBeNull();
  });

  test('survives a corrupt stored value rather than throwing', () => {
    const st = fakeStorage();
    st.bag['nexus-ai:job-runs'] = 'not an object';
    const s = new JobRunStore(st);
    expect(s.averageMs('wpeRefresh')).toBeNull();
    s.record('wpeRefresh', 1, 100);
    expect(s.averageMs('wpeRefresh')).toBe(100);
  });
});
