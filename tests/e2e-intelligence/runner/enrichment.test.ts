/**
 * WP-18 · Unit pins for the enrichment reader.
 *
 * The journey's claim is "`find_sites_with_plugin` renders enrichment with
 * REAL observation ages" — so the reader has to tell an enriched cell from an
 * unenriched one. That distinction is the whole assertion: the tool renders
 * three different things in the Observed column (a ledger age with its trust
 * class, a legacy `indexed <date>`, or an em dash), and only the first proves
 * the ledger reached the surface. A reader that counted all three as
 * enrichment would pass with the intelligence core switched off, which is
 * exactly the additive-parity fallback the layer is built to have.
 *
 * Fixture shape taken from `find-sites-with-plugin.ts`'s rendering.
 */
import {
  ledgerObservedRows,
  parseObservedCell,
  parsePluginTable,
} from './enrichment';

const OUTPUT = [
  '## Sites with "akismet"',
  '',
  '| Site | Version | Status | Source | Observed |',
  '|------|---------|--------|--------|----------|',
  '| my-local-site | v5.3.1 | active | [local] | 4m ago (observed) |',
  '| another-site | v5.3 | inactive | [local] | indexed 2026-08-11 |',
  '| third-site | v5.2 | active | [local] | — |',
  '| prod-install | v5.3.1 | active | [wpe] | 9d ago (reported) ⚠ stale |',
  '',
  'Found in 4 of 120 sites (100 local, 20 remote).',
  'Freshness: 1 of 2 ledger-observed facts within SLO — 1 stale; consider a live re-check before acting on those.',
].join('\n');

describe('parsePluginTable', () => {
  const rows = parsePluginTable(OUTPUT);

  it('reads every data row and neither the header nor the separator', () => {
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => r.site)).toEqual([
      'my-local-site',
      'another-site',
      'third-site',
      'prod-install',
    ]);
  });

  it('keeps the source tag so a journey can tell local from remote', () => {
    expect(rows[3].source).toBe('[wpe]');
  });

  it('returns nothing for the tool\'s no-matches sentence', () => {
    // The "No sites have a plugin matching…" response has no table at all. If
    // this returned a row, every downstream assertion would run against
    // fabricated structure.
    expect(parsePluginTable('No sites have a plugin matching "nope" (searched 3 sites: 3 local, 0 remote).')).toEqual([]);
  });
});

describe('parseObservedCell — the enriched/unenriched distinction', () => {
  it('reads a ledger-observed cell into its age and trust class', () => {
    expect(parseObservedCell('4m ago (observed)')).toEqual({
      ageText: '4m ago',
      trust: 'observed',
      stale: false,
    });
  });

  it('reads the stale marker', () => {
    expect(parseObservedCell('9d ago (reported) ⚠ stale')).toEqual({
      ageText: '9d ago',
      trust: 'reported',
      stale: true,
    });
  });

  it('rejects the legacy content-index cell — that is NOT ledger enrichment', () => {
    // `indexed 2026-08-11` is what the tool renders with the intelligence core
    // absent. Counting it as enrichment is how this journey would certify a
    // dark ledger.
    expect(parseObservedCell('indexed 2026-08-11')).toBeNull();
  });

  it('rejects the em dash', () => {
    expect(parseObservedCell('—')).toBeNull();
  });
});

describe('ledgerObservedRows', () => {
  it('keeps only the rows the ledger actually stamped', () => {
    const enriched = ledgerObservedRows(parsePluginTable(OUTPUT));
    expect(enriched.map((r) => r.site)).toEqual(['my-local-site', 'prod-install']);
  });

  it('is empty when nothing was enriched, so the journey fails rather than passes', () => {
    const legacyOnly = OUTPUT.split('\n')
      .filter((l) => !l.includes('ago ('))
      .join('\n');
    expect(ledgerObservedRows(parsePluginTable(legacyOnly))).toEqual([]);
  });
});
