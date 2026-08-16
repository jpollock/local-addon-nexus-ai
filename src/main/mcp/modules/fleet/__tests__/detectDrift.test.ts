/**
 * WP-03 — detect_drift reconciled against the ledger's own drift detector.
 *
 * The fixture is built to produce all FOUR reconciliation classes at once,
 * because the classes are the packet's deliverable and a fixture that only
 * reaches one of them would let the other three rot:
 *
 *   explained      plugin:woocommerce  — legacy sees 9.9.1 vs 9.5.0; the ledger
 *                                        recorded alpha changing 9.5.0 → 9.9.1
 *   stable         plugin:akismet      — legacy sees it missing on beta; the
 *                                        ledger knows the fact but never saw it move
 *   coverage gap   theme:…twentythree  — legacy sees a theme difference; the
 *                                        ledger has never observed that fact
 *   ledger-only    plugin:custom-thing — the ledger recorded beta changing
 *                                        1.0 → 1.1, but both index structures
 *                                        still say 1.0, so legacy sees nothing
 *
 * That last one is the interesting shape: graph.db and IndexRegistry are
 * genuinely different populations (CLAUDE.md "Fleet counts"), so a change the
 * graph recorded and the content index has not yet picked up is a real state,
 * not a contrived one.
 */
import Database from 'better-sqlite3';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { initIntelligenceCore } from '../../../../intelligence-host/bootstrap';
import { setIntelligenceCore } from '../../../../intelligence-host/coreRegistry';
import { runGraphBackfill } from '../../../../intelligence-host/graphBackfill';
import { provisionalEnvironmentId } from '../../../../intelligence-host/provisionalEntity';
import { detectDriftHandler } from '../detect-drift';

const H = 3600_000;
const NOW = Date.now();
const SILENT = { info: () => {}, error: () => {} };

/** alpha is the baseline and recently observed; beta is deliberately stale. */
const ALPHA_T = NOW - 2 * H;
const ALPHA_CHANGED_T = NOW - 1 * H;
const BETA_T = NOW - 30 * H;          // past site.core (4h) and plugin (8h) SLOs
const BETA_CHANGED_T = NOW - 25 * H;

function makeGraph() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT, domain TEXT, wp_version TEXT,
      php_version TEXT, source TEXT, updated_at INTEGER, is_active INTEGER, account_id TEXT);
    CREATE TABLE plugins (site_id TEXT, slug TEXT, version TEXT, is_active INTEGER, updated_at INTEGER);
    CREATE TABLE themes (site_id TEXT, slug TEXT, version TEXT, is_active INTEGER, updated_at INTEGER);
  `);
  db.prepare(`INSERT INTO sites VALUES ('alpha','alpha','a.com','6.5','8.3','wpe',?,1,NULL)`).run(ALPHA_T);
  db.prepare(`INSERT INTO sites VALUES ('beta','beta','b.com','6.4','8.3','wpe',?,1,NULL)`).run(BETA_T);
  db.prepare(`INSERT INTO plugins VALUES ('alpha','woocommerce','9.5.0',1,?)`).run(ALPHA_T);
  db.prepare(`INSERT INTO plugins VALUES ('alpha','akismet','5.3',1,?)`).run(ALPHA_T);
  db.prepare(`INSERT INTO plugins VALUES ('alpha','custom-thing','1.0',1,?)`).run(ALPHA_T);
  db.prepare(`INSERT INTO plugins VALUES ('beta','woocommerce','9.5.0',1,?)`).run(BETA_T);
  db.prepare(`INSERT INTO plugins VALUES ('beta','custom-thing','1.0',1,?)`).run(BETA_T);
  // Only alpha's theme is ever observed — beta's active theme is the ledger's
  // coverage gap, and it must stay unobserved for that class to be reachable.
  db.prepare(`INSERT INTO themes VALUES ('alpha','twentytwentyfour','1.2',1,?)`).run(ALPHA_T);
  // gamma is in the graph (so the backfill seeds it and it will drift) but NOT
  // in the IndexRegistry, so it is never a comparison target. A real state —
  // graph.db and the content index are different populations — and the only
  // way to prove the report is scoped: without the scope filter, gamma's drift
  // would leak into a report about alpha and beta.
  db.prepare(`INSERT INTO sites VALUES ('gamma','gamma','g.com','6.5','8.3','wpe',?,1,NULL)`).run(ALPHA_T);
  db.prepare(`INSERT INTO plugins VALUES ('gamma','offsite-plugin','3.0',1,?)`).run(ALPHA_T);
  return db;
}

/**
 * `lastIndexed` is recent so the legacy `fleetFreshnessWarning` footer stays
 * silent. That is what lets the additive-parity assertion be an exact
 * `startsWith` — enrichment is appended BEFORE that footer, so a fixture that
 * produced one would make the enriched output a non-prefix. The stale case is
 * covered separately by the third test.
 */
function makeServices(graphDb: unknown, lastIndexed = NOW) {
  const plug = (slug: string, name: string, version: string) =>
    ({ slug, name, version, isActive: true });
  const entries: Record<string, unknown> = {
    alpha: {
      siteId: 'alpha', siteName: 'alpha', lastIndexed, state: 'indexed',
      documentCount: 10, chunkCount: 20,
      structure: {
        wpVersion: '6.5', phpVersion: '8.3',
        // 9.9.1 — the index has caught up with the change the ledger recorded.
        plugins: [plug('woocommerce', 'WooCommerce', '9.9.1'), plug('akismet', 'Akismet', '5.3'),
                  plug('custom-thing', 'Custom Thing', '1.0')],
        themes: [{ slug: 'twentytwentyfour', name: 'Twenty Twenty-Four', version: '1.2', isActive: true }],
        users: { totalUsers: 3 }, hasWooCommerce: true, hasACF: false,
      },
    },
    beta: {
      siteId: 'beta', siteName: 'beta', lastIndexed, state: 'indexed',
      documentCount: 7, chunkCount: 14,
      structure: {
        wpVersion: '6.4', phpVersion: '8.3',
        // custom-thing still 1.0 here while the graph moved to 1.1 — this is
        // what makes the ledger-only class reachable.
        plugins: [plug('woocommerce', 'WooCommerce', '9.5.0'), plug('custom-thing', 'Custom Thing', '1.0')],
        themes: [{ slug: 'twentytwentythree', name: 'Twenty Twenty-Three', version: '1.3', isActive: true }],
        users: { totalUsers: 2 }, hasWooCommerce: true, hasACF: false,
      },
    },
  };
  return {
    siteData: { getSite: () => undefined, getSites: () => ({}) },
    indexRegistry: {
      get: (id: string) => entries[id],
      listAll: () => Object.values(entries),
    },
    graphService: { getDb: () => graphDb },
  } as never;
}

/** Seed twins, then apply the two changes that make the ledger detect drift. */
async function seedLedgerWithDrift(core: ReturnType<typeof initIntelligenceCore>, db: any) {
  runGraphBackfill(core!, db, SILENT);
  await new Promise((r) => setTimeout(r, 700));
  db.prepare(`UPDATE plugins SET version='9.9.1', updated_at=? WHERE site_id='alpha' AND slug='woocommerce'`).run(ALPHA_CHANGED_T);
  db.prepare(`UPDATE plugins SET version='1.1', updated_at=? WHERE site_id='beta' AND slug='custom-thing'`).run(BETA_CHANGED_T);
  db.prepare(`UPDATE plugins SET version='3.1', updated_at=? WHERE site_id='gamma' AND slug='offsite-plugin'`).run(ALPHA_CHANGED_T);
  runGraphBackfill(core!, db, SILENT);
  await new Promise((r) => setTimeout(r, 700));
}

function newCore(prefix: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const kv = new Map<string, unknown>();
  return initIntelligenceCore({
    storage: { get: (k) => kv.get(k) ?? null, set: (k, v) => kv.set(k, v) },
    logger: { info: () => {}, error: (...a) => console.error(a) },
    dataDir: dir,
  })!;
}

test('detect_drift: both detectors reported, labeled by origin, and reconciled', async () => {
  const graphDb = makeGraph();
  const services = makeServices(graphDb);

  // ── Legacy run: core not registered ─────────────────────────────────────
  const legacy = await detectDriftHandler.execute({ baseline_site: 'alpha' }, services);
  const legacyText = legacy.content[0].text;
  expect(legacyText).toContain('## Drift Report: baseline = "alpha"');
  expect(legacyText).toContain('WordPress: 6.5 (baseline) vs 6.4 (target)');
  expect(legacyText).toContain('Missing plugin: Akismet');
  expect(legacyText).not.toContain('[origin: ledger]');
  expect(legacyText).not.toContain('Detector Reconciliation');
  expect(legacyText).not.toContain('Observations:');

  const core = newCore('intel-drift-');
  setIntelligenceCore(core);
  await seedLedgerWithDrift(core, graphDb);

  const enriched = await detectDriftHandler.execute({ baseline_site: 'alpha' }, services);
  const text = enriched.content[0].text;

  // Additive parity — the legacy report survives character for character.
  expect(text.startsWith(legacyText)).toBe(true);

  // (1) Ledger drift is reported, labeled by origin, and each row carries how
  //     long the previous value stood before the change was observed (WP-03b —
  //     `previous_observed_at`, from schema drift.detected/2). alpha's previous
  //     value was observed 2h ago and the change 1h ago → 1h; beta's 30h/25h → 5h.
  expect(text).toContain('### Changes Recorded by the Ledger  [origin: ledger]');
  expect(text).toMatch(/\| alpha \(baseline\) \| plugin:woocommerce \| 9\.5\.0 → 9\.9\.1 \| 1h \| 1h ago \|/);
  expect(text).toMatch(/\| beta \| plugin:custom-thing \| 1\.0 → 1\.1 \| 5h \| 1d ago \|/);
  expect(text).toContain('"Diverged for" is the gap between the previous and current observations');
  // Every row here has the timestamp, so the v1 caveat must NOT be printed.
  expect(text).not.toContain('drift.detected/2');

  // (2) Observations header — beta is stale, so the remedy phrase is required.
  expect(text).toMatch(/> Observations: 2 of 2 environment\(s\) ledger-observed — 1 carry at least one fact past its SLO/);
  expect(text).toContain('consider a live re-check');

  // (3) All four reconciliation classes.
  expect(text).toContain('### Detector Reconciliation');
  expect(text).toMatch(/\*\*Explained by a recorded change\*\* \(1\)/);
  expect(text).toMatch(/beta · `plugin:woocommerce` — 1h ago, the ledger recorded alpha \(baseline\) changing 9\.5\.0 → 9\.9\.1/);

  expect(text).toMatch(/\*\*Stable divergence — no recorded change\*\* \(2\)/);
  expect(text).toMatch(/beta · `plugin:akismet` — divergence is stable/);
  expect(text).toMatch(/beta · `site\.core` — divergence is stable/);

  expect(text).toMatch(/\*\*Not covered by the ledger\*\* \(1\)/);
  expect(text).toMatch(/beta · `theme:twentytwentythree` — the ledger has never observed this fact.*\[pipeline coverage gap\]/);

  expect(text).toMatch(/\*\*Seen only by the ledger \[both detectors disagree\]\*\* \(1\)/);
  expect(text).toMatch(/beta · `plugin:custom-thing` — changed 1\.0 → 1\.1 1d ago, but the cross-site comparison surfaced no drift/);

  // The explained fact must NOT also appear as ledger-only — that would double
  // count the one change both detectors agreed on.
  expect(text).not.toMatch(/plugin:woocommerce` — changed .* but the cross-site comparison/);

  // (4) Scoping: gamma drifted in the same ledger, but it is not one of the
  // compared sites. A report about alpha vs beta must not mention it — an
  // unscoped query would quietly turn this into a fleet-wide change feed.
  expect(text).not.toContain('gamma');
  expect(text).not.toContain('offsite-plugin');

  core.close();
  graphDb.close();
});

/**
 * WP-03b fixtures — a drift event straight through the emitter.
 *
 * No backfill and no fold, so these tests cost nothing in debounce waits and
 * the emission ORDER is exactly what the test says it is (ULIDs are monotonic
 * within a process, so ledger id order == the order below). `beta` is a
 * comparison target in `makeServices`, so its entity is in the report's scope.
 */
function emitDrift(
  core: ReturnType<typeof newCore>,
  o: { schema: string; fact: string; previous: unknown; observed: unknown; observedAt: number; previousObservedAt?: number },
): void {
  core.emitter.emit({
    observed_at: new Date(o.observedAt).toISOString(),
    topic: 'state.drift.detected',
    schema: o.schema,
    entity: { environment: provisionalEnvironmentId('beta') },
    actor: { id: 'act_fold_state_twin', kind: 'system' },
    source: { class: 'platform', system: 'fold:state-twin', trust: 'derived' },
    payload: {
      fact: o.fact,
      previous: o.previous,
      observed: o.observed,
      // v1 of the payload simply had no such key.
      ...(o.previousObservedAt === undefined
        ? {}
        : { previous_observed_at: new Date(o.previousObservedAt).toISOString() }),
    },
  });
}

test('detect_drift: a v1 drift event renders no duration rather than a fabricated one', async () => {
  // drift.detected/1 predates `previous_observed_at`. Those events are already
  // in real ledgers; the report must degrade to "unknown", never to a number
  // computed from a missing timestamp (which would render as "56y" or "1m").
  const graphDb = makeGraph();
  const services = makeServices(graphDb);
  const core = newCore('intel-drift-v1-');
  setIntelligenceCore(core);

  emitDrift(core, {
    schema: 'drift.detected/1',
    fact: 'plugin:legacy-thing',
    previous: { version: '1.0' },
    observed: { version: '2.0' },
    observedAt: NOW - 2 * H,
  });

  // An out-of-order pair degrades the same way. `stateTwinFold`'s own guard
  // means the current producer cannot emit one, but this reader consumes
  // whatever is in the ledger — including events from producers not yet
  // written — and a negative interval must not render as a duration.
  emitDrift(core, {
    schema: 'drift.detected/2',
    fact: 'plugin:backwards-thing',
    previous: { version: '3.0' },
    observed: { version: '4.0' },
    observedAt: NOW - 4 * H,
    previousObservedAt: NOW - 1 * H,
  });

  emitDrift(core, {
    schema: 'drift.detected/2',
    fact: 'plugin:instant-thing',
    previous: { version: '5.0' },
    observed: { version: '6.0' },
    observedAt: NOW - 6 * H,
    previousObservedAt: NOW - 6 * H,
  });

  const text = (await detectDriftHandler.execute({ baseline_site: 'alpha' }, services)).content[0].text;

  expect(text).toMatch(/\| beta \| plugin:legacy-thing \| 1\.0 → 2\.0 \| — \| 2h ago \|/);
  expect(text).toMatch(/\| beta \| plugin:backwards-thing \| 3\.0 → 4\.0 \| — \| 4h ago \|/);

  // A REACHABLE zero: stateTwinFold's guard is a strict `>`, so two values
  // observed in the same timestamp granule both fold and drift fires with an
  // interval of 0. `fmtDuration` floors at "1m", which would claim a minute
  // that was never observed — the shared age vocabulary is right for ages and
  // wrong for this. "<1m" is the honest rendering of a known-but-tiny gap, and
  // it is not "—", which means unknown.
  expect(text).toMatch(/\| beta \| plugin:instant-thing \| 5\.0 → 6\.0 \| <1m \| 6h ago \|/);
  // The absence is explained where it appears, not left as a bare em dash.
  expect(text).toContain('predate schema drift.detected/2');
  // No duration invented from the missing timestamp.
  expect(text).not.toMatch(/plugin:legacy-thing \| 1\.0 → 2\.0 \| \d/);

  core.close();
  graphDb.close();
});

test('detect_drift: the ledger query is newest-first, so the cap drops the OLDEST events', async () => {
  // The WP-03 disclosure this retires: `query` defaulted to ORDER BY id ASC, so
  // hitting the 2000-event cap dropped the NEWEST changes and the report read as
  // "nothing changed recently". Reaching 2000 events for real would dominate the
  // suite (that is why WP-03 left the branch untested), so the cap is simulated
  // by clamping the limit the tool asks for — the ordering under test is still
  // decided by the real Ledger SQL.
  const graphDb = makeGraph();
  const services = makeServices(graphDb);
  const core = newCore('intel-drift-order-');
  setIntelligenceCore(core);

  emitDrift(core, {
    schema: 'drift.detected/2', fact: 'plugin:oldest-change',
    previous: { version: '1.0' }, observed: { version: '1.1' },
    observedAt: NOW - 20 * H, previousObservedAt: NOW - 26 * H,
  });
  emitDrift(core, {
    schema: 'drift.detected/2', fact: 'plugin:newest-change',
    previous: { version: '2.0' }, observed: { version: '2.1' },
    observedAt: NOW - 3 * H, previousObservedAt: NOW - 9 * H,
  });

  const realQuery = core.ledger.query.bind(core.ledger);
  let asked: { order?: string } | undefined;
  core.ledger.query = (opts = {}) => {
    asked = opts;
    return realQuery({ ...opts, limit: 1 });
  };

  const text = (await detectDriftHandler.execute({ baseline_site: 'alpha' }, services)).content[0].text;

  expect(asked?.order).toBe('desc');
  expect(text).toContain('plugin:newest-change');
  expect(text).not.toContain('plugin:oldest-change');
  // The truncation-disclosure branch is retired: dropping the oldest events is
  // the boring, correct behaviour and no longer warrants a warning.
  expect(text).not.toContain('event cap');

  core.ledger.query = realQuery;
  core.close();
  graphDb.close();
});

test('detect_drift: a clean ledger adds nothing but the legacy report', async () => {
  const graphDb = makeGraph();
  const services = makeServices(graphDb);
  const core = newCore('intel-drift-clean-');
  setIntelligenceCore(core);
  // Seed twins but apply NO changes, so no state.drift.detected is ever emitted.
  runGraphBackfill(core, graphDb, SILENT);
  await new Promise((r) => setTimeout(r, 700));

  const text = (await detectDriftHandler.execute({ baseline_site: 'alpha' }, services)).content[0].text;

  // Observations header still renders — coverage is worth stating even when
  // nothing drifted — but there is no change table to show.
  expect(text).toMatch(/> Observations: 2 of 2 environment\(s\) ledger-observed/);
  expect(text).not.toContain('[origin: ledger]');
  // Reconciliation still runs: legacy findings with no ledger movement are the
  // whole point of the "stable divergence" class.
  expect(text).toContain('### Detector Reconciliation');
  expect(text).toMatch(/\*\*Stable divergence — no recorded change\*\*/);
  expect(text).not.toMatch(/\*\*Explained by a recorded change\*\*/);

  core.close();
  graphDb.close();
});

test('detect_drift: a stale index keeps its legacy warning last, after the enrichment', async () => {
  // The startsWith pin above is exact only when fleetFreshnessWarning is
  // silent. This covers the other case: enrichment is inserted before that
  // trailing warning, so parity here means every legacy line survives AND the
  // warning is still the final line.
  const graphDb = makeGraph();
  const staleServices = makeServices(graphDb, NOW - 40 * H); // > 24h → ⚠️ warning

  const legacyText = (await detectDriftHandler.execute({ baseline_site: 'alpha' }, staleServices)).content[0].text;
  const legacyLines = legacyText.split('\n');
  const warningLine = legacyLines[legacyLines.length - 1];
  expect(warningLine).toContain('Index data is stale');

  const core = newCore('intel-drift-stale-');
  setIntelligenceCore(core);
  await seedLedgerWithDrift(core, graphDb);

  const text = (await detectDriftHandler.execute({ baseline_site: 'alpha' }, staleServices)).content[0].text;
  const lines = text.split('\n');

  expect(lines[lines.length - 1]).toBe(warningLine);           // warning still last
  expect(text).toContain('### Changes Recorded by the Ledger'); // enrichment present
  for (const line of legacyLines) expect(lines).toContain(line); // nothing lost

  core.close();
  graphDb.close();
});
