/**
 * WP-18 · Journey 2 — a live re-check reconciles AND the ledger takes the write.
 *
 * `verify_site_live` is the remedy every staleness disclosure points at:
 * re-observe the site through the real transport, diff against the cached
 * twins, and record fresh provenance-stamped observations. The claim worth
 * verifying end-to-end is the second half — that checking freshness actually
 * makes the system fresher — because that is the half that can fail silently.
 *
 * THE LEDGER IS NOT OPENED HERE. While Local holds the addon, better-sqlite3 in
 * this tree is built for Electron, so a direct read would fail with an ABI error
 * that reads as a broken layer. The evidence comes from the live health surface
 * instead: its whole-ledger event count before and after, and its "Other
 * sources" line, which names any producer with no liveness SLO — exactly what
 * `live-recheck:local` is.
 *
 * This is the one sanctioned write in the harness, and it writes only
 * observations. No site is mutated.
 */
import { loadConnectionInfo, NexusMcpClient } from '../../e2e-cli/helpers/mcp-client';
import { firstRunningLocalSite } from '../runner/fleet';
import { parseHealthReport, recordedEventCount, rowFor } from '../runner/healthReport';
import { parseVerifyReport } from '../runner/verifyReport';

const client = new NexusMcpClient(loadConnectionInfo()!);

describe('journey: verify_site_live reconciles and emits', () => {
  let site: string | undefined;
  let before: number | undefined;
  let raw: string;

  beforeAll(async () => {
    site = firstRunningLocalSite(await client.callTool('nexus_list_sites', {}));
    if (!site) return;
    before = recordedEventCount(parseHealthReport(await client.callTool('nexus_intelligence_health', {})));
    raw = await client.callTool('verify_site_live', { site });
    console.log(`\n--- verify_site_live(${site}) ---\n${raw}\n---\n`);
  });

  it('found a running local site to check', () => {
    // A hard failure, not a skip: without a running site this journey verified
    // nothing, and a green here would say otherwise.
    if (!site) {
      throw new Error(
        'No running local site. `verify_site_live` needs one by design — start any site in ' +
          'Local (or `nexus sites start <name>@local`) and re-run.'
      );
    }
    expect(typeof site).toBe('string');
  });

  it('reports the reconciliation for the site asked about', () => {
    const parsed = parseVerifyReport(raw);
    expect(parsed.siteLabel).toBe(site);
    expect(parsed.observedLive).toBeGreaterThan(0);
  });

  it('read the site through the LOCAL transport, not a cache', () => {
    expect(parseVerifyReport(raw).observationSystem).toBe('live-recheck:local');
  });

  it('recorded one fresh observation per plugin it saw', () => {
    const parsed = parseVerifyReport(raw);
    // `recorded` = live plugins + facts newly marked removed, so it is never
    // fewer than what was observed live.
    expect(parsed.recorded).toBeGreaterThanOrEqual(parsed.observedLive!);
  });

  it('the ledger actually grew by at least what the tool said it wrote', () => {
    // The claim under test. Measured through the health surface's whole-ledger
    // count — `>=` because other producers may emit while this runs, never `>`
    // alone, because that would pass on someone else's event.
    return client.callTool('nexus_intelligence_health', {}).then((after) => {
      const parsed = parseVerifyReport(raw);
      const now = recordedEventCount(parseHealthReport(after));
      expect(before).toBeDefined();
      expect(now).toBeDefined();
      expect(now! - before!).toBeGreaterThanOrEqual(parsed.recorded!);
    });
  });

  it('the health surface now names live-recheck as a source it has heard from', () => {
    return client.callTool('nexus_intelligence_health', {}).then((after) => {
      const others = rowFor(parseHealthReport(after), 'Other sources');
      expect(others).toBeDefined();
      // The tool renders unlisted producers by their system id, deliberately
      // (see intelligence-health.ts's disclosed exception).
      expect(others!.value).toContain('live-recheck:local');
    });
  });

  it('every difference it reported carries a note explaining what was done', () => {
    const notes = new Set(['first observation', 'twin updated', 'recorded as removed']);
    for (const delta of parseVerifyReport(raw).deltas) {
      expect(notes.has(delta.note)).toBe(true);
      expect(delta.slug).not.toBe('');
    }
  });
});
