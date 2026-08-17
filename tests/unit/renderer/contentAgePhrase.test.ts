/**
 * WP-22b · the two copies of the content-age phrase, pinned to each other.
 *
 * `durationPhrase` exists twice — `main/intelligence-host/siteStatus.ts` renders it
 * into the "where am I?" answer, and the docked panel's `siteContextModel.ts` renders
 * it into the chip — because main and renderer do not share a bundle. Same reason
 * `localDay` and `resolveAgentCron` are duplicated, and the same remedy: one case
 * table, run through both copies, so the two can never disagree about how old the
 * same copy is. A user who reads "11 days ago" on the band and hears "12 days ago"
 * from the assistant in the same minute has been given two facts, not one.
 *
 * The renderer's copy is private, so it is exercised through `contentAgeChip`, which
 * is the only thing that renders it — a stronger pin than reaching for the helper,
 * because it also catches a chip that stops using it.
 */
import { durationPhrase } from '../../../src/main/intelligence-host/siteStatus';
import { contentAgeChip } from '../../../src/renderer/components/DockedPanel/siteContextModel';

/** Every boundary the phrase has, plus one ordinary value on each side of it. */
const CASES: number[] = [
  0,
  1,
  59,
  3599, // just under an hour
  3600, // exactly an hour
  5400, // rounds to 2 hours
  86_399, // just under a day
  86_400, // exactly a day
  86_400 * 1.4, // rounds back to 1 day
  86_400 * 11,
  86_400 * 365,
  -1, // a clock that disagrees with itself is never a negative age on screen
  Number.POSITIVE_INFINITY,
  Number.NaN,
];

describe('the content age reads the same in the chat answer and on the band', () => {
  for (const seconds of CASES) {
    it(`agrees at ${seconds} seconds`, () => {
      const chip = contentAgeChip({
        state: 'pulled',
        sourceName: 'the live site',
        behindSeconds: seconds,
      });

      if (!Number.isFinite(seconds)) {
        // The chip refuses to render a phrase it cannot compute; the prose renderer
        // has a sentence to finish and says "less than an hour". Different surfaces,
        // and the chip's silence is the stricter of the two.
        expect(chip).toBeNull();
        return;
      }

      expect(chip).toBe(`Pulled from the live site ${durationPhrase(seconds)} ago`);
    });
  }
});
