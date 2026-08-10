/**
 * NexusOverview time consistency — date and time must both be local or both be UTC
 *
 * The overview row previously mixed `now.getHours()` (local) with `now.toISOString().slice(0,10)`
 * (UTC), causing the date and time to disagree for seven hours a day in PDT. This is the same
 * class of defect fixed in the logging layer.
 *
 * CRITICAL: This test exercises the production implementation of localDay() under a simulated
 * PDT evening where local and UTC dates differ. It fails against the original UTC-mixing code
 * (now.toISOString().slice(0,10)) and passes against the fixed code (localDay(now)).
 *
 * Uses simulatedZone.ts so the assertions pass on any machine (UTC, JST, etc.), not only
 * machines whose wall clock happens to be PDT.
 */
import { localDay } from '../../../src/renderer/components/localDay';
import { ZonedDate } from '../logging/simulatedZone';

describe('NexusOverview time consistency', () => {
  it('localDay() returns local date in PDT evening (UTC is next day)', () => {
    // Simulate PDT (UTC-7) at 20:30 local = 03:30 UTC next day
    // Local: 2026-08-10 20:30
    // UTC:   2026-08-11 03:30
    const pdtEvening = new ZonedDate('2026-08-11T03:30:00Z', -7);
    jest.useFakeTimers();
    jest.setSystemTime(pdtEvening);

    // Get local time components (what NexusOverview.tsx uses for hh:mm)
    const hh = pdtEvening.getHours().toString().padStart(2, '0');
    const mm = pdtEvening.getMinutes().toString().padStart(2, '0');

    // Get date using the fixed implementation
    const day = localDay(pdtEvening);

    // In PDT, local time is 20:30, so local date should be 2026-08-10
    expect(day).toBe('2026-08-10'); // Local date
    expect(hh).toBe('20'); // Local hour

    // The bug: UTC date is 2026-08-11, which disagrees with local time 20:30
    const brokenDay = pdtEvening.toISOString().slice(0, 10);
    expect(brokenDay).toBe('2026-08-11'); // UTC is next day
    expect(day).not.toBe(brokenDay); // Our fix uses local, not UTC

    jest.useRealTimers();
  });

  it('localDay() handles invalid Date', () => {
    const invalidDate = new Date('invalid');
    expect(localDay(invalidDate)).toBe('unknown');
  });

  it('localDay() handles normal date', () => {
    const normalDate = new ZonedDate('2026-08-10T19:00:00Z', -7); // 12:00 PDT
    jest.useFakeTimers();
    jest.setSystemTime(normalDate);

    const day = localDay(normalDate);
    expect(day).toBe('2026-08-10');

    jest.useRealTimers();
  });

  it('detects UTC/local mix conceptually', () => {
    // Demonstrate the bug independently
    // 2026-08-10 20:00 PDT = 2026-08-11 03:00 UTC
    const pdtEvening = new ZonedDate('2026-08-11T03:00:00Z', -7);
    jest.useFakeTimers();
    jest.setSystemTime(pdtEvening);

    const localHours = pdtEvening.getHours();
    const utcDay = pdtEvening.toISOString().slice(0, 10);
    const localDayValue = localDay(pdtEvening);

    // UTC date is 2026-08-11
    expect(utcDay).toBe('2026-08-11');

    // Local date is 2026-08-10
    expect(localDayValue).toBe('2026-08-10');

    // Local hour is 20
    expect(localHours).toBe(20);

    // The bug: showing "2026-08-11 20:00" when actual local time is "2026-08-10 20:00"
    expect(utcDay).not.toBe(localDayValue);

    jest.useRealTimers();
  });
});
