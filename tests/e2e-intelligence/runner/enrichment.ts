/**
 * WP-18 · Reading `find_sites_with_plugin`'s Observed column.
 *
 * The tool renders THREE different things there and only one of them proves
 * the ledger reached the surface:
 *
 *   `4m ago (observed)`      ← a twin fact: age + trust class, optionally ⚠ stale
 *   `indexed 2026-08-11`     ← the legacy content-index date, rendered when the
 *                              intelligence core is absent (additive parity)
 *   `—`                      ← nothing known
 *
 * Treating the second as enrichment would let the journey pass against a dark
 * ledger, which is the failure it exists to catch. So the distinction lives
 * here, in one pinned place, rather than in an ad-hoc regex inside a journey.
 */

export interface PluginRow {
  site: string;
  version: string;
  status: string;
  source: string;
  observed: string;
}

export interface ObservedCell {
  /** The rendered age, e.g. `4m ago` — kept as text; the tool rounds. */
  ageText: string;
  /** The envelope's trust class, as rendered. */
  trust: string;
  /** True when the tool flagged the fact as past its freshness SLO. */
  stale: boolean;
}

/** `<age> ago (<trust>)` with an optional stale marker — the enriched shape. */
const OBSERVED = /^(\d+[smhd]\s+ago|just now)\s+\(([a-z-]+)\)(\s*⚠\s*stale)?$/;

export function parsePluginTable(markdown: string): PluginRow[] {
  const rows: PluginRow[] = [];
  for (const raw of markdown.split('\n')) {
    const line = raw.trim();
    if (!line.startsWith('|') || !line.endsWith('|')) continue;
    const cells = line.slice(1, -1).split('|').map((c) => c.trim());
    if (cells.length !== 5) continue;
    if (cells[0] === 'Site') continue; // header
    if (cells.every((c) => /^-+$/.test(c))) continue; // separator
    rows.push({
      site: cells[0],
      version: cells[1],
      status: cells[2],
      source: cells[3],
      observed: cells[4],
    });
  }
  return rows;
}

/** The parsed enrichment, or null when the cell is not ledger-stamped. */
export function parseObservedCell(cell: string): ObservedCell | null {
  const m = OBSERVED.exec(cell.trim());
  if (!m) return null;
  return { ageText: m[1], trust: m[2], stale: !!m[3] };
}

/** Only the rows the intelligence ledger actually stamped. */
export function ledgerObservedRows(rows: PluginRow[]): PluginRow[] {
  return rows.filter((r) => parseObservedCell(r.observed) !== null);
}
