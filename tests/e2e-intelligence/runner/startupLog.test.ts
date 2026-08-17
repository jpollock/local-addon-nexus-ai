/**
 * WP-18 · Unit pins for the startup-health-line reader.
 *
 * WP-17 shipped `formatHealthLogLine` and wired it into `src/main/index.ts`,
 * but nothing pinned that the line ever reaches a log file — the survivor this
 * packet inherits. The journey asserts it against the LIVE log; this file pins
 * the reading of it, because a locator that looks in the wrong place, or a
 * parser that matches nothing, both fail the same way the bug would: silently,
 * as an absent line.
 *
 * The candidate-path pin is not hypothetical. Measured on this machine
 * 2026-08-17: `~/Library/Logs/local-lightning.log` was written that week while
 * `~/Library/Application Support/Local/local-lightning.log` had been frozen
 * since May. Reading only the second finds a dead file and reports "no startup
 * line" — the same class of bug as the EventLog's UTC filenames.
 */
import {
  findStartupHealthLines,
  localLogCandidates,
  parsePsStart,
  STARTUP_HEALTH_MARKER,
} from './startupLog';

const HOME = '/Users/someone';

describe('localLogCandidates', () => {
  it('includes the VERBOSE log — the only file an info line reaches', () => {
    // MEASURED 2026-08-17 against a running Local: `local-lightning.log`
    // carries warn and error only, and WP-17's health line is `logger.info`.
    // A locator that knew only the main log reports "no startup line" against
    // a wire that works — a false RED, the mirror image of the false green
    // this journey exists to prevent. Both were observed on this machine
    // within one session.
    expect(localLogCandidates('darwin', HOME)[0]).toBe(
      `${HOME}/Library/Logs/local-lightning-verbose.log`
    );
  });

  it('includes both known darwin roots — one of them is routinely stale', () => {
    const candidates = localLogCandidates('darwin', HOME);
    expect(candidates).toContain(`${HOME}/Library/Logs/local-lightning.log`);
    expect(candidates).toContain(
      `${HOME}/Library/Application Support/Local/local-lightning-verbose.log`
    );
    expect(candidates).toContain(
      `${HOME}/Library/Application Support/Local/local-lightning.log`
    );
  });

  it('puts every ~/Library/Logs path before the Application Support ones', () => {
    // Measured 2026-08-17: the Application Support copies had not been written
    // since May while ~/Library/Logs was current.
    const candidates = localLogCandidates('darwin', HOME);
    const lastLogs = candidates.map((c) => c.includes('/Library/Logs/')).lastIndexOf(true);
    const firstAppSupport = candidates.map((c) => c.includes('Application Support')).indexOf(true);
    expect(lastLogs).toBeLessThan(firstAppSupport);
  });

  it('returns platform-appropriate paths elsewhere, never the darwin ones', () => {
    const linux = localLogCandidates('linux', HOME);
    expect(linux.length).toBeGreaterThan(0);
    expect(linux.join('\n')).not.toContain('Library/Logs');
  });
});

describe('findStartupHealthLines', () => {
  const JSON_LINE = JSON.stringify({
    level: 'info',
    message:
      '[Intelligence] health: STALE — core=OK(ready) ledger=OK(12,345 event(s)) ' +
      'producer:wp-webhook=STALE(last seen 5d ago) fold:state-twin/1=OK(0 waiting) ' +
      'mirror=OK(no differences) entities=OK(available) [1 check error(s)]',
    timestamp: '2026-08-17T18:52:22.962Z',
  });

  const LOG = [
    JSON.stringify({ level: 'info', message: '[NexusAI] Addon loading...', timestamp: '2026-08-17T18:52:20.000Z' }),
    JSON.stringify({ level: 'error', message: '[Intelligence] init failed (non-fatal): boom', timestamp: '2026-08-17T18:52:21.000Z' }),
    JSON_LINE,
  ].join('\n');

  it('finds the health line and ignores every other [Intelligence] line', () => {
    const found = findStartupHealthLines(LOG);
    expect(found).toHaveLength(1);
    expect(found[0].raw).toContain(STARTUP_HEALTH_MARKER);
  });

  it('reads the timestamp from the JSON envelope Local writes', () => {
    expect(findStartupHealthLines(LOG)[0].timestamp).toBe('2026-08-17T18:52:22.962Z');
  });

  it('reads the overall verdict', () => {
    expect(findStartupHealthLines(LOG)[0].worst).toBe('STALE');
  });

  it('reads every check key, including keys carrying colons and slashes', () => {
    // 'producer:wp-webhook' and 'fold:state-twin/1' are the real key shapes;
    // a naive \w+ key pattern truncates both and the journey's coverage
    // assertion then passes against half a report.
    expect(findStartupHealthLines(LOG)[0].keys).toEqual([
      'core',
      'ledger',
      'producer:wp-webhook',
      'fold:state-twin/1',
      'mirror',
      'entities',
    ]);
  });

  it('does not mistake a value containing parentheses for a key', () => {
    // 'ledger=OK(12,345 event(s))' has a nested '(' — proof the key scan is
    // anchored on the verdict word rather than on the next '='.
    expect(findStartupHealthLines(LOG)[0].keys).not.toContain('s');
  });

  it('reads a plain (non-JSON) line too, with no timestamp rather than a fake one', () => {
    const plain = '2026-08-17 [Intelligence] health: OK — core=OK(ready)';
    const found = findStartupHealthLines(plain);
    expect(found).toHaveLength(1);
    expect(found[0].worst).toBe('OK');
    expect(found[0].timestamp).toBeUndefined();
  });

  it('finds nothing in a log that has no health line', () => {
    expect(findStartupHealthLines('nothing to see here')).toEqual([]);
  });

  it('returns every occurrence, newest last, so a caller can take the latest boot', () => {
    expect(findStartupHealthLines([LOG, JSON_LINE].join('\n'))).toHaveLength(2);
  });
});

describe('parsePsStart — the boot anchor', () => {
  it('parses the `ps -o lstart=` format', () => {
    const parsed = parsePsStart('Sat Aug 16 11:01:23 2026');
    expect(parsed?.toISOString().slice(0, 10)).toBe('2026-08-16');
  });

  it('tolerates the leading whitespace ps pads with', () => {
    expect(parsePsStart('  Sat Aug 16 11:01:23 2026  ')).toBeInstanceOf(Date);
  });

  it('returns null for output that is not a date, never `new Date(NaN)`', () => {
    // A NaN Date compares false against everything, so an unparseable anchor
    // would silently make the journey's "newer than boot" check unfalsifiable.
    expect(parsePsStart('')).toBeNull();
    expect(parsePsStart('no such process')).toBeNull();
  });
});
