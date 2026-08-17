/**
 * WP-18 · Journey 3 — enrichment renders with REAL observation ages.
 *
 * `find_sites_with_plugin` is the worked example of the enrich-don't-replace
 * rule: the legacy caches answer the question, and the ledger adds when each
 * fact was last observed, how it was sourced, and whether it is still inside
 * its freshness SLO. The failure this journey exists to catch is the quiet one
 * — the core absent or dark, the tool falling back to its legacy rendering, and
 * every consumer seeing a plausible answer with no provenance in it.
 *
 * Which is why the assertion is on the ENRICHED cell shape specifically. The
 * tool renders `indexed 2026-08-11` from the content index when the ledger has
 * nothing; counting that as enrichment would certify a dark ledger, so
 * `parseObservedCell` rejects it (pinned in enrichment.test.ts).
 */
import { loadConnectionInfo, NexusMcpClient } from '../../e2e-cli/helpers/mcp-client';
import { ledgerObservedRows, parseObservedCell, parsePluginTable } from '../runner/enrichment';
import { firstRunningLocalSite } from '../runner/fleet';
import { parseVerifyReport } from '../runner/verifyReport';

const client = new NexusMcpClient(loadConnectionInfo()!);

/** Envelope trust vocabulary — an enriched cell must render one of these. */
const TRUST_CLASSES = ['observed', 'reported', 'derived', 'asserted', 'inferred'];

/**
 * Plugins common enough that at least one is somewhere in a real fleet.
 * Candidates rather than a single fixture: this journey reads the developer's
 * own sites, and a fixed plugin nobody has would fail as a missing plugin
 * rather than as missing enrichment.
 */
const FALLBACK_SLUGS = [
  'akismet',
  'hello-dolly',
  'woocommerce',
  'jetpack',
  'wordpress-seo',
  'contact-form-7',
];

describe('journey: find_sites_with_plugin renders ledger provenance', () => {
  let verifiedSite: string | undefined;
  let query: string | undefined;
  let raw = '';

  beforeAll(async () => {
    // Seed the ledger with a guaranteed-fresh observation first, so the fresh
    // age sub-check below has something recent to find. Sanctioned write path.
    verifiedSite = firstRunningLocalSite(await client.callTool('nexus_list_sites', {}));
    const seeded = verifiedSite
      ? parseVerifyReport(await client.callTool('verify_site_live', { site: verifiedSite }))
      : undefined;

    // Slugs the live check just touched come first — they are certain to be in
    // the ledger — then the common fallbacks.
    const candidates = [...(seeded?.deltas.map((d) => d.slug) ?? []), ...FALLBACK_SLUGS];

    for (const slug of candidates) {
      const output = await client.callTool('find_sites_with_plugin', { plugin: slug });
      if (ledgerObservedRows(parsePluginTable(output)).length > 0) {
        query = slug;
        raw = output;
        break;
      }
    }
    if (query) console.log(`\n--- find_sites_with_plugin(${query}) ---\n${raw}\n---\n`);
  });

  it('found at least one plugin whose facts the ledger has observed', () => {
    if (!query) {
      throw new Error(
        'No enrichment on any candidate plugin. Either the intelligence core is not running ' +
          '(check nexus_intelligence_health) or none of these plugins is on a site the ledger ' +
          `has observed: ${FALLBACK_SLUGS.join(', ')}.`
      );
    }
    expect(ledgerObservedRows(parsePluginTable(raw)).length).toBeGreaterThan(0);
  });

  it('renders a real age and a real trust class on every enriched row', () => {
    for (const row of ledgerObservedRows(parsePluginTable(raw))) {
      const cell = parseObservedCell(row.observed)!;
      expect(cell.ageText).toMatch(/^(\d+[smhd] ago|just now)$/);
      expect(TRUST_CLASSES).toContain(cell.trust);
    }
  });

  it('summarises freshness over exactly the rows it enriched', () => {
    // The tool's own footer must agree with the table above it. A count that
    // disagreed would mean the enrichment loop and the summary were reading
    // different sets — and the summary is what a model relays to a user.
    const enriched = ledgerObservedRows(parsePluginTable(raw));
    const summary = raw
      .split('\n')
      .find((l) => l.startsWith('Freshness:'));
    expect(summary).toBeDefined();

    const all = /all (\d+) ledger-observed facts/.exec(summary!);
    const partial = /(\d+) of (\d+) ledger-observed facts/.exec(summary!);
    const claimed = Number(all?.[1] ?? partial?.[2]);
    expect(claimed).toBe(enriched.length);
  });

  it('marks a fact past its SLO as stale rather than presenting it as current', () => {
    // Not "some row must be stale" — a healthy fleet may have none. The pin is
    // that the two renderings are consistent: a summary claiming stale facts
    // must have stale rows to point at.
    const enriched = ledgerObservedRows(parsePluginTable(raw));
    const summary = raw.split('\n').find((l) => l.startsWith('Freshness:')) ?? '';
    const staleClaimed = Number(/— (\d+) stale/.exec(summary)?.[1] ?? 0);
    const staleRows = enriched.filter((r) => parseObservedCell(r.observed)!.stale).length;
    expect(staleRows).toBe(staleClaimed);
  });

  it('shows a freshly re-observed site with a minutes-scale age', () => {
    // The strongest available proof that the age is computed and not a
    // constant: the site journey 3 just re-observed, if it appears here, must
    // read in minutes. When it does not appear (the site is not in the content
    // index, so it produces no cache row to enrich), that is DISCLOSED rather
    // than silently passed.
    const enriched = ledgerObservedRows(parsePluginTable(raw));
    const justChecked = enriched.find((r) => r.site === verifiedSite);
    if (!justChecked) {
      console.log(
        `[disclosure] ${verifiedSite ?? 'the verified site'} does not appear in the "${query}" ` +
          'results, so the fresh-age sub-check did not apply. The enrichment assertions above ' +
          'still ran against the other rows.'
      );
      return;
    }
    const cell = parseObservedCell(justChecked.observed)!;
    expect(cell.ageText).toMatch(/^(just now|\d+m ago)$/);
    expect(cell.stale).toBe(false);
  });
});
