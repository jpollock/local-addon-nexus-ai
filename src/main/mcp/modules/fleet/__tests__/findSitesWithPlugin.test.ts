import Database from 'better-sqlite3';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { initIntelligenceCore } from '../../../../intelligence-host/bootstrap';
import { setIntelligenceCore } from '../../../../intelligence-host/coreRegistry';
import { runGraphBackfill } from '../../../../intelligence-host/graphBackfill';
import { findSitesWithPluginHandler } from '../find-sites-with-plugin';

test('migrated tool: legacy results enriched with observed/trust; twin-only surfaces as drift hint', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intel-tool-'));
  const kv = new Map<string, unknown>();
  const core = initIntelligenceCore({
    storage: { get: (k) => kv.get(k) ?? null, set: (k, v) => kv.set(k, v) },
    logger: { info: () => {}, error: (...a) => console.error(a) },
    dataDir: dir,
  })!;
  setIntelligenceCore(core);

  // graph db: one WPE site with woocommerce; one site ('ghost') that the
  // ledger will know about but the tool's legacy graph query won't return
  const graphDb = new Database(':memory:');
  graphDb.exec(`
    CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT, domain TEXT, wp_version TEXT,
      php_version TEXT, source TEXT, updated_at INTEGER, is_active INTEGER);
    CREATE TABLE plugins (site_id TEXT, slug TEXT, version TEXT, is_active INTEGER, updated_at INTEGER);
  `);
  const t = Date.now() - 2 * 3600_000;
  graphDb.prepare(`INSERT INTO sites VALUES ('localwpe','localwpe','a.com','7.0','8.3','wpe',?,1)`).run(t);
  graphDb.prepare(`INSERT INTO sites VALUES ('ghost','ghost','g.com','7.0',NULL,'wpe',?,1)`).run(t);
  graphDb.prepare(`INSERT INTO plugins VALUES ('localwpe','woocommerce','9.9.1',1,?)`).run(t);
  graphDb.prepare(`INSERT INTO plugins VALUES ('ghost','woocommerce','9.5.0',1,?)`).run(t);

  // Seed twins from the graph (both sites), then DELETE ghost's plugin row so
  // the legacy path misses it while the ledger still knows — drift scenario.
  runGraphBackfill(core, graphDb, { info: () => {}, error: () => {} });
  await new Promise((r) => setTimeout(r, 700));
  graphDb.prepare(`DELETE FROM plugins WHERE site_id='ghost'`).run();

  // Partial mock — only the two services this tool touches; cast because the
  // real NexusServices type carries the full service container.
  const services = {
    indexRegistry: { listAll: () => [] }, // no local indexed sites in this fixture
    graphService: { getDb: () => graphDb },
  } as never;
  const result = await findSitesWithPluginHandler.execute({ plugin: 'woocommerce' }, services);
  const text = result.content[0].text;

  expect(text).toContain('localwpe');
  expect(text).toContain('v9.9.1');
  expect(text).toMatch(/2h ago \(observed\)/);        // enrichment column
  expect(text).toMatch(/Freshness: all 1 ledger-observed/); // within 8h SLO
  expect(text).toMatch(/Drift hint: .*1 environment/); // ghost surfaced, not silently merged
  expect(text).toContain('ghost');
  core.close();
  graphDb.close();
});
