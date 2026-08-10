/**
 * localDay() pinning test — renderer and main copies must stay in sync
 *
 * Mirrors effectiveCadence.test.ts pattern: runs BOTH implementations (renderer and main)
 * over ONE shared case table so a change to either side fails the suite. Both carry the same
 * ICU guard, and nothing should let them drift.
 *
 * The test table includes: normal dates, PDT evening where UTC differs, invalid Date (the
 * 'unknown' branch), and a case exercising the regex fallback.
 */

import { localDay as rendererLocalDay } from '../../../src/renderer/components/localDay';
import { localDay as mainLocalDay } from '../../../src/main/logging/eventLog';

interface LocalDayCase {
  label: string;
  date: Date;
  expected: string | RegExp; // string for exact match, RegExp for pattern
}

/**
 * Shared case table — both implementations must return the same result for every case.
 * Add new cases here when you discover an edge the guard should handle.
 */
const cases: LocalDayCase[] = [
  {
    label: 'normal date',
    date: new Date('2026-08-10T12:00:00Z'),
    expected: /^\d{4}-\d{2}-\d{2}$/, // YYYY-MM-DD format, value depends on test machine timezone
  },
  {
    label: 'PDT evening where local and UTC days differ',
    date: new Date('2026-08-11T03:30:00Z'), // 20:30 PDT = 03:30 UTC next day
    expected: '2026-08-10', // Local date (PDT), not UTC (2026-08-11)
  },
  {
    label: 'invalid Date (the unknown branch)',
    date: new Date('invalid'),
    expected: 'unknown',
  },
  {
    label: 'another PDT evening',
    date: new Date('2026-08-11T06:59:59Z'), // 23:59:59 PDT, one second before midnight
    expected: '2026-08-10', // Still Aug 10 in PDT
  },
];

describe('localDay() copies stay in sync', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('renderer copy (src/renderer/components/localDay.ts)', () => {
    cases.forEach(({ label, date, expected }) => {
      it(label, () => {
        jest.setSystemTime(date);
        const result = rendererLocalDay(date);

        if (typeof expected === 'string') {
          expect(result).toBe(expected);
        } else {
          expect(result).toMatch(expected);
        }
      });
    });
  });

  describe('main copy (src/main/logging/eventLog.ts)', () => {
    cases.forEach(({ label, date, expected }) => {
      it(label, () => {
        jest.setSystemTime(date);
        const result = mainLocalDay(date);

        if (typeof expected === 'string') {
          expect(result).toBe(expected);
        } else {
          expect(result).toMatch(expected);
        }
      });
    });
  });

  describe('both copies agree', () => {
    cases.forEach(({ label, date }) => {
      it(label, () => {
        jest.setSystemTime(date);
        const rendererResult = rendererLocalDay(date);
        const mainResult = mainLocalDay(date);

        expect(rendererResult).toBe(mainResult);
      });
    });
  });

  describe('NexusOverview uses the guarded renderer copy', () => {
    it('imports localDay from the renderer module, not using raw toISOString', () => {
      // Read NexusOverview source and verify it imports and uses localDay
      const fs = require('fs');
      const path = require('path');
      const overviewPath = path.join(__dirname, '../../../src/renderer/components/NexusOverview.tsx');
      const source = fs.readFileSync(overviewPath, 'utf8');

      // Must import localDay
      expect(source).toMatch(/import.*localDay.*from.*['"]\.\/localDay['"]/);

      // The line that computes `day` must call localDay(now), not toISOString
      // Line ~526: const day = localDay(now);
      expect(source).toMatch(/const day = localDay\(now\);/);

      // Must NOT use the broken UTC implementation
      expect(source).not.toMatch(/const day = now\.toISOString\(\)\.slice\(0,\s*10\)/);
    });
  });
});
