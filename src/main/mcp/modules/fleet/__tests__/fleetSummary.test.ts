import Database from 'better-sqlite3';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { initIntelligenceCore } from '../../../../intelligence-host/bootstrap';
import { setIntelligenceCore } from '../../../../intelligence-host/coreRegistry';
import { runGraphBackfill } from '../../../../intelligence-host/graphBackfill';
import { fleetSummaryHandler } from '../fleet-summary';

test('migrated tool: fleet_summary gains an observations header, freshness, and a fleet-size drift hint; legacy body preserved additively', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intel-tool-'));
  const kv = new Map<string, unknown>();
  const core = initIntelligenceCore({
    storage: { get: (k) => kv.get(k) ?? null, set: (k, v) => kv.set(k, v) },
    logger: { info: () => {}, error: (...a) => console.error(a) },
    dataDir: dir,
  })!;

  // graph db: two WPE sites. 'wpe-ghost' is seeded, backfilled into the
  // ledger, then removed from the graph's active set — a site the ledger
  // has observed core facts for that the tool's own site population
  // (indexed local ∪ wpe/external from the graph) no longer counts at all.
  // That is fleet-SIZE drift, this packet's accept criterion.
  const graphDb = new Database(':memory:');
  graphDb.exec(`
    CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT, domain TEXT, wp_version TEXT,
      php_version TEXT, source TEXT, updated_at INTEGER, is_active INTEGER);
    CREATE TABLE plugins (site_id TEXT, slug TEXT, version TEXT, is_active INTEGER, updated_at INTEGER);
  `);
  const t = Date.now() - 2 * 3600_000;
  graphDb.prepare(`INSERT INTO sites VALUES ('wpe-a','wpe-a','a.com','7.0','8.3','wpe',?,1)`).run(t);
  graphDb.prepare(`INSERT INTO sites VALUES ('wpe-ghost','wpe-ghost','g.com','7.1','8.2','wpe',?,1)`).run(t);

  // Partial mock — only the services this tool touches; cast because the
  // real NexusServices type carries the full service container.
  const services = {
    indexRegistry: { listAll: () => [] }, // no local indexed sites in this fixture
    siteData: { getSites: () => ({}) },
    graphService: { getDb: () => graphDb },
  } as never;

  // Backfill and remove 'wpe-ghost' from the graph BEFORE capturing the
  // baseline, so the graph state the baseline reads is identical to the
  // state the enriched run reads — only the core's presence differs between
  // the two calls. (Capturing the baseline first, then mutating the graph,
  // would make the "legacy body unchanged" comparison compare two different
  // legacy states rather than isolating the enrichment's effect.)
  runGraphBackfill(core, graphDb, { info: () => {}, error: () => {} });
  await new Promise((r) => setTimeout(r, 700));
  graphDb.prepare(`DELETE FROM sites WHERE id='wpe-ghost'`).run();

  // ── Additive-parity baseline: run BEFORE the core is registered ─────────
  // getIntelligenceCore() returns undefined at this point (setIntelligenceCore
  // has not been called yet), so this is the true legacy path.
  const baseline = (await fleetSummaryHandler.execute({}, services)).content[0].text;

  setIntelligenceCore(core);
  const result = await fleetSummaryHandler.execute({}, services);
  const text = result.content[0].text;

  // Report-shaped tools insert their observations header near the TOP
  // (mirroring find-outdated-sites, per this packet's instructions), not
  // appended at the end like compare_sites' additive section. A mid-document
  // insertion breaks both `startsWith` and whole-string `toContain` against
  // the baseline — neither survives content being spliced into the middle of
  // a string. The parity pin here instead strips the enrichment's own lines
  // (the ones this migration added, identified by their `> ` prefix) back out
  // of the enriched text and asserts what remains is byte-identical to the
  // baseline: additive means nothing else moved or changed. See the WP-01
  // calibration note in WORK_PACKETS.md — `startsWith`/`toContain` only fit
  // footer-style (compare_sites) or single-insertion-point enrichment.
  expect(text).not.toEqual(baseline);
  const withoutEnrichment = text
    .split('\n')
    .filter((line) => !line.startsWith('> Observations:') && !line.startsWith('> Drift hint:'))
    .join('\n');
  expect(withoutEnrichment).toEqual(baseline);

  expect(text).toMatch(/\*\*Total sites: 1\*\* — 0 local, 1 WP Engine/);
  expect(text).toMatch(/> Observations: 1 of 1 sites ledger-observed, all within SLO\./);
  expect(text).toMatch(/> Drift hint: the intelligence ledger has observed 1 environment\(s\).*wpe-ghost/);

  // baseline itself is the "no core registered" legacy-path assertion: it was
  // captured before setIntelligenceCore was ever called in this module, and
  // it must carry none of the enrichment vocabulary.
  expect(baseline).not.toContain('> Observations:');
  expect(baseline).not.toContain('Drift hint:');

  core.close();
  graphDb.close();
});
