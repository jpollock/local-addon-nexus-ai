/**
 * WP-04 — Site Finder plugin/version filters read twins.
 *
 * Drives the REAL `SITE_FINDER_APPLY` handler (via `registerIpcHandlers`, the
 * harness `tests/unit/ipc/site-finder-soft-delete.test.ts` established) rather
 * than a re-implementation of the filter chain. That distinction is the point
 * of this suite: `tests/unit/site-finder/filter-apply.test.ts` declares its own
 * `applyFilter()` and asserts against that copy, so it cannot see a regression
 * in the handler these tests cover.
 *
 * The load-bearing assertion is the additive-parity pin at the bottom: with
 * membership decided by the graph predicate alone (owner ruling), stripping the
 * enrichment's own keys back out must leave the payload EQUAL to the
 * pre-core baseline. If a future change ever lets a twin fact decide
 * membership, that test fails instead of the SF eval suite silently drifting.
 */
import Database from 'better-sqlite3';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';

class MockIpcMain {
  handlers = new Map<string, Function>();
  handle(channel: string, handler: Function) { this.handlers.set(channel, handler); }
  on() { /* sync channels irrelevant here */ }
  removeHandler(channel: string) { this.handlers.delete(channel); }
  removeAllListeners() { /* no-op in tests */ }
  invoke(channel: string, ...args: any[]) {
    const handler = this.handlers.get(channel);
    if (!handler) throw new Error(`No handler registered for ${channel}`);
    return handler({}, ...args);
  }
}
const mockIpc = new MockIpcMain();
jest.mock('electron', () => ({ ipcMain: mockIpc, shell: { openPath: jest.fn() }, app: { getPath: () => '/tmp' } }));

import { registerIpcHandlers } from '../../ipc-handlers';
import { IPC_CHANNELS } from '../../../common/constants';
import { initIntelligenceCore } from '../bootstrap';
import { setIntelligenceCore } from '../coreRegistry';
import { runGraphBackfill } from '../graphBackfill';

const HOUR = 3600_000;

/**
 * Fixture. `plugin:` facts carry an 8h SLO, so 2h-old observations are fresh
 * and the 20h-old one is stale — both sides of the SLO are exercised without
 * hardcoding the SLO here.
 *
 *   loc-fresh  (local) — ACF 6.2.0, observed 2h ago    → matches, fresh
 *   loc-stale  (local) — ACF 6.1.0, observed 20h ago   → matches, STALE
 *   wpe-drift  (wpe)   — ACF 6.2.0 in cache, ledger says 6.0.0 → version drift
 *   wpe-modern (wpe)   — ACF 7.0.0                     → excluded by version filter
 *   wpe-ghost  (wpe)   — ACF row deleted after backfill → twin-only drift hint
 *   loc-nogap  (local) — ACF present, never backfilled  → coverage gap
 *   wpe-gone   (wpe)   — ACF observed INACTIVE, row deleted → must NOT hint
 *
 * loc-fresh also carries WooCommerce observed 20h ago, so a query naming both
 * slugs has a row with two observations of different ages.
 */
function makeGraphDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT, domain TEXT, wp_version TEXT,
      php_version TEXT, source TEXT, updated_at INTEGER, is_active INTEGER,
      post_count INTEGER, user_count INTEGER, last_post_at INTEGER, settings_json TEXT,
      remote_install_id TEXT, remote_domain TEXT, environment TEXT, account_id TEXT);
    CREATE TABLE plugins (site_id TEXT, slug TEXT, name TEXT, version TEXT, is_active INTEGER, updated_at INTEGER);
    CREATE TABLE users (site_id TEXT, role TEXT);
  `);
  const site = db.prepare(
    `INSERT INTO sites (id,name,domain,wp_version,php_version,source,updated_at,is_active)
     VALUES (?,?,?,?,?,?,?,1)`
  );
  const plugin = db.prepare(`INSERT INTO plugins (site_id,slug,name,version,is_active,updated_at) VALUES (?,?,?,?,1,?)`);
  const fresh = Date.now() - 2 * HOUR;
  const stale = Date.now() - 20 * HOUR;

  site.run('loc-fresh', 'loc-fresh', 'f.local', '7.0', '8.3', 'local', fresh);
  site.run('loc-stale', 'loc-stale', 's.local', '7.0', '8.3', 'local', stale);
  site.run('loc-nogap', 'loc-nogap', 'n.local', '7.0', '8.3', 'local', fresh);
  site.run('wpe-drift', 'wpe-drift', 'd.com', '7.0', '8.3', 'wpe', fresh);
  site.run('wpe-modern', 'wpe-modern', 'm.com', '7.0', '8.3', 'wpe', fresh);
  site.run('wpe-ghost', 'wpe-ghost', 'g.com', '7.0', '8.3', 'wpe', fresh);
  site.run('wpe-gone', 'wpe-gone', 'x.com', '7.0', '8.3', 'wpe', fresh);

  plugin.run('loc-fresh', 'advanced-custom-fields', 'ACF', '6.2.0', fresh);
  // Present in the cache, so it matches; hidden from the backfill (see below),
  // so the ledger never observes it — the coverage-gap case.
  plugin.run('loc-nogap', 'advanced-custom-fields', 'ACF', '6.2.0', fresh);
  plugin.run('loc-stale', 'advanced-custom-fields', 'ACF', '6.1.0', stale);
  plugin.run('wpe-drift', 'advanced-custom-fields', 'ACF', '6.2.0', fresh);
  plugin.run('wpe-modern', 'advanced-custom-fields', 'ACF', '7.0.0', fresh);
  plugin.run('wpe-ghost', 'advanced-custom-fields', 'ACF', '6.2.0', fresh);
  // Two observations of different ages on ONE row, so "report the stalest"
  // is a claim the fixture can actually falsify.
  plugin.run('loc-fresh', 'woocommerce', 'WooCommerce', '9.0.0', stale);
  // Observed INACTIVE. Its cache row is deleted after the backfill, so without
  // the active:false skip it would surface as a twin-only drift hint — an
  // uninstalled plugin reported as "missing from cache results".
  db.prepare(`INSERT INTO plugins (site_id,slug,name,version,is_active,updated_at) VALUES (?,?,?,?,0,?)`)
    .run('wpe-gone', 'advanced-custom-fields', 'ACF', '6.2.0', fresh);
  return db;
}

function makeDeps(graphDb: InstanceType<typeof Database>) {
  const noop = () => {};
  const allSites: Record<string, any> = {
    'loc-fresh': { name: 'loc-fresh', domain: 'f.local', phpVersion: '8.3' },
    'loc-stale': { name: 'loc-stale', domain: 's.local', phpVersion: '8.3' },
    'loc-nogap': { name: 'loc-nogap', domain: 'n.local', phpVersion: '8.3' },
  };
  const rows = () => graphDb.prepare(`SELECT * FROM sites WHERE is_active = 1`).all() as any[];
  return {
    siteData: { getSite: (id: string) => allSites[id] ?? null, getSites: () => allSites },
    localServicesBridge: { getAllSiteStatuses: () => ({}), getThemes: async () => [] },
    indexRegistry: { listAll: () => [], get: () => null, update: noop },
    embeddingService: {},
    contentPipeline: {},
    vectorStore: {},
    registryStorage: { get: () => null, set: noop },
    localLogger: { info: noop, warn: noop, error: noop, debug: noop },
    getMcpServer: () => null,
    getStartupStatus: () => ({ ready: true, phase: 'ready' }),
    graphService: {
      getDb: () => graphDb,
      listSites: async (opts: { source?: string } = {}) => rows().filter((r) => !opts.source || r.source === opts.source),
    },
    eventProcessor: {},
    vectorDbPath: '/tmp/nexus-test-vectors.db',
    nexusServices: { twinService: { getAll: () => [] } },
  } as any;
}

/** The enrichment's own additions — everything WP-04 adds and nothing else. */
function stripEnrichment(payload: any) {
  const clean = (rowsIn: any[]) =>
    (rowsIn ?? []).map((r) => {
      const { observedAt, observedTrust, observedStale, ...rest } = r;
      return rest;
    });
  const { intelligence, ...rest } = payload;
  return { ...rest, local: clean(payload.local), wpe: clean(payload.wpe), external: clean(payload.external) };
}

describe('SITE_FINDER_APPLY — twin-backed provenance (WP-04)', () => {
  let graphDb: InstanceType<typeof Database>;
  let core: ReturnType<typeof initIntelligenceCore>;
  let dir: string;
  let baseline: any;
  let enriched: any;
  let versionEnriched: any;
  let multiEnriched: any;

  beforeAll(async () => {
    graphDb = makeGraphDb();
    mockIpc.handlers.clear();
    registerIpcHandlers(makeDeps(graphDb));

    // ── Seed twins from the graph ───────────────────────────────────────────
    // `initIntelligenceCore` does not register the core — `setIntelligenceCore`
    // does — so the baseline run below still sees no core, while the fixture
    // mutations that follow apply to BOTH runs. Both runs must observe the
    // identical graph state or the parity pin measures the fixture, not the code.
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp04-sf-'));
    const kv = new Map<string, unknown>();
    core = initIntelligenceCore({
      storage: { get: (k) => kv.get(k) ?? null, set: (k, v) => kv.set(k, v) },
      logger: { info: () => {}, error: (...a) => console.error(a) },
      dataDir: dir,
    })!;

    // wpe-drift's ledger version differs from the cache: back-date the cache
    // row's value only AFTER the backfill reads it, so the ledger holds 6.0.0
    // while the graph (which decides membership) holds 6.2.0.
    graphDb.prepare(`UPDATE plugins SET version='6.0.0' WHERE site_id='wpe-drift'`).run();
    // loc-nogap is invisible to the backfill, so the ledger never observes it.
    graphDb.prepare(`UPDATE sites SET is_active=0 WHERE id='loc-nogap'`).run();

    runGraphBackfill(core, graphDb as any, { info: () => {}, error: () => {} });
    await new Promise((r) => setTimeout(r, 700)); // debounced fold

    // Restore the cache to its real state: wpe-drift back to 6.2.0 (ledger now
    // disagrees), loc-nogap active again (matches, but never observed), and
    // wpe-ghost's plugin row deleted (ledger knows it, cache no longer does).
    graphDb.prepare(`UPDATE plugins SET version='6.2.0' WHERE site_id='wpe-drift'`).run();
    graphDb.prepare(`UPDATE sites SET is_active=1 WHERE id='loc-nogap'`).run();
    graphDb.prepare(`DELETE FROM plugins WHERE site_id='wpe-ghost'`).run();
    graphDb.prepare(`DELETE FROM plugins WHERE site_id='wpe-gone'`).run();

    // ── Baseline: the same handler, same graph, NO core registered ──────────
    baseline = await mockIpc.invoke(IPC_CHANNELS.SITE_FINDER_APPLY, {
      plugins: ['advanced-custom-fields'],
    });

    setIntelligenceCore(core!);

    enriched = await mockIpc.invoke(IPC_CHANNELS.SITE_FINDER_APPLY, {
      plugins: ['advanced-custom-fields'],
    });
    versionEnriched = await mockIpc.invoke(IPC_CHANNELS.SITE_FINDER_APPLY, {
      pluginVersion: { slug: 'advanced-custom-fields', olderThan: '6.3.0' },
    });
    multiEnriched = await mockIpc.invoke(IPC_CHANNELS.SITE_FINDER_APPLY, {
      plugins: ['advanced-custom-fields', 'woocommerce'],
    });
  }, 30_000);

  afterAll(() => {
    core?.close();
    graphDb.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // ── (1) enrichment actually renders ───────────────────────────────────────
  // A wrong entity-id source fails SILENTLY — the join returns nothing and
  // enrichment vanishes with no error — so this assertion is the only thing
  // standing between a broken join and a green suite (cp.entity-join).
  it('stamps observedAt and trust on rows the ledger has observed', () => {
    const rows = [...enriched.local, ...enriched.wpe];
    const fresh = rows.find((r: any) => r.id === 'loc-fresh');
    expect(fresh.observedAt).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/));
    expect(fresh.observedTrust).toBe('observed');
    expect(fresh.observedStale).toBe(false);

    const wpe = enriched.wpe.find((r: any) => r.id === 'wpe-drift');
    expect(wpe.observedAt).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/));
  });

  it('flags an observation past its SLO as stale, without hardcoding the SLO', () => {
    const stale = enriched.local.find((r: any) => r.id === 'loc-stale');
    expect(stale.observedStale).toBe(true);
    const fresh = enriched.local.find((r: any) => r.id === 'loc-fresh');
    expect(fresh.observedStale).toBe(false);
  });

  // ── (2) freshness summary ─────────────────────────────────────────────────
  it('reports a freshness summary naming the stale count and the remedy', () => {
    expect(enriched.intelligence.freshness.observed).toBeGreaterThan(0);
    expect(enriched.intelligence.freshness.stale).toBe(1);
    expect(enriched.intelligence.notes.join('\n')).toContain('consider a live re-check');
  });

  // ── (3) drift hints — three distinct disagreements, kept distinct ─────────
  it('surfaces a twin-only environment the graph has no plugin row for', () => {
    const names = enriched.intelligence.twinOnly.map((t: any) => t.name);
    expect(names).toContain('wpe-ghost');
    expect(enriched.intelligence.notes.join('\n')).toMatch(/Drift hint:.*1 environment/);
  });

  it('reports a matched row whose ledger and cache versions disagree, without changing membership', () => {
    const drift = enriched.intelligence.versionDrift.find((d: any) => d.siteId === 'wpe-drift');
    expect(drift).toMatchObject({ slug: 'advanced-custom-fields', ledger: '6.0.0', cache: '6.2.0' });
    // Membership is unaffected: the row is still present, selected on the cache value.
    expect(enriched.siteIds).toContain('wpe-drift');
  });

  it('keeps "never observed" distinct from "observed and diverged"', () => {
    // loc-nogap matched the filter but the ledger holds no fact for it.
    expect(enriched.intelligence.coverageGap).toContain('loc-nogap');
    // …and it is NOT reported as a twin-only environment, which is the opposite absence.
    const twinOnlyNames = enriched.intelligence.twinOnly.map((t: any) => t.name);
    expect(twinOnlyNames).not.toContain('loc-nogap');
    expect(enriched.intelligence.notes.join('\n')).toContain('Coverage gap');
  });

  it('does not hint an environment whose fact says the plugin is inactive', () => {
    // wpe-gone is observed with active:false and its cache row is gone. That is
    // an uninstall the ledger recorded, not a cache that lost a row.
    const names = enriched.intelligence.twinOnly.map((t: any) => t.name);
    expect(names).not.toContain('wpe-gone');
    expect(names).toContain('wpe-ghost'); // the genuine disagreement still hints
  });

  it('reports the STALEST observation when a row matched on several queried slugs', () => {
    // loc-fresh holds ACF (2h) and WooCommerce (20h). A result is only as
    // trustworthy as its oldest input, so the row must read as stale.
    const row = multiEnriched.local.find((r: any) => r.id === 'loc-fresh');
    expect(row.observedStale).toBe(true);
    // …and it is genuinely the older fact being reported, not a coincidence:
    // the same row in the ACF-only query is fresh.
    expect(enriched.local.find((r: any) => r.id === 'loc-fresh').observedStale).toBe(false);
  });

  // ── the version filter (SF-06 shape) is enriched the same way ─────────────
  it('enriches the pluginVersion filter and leaves its membership to the graph', () => {
    // olderThan 6.3.0: loc-stale (6.1.0), loc-fresh (6.2.0), wpe-drift (cache 6.2.0)
    // match; wpe-modern (7.0.0) does not. The ledger's 6.0.0 for wpe-drift is
    // NOT what it was selected on.
    expect(versionEnriched.siteIds).toEqual(expect.arrayContaining(['loc-fresh', 'loc-stale', 'wpe-drift']));
    expect(versionEnriched.siteIds).not.toContain('wpe-modern');
    const row = versionEnriched.wpe.find((r: any) => r.id === 'wpe-drift');
    expect(row.observedAt).toBeTruthy();
  });

  // ── (4) THE ADDITIVE-PARITY PIN ───────────────────────────────────────────
  // Turns the pattern's abort condition into a failing test. The enrichment is
  // a mid-payload splice (per-row keys), not an appended section, so the pin
  // strips exactly the keys WP-04 adds and asserts DEEP EQUALITY with the
  // pre-core baseline — `toContain`-style checks would not catch a row
  // appearing, disappearing, or changing order.
  it('parity: stripping the enrichment leaves the payload identical to the pre-core baseline', () => {
    expect(stripEnrichment(enriched)).toEqual(stripEnrichment(baseline));
  });

  it('parity: membership is byte-identical with and without the core', () => {
    expect(enriched.siteIds).toEqual(baseline.siteIds);
    // The ledger knows wpe-ghost carries ACF and the cache no longer does —
    // proof the pin is not vacuous: a twins-decide implementation would add it.
    expect(enriched.siteIds).not.toContain('wpe-ghost');
  });

  it('baseline really was un-enriched (the pin compares against something)', () => {
    expect(baseline.intelligence).toBeUndefined();
    expect(baseline.local.every((r: any) => r.observedAt === undefined)).toBe(true);
    expect(enriched.local.some((r: any) => r.observedAt !== undefined)).toBe(true);
  });
});
