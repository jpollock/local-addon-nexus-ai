/**
 * WP-18 · When did the running Local start?
 *
 * The startup-health-line journey needs a boot anchor: WP-17's line is written
 * once per boot, and asserting only that it "exists somewhere in the log" would
 * pass on a line written days ago by a build that has since regressed.
 *
 * I/O only — the parsing it depends on (`parsePsStart`) is pinned in
 * `startupLog.test.ts`. Returns null rather than guessing; the journey reports
 * a missing anchor in its own words instead of asserting against one it does
 * not have.
 */
import { execFileSync } from 'child_process';
import { parsePsStart } from './startupLog';

/** Patterns tried in order; the first that yields a pid wins. */
const PGREP_ATTEMPTS: Array<string[]> = [
  ['-x', 'Local'],
  ['-f', 'Local.app/Contents/MacOS/Local'],
];

function firstPid(): string | null {
  for (const args of PGREP_ATTEMPTS) {
    try {
      const out = execFileSync('pgrep', args, { encoding: 'utf-8' }).trim();
      const pid = out.split('\n')[0]?.trim();
      if (pid) return pid;
    } catch {
      /* pgrep exits 1 when nothing matches — try the next pattern */
    }
  }
  return null;
}

export function localProcessStart(): Date | null {
  const pid = firstPid();
  if (!pid) return null;
  try {
    return parsePsStart(execFileSync('ps', ['-p', pid, '-o', 'lstart='], { encoding: 'utf-8' }));
  } catch {
    return null;
  }
}
