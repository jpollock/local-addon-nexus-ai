/**
 * The two smaller reader migrations that shipped together:
 * `find_sites_with_theme` (observed column) and `find_outdated_sites`
 * (freshness overlay + ledger gap-fill).
 *
 * `find_outdated_sites` is the one with teeth: its fixture puts `siteB`'s
 * `wp_version` in the LEDGER and nowhere in the graph, so the gap-fill is
 * exercised rather than asserted about. The test pins that the filled value
 * is both reported (`6.9`) and participates in the outdated comparison — a
 * gap-fill that displayed a version without comparing it would look correct
 * and still under-report the fleet.
 */
import Database from 'better-sqlite3';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { initIntelligenceCore } from '../../../../intelligence-host/bootstrap';
import { setIntelligenceCore } from '../../../../intelligence-host/coreRegistry';
import { runGraphBackfill } from '../../../../intelligence-host/graphBackfill';
import { findSitesWithThemeHandler } from '../find-sites-with-theme';
import { findOutdatedSitesHandler } from '../find-outdated-sites';

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intel-night-'));
  const kv = new Map<string, unknown>();
  const core = initIntelligenceCore({
    storage: { get: (k) => kv.get(k) ?? null, set: (k, v) => kv.set(k, v) },
    logger: { info: () => {}, error: (...a) => console.error(a) },
    dataDir: dir,
  })!;
  setIntelligenceCore(core);
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT, domain TEXT, wp_version TEXT,
      php_version TEXT, source TEXT, updated_at INTEGER, is_active INTEGER, last_sync_at INTEGER);
    CREATE TABLE plugins (site_id TEXT, slug TEXT, version TEXT, is_active INTEGER, updated_at INTEGER);
    CREATE TABLE themes (site_id TEXT, slug TEXT, name TEXT, version TEXT, is_active INTEGER, updated_at INTEGER);
  `);
  return { core, db };
}

test('theme tool: twin enrichment with observed column', async () => {
  const { core, db } = fixture();
  const t = Date.now() - 3 * 3600_000;
  db.prepare(`INSERT INTO sites VALUES ('siteA','siteA','a.com','7.0','8.3','wpe',?,1,?)`).run(t, t);
  db.prepare(`INSERT INTO themes(site_id,slug,name,version,is_active,updated_at) VALUES ('siteA','astra','Astra','4.8',1,?)`).run(t);
  runGraphBackfill(core, db, { info: () => {}, error: () => {} });
  await new Promise((r) => setTimeout(r, 700));

  const services = { indexRegistry: { listAll: () => [] }, graphService: { getDb: () => db } } as never;
  const res = await findSitesWithThemeHandler.execute({ theme: 'astra' }, services);
  const text = res.content[0].text;
  expect(text).toContain('siteA');
  expect(text).toMatch(/3h ago \(observed\)/);
  expect(text).toMatch(/Freshness: all 1 ledger-observed/);
  core.close(); db.close();
});

test('outdated tool: freshness overlay + ledger gap-fill', async () => {
  const { core, db } = fixture();
  const freshT = Date.now() - 3600_000;           // 1h — fresh vs 24h site SLO... (site.core has no SLO entry -> 4h fallback) fresh
  const staleT = Date.now() - 30 * 86_400_000;    // 30d — stale
  // siteA: fresh, has versions. siteB: stale, wp_version MISSING in graph but present via ledger.
  db.prepare(`INSERT INTO sites VALUES ('siteA','siteA','a.com','7.0','8.3','wpe',?,1,?)`).run(freshT, freshT);
  db.prepare(`INSERT INTO sites VALUES ('siteB','siteB','b.com',NULL,'8.1','wpe',?,1,?)`).run(staleT, staleT);
  runGraphBackfill(core, db, { info: () => {}, error: () => {} });
  await new Promise((r) => setTimeout(r, 700));
  // ledger learns siteB's wp_version from a later webhook-style observation
  core.emitter.emit({
    observed_at: new Date(Date.now() - 7200_000).toISOString(),
    topic: 'state.site.observed', schema: 'site.observed/1',
    entity: { environment: core.twins.search('site.').find(f => (f.value as any).name === 'siteB')!.entityId },
    actor: { id: 'act_test', kind: 'system' },
    source: { class: 'platform', system: 'wp-webhook', trust: 'observed' },
    payload: { name: 'siteB', domain: 'b.com', wp_version: '6.9' },
  });
  core.scheduleFolds();
  await new Promise((r) => setTimeout(r, 700));
  // graph still lacks siteB wp_version:
  const services = { indexRegistry: { listAll: () => [] }, graphService: { getDb: () => db } } as never;
  const res = await findOutdatedSitesHandler.execute({ component: 'wordpress' }, services);
  const text = res.content[0].text;
  expect(text).toMatch(/Observations: 2 of 2 sites ledger-observed/);
  expect(text).toMatch(/missing version value\(s\) filled from the ledger/);
  expect(text).toContain('6.9'); // siteB's version came from the ledger, not the cache
  expect(text).toMatch(/Outdated: 6.9/); // and participates in the comparison
  core.close(); db.close();
});
