/**
 * WP-18 · Unit pins for the health-report reader.
 *
 * The health journey asserts things ABOUT a live report, so the thing that
 * turns that report into assertable structure is itself load-bearing: a parser
 * that quietly returns zero rows would make every assertion over those rows
 * vacuously true, and the journey would pass against a health surface that had
 * stopped rendering anything at all. Hence the "finds every row" pins and the
 * explicit empty-input pin.
 *
 * The fixture below is the real rendering shape, taken from
 * `renderHealthReport` in src/main/mcp/modules/fleet/intelligence-health.ts.
 */
import {
  parseHealthReport,
  recordedEventCount,
  rowFor,
  unexplainedNotReporting,
  VERDICT_WORDS,
} from './healthReport';

const REPORT = [
  '## Nexus AI background record-keeping — not reporting',
  '',
  '| Check | Now | Expected | Verdict |',
  '|---|---|---|---|',
  '| Recording | ready | starts with the app | OK |',
  '| Recorded so far | 12,345 event(s) | more than 0 | OK |',
  '| In-site events | last seen 4h ago | within 3d | OK |',
  '| WP Engine site updates | nothing yet | within 14d | not reporting |',
  '| Chat context | last seen 2d ago | within 7d | OK |',
  '| Other sources | 1 (graph-backfill) | no liveness expectation set | OK |',
  '| Processing backlog | 0 waiting | within 500 | OK |',
  '| Access & Permissions mirror | 2 difference(s) | no differences | needs a check |',
  '| Site identity | available | available | OK |',
  '',
  '**Notes**',
  '- **WP Engine site updates** — nothing from this source has ever been recorded — expected when this source is not in use on this machine',
  '- **Access & Permissions mirror** — wpe.wpcli.production, wpe.push.production',
  '',
  '**Could not be measured**',
  '- fold lag: database is locked',
  '',
  '_Checked 2026-08-17T13:24:05.000Z._',
  '',
  '_Whatever this says, Nexus AI keeps working._',
].join('\n');

describe('parseHealthReport', () => {
  const parsed = parseHealthReport(REPORT);

  it('reads the overall verdict from the heading', () => {
    expect(parsed.worst).toBe('not reporting');
  });

  it('finds every table row and no header or separator row', () => {
    expect(parsed.rows).toHaveLength(9);
    expect(parsed.rows.map((r) => r.label)).not.toContain('Check');
  });

  it('splits each row into label, value, threshold and verdict', () => {
    expect(parsed.rows[2]).toEqual({
      label: 'In-site events',
      value: 'last seen 4h ago',
      threshold: 'within 3d',
      verdict: 'OK',
    });
  });

  it('reads the notes, keyed by the line they explain', () => {
    expect(parsed.notes['Access & Permissions mirror']).toBe(
      'wpe.wpcli.production, wpe.push.production'
    );
  });

  it('reads the could-not-be-measured list separately from the notes', () => {
    expect(parsed.couldNotMeasure).toEqual(['fold lag: database is locked']);
    expect(parsed.notes['fold lag']).toBeUndefined();
  });

  it('reads the checked-at stamp', () => {
    expect(parsed.checkedAt).toBe('2026-08-17T13:24:05.000Z');
  });

  it('returns nothing rather than inventing structure for a non-report', () => {
    // A parser that fabricates rows here would make the journey's row
    // assertions pass against a tool that returned an error string.
    const empty = parseHealthReport('Intelligence ledger unavailable.');
    expect(empty.rows).toEqual([]);
    expect(empty.worst).toBeUndefined();
  });

  it('every parsed verdict is one of the three controlled-vocabulary words', () => {
    for (const row of parsed.rows) expect(VERDICT_WORDS).toContain(row.verdict);
  });
});

describe('recordedEventCount — how a journey proves the ledger grew, without opening it', () => {
  it('reads the count through its thousands separators', () => {
    // 12,345 must not read as 12: the delta a journey measures would be
    // meaningless, and a wrong-but-plausible number is worse than none.
    expect(recordedEventCount(parseHealthReport(REPORT))).toBe(12345);
  });

  it('is undefined when the row is absent, never 0', () => {
    // 0 would read as "the ledger is empty" — a measurement, not a gap.
    const noLedgerLine = REPORT.split('\n')
      .filter((l) => !l.startsWith('| Recorded so far'))
      .join('\n');
    expect(recordedEventCount(parseHealthReport(noLedgerLine))).toBeUndefined();
  });
});

describe('rowFor', () => {
  it('finds a row by its exact label', () => {
    expect(rowFor(parseHealthReport(REPORT), 'Chat context')?.value).toBe('last seen 2d ago');
  });

  it('returns undefined for a label that is not present', () => {
    expect(rowFor(parseHealthReport(REPORT), 'Nonexistent line')).toBeUndefined();
  });
});

describe('unexplainedNotReporting — the journey\'s actual contract', () => {
  it('is empty when every "not reporting" line carries a note', () => {
    expect(unexplainedNotReporting(parseHealthReport(REPORT))).toEqual([]);
  });

  it('names a "not reporting" line that has no note', () => {
    const stripped = REPORT.split('\n')
      .filter((l) => !l.startsWith('- **WP Engine site updates**'))
      .join('\n');

    expect(unexplainedNotReporting(parseHealthReport(stripped))).toEqual([
      'WP Engine site updates',
    ]);
  });

  it('ignores lines that are OK or need a check — only silence needs explaining', () => {
    const noNotes = REPORT.split('\n')
      .filter((l) => !l.startsWith('- **'))
      .join('\n');

    // 'Access & Permissions mirror' is "needs a check" and loses its note here;
    // it must NOT be reported, or the contract would demand a note on every row.
    expect(unexplainedNotReporting(parseHealthReport(noNotes))).toEqual([
      'WP Engine site updates',
    ]);
  });
});
