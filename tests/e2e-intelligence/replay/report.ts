/**
 * WP-18 · The replay's verdict and its rendering.
 *
 * Read once, in a terminal, by a human deciding whether to release. So: the
 * verdict watches every problem category (one that watched a subset would
 * certify the rest), and nothing is dropped from a list without saying how
 * much was dropped — a silently truncated failure list reads as a small
 * failure.
 */
import { TwinSetDiff } from './invariants';

export interface ReplayProblems {
  /** Set when the replay itself threw — the loudest possible failure. */
  threw?: string;
  monotonic: string[];
  drift: string[];
  twinRows: string[];
  counts: string[];
  diff: TwinSetDiff;
}

export interface ReplayResult {
  /** The COPY that was read. The live ledger is never opened for writing. */
  ledgerPath: string;
  events: number;
  stateObservations: number;
  driftEvents: number;
  liveTwins: number;
  replayedTwins: number;
  entities: number;
  foldNames: string[];
  durationMs: number;
  problems: ReplayProblems;
}

export function replayPassed(result: ReplayResult): boolean {
  const p = result.problems;
  return (
    !p.threw &&
    p.monotonic.length === 0 &&
    p.drift.length === 0 &&
    p.twinRows.length === 0 &&
    p.counts.length === 0 &&
    p.diff.identical
  );
}

const MAX_LINES = 20;

function section(title: string, lines: string[]): string[] {
  if (lines.length === 0) return [];
  const shown = lines.slice(0, MAX_LINES);
  const withheld = lines.length - shown.length;
  return [
    '',
    `${title} (${lines.length}):`,
    ...shown.map((l) => `  - ${l}`),
    ...(withheld > 0 ? [`  … ${withheld} more not shown`] : []),
  ];
}

export function formatReplayReport(result: ReplayResult): string {
  const passed = replayPassed(result);
  const p = result.problems;
  const rule = '='.repeat(78);

  const lines = [
    rule,
    `REAL-LEDGER REPLAY — ${passed ? 'PASS' : 'FAIL'}`,
    rule,
    '',
    `ledger copy:        ${result.ledgerPath}`,
    `events replayed:    ${result.events} (${result.stateObservations} state observations, ${result.driftEvents} drift)`,
    `folds run:          ${result.foldNames.join(', ') || '(none)'}`,
    `twins live:         ${result.liveTwins}`,
    `twins replayed:     ${result.replayedTwins} over ${result.entities} entities`,
    `took:               ${result.durationMs} ms`,
  ];

  if (p.threw) lines.push('', `THREW: ${p.threw}`);

  lines.push(
    ...section('Non-monotonic event ids', p.monotonic),
    ...section('Malformed drift events', p.drift),
    ...section('Malformed twin rows', p.twinRows),
    ...section('Counts outside the stated bounds', p.counts),
    ...section('Twin facts the replay did not reproduce', p.diff.missing),
    ...section('Twin facts the replay produced that live does not have', p.diff.extra),
    ...section('Twin facts that differ', p.diff.differing)
  );

  lines.push('', rule);
  return lines.join('\n');
}
