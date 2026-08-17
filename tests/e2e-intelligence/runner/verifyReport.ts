/**
 * WP-18 · Reading `verify_site_live`'s reconciliation report.
 *
 * The tool re-observes a site through the real transport, diffs it against the
 * cached twins, emits fresh observations and reports the delta. The journey
 * asserts both halves — reconciled AND emitted — so both are recovered here.
 *
 * Nothing defaults to 0. A rendering that never appeared must read as *not
 * measured*, because "the tool emitted nothing" is a defect and "the rendering
 * changed shape" is a test-maintenance problem, and a 0 would merge them.
 */

export interface VerifyDelta {
  slug: string;
  /** `first observation` | `twin updated` | `recorded as removed`. */
  note: string;
}

export interface ParsedVerifyReport {
  siteLabel?: string;
  /** How many plugins were read live. */
  observedLive?: number;
  /** How many matched the cached twins exactly. */
  unchanged?: number;
  /** How many fresh observations were written to the ledger. */
  recorded?: number;
  /** The `source.system` those observations were stamped with. */
  observationSystem?: string;
  /** True when the tool reported the ledger's picture was already accurate. */
  noDrift: boolean;
  deltas: VerifyDelta[];
}

const TITLE = /^##\s+Live verification\s+—\s+(.+?)\s*$/;
const OBSERVED = /^Observed\s+(\d+)\s+plugins live\s+\(([^)]*)\)\.\s+(\d+)\s+matched/;
const RECORDED = /^Recorded\s+(\d+)\s+fresh observations\s+\(trust:\s*[^,]+,\s*via\s+([^)]+)\)/;
const NO_DRIFT = /^✓\s+No drift:/;

export function parseVerifyReport(markdown: string): ParsedVerifyReport {
  const out: ParsedVerifyReport = { noDrift: false, deltas: [] };

  for (const raw of markdown.split('\n')) {
    const line = raw.trim();

    const title = TITLE.exec(line);
    if (title) {
      out.siteLabel = title[1];
      continue;
    }

    const observed = OBSERVED.exec(line);
    if (observed) {
      out.observedLive = Number(observed[1]);
      out.unchanged = Number(observed[3]);
      continue;
    }

    const recorded = RECORDED.exec(line);
    if (recorded) {
      out.recorded = Number(recorded[1]);
      out.observationSystem = recorded[2].trim();
      continue;
    }

    if (NO_DRIFT.test(line)) {
      out.noDrift = true;
      continue;
    }

    if (line.startsWith('|') && line.endsWith('|')) {
      const cells = line.slice(1, -1).split('|').map((c) => c.trim());
      if (cells.length !== 4) continue;
      if (cells[0] === 'Plugin') continue; // header
      if (cells.every((c) => /^-+$/.test(c))) continue; // separator
      out.deltas.push({ slug: cells[0], note: cells[3] });
    }
  }

  return out;
}
