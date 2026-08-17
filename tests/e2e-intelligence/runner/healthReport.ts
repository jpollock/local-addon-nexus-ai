/**
 * WP-18 · Reading `nexus_intelligence_health`'s rendering back into structure.
 *
 * The tool renders markdown for a human; the journey needs to assert over it.
 * Parsing the rendered surface rather than calling `collectIntelligenceHealth`
 * directly is deliberate: the journey's subject IS the live surface — the
 * rendering, the vocabulary translation and the tool registration included.
 * A journey that imported the host module would pass while the MCP tool was
 * unregistered, which is precisely the class of gap layer 5 exists to close.
 *
 * The parser must never invent structure. Everything downstream asserts over
 * `rows`, so a parser that returned rows for a non-report would make those
 * assertions vacuous — pinned in `healthReport.test.ts`.
 */

/** Controlled Vocabulary v1 — the only verdict words the tool ever prints. */
export const VERDICT_WORDS = ['OK', 'needs a check', 'not reporting'] as const;
export type VerdictWord = (typeof VERDICT_WORDS)[number];

/** The one that means "this check is silent" — the journey's subject. */
export const NOT_REPORTING: VerdictWord = 'not reporting';

export interface HealthRow {
  label: string;
  value: string;
  threshold: string;
  verdict: string;
}

export interface ParsedHealthReport {
  /** The heading's overall verdict; undefined when the text is not a report. */
  worst?: string;
  rows: HealthRow[];
  /** Notes section, keyed by the row label they explain. */
  notes: Record<string, string>;
  /** The "Could not be measured" list — checks that did not run at all. */
  couldNotMeasure: string[];
  checkedAt?: string;
}

const HEADING = /^##\s+Nexus AI background record-keeping\s+—\s+(.+?)\s*$/;
const NOTE = /^-\s+\*\*(.+?)\*\*\s+—\s+(.*)$/;
const CHECKED_AT = /^_Checked\s+(.+?)\._$/;

export function parseHealthReport(markdown: string): ParsedHealthReport {
  const rows: HealthRow[] = [];
  const notes: Record<string, string> = {};
  const couldNotMeasure: string[] = [];
  let worst: string | undefined;
  let checkedAt: string | undefined;
  let section: 'none' | 'notes' | 'errors' = 'none';

  for (const raw of markdown.split('\n')) {
    const line = raw.trim();

    const heading = HEADING.exec(line);
    if (heading) {
      worst = heading[1];
      continue;
    }

    if (line === '**Notes**') {
      section = 'notes';
      continue;
    }
    if (line === '**Could not be measured**') {
      section = 'errors';
      continue;
    }

    const stamp = CHECKED_AT.exec(line);
    if (stamp) {
      checkedAt = stamp[1];
      section = 'none';
      continue;
    }

    if (line.startsWith('|') && line.endsWith('|')) {
      const cells = line.slice(1, -1).split('|').map((c) => c.trim());
      if (cells.length !== 4) continue;
      if (cells[0] === 'Check') continue; // header
      if (cells.every((c) => /^-+$/.test(c))) continue; // separator
      rows.push({ label: cells[0], value: cells[1], threshold: cells[2], verdict: cells[3] });
      continue;
    }

    if (line.startsWith('- ')) {
      if (section === 'errors') {
        couldNotMeasure.push(line.slice(2).trim());
        continue;
      }
      const note = NOTE.exec(line);
      if (note) notes[note[1]] = note[2];
    }
  }

  return { worst, rows, notes, couldNotMeasure, checkedAt };
}

/**
 * Labels reading *not reporting* with nothing said about why.
 *
 * This is the health journey's actual contract, and it is not vacuous: every
 * DARK line in `health.ts` sets a `detail`, so a silent line here means either
 * a new DARK branch shipped without an explanation or the notes rendering
 * broke. "Not reporting, no reason given" is the shape the M1 incident wore.
 *
 * Keyed by label, so two lines sharing one label (several folds all render as
 * *Processing backlog*) share a note. Accepted: one explanation for a repeated
 * label is still an explanation, and the alternative — demanding a note per
 * row — would fail on a legitimately-rendered report.
 */
export function unexplainedNotReporting(report: ParsedHealthReport): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of report.rows) {
    if (row.verdict !== NOT_REPORTING) continue;
    if (report.notes[row.label]) continue;
    if (seen.has(row.label)) continue;
    seen.add(row.label);
    out.push(row.label);
  }
  return out;
}

/** The first row with this exact label, or undefined. */
export function rowFor(report: ParsedHealthReport, label: string): HealthRow | undefined {
  return report.rows.find((r) => r.label === label);
}

/**
 * The "Recorded so far" event count, as a number.
 *
 * `ledgerLine` renders it through `toLocaleString('en-US')`, so the thousands
 * separators have to come back out before two readings can be compared — which
 * is how a journey proves the ledger gained events without opening the ledger
 * file. (It cannot: while Local holds the ledger, better-sqlite3 in this
 * process is built for the other Node ABI. See the README.)
 *
 * Undefined, never 0, when the row is missing: a 0 here would read as an empty
 * ledger — a measurement — rather than as a failure to measure.
 */
export function recordedEventCount(report: ParsedHealthReport): number | undefined {
  const row = rowFor(report, 'Recorded so far');
  if (!row) return undefined;
  const digits = row.value.replace(/[^0-9]/g, '');
  return digits === '' ? undefined : Number(digits);
}

