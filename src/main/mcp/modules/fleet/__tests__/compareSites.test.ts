/**
 * WP-02 — compare_sites twin enrichment.
 *
 * Fixture shape follows findSitesWithPlugin.test.ts: a real intelligence core
 * on a temp dir, an in-memory graph, runGraphBackfill to seed twins, a wait for
 * the debounced fold, partial service mocks cast `as never`.
 *
 * The one deliberate addition is the legacy-parity assertion: the tool is run
 * ONCE before the core is registered, and the enriched run must begin with that
 * exact output. Enrichment is additive by contract, and "additive" is a claim a
 * test can actually pin rather than a comment asserting itself.
 */
import Database from 'better-sqlite3';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { initIntelligenceCore } from '../../../../intelligence-host/bootstrap';
import { setIntelligenceCore } from '../../../../intelligence-host/coreRegistry';
import { runGraphBackfill } from '../../../../intelligence-host/graphBackfill';
import { compareSitesHandler } from '../compare-sites';

const HOUR = 3600_000;
const NOW = Date.now();
const A_OBSERVED = NOW - 1 * HOUR;       // fresh against every SLO in play
const B_OBSERVED = NOW - 72 * HOUR;      // stale against every SLO in play

function makeGraph(): InstanceType<typeof Database> {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT, domain TEXT, wp_version TEXT,
      php_version TEXT, source TEXT, updated_at INTEGER, is_active INTEGER, account_id TEXT);
    CREATE TABLE plugins (site_id TEXT, slug TEXT, version TEXT, is_active INTEGER, updated_at INTEGER);
    CREATE TABLE themes (site_id TEXT, slug TEXT, version TEXT, is_active INTEGER, updated_at INTEGER);
  `);
  db.prepare(`INSERT INTO sites VALUES ('alpha','alpha','a.com','6.5','8.3','wpe',?,1,NULL)`).run(A_OBSERVED);
  db.prepare(`INSERT INTO sites VALUES ('beta','beta','b.com','6.4','8.3','wpe',?,1,NULL)`).run(B_OBSERVED);
  db.prepare(`INSERT INTO plugins VALUES ('alpha','woocommerce','9.9.1',1,?)`).run(A_OBSERVED);
  db.prepare(`INSERT INTO plugins VALUES ('beta','woocommerce','9.5.0',1,?)`).run(B_OBSERVED);
  db.prepare(`INSERT INTO themes VALUES ('alpha','twentytwentyfour','1.2',1,?)`).run(A_OBSERVED);
  db.prepare(`INSERT INTO themes VALUES ('beta','twentytwentyfour','1.2',1,?)`).run(B_OBSERVED);
  return db;
}

/**
 * IndexRegistry entries for both sides. `lastIndexed` is deliberately recent:
 * it keeps the legacy `fleetFreshnessWarning` footer silent, so the enriched
 * output is a clean prefix-extension of the legacy output and the parity
 * assertion below can be an exact `startsWith`.
 */
function makeServices(graphDb: unknown) {
  const structure = (wpVersion: string, pluginVersion: string) => ({
    wpVersion,
    phpVersion: '8.3',
    plugins: [{ slug: 'woocommerce', name: 'WooCommerce', version: pluginVersion, isActive: true }],
    themes: [{ slug: 'twentytwentyfour', name: 'Twenty Twenty-Four', version: '1.2', isActive: true }],
    users: { totalUsers: 3 },
    hasWooCommerce: true,
    hasACF: false,
  });
  const entries: Record<string, unknown> = {
    alpha: {
      siteId: 'alpha', siteName: 'alpha', lastIndexed: NOW, state: 'indexed',
      documentCount: 10, chunkCount: 20, structure: structure('6.5', '9.9.1'),
    },
    beta: {
      siteId: 'beta', siteName: 'beta', lastIndexed: NOW, state: 'indexed',
      documentCount: 7, chunkCount: 14, structure: structure('6.4', '9.5.0'),
    },
  };
  return {
    // Empty Local store: both sides resolve through the graph (resolveAnySite's
    // WPE fallback), which is the path that exercises graph-id → entity-id.
    siteData: { getSite: () => undefined, getSites: () => ({}) },
    indexRegistry: { get: (id: string) => entries[id], listAll: () => [] },
    graphService: { getDb: () => graphDb },
  } as never;
}

test('compare_sites: per-side observation ages, SLO-skew warning, legacy output untouched', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intel-compare-'));
  const graphDb = makeGraph();
  const services = makeServices(graphDb);

  // ── 1. Legacy run: no core registered yet ───────────────────────────────
  const legacy = await compareSitesHandler.execute({ site_a: 'alpha', site_b: 'beta' }, services);
  const legacyText = legacy.content[0].text;
  expect(legacyText).toContain('## Site Comparison: alpha vs beta');
  expect(legacyText).toContain('WordPress: 6.5 (alpha) vs 6.4 (beta)');
  expect(legacyText).not.toContain('Observation Ages');
  expect(legacyText).not.toContain('Freshness:');

  // ── 2. Bring the core up and seed twins from the graph ──────────────────
  const kv = new Map<string, unknown>();
  const core = initIntelligenceCore({
    storage: { get: (k) => kv.get(k) ?? null, set: (k, v) => kv.set(k, v) },
    logger: { info: () => {}, error: (...a) => console.error(a) },
    dataDir: dir,
  })!;
  setIntelligenceCore(core);
  runGraphBackfill(core, graphDb, { info: () => {}, error: () => {} });
  await new Promise((r) => setTimeout(r, 700)); // debounced fold

  const enriched = await compareSitesHandler.execute({ site_a: 'alpha', site_b: 'beta' }, services);
  const text = enriched.content[0].text;

  // Enrichment is ADDITIVE — the legacy report is intact, character for
  // character, and everything new is appended after it.
  expect(text.startsWith(legacyText)).toBe(true);

  // Per-side observation age, per compared dimension.
  expect(text).toContain('### Observation Ages');
  expect(text).toMatch(/\| WordPress \| 1h ago \(observed\) \| 3d ago \(observed\) ⚠ stale \|/);
  expect(text).toMatch(/\| PHP \| 1h ago \(observed\) \| 3d ago \(observed\) ⚠ stale \|/);
  expect(text).toMatch(/\| Plugins \(stalest\) \| 1h ago \(observed\) \| 3d ago \(observed\) ⚠ stale \|/);
  expect(text).toMatch(/\| Themes \(stalest\) \| 1h ago \(observed\) \| 3d ago \(observed\) ⚠ stale \|/);

  // The packet's headline criterion: ages more than one SLO apart are called
  // out, naming the older side as the one to re-check.
  expect(text).toContain('⚠️ Observation skew');
  expect(text).toMatch(/a gap of 3d, more than the 4h freshness SLO/);   // site.core / theme: → 4h fallback
  expect(text).toMatch(/a gap of 3d, more than the 8h freshness SLO/);   // plugin:           → 8h
  expect(text).toContain('consider a live re-check of beta');

  // Dimensions sharing an age pair AND an SLO collapse into one warning —
  // WordPress and PHP both fold from `site.core`, and `theme:` happens to
  // carry the same 4h fallback SLO. `plugin:` has its own 8h SLO, so it stays
  // a separate line rather than being rolled in.
  expect(text).toContain('Observation skew — WordPress, PHP, Themes (stalest):');
  expect(text.match(/Observation skew/g)).toHaveLength(2);

  // Freshness summary: 6 observations (2 sides × core/plugin/theme), 3 stale.
  expect(text).toMatch(/Freshness: 3 of 6 ledger-observed fact\(s\) within SLO — 3 stale; consider a live re-check/);

  core.close();
  graphDb.close();
});

test('compare_sites: no skew warning when both sides were observed together', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intel-compare-even-'));
  const graphDb = makeGraph();
  // Re-stamp beta to alpha's observation time: same data, no skew.
  graphDb.prepare(`UPDATE sites SET updated_at = ? WHERE id = 'beta'`).run(A_OBSERVED);
  graphDb.prepare(`UPDATE plugins SET updated_at = ? WHERE site_id = 'beta'`).run(A_OBSERVED);
  graphDb.prepare(`UPDATE themes SET updated_at = ? WHERE site_id = 'beta'`).run(A_OBSERVED);

  const kv = new Map<string, unknown>();
  const core = initIntelligenceCore({
    storage: { get: (k) => kv.get(k) ?? null, set: (k, v) => kv.set(k, v) },
    logger: { info: () => {}, error: (...a) => console.error(a) },
    dataDir: dir,
  })!;
  setIntelligenceCore(core);
  runGraphBackfill(core, graphDb, { info: () => {}, error: () => {} });
  await new Promise((r) => setTimeout(r, 700));

  const result = await compareSitesHandler.execute({ site_a: 'alpha', site_b: 'beta' }, makeServices(graphDb));
  const text = result.content[0].text;

  // Still reports ages — the version difference is real and worth comparing.
  expect(text).toContain('### Observation Ages');
  expect(text).toContain('WordPress: 6.5 (alpha) vs 6.4 (beta)');
  // ...but there is nothing to warn about.
  expect(text).not.toContain('Observation skew');
  expect(text).toMatch(/Freshness: all 6 ledger-observed fact\(s\) across both sides are within their SLO\./);

  core.close();
  graphDb.close();
});
