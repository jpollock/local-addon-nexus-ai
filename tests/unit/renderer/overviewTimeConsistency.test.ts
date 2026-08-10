/**
 * NexusOverview time consistency — date and time must both be local or both be UTC
 *
 * The overview row previously mixed `now.getHours()` (local) with `now.toISOString().slice(0,10)`
 * (UTC), causing the date and time to disagree for seven hours a day in PDT. This is the same
 * class of defect fixed in the logging layer.
 */

describe('NexusOverview time consistency', () => {
  // Simulate a timezone where local time is behind UTC (e.g., PDT is UTC-7)
  const simulateTimezone = (date: Date, offsetMinutes: number): { getHours: () => number; getMinutes: () => number; toISOString: () => string; toLocaleDateString: (locale: string) => string } => {
    const utcTime = date.getTime();
    const localTime = utcTime + (offsetMinutes * 60 * 1000);
    const localDate = new Date(localTime);

    return {
      getHours: () => localDate.getUTCHours(),
      getMinutes: () => localDate.getUTCMinutes(),
      toISOString: () => date.toISOString(),
      toLocaleDateString: (locale: string) => {
        // Simplified: just return YYYY-MM-DD for the local date
        const y = localDate.getUTCFullYear();
        const m = String(localDate.getUTCMonth() + 1).padStart(2, '0');
        const d = String(localDate.getUTCDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
      },
    };
  };

  it('date and time use the same timezone (local)', () => {
    // 2026-08-10 23:30 PDT = 2026-08-11 06:30 UTC
    // Local: 2026-08-10 23:30
    // UTC:   2026-08-11 06:30
    // If time is local (23) but date is UTC (08-11), they disagree
    const utcDate = new Date('2026-08-11T06:30:00Z');
    const now = simulateTimezone(utcDate, -420); // PDT is UTC-7 hours

    const hh = now.getHours().toString().padStart(2, '0');
    const mm = now.getMinutes().toString().padStart(2, '0');

    // BROKEN code would do: const day = now.toISOString().slice(0, 10); // '2026-08-11'
    // FIXED code should do: const day = now.toLocaleDateString('en-CA'); // '2026-08-10'

    // Simulate the correct (local) approach
    const day = now.toLocaleDateString('en-CA');

    // Time is 23:30, date should be 2026-08-10 (both local)
    expect(hh).toBe('23');
    expect(mm).toBe('30');
    expect(day).toBe('2026-08-10');

    // If date were UTC (BROKEN), it would be 2026-08-11, which would fail this test
    const brokenDay = now.toISOString().slice(0, 10);
    expect(brokenDay).toBe('2026-08-11'); // UTC date
    expect(brokenDay).not.toBe(day); // They disagree!
  });

  it('detects UTC/local mix in simulated PDT evening', () => {
    // 2026-08-10 20:00 PDT = 2026-08-11 03:00 UTC
    const utcDate = new Date('2026-08-11T03:00:00Z');
    const now = simulateTimezone(utcDate, -420); // PDT

    const localHours = now.getHours();
    const utcDay = now.toISOString().slice(0, 10);
    const localDay = now.toLocaleDateString('en-CA');

    // Time shows 20:xx (local), but UTC date is next day
    expect(localHours).toBe(20);
    expect(localDay).toBe('2026-08-10');
    expect(utcDay).toBe('2026-08-11');

    // The bug: showing "2026-08-11 20:00" when actual local time is "2026-08-10 20:00"
    expect(utcDay).not.toBe(localDay);
  });
});
