import { makeSingleFlight } from '../../../src/main/startup/singleFlight';

describe('makeSingleFlight (P1-7 scheduler re-entrancy guard)', () => {
  it('coalesces overlapping calls into a single execution', async () => {
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const guard = makeSingleFlight<number>();
    const fn = async () => {
      calls++;
      await gate;
      return calls;
    };

    const a = guard(fn);
    const b = guard(fn); // issued while `a` is still in flight
    release();
    const [ra, rb] = await Promise.all([a, b]);

    expect(calls).toBe(1); // fn ran once, not twice
    expect(ra).toBe(rb); // both callers share the one result
  });

  it('runs fresh once the previous call has settled', async () => {
    let calls = 0;
    const guard = makeSingleFlight<number>();
    const fn = async () => {
      calls++;
      return calls;
    };

    await guard(fn);
    await guard(fn);
    expect(calls).toBe(2);
  });

  it('propagates a rejection and resets so the next call can run', async () => {
    let calls = 0;
    const guard = makeSingleFlight<number>();
    const fn = async () => {
      calls++;
      if (calls === 1) throw new Error('boom');
      return calls;
    };

    await expect(guard(fn)).rejects.toThrow('boom');
    await expect(guard(fn)).resolves.toBe(2); // in-flight was cleared after the failure
  });
});
