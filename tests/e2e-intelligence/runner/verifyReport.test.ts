/**
 * WP-18 · Unit pins for the live-verification reader.
 *
 * `verify_site_live` is the one sanctioned write path in this harness: it
 * observes and records, it never mutates a site. The journey's claim is that it
 * "reconciles and emits" — so the reader has to recover BOTH halves from the
 * rendering: the reconciliation (how many matched, what differed) and the
 * recording (how many observations, via which producer system).
 *
 * `recorded` is the number the journey checks the ledger against. A reader that
 * defaulted it to 0 on a parse miss would turn "nothing was emitted" and "the
 * rendering changed" into the same result, and only one of those is a defect.
 *
 * Fixture shape taken from `verify-site-live.ts`'s rendering.
 */
import { parseVerifyReport } from './verifyReport';

const DRIFT = [
  '## Live verification — alpha-site',
  '',
  'Observed 12 plugins live (local). 9 matched the cached twins exactly.',
  '',
  '### 3 difference(s) vs cached observations',
  '',
  '| Plugin | Cached | Live | Note |',
  '|--------|--------|------|------|',
  '| akismet | v5.3 active (2d ago) | v5.3.1 active | twin updated |',
  '| hello-dolly | — not in ledger — | v1.7.2 inactive | first observation |',
  '| old-plugin | v1.0 active (9d ago) | — not installed — | recorded as removed |',
  '',
  'Recorded 13 fresh observations (trust: observed, via live-recheck:local). Twins are current as of this check.',
].join('\n');

const NO_DRIFT = [
  '## Live verification — alpha-site',
  '',
  'Observed 12 plugins live (local). 12 matched the cached twins exactly.',
  '',
  "✓ No drift: the ledger's picture of this site was accurate. All observations re-stamped as of now.",
  '',
  'Recorded 12 fresh observations (trust: observed, via live-recheck:local). Twins are current as of this check.',
].join('\n');

describe('parseVerifyReport — the drift case', () => {
  const parsed = parseVerifyReport(DRIFT);

  it('reads the site label', () => {
    expect(parsed.siteLabel).toBe('alpha-site');
  });

  it('reads how many plugins were observed live and how many matched', () => {
    expect(parsed.observedLive).toBe(12);
    expect(parsed.unchanged).toBe(9);
  });

  it('reads the producer system the observations were stamped with', () => {
    // This is the value that shows up in the health tool's "Other sources"
    // line afterwards — the journey's evidence that the ledger took the write.
    expect(parsed.observationSystem).toBe('live-recheck:local');
  });

  it('reads how many observations were recorded', () => {
    expect(parsed.recorded).toBe(13);
  });

  it('reads each difference with its slug and note', () => {
    expect(parsed.deltas).toEqual([
      { slug: 'akismet', note: 'twin updated' },
      { slug: 'hello-dolly', note: 'first observation' },
      { slug: 'old-plugin', note: 'recorded as removed' },
    ]);
  });
});

describe('parseVerifyReport — the no-drift case', () => {
  const parsed = parseVerifyReport(NO_DRIFT);

  it('still reports what was recorded — a clean check is still a write', () => {
    expect(parsed.recorded).toBe(12);
    expect(parsed.noDrift).toBe(true);
  });

  it('has no deltas', () => {
    expect(parsed.deltas).toEqual([]);
  });
});

describe('parseVerifyReport — a response that is not a report', () => {
  const parsed = parseVerifyReport(
    'Site is halted — a live check needs the site running.'
  );

  it('leaves recorded undefined rather than 0', () => {
    // 0 would read as "it ran and emitted nothing" — a measurement. Undefined
    // is the honest answer when the rendering was never produced.
    expect(parsed.recorded).toBeUndefined();
    expect(parsed.observationSystem).toBeUndefined();
    expect(parsed.siteLabel).toBeUndefined();
  });
});
