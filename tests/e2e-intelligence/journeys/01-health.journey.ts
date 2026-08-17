/**
 * WP-18 · Journey 1 — the layer reports on itself, and said so at boot.
 *
 * Drives WP-17's `nexus_intelligence_health` against the LIVE addon and closes
 * the survivor WP-17 left behind: the startup log line was wired into
 * `src/main/index.ts` and its FORMATTER was pinned, but nothing pinned that the
 * line ever reaches a log file. Answering "was the layer alive at boot?" from a
 * log alone is the entire reason that line exists — it is the question the M1
 * ABI incident had no way to answer — so an unpinned wire is the same silence
 * one level up.
 *
 * The report assertions are deliberately about EXPLANATION, not about
 * everything being green. A developer machine with no WP Engine account
 * legitimately shows "not reporting" on the WPE producer forever. What is never
 * legitimate is a line that says "not reporting" and says nothing about why.
 */
import * as fs from 'fs';
import * as os from 'os';

import { loadConnectionInfo, NexusMcpClient } from '../../e2e-cli/helpers/mcp-client';
import {
  parseHealthReport,
  recordedEventCount,
  rowFor,
  unexplainedNotReporting,
  VERDICT_WORDS,
} from '../runner/healthReport';
import { findStartupHealthLines, localLogCandidates } from '../runner/startupLog';

const client = new NexusMcpClient(loadConnectionInfo()!);

describe('journey: nexus_intelligence_health reports on the live layer', () => {
  let raw: string;

  beforeAll(async () => {
    raw = await client.callTool('nexus_intelligence_health', {});
    console.log(`\n--- nexus_intelligence_health ---\n${raw}\n---\n`);
  });

  it('renders a report with rows, not an error string', () => {
    const report = parseHealthReport(raw);
    // Everything below asserts over `rows`; without this the suite could pass
    // against a tool that returned "Intelligence ledger unavailable."
    expect(report.rows.length).toBeGreaterThanOrEqual(3);
    expect(report.worst).toBeDefined();
  });

  it('speaks only the controlled vocabulary — no internal OK/STALE/DARK leaks', () => {
    for (const row of parseHealthReport(raw).rows) {
      expect(VERDICT_WORDS).toContain(row.verdict);
    }
  });

  it('has the core up: recording started with the app', () => {
    const recording = rowFor(parseHealthReport(raw), 'Recording');
    expect(recording?.value).toBe('ready');
    expect(recording?.verdict).toBe('OK');
  });

  it('has recorded events — a started core with an empty ledger is the M1 shape', () => {
    expect(recordedEventCount(parseHealthReport(raw))).toBeGreaterThan(0);
  });

  it('explains every line that reads "not reporting"', () => {
    // The contract, stated as the packet states it: no silence this journey
    // cannot itself account for. Every DARK branch in health.ts sets a detail,
    // so a bare one means a new branch shipped without an explanation.
    expect(unexplainedNotReporting(parseHealthReport(raw))).toEqual([]);
  });

  it('measured every check it listed', () => {
    // "Could not be measured" entries are checks that threw. They are rendered
    // rather than dropped precisely so they are not mistaken for passes.
    expect(parseHealthReport(raw).couldNotMeasure).toEqual([]);
  });

  it('stamps the report with when it was checked', () => {
    const checkedAt = parseHealthReport(raw).checkedAt;
    expect(checkedAt).toBeDefined();
    expect(Number.isNaN(Date.parse(checkedAt!))).toBe(false);
  });
});

describe('journey: the startup health line reached the log (WP-17 survivor)', () => {
  // EVERY candidate is searched, not just the newest file. Local splits its
  // log by level — the health line is `logger.info`, so it lands only in the
  // verbose file — and a newest-file-wins pick would read the main log, find
  // nothing, and red against a wire that works.
  const searched = localLogCandidates(os.platform(), os.homedir()).filter((p) => fs.existsSync(p));
  const hits = searched
    .map((p) => ({ path: p, lines: findStartupHealthLines(fs.readFileSync(p, 'utf-8')) }))
    .filter((h) => h.lines.length > 0);

  /** The most recently stamped health line across every log that has one. */
  const newestLine = hits
    .flatMap((h) => h.lines.map((l) => ({ ...l, path: h.path })))
    .sort((a, b) => Date.parse(a.timestamp ?? '') - Date.parse(b.timestamp ?? ''))
    .pop();

  it('found a startup health line in one of Local\'s logs', () => {
    if (!newestLine) {
      throw new Error(
        'No "[Intelligence] health:" line in any Local log. Either the layer did not start, or ' +
          'src/main/index.ts no longer logs it. Searched:\n  ' +
          (searched.join('\n  ') || '(no Local log file exists at all)')
      );
    }
    console.log(`[startup-log] found in ${newestLine.path}`);
    console.log(`[startup-log] ${newestLine.raw}`);
  });

  it('logged that line during the CURRENT boot, not a previous one', () => {
    const bootIso = process.env.E2E_INTEL_LOCAL_BOOT_ISO;
    if (!bootIso) {
      throw new Error(
        'No boot anchor: the running Local process could not be located, so "logged at this ' +
          'boot" cannot be checked. The health line may be days old. Re-run once `pgrep -x Local` ' +
          'finds the process.'
      );
    }
    expect(newestLine!.timestamp).toBeDefined();
    // A minute of slack: the log stamp and `ps` read different clocks, and the
    // line is written a moment into startup.
    expect(Date.parse(newestLine!.timestamp!)).toBeGreaterThan(Date.parse(bootIso) - 60_000);
  });

  it('carries the checks the report carries — core and ledger at minimum', () => {
    expect(newestLine!.keys).toContain('core');
    expect(newestLine!.keys).toContain('ledger');
    expect(newestLine!.worst).toMatch(/^(OK|STALE|DARK)$/);
  });

  it('measured every check at boot too', () => {
    expect(newestLine!.checkErrors).toBe(0);
  });
});
