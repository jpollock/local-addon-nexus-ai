/**
 * WP-04b — Site Finder filter semantics, pinned against the REAL handler.
 *
 * This file replaces `tests/unit/site-finder/filter-apply.test.ts`, which
 * declared its own `applyFilter()` and imported nothing from `src/`: every
 * semantic it pinned was pinned to a COPY, so a regression in the real
 * `SITE_FINDER_APPLY` handler was invisible to it. The assertions were good;
 * the target was wrong. They are re-expressed here against the handler itself,
 * driven through `registerIpcHandlers` — the harness
 * `tests/unit/ipc/site-finder-soft-delete.test.ts` established and
 * `src/main/intelligence-host/__tests__/siteFinderTwins.test.ts` (WP-04) is the
 * template for.
 *
 * THE HANDLER HAS THREE NEAR-DUPLICATE FILTER CHAINS — local, WPE, external
 * (`ipc-handlers.ts`, one `for` loop each). Divergence between them is the bug
 * class the copy could structurally never catch, because the copy had exactly
 * one chain. So each ported assertion exercises the chain the original targeted
 * and, where the fixture makes it cheap, all three.
 *
 * ── Waivers (assertions NOT ported, with the reason) ──────────────────────────
 * (b) UNREACHABLE — `describe('empty filter guard')` asserted a re-declared
 *     `hasFilter()` predicate directly (`expect(hasFilter({})).toBe(false)`).
 *     The real `hasFilter` is a `const` inside the handler closure and is not
 *     exported, so the unit shape cannot be reached. Ported BEHAVIOURALLY
 *     instead — same four inputs, asserted through the handler's result — in
 *     `empty-filter guard` below.
 * (b) UNREACHABLE AS WRITTEN — the copy's `maxUserCount` case read
 *     `sites.user_count` for every source. The real handler reads
 *     `sites.user_count` only on the LOCAL chain; WPE and external count rows in
 *     the `users` table (deliberate — `sites.user_count` is not populated for
 *     remote sources, and the handler says so). The assertion's INTENT
 *     ("wpe-stg, 2 users, is under the cap") is ported by giving wpe-stg two
 *     `users` rows; the copy's data source is not reachable for that chain.
 * (c) ALREADY COVERED — `pluginVersion` membership on the local and WPE chains
 *     is also pinned by `siteFinderTwins.test.ts` ("enriches the pluginVersion
 *     filter and leaves its membership to the graph"). Ported here anyway: that
 *     suite exists to pin the intelligence enrichment, and its fixture is free
 *     to change for reasons that have nothing to do with filter semantics.
 *
 * Everything else the copy pinned is ported. A handful of assertions are NEW
 * and marked `[new]` — boundary values (`>=` vs `>`), the NULL `last_post_at`
 * asymmetry, the missing-settings-key branch, and the `plugins` vs
 * `pluginVersion` `is_active` asymmetry. Each is a branch the handler already
 * has and the copy left unpinned; none changes the handler.
 *
 * ── WP-04c — the three divergences, now FIXED and pinned ─────────────────────
 * WP-04b found these while porting and deliberately left them untested: a test
 * asserting the then-current output would have promoted each defect into a
 * regression guard. WP-04c fixed all three in `ipc-handlers.ts`, so the
 * withheld assertions become real pins below (`phpVersions`, `wpeEnvironment`,
 * `minAdminCount` blocks):
 *   1. `phpVersions` was applied on the local chain ONLY — a PHP-version query
 *      returned every WPE install and external host unfiltered. Now applied on
 *      all three, with the same exact-membership predicate the local chain uses.
 *   2. `wpeEnvironment` passed the `hasFilter` guard with no chain implementing
 *      it, so it alone returned the whole fleet — the exact outcome the guard
 *      exists to prevent. Now honoured on the WPE and external chains, and
 *      DELIBERATELY matching nothing on the local chain (owner ruling: a Local
 *      site's environment is a constant, and is present only for the minority
 *      of Local sites that have a graph row at all, so matching on it would
 *      match on indexing coverage rather than on a fact). That choice is pinned
 *      as a choice, not left as an absence.
 *   3. `minAdminCount` had the same guard-passes-nothing-implements defect.
 *      Now honoured on all three chains from `sites.user_count_by_role`, with
 *      NULL (never collected) excluded rather than read as zero.
 */

import Database from 'better-sqlite3';

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

import { registerIpcHandlers } from '../../../src/main/ipc-handlers';
import { IPC_CHANNELS } from '../../../src/common/constants';

const NOW = Date.now();
const DAY = 24 * 60 * 60 * 1000;

const SETTINGS_SPECIAL = {
  // The "special" side of all five boolean settings filters at once.
  blogname: 'Special', permalink_structure: '', default_comment_status: 'closed',
  blog_public: '0', show_on_front: 'page', users_can_register: '1',
};
const SETTINGS_NORMAL = {
  blogname: 'Normal', permalink_structure: '/%postname%/', default_comment_status: 'open',
  blog_public: '1', show_on_front: 'posts', users_can_register: '0',
};

/**
 * Fixture. The copy's seven sites, plus per-chain mirrors so a semantic the
 * copy could only prove on one chain is proved on all three.
 *
 * `admins` is `sites.user_count_by_role.$.administrator`; "—" means the column
 * is NULL (never collected), which `minAdminCount` must treat as unknown.
 *
 *   local (also present in Local's own store — the local chain reads BOTH):
 *     myloop      WP 7.0  PHP 8.2.29  59 posts  81 users  -2d   3 admins  ACF 6.8.3, WooCommerce 9.1.0 INACTIVE
 *     oldsite     WP 6.8  PHP 7.4.33   3 posts   1 user  -90d   1 admin   WooCommerce 8.0.0, ACF 5.12.0
 *     newsite     WP 7.0  PHP 8.3.1    2 posts   2 users  -5d   — admins  Akismet (no ACF)
 *     hiddensite  WP 7.0  PHP 8.2.29  10 posts   3 users -60d   — admins  blog_public=0
 *     regopen     WP 7.0  PHP 8.2.29   5 posts  20 users  -7d   — admins  users_can_register=1
 *     neverposted WP 7.0  PHP 8.2      1 post    1 user  NULL   — admins  last_post_at NULL
 *     partialset  WP 7.0  PHP 8.2      1 post    1 user   -3d   — admins  settings_json with NO filterable keys
 *   wpe (graph only; user counts come from the `users` table):
 *     wpe-prod    WP 6.9  PHP 8.2  100 posts  5 users  -3d  production  2 admins  ACF 6.8.3, no settings_json
 *     wpe-stg     WP 6.9  PHP 7.4   10 posts  2 users -15d  staging     0 admins  ACF 5.9.0,  no settings_json
 *     wpe-inact   WP 7.0  PHP 8.3    5 posts  0 users  -1d  production  — admins  ACF 5.0.1 INACTIVE
 *     wpe-special WP 7.0  PHP 8.3    8 posts  0 users  -2d  production  — admins  settings = SPECIAL
 *     wpe-normal  WP 7.0  PHP 8.3    9 posts  0 users  -2d  production  — admins  settings = NORMAL
 *   external:
 *     ssh:ext-host    WP 6.9 PHP 8.1  12 posts  4 users -20d  production  4 admins  ACF 6.0.0, no settings_json
 *     ssh:ext-special WP 7.0 PHP 8.3   5 posts  0 users  -2d  production  — admins  settings = SPECIAL
 *     ssh:ext-normal  WP 7.0 PHP 8.3   6 posts  0 users  -2d  STAGING     2 admins  settings = NORMAL
 *
 * The PHP column is deliberately mixed-granularity, because the real data is:
 * WP Engine stores major.minor (`8.2`), Local and external SSH hosts store a
 * full patch version (`8.2.29`). The `phpVersions` predicate is exact
 * membership on all three chains, so the fixture must be able to tell those
 * apart — see the `phpVersions` block below.
 */
type SiteRow = {
  id: string; name: string; source: 'local' | 'wpe' | 'external'; domain: string;
  wp: string; php: string; posts: number | null; users: number | null;
  lastPost: number | null; settings?: Record<string, string>; env?: string;
  /**
   * Administrator count, written into `sites.user_count_by_role` as
   * `{"administrator":N,"editor":0}`. **Omitting it leaves the column NULL** —
   * "never collected", which `minAdminCount` must treat as unknown-and-excluded
   * rather than as zero. Live, that NULL is the common case, not the edge one:
   * 219 of 342 active WPE rows have never been deep-refreshed.
   */
  admins?: number;
};

const SITES: SiteRow[] = [
  { id: 'myloop',      name: 'myloop',      source: 'local', domain: 'myloop.local',      wp: '7.0', php: '8.2.29', posts: 59, users: 81, lastPost: NOW - 2 * DAY,  settings: { ...SETTINGS_NORMAL, permalink_structure: '' }, admins: 3 },
  { id: 'oldsite',     name: 'oldsite',     source: 'local', domain: 'oldsite.local',     wp: '6.8', php: '7.4.33', posts: 3,  users: 1,  lastPost: NOW - 90 * DAY, settings: { ...SETTINGS_NORMAL, default_comment_status: 'closed' }, admins: 1 },
  { id: 'newsite',     name: 'newsite',     source: 'local', domain: 'newsite.local',     wp: '7.0', php: '8.3.1',  posts: 2,  users: 2,  lastPost: NOW - 5 * DAY,  settings: { ...SETTINGS_NORMAL, show_on_front: 'page' } },
  { id: 'hiddensite',  name: 'hiddensite',  source: 'local', domain: 'hiddensite.local',  wp: '7.0', php: '8.2.29', posts: 10, users: 3,  lastPost: NOW - 60 * DAY, settings: { ...SETTINGS_NORMAL, blog_public: '0' } },
  { id: 'regopen',     name: 'regopen',     source: 'local', domain: 'regopen.local',     wp: '7.0', php: '8.2.29', posts: 5,  users: 20, lastPost: NOW - 7 * DAY,  settings: { ...SETTINGS_NORMAL, users_can_register: '1' } },
  { id: 'neverposted', name: 'neverposted', source: 'local', domain: 'neverposted.local', wp: '7.0', php: '8.2',    posts: 1,  users: 1,  lastPost: null,           settings: { ...SETTINGS_NORMAL } },
  // settings_json present but carrying none of the five filterable keys.
  { id: 'partialset',  name: 'partialset',  source: 'local', domain: 'partialset.local',  wp: '7.0', php: '8.2',    posts: 1,  users: 1,  lastPost: NOW - 3 * DAY,  settings: { blogname: 'Partial' } },

  { id: 'wpe-prod',    name: 'wpe-prod',    source: 'wpe', domain: 'prod.wpengine.com', wp: '6.9', php: '8.2', posts: 100, users: null, lastPost: NOW - 3 * DAY,  env: 'production', admins: 2 },
  { id: 'wpe-stg',     name: 'wpe-stg',     source: 'wpe', domain: 'stg.wpengine.com',  wp: '6.9', php: '7.4', posts: 10,  users: null, lastPost: NOW - 15 * DAY, env: 'staging', admins: 0 },
  { id: 'wpe-inact',   name: 'wpe-inact',   source: 'wpe', domain: 'inact.wpengine.com', wp: '7.0', php: '8.3', posts: 5,  users: null, lastPost: NOW - 1 * DAY,  env: 'production' },
  { id: 'wpe-special', name: 'wpe-special', source: 'wpe', domain: 'sp.wpengine.com',   wp: '7.0', php: '8.3', posts: 8,   users: null, lastPost: NOW - 2 * DAY,  settings: SETTINGS_SPECIAL, env: 'production' },
  { id: 'wpe-normal',  name: 'wpe-normal',  source: 'wpe', domain: 'no.wpengine.com',   wp: '7.0', php: '8.3', posts: 9,   users: null, lastPost: NOW - 2 * DAY,  settings: SETTINGS_NORMAL,  env: 'production' },

  { id: 'ssh:ext-host',    name: 'ext-host',    source: 'external', domain: 'ext.example.com',  wp: '6.9', php: '8.1', posts: 12, users: null, lastPost: NOW - 20 * DAY, env: 'production', admins: 4 },
  { id: 'ssh:ext-special', name: 'ext-special', source: 'external', domain: 'sp.example.com',   wp: '7.0', php: '8.3', posts: 5,  users: null, lastPost: NOW - 2 * DAY,  settings: SETTINGS_SPECIAL, env: 'production' },
  // The one non-production external host: proves the external chain reads its
  // OWN environment label rather than defaulting every SSH host to production.
  { id: 'ssh:ext-normal',  name: 'ext-normal',  source: 'external', domain: 'no.example.com',   wp: '7.0', php: '8.3', posts: 6,  users: null, lastPost: NOW - 2 * DAY,  settings: SETTINGS_NORMAL,  env: 'staging', admins: 2 },
];

/** site_id -> number of rows in the `users` table (how WPE/external counts are read). */
const USER_ROWS: Record<string, number> = { 'wpe-prod': 5, 'wpe-stg': 2, 'ssh:ext-host': 4 };

const PLUGINS: Array<[siteId: string, slug: string, name: string, version: string, active: 0 | 1]> = [
  ['myloop',       'advanced-custom-fields', 'ACF',         '6.8.3', 1],
  ['myloop',       'woocommerce',            'WooCommerce', '9.1.0', 0], // installed, INACTIVE
  ['oldsite',      'woocommerce',            'WooCommerce', '8.0.0', 1],
  ['oldsite',      'advanced-custom-fields', 'ACF',         '5.12.0', 1],
  ['newsite',      'akismet',                'Akismet',     '5.7.0', 1],
  ['wpe-prod',     'advanced-custom-fields', 'ACF',         '6.8.3', 1],
  ['wpe-stg',      'advanced-custom-fields', 'ACF',         '5.9.0', 1],
  ['wpe-inact',    'advanced-custom-fields', 'ACF',         '5.0.1', 0], // old but INACTIVE
  ['ssh:ext-host', 'advanced-custom-fields', 'ACF',         '6.0.0', 1],
];

function makeGraphDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT, domain TEXT, wp_version TEXT,
      php_version TEXT, source TEXT, updated_at INTEGER, is_active INTEGER,
      post_count INTEGER, user_count INTEGER, user_count_by_role TEXT,
      last_post_at INTEGER, settings_json TEXT,
      remote_install_id TEXT, remote_domain TEXT, environment TEXT, account_id TEXT);
    CREATE TABLE plugins (site_id TEXT, slug TEXT, name TEXT, version TEXT, is_active INTEGER, updated_at INTEGER);
    CREATE TABLE users (site_id TEXT, role TEXT);
  `);
  const insertSite = db.prepare(
    `INSERT INTO sites (id,name,domain,wp_version,php_version,source,updated_at,is_active,
      post_count,user_count,user_count_by_role,last_post_at,settings_json,environment)
     VALUES (?,?,?,?,?,?,?,1,?,?,?,?,?,?)`,
  );
  for (const s of SITES) {
    insertSite.run(
      s.id, s.name, s.domain, s.wp, s.php, s.source, NOW,
      s.posts, s.users,
      // Real shape, per GraphService and the MCP server instructions:
      // `{"administrator":N,"editor":N,...}`. NULL when never collected.
      s.admins === undefined ? null : JSON.stringify({ administrator: s.admins, editor: 0 }),
      s.lastPost, s.settings ? JSON.stringify(s.settings) : null, s.env ?? null,
    );
  }
  const insertPlugin = db.prepare(
    `INSERT INTO plugins (site_id,slug,name,version,is_active,updated_at) VALUES (?,?,?,?,?,?)`,
  );
  for (const [siteId, slug, name, version, active] of PLUGINS) {
    insertPlugin.run(siteId, slug, name, version, active, NOW);
  }
  const insertUser = db.prepare(`INSERT INTO users (site_id,role) VALUES (?,?)`);
  for (const [siteId, count] of Object.entries(USER_ROWS)) {
    for (let i = 0; i < count; i++) insertUser.run(siteId, i === 0 ? 'administrator' : 'author');
  }
  return db;
}

/** Local's OWN store — the local chain iterates this, not the graph. */
function localStore(): Record<string, any> {
  const out: Record<string, any> = {};
  for (const s of SITES.filter((x) => x.source === 'local')) {
    out[s.id] = { id: s.id, name: s.name, domain: s.domain, phpVersion: s.php };
  }
  return out;
}

function makeDeps(graphDb: InstanceType<typeof Database>) {
  const noop = () => {};
  const rows = () => graphDb.prepare(`SELECT * FROM sites WHERE is_active = 1`).all() as any[];
  return {
    siteData: { getSite: (id: string) => localStore()[id] ?? null, getSites: () => localStore() },
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
      listSites: async (opts: { source?: string; active_only?: boolean } = {}) =>
        rows().filter((r) => !opts.source || r.source === opts.source),
    },
    eventProcessor: {},
    vectorDbPath: '/tmp/nexus-test-vectors.db',
    nexusServices: { twinService: { getAll: () => [] } },
  } as any;
}

let graphDb: InstanceType<typeof Database>;

beforeAll(() => {
  graphDb = makeGraphDb();
  mockIpc.handlers.clear();
  registerIpcHandlers(makeDeps(graphDb));
});

afterAll(() => graphDb.close());

/** Invoke the real handler. Returns the payload; fails loudly on `success:false`. */
async function apply(filters: Record<string, unknown>): Promise<any> {
  const res: any = await mockIpc.invoke(IPC_CHANNELS.SITE_FINDER_APPLY, filters);
  if (res?.success !== true) throw new Error(`SITE_FINDER_APPLY failed: ${res?.error}`);
  return res;
}

/**
 * Matched site NAMES, as the copy's `applyFilter()` returned them, so the ported
 * assertions read the same. Drawn from the three rendered buckets rather than
 * `siteIds`, which additionally proves each match landed in the right bucket.
 */
async function names(filters: Record<string, unknown>): Promise<string[]> {
  const res = await apply(filters);
  return [...(res.local ?? []), ...(res.wpe ?? []), ...(res.external ?? [])].map((r: any) => r.name);
}

// ---------------------------------------------------------------------------
// P0 — recentPostDays
// ---------------------------------------------------------------------------

describe('P0: recentPostDays filter', () => {
  it('returns sites updated within 7 days — on all three chains', async () => {
    const results = await names({ recentPostDays: 7 });
    expect(results).toContain('myloop');      // local, -2d
    expect(results).toContain('newsite');     // local, -5d
    expect(results).toContain('wpe-prod');    // wpe, -3d
    expect(results).toContain('ext-special'); // external, -2d
    expect(results).not.toContain('oldsite');     // -90d
    expect(results).not.toContain('hiddensite');  // -60d
    expect(results).not.toContain('wpe-stg');     // -15d
    expect(results).not.toContain('ext-host');    // -20d
  });

  it('returns sites updated within 30 days', async () => {
    const results = await names({ recentPostDays: 30 });
    expect(results).toContain('myloop');
    expect(results).toContain('newsite');
    expect(results).toContain('regopen');   // -7d
    expect(results).toContain('wpe-stg');   // -15d
    expect(results).toContain('ext-host');  // -20d
    expect(results).not.toContain('oldsite');
    expect(results).not.toContain('hiddensite');
  });

  it('is the inverse of stalePostDays for the same N', async () => {
    const recent = await names({ recentPostDays: 30 });
    const stale = await names({ stalePostDays: 30 });
    const all = SITES.map((s) => s.name);
    for (const name of all) {
      expect([name, recent.includes(name) && stale.includes(name)]).toEqual([name, false]);
    }
  });

  it('[new] treats a NULL last_post_at as stale, never as recent', async () => {
    // The two filters read the same column with opposite null-handling:
    // stale skips the check when the column is NULL, recent excludes on it.
    // "Never posted" is the one row that is in neither set by accident.
    expect(await names({ stalePostDays: 30 })).toContain('neverposted');
    expect(await names({ recentPostDays: 30 })).not.toContain('neverposted');
  });
});

// ---------------------------------------------------------------------------
// P1 — phpEolOnly, wpVersionOlderThan, maxPostCount, maxUserCount, pluginVersion
// ---------------------------------------------------------------------------

describe('P1: phpEolOnly filter', () => {
  it('returns only sites on EOL PHP — on all three chains', async () => {
    const results = await names({ phpEolOnly: true });
    expect(results).toContain('oldsite');  // local,    PHP 7.4.33
    expect(results).toContain('wpe-stg');  // wpe,      PHP 7.4
    expect(results).toContain('ext-host'); // external, PHP 8.1
    expect(results).not.toContain('myloop');      // 8.2
    expect(results).not.toContain('newsite');     // 8.3
    expect(results).not.toContain('wpe-prod');    // 8.2
    expect(results).not.toContain('ext-special'); // 8.3
  });
});

describe('P1: wpVersionOlderThan filter', () => {
  it('returns sites running WP older than 7.0 — on all three chains', async () => {
    const results = await names({ wpVersionOlderThan: '7.0' });
    expect(results).toContain('oldsite');   // 6.8
    expect(results).toContain('wpe-prod');  // 6.9
    expect(results).toContain('wpe-stg');   // 6.9
    expect(results).toContain('ext-host');  // 6.9
    expect(results).not.toContain('myloop');
    expect(results).not.toContain('newsite');
  });

  it('[new] excludes a site sitting exactly on the bound (older-than is strict)', async () => {
    const results = await names({ wpVersionOlderThan: '7.0' });
    for (const name of ['myloop', 'wpe-inact', 'ext-special']) { // all exactly WP 7.0
      expect([name, results.includes(name)]).toEqual([name, false]);
    }
  });
});

describe('P1: maxPostCount filter', () => {
  it('returns sites with fewer than 5 posts', async () => {
    const results = await names({ maxPostCount: 5 });
    expect(results).toContain('oldsite');  // 3
    expect(results).toContain('newsite');  // 2
    expect(results).not.toContain('myloop');   // 59
    expect(results).not.toContain('wpe-prod'); // 100
  });

  it('[new] excludes a site sitting exactly on the cap, on all three chains', async () => {
    const results = await names({ maxPostCount: 5 });
    for (const name of ['regopen', 'wpe-inact', 'ext-special']) { // all exactly 5 posts
      expect([name, results.includes(name)]).toEqual([name, false]);
    }
  });
});

describe('P1: maxUserCount filter', () => {
  it('returns sites with fewer than 3 users', async () => {
    // Local counts read `sites.user_count`; WPE and external count `users` rows.
    // Two data sources, one filter — see the waiver note in this file's header.
    const results = await names({ maxUserCount: 3 });
    expect(results).toContain('oldsite');  // local, 1
    expect(results).toContain('newsite');  // local, 2
    expect(results).toContain('wpe-stg');  // wpe,   2 rows in `users`
    expect(results).not.toContain('myloop');   // 81
    expect(results).not.toContain('regopen');  // 20
    expect(results).not.toContain('wpe-prod'); // 5 rows
    expect(results).not.toContain('ext-host'); // 4 rows
  });

  it('[new] excludes a site sitting exactly on the cap', async () => {
    expect(await names({ maxUserCount: 3 })).not.toContain('hiddensite'); // exactly 3
  });
});

describe('P1: pluginVersion filter', () => {
  it('returns sites with ACF older than 6.3.0 — on all three chains', async () => {
    const results = await names({ pluginVersion: { slug: 'advanced-custom-fields', olderThan: '6.3.0' } });
    expect(results).toContain('oldsite');   // local,    5.12.0
    expect(results).toContain('wpe-stg');   // wpe,      5.9.0
    expect(results).toContain('ext-host');  // external, 6.0.0
    expect(results).not.toContain('myloop');   // 6.8.3
    expect(results).not.toContain('wpe-prod'); // 6.8.3
  });

  it('returns no sites when all versions are current', async () => {
    const res = await apply({ pluginVersion: { slug: 'advanced-custom-fields', olderThan: '5.0.0' } });
    expect(res.siteIds).toHaveLength(0);
  });

  it('excludes sites where the plugin is not installed', async () => {
    const results = await names({ pluginVersion: { slug: 'advanced-custom-fields', olderThan: '9.0.0' } });
    expect(results).not.toContain('newsite');     // local, no ACF
    expect(results).not.toContain('wpe-special'); // wpe, no ACF
    expect(results).not.toContain('ext-normal');  // external, no ACF
    expect(results).toContain('myloop');          // installed and current-but-under-9.0.0
  });

  it('[new] requires the plugin to be ACTIVE, where the plugins filter does not', async () => {
    // wpe-inact carries ACF 5.0.1 with is_active = 0. The `plugins` predicate
    // asks only whether a row exists; `pluginVersion` asks for an ACTIVE row.
    // Same fixture row, two answers — the asymmetry is real and is load-bearing.
    expect(await names({ plugins: ['advanced-custom-fields'] })).toContain('wpe-inact');
    expect(await names({ pluginVersion: { slug: 'advanced-custom-fields', olderThan: '9.0.0' } }))
      .not.toContain('wpe-inact');
  });
});

// ---------------------------------------------------------------------------
// P2 — settings_json based filters. Each runs on all three chains: the copy
// could only ever prove these on local sites, because only local sites in its
// fixture carried settings_json.
// ---------------------------------------------------------------------------

describe('P2: commentsDisabled filter — both directions', () => {
  it('true: returns only sites with comments closed', async () => {
    const results = await names({ commentsDisabled: true });
    expect(results).toContain('oldsite');
    expect(results).toContain('wpe-special');
    expect(results).toContain('ext-special');
    expect(results).not.toContain('myloop');
    expect(results).not.toContain('newsite');
    expect(results).not.toContain('wpe-normal');
  });

  it('false: returns only sites with comments open (inverse)', async () => {
    const results = await names({ commentsDisabled: false });
    expect(results).toContain('myloop');
    expect(results).toContain('newsite');
    expect(results).toContain('wpe-normal');
    expect(results).toContain('ext-normal');
    expect(results).not.toContain('oldsite');
    expect(results).not.toContain('wpe-special');
  });
});

describe('P2: hiddenFromSearch filter — both directions', () => {
  it('true: returns only sites blocking search engines', async () => {
    const results = await names({ hiddenFromSearch: true });
    expect(results).toContain('hiddensite');
    expect(results).toContain('wpe-special');
    expect(results).toContain('ext-special');
    expect(results).not.toContain('myloop');
    expect(results).not.toContain('oldsite');
  });

  it('false: returns only sites visible to search engines (inverse)', async () => {
    const results = await names({ hiddenFromSearch: false });
    expect(results).toContain('myloop');
    expect(results).toContain('oldsite');
    expect(results).toContain('wpe-normal');
    expect(results).not.toContain('hiddensite');
    expect(results).not.toContain('ext-special');
  });
});

describe('P2: selfRegistrationOpen filter — both directions', () => {
  it('true: returns only sites with open registration', async () => {
    const results = await names({ selfRegistrationOpen: true });
    expect(results).toContain('regopen');
    expect(results).toContain('wpe-special');
    expect(results).toContain('ext-special');
    expect(results).not.toContain('myloop');
  });

  it('false: returns only sites with closed registration (inverse)', async () => {
    const results = await names({ selfRegistrationOpen: false });
    expect(results).toContain('myloop');
    expect(results).toContain('wpe-normal');
    expect(results).not.toContain('regopen');
    expect(results).not.toContain('ext-special');
  });
});

describe('P2: staticFrontPage filter — both directions', () => {
  it('true: returns only sites with a static homepage', async () => {
    const results = await names({ staticFrontPage: true });
    expect(results).toContain('newsite');
    expect(results).toContain('wpe-special');
    expect(results).toContain('ext-special');
    expect(results).not.toContain('myloop');
    expect(results).not.toContain('regopen');
  });

  it('false: returns only sites with a blog-roll front page (inverse)', async () => {
    const results = await names({ staticFrontPage: false });
    expect(results).toContain('myloop');
    expect(results).toContain('regopen');
    expect(results).toContain('wpe-normal');
    expect(results).not.toContain('newsite');
    expect(results).not.toContain('ext-special');
  });
});

describe('P2: plainPermalinks filter — both directions', () => {
  it('true: returns only sites with plain (ugly) permalinks', async () => {
    const results = await names({ plainPermalinks: true });
    expect(results).toContain('myloop');
    expect(results).toContain('wpe-special');
    expect(results).toContain('ext-special');
    expect(results).not.toContain('oldsite');
    expect(results).not.toContain('newsite');
  });

  it('false: returns only sites with pretty permalinks (inverse)', async () => {
    const results = await names({ plainPermalinks: false });
    expect(results).toContain('oldsite');
    expect(results).toContain('newsite');
    expect(results).toContain('wpe-normal');
    expect(results).not.toContain('myloop');
    expect(results).not.toContain('ext-special');
  });
});

describe('P2: unknown settings state is excluded from BOTH directions', () => {
  it('[new] excludes a site with no settings_json at all', async () => {
    // wpe-prod and ext-host have settings_json NULL. Unknown is not "false".
    for (const direction of [true, false]) {
      const results = await names({ commentsDisabled: direction });
      expect([direction, results.includes('wpe-prod')]).toEqual([direction, false]);
      expect([direction, results.includes('ext-host')]).toEqual([direction, false]);
    }
  });

  it('[new] excludes a site whose settings_json lacks the specific key', async () => {
    // partialset has settings_json, but none of the five filterable keys. A
    // per-key branch in each chain handles this separately from the NULL case.
    for (const filter of [
      { commentsDisabled: false }, { hiddenFromSearch: false }, { selfRegistrationOpen: false },
      { staticFrontPage: false }, { plainPermalinks: false },
    ]) {
      const key = Object.keys(filter)[0];
      expect([key, (await names(filter)).includes('partialset')]).toEqual([key, false]);
    }
  });
});

// ---------------------------------------------------------------------------
// P3 — Source filter
// ---------------------------------------------------------------------------

describe('P3: source filter', () => {
  it('source=wpe returns only WPE sites', async () => {
    const results = await names({ source: 'wpe' });
    expect(results).toContain('wpe-prod');
    expect(results).toContain('wpe-stg');
    expect(results).not.toContain('myloop');
    expect(results).not.toContain('newsite');
    expect(results).not.toContain('ext-host');
  });

  it('source=local returns only local sites', async () => {
    const results = await names({ source: 'local' });
    expect(results).toContain('myloop');
    expect(results).toContain('newsite');
    expect(results).not.toContain('wpe-prod');
    expect(results).not.toContain('wpe-stg');
    expect(results).not.toContain('ext-host');
  });

  it('source=external returns only external hosts', async () => {
    const results = await names({ source: 'external' });
    expect(results).toContain('ext-host');
    expect(results).not.toContain('myloop');
    expect(results).not.toContain('wpe-prod');
  });

  it('an unfiltered query includes external hosts alongside local and WPE', async () => {
    const results = await names({ recentPostDays: 30 });
    expect(results).toContain('ext-host'); // -20d
    expect(results).toContain('myloop');
    expect(results).toContain('wpe-stg');
  });

  it('[new] renders each match into the bucket for its own source', async () => {
    // The copy returned one flat list and could not express this at all; the
    // renderer reads the three arrays, not siteIds.
    const res = await apply({ source: 'external' });
    expect(res.external.map((r: any) => r.id)).toEqual(expect.arrayContaining(['ssh:ext-host']));
    expect(res.local).toHaveLength(0);
    expect(res.wpe).toHaveLength(0);
    // …and the external bucket carries the fields only that bucket has.
    const host = res.external.find((r: any) => r.id === 'ssh:ext-host');
    expect(host).toMatchObject({ type: 'external', alias: 'ext-host', environment: 'production' });
  });
});

// ---------------------------------------------------------------------------
// WP-04c — the three divergences WP-04b found and withheld. See the file header.
// ---------------------------------------------------------------------------

describe('WP-04c: phpVersions filter — all three chains', () => {
  it('filters LOCAL sites on an exact full-patch version', async () => {
    const results = await names({ phpVersions: ['8.2.29'] });
    expect(results).toContain('myloop');
    expect(results).toContain('hiddensite');
    expect(results).toContain('regopen');
    expect(results).not.toContain('newsite');  // 8.3.1
    expect(results).not.toContain('oldsite');  // 7.4.33
  });

  it('no longer returns every remote site unfiltered — the WP-04b defect', async () => {
    // Before the fix, neither the WPE loop nor the external loop had a
    // phpVersions branch at all: this exact query filtered the local sites
    // correctly and returned 5 of 5 WPE installs and 3 of 3 external hosts,
    // none of them on 8.2.29. The buckets, not `siteIds`, are asserted so the
    // regression cannot hide behind a local match.
    const res = await apply({ phpVersions: ['8.2.29'] });
    expect(res.wpe).toHaveLength(0);
    expect(res.external).toHaveLength(0);
    expect(res.local.length).toBeGreaterThan(0); // and the chain that DID work still does
  });

  it('filters the WPE chain, whose stored version is major.minor', async () => {
    const results = await names({ phpVersions: ['8.2'] });
    expect(results).toContain('wpe-prod');     // wpe, stored '8.2'
    expect(results).toContain('neverposted');  // local, stored '8.2'
    expect(results).not.toContain('myloop');   // local, '8.2.29' — exact, not prefix
    expect(results).not.toContain('wpe-stg');  // 7.4
  });

  it('filters the EXTERNAL chain in isolation', async () => {
    // ext-host is the only site in the fixture on 8.1, so a match here cannot
    // be an accident of another chain.
    const res = await apply({ phpVersions: ['8.1'] });
    expect(res.external.map((r: any) => r.name)).toEqual(['ext-host']);
    expect(res.local).toHaveLength(0);
    expect(res.wpe).toHaveLength(0);
  });

  it('matches across the WPE and external chains at once', async () => {
    const results = await names({ phpVersions: ['8.3'] });
    expect(results).toContain('wpe-inact');
    expect(results).toContain('ext-special');
    expect(results).toContain('ext-normal');
    expect(results).not.toContain('newsite'); // local '8.3.1' — exact membership
  });
});

describe('WP-04c: wpeEnvironment filter', () => {
  it('returns only staging, across BOTH remote chains', async () => {
    // ext-normal is the fixture's one non-production external host: this is the
    // assertion that proves the external chain reads its own label rather than
    // treating every SSH host as production.
    const results = await names({ wpeEnvironment: 'staging' });
    expect(results.sort()).toEqual(['ext-normal', 'wpe-stg']);
  });

  it('returns only production', async () => {
    const results = await names({ wpeEnvironment: 'production' });
    expect(results).toContain('wpe-prod');
    expect(results).toContain('ext-host');
    expect(results).not.toContain('wpe-stg');    // staging
    expect(results).not.toContain('ext-normal'); // staging
  });

  it('matches NO local site, on purpose — this is a decision, not a gap', async () => {
    // Owner ruling (WP-04c): a Local site has no meaningful environment axis.
    // The graph stores a constant 'development' for every one, and most Local
    // sites have no graph row at all, so matching on it would be matching on
    // indexing coverage rather than on a fact about the site. Asserted for all
    // three values so a future implementation on the local chain fails here
    // rather than passing silently.
    for (const env of ['production', 'staging', 'development'] as const) {
      const res = await apply({ wpeEnvironment: env });
      expect([env, res.local]).toEqual([env, []]);
    }
  });

  it('no longer returns the whole fleet — the WP-04b defect', async () => {
    // Before the fix, no chain implemented this, so the filter passed hasFilter
    // and then matched everything: all 15 fixture sites, the exact outcome the
    // empty-filter guard exists to prevent.
    const results = await names({ wpeEnvironment: 'staging' });
    expect(results.length).toBeLessThan(SITES.length);
    expect(results).not.toContain('myloop');
  });
});

describe('WP-04c: minAdminCount filter — all three chains', () => {
  it('returns sites with at least 2 administrators, on all three chains', async () => {
    const results = await names({ minAdminCount: 2 });
    expect(results).toContain('myloop');     // local,    3
    expect(results).toContain('wpe-prod');   // wpe,      2 — exactly on the bound
    expect(results).toContain('ext-host');   // external, 4
    expect(results).toContain('ext-normal'); // external, 2
    expect(results).not.toContain('oldsite'); // local, 1
    expect(results).not.toContain('wpe-stg'); // wpe,   0
  });

  it('[boundary] the bound is inclusive (>=), not strict', async () => {
    // wpe-prod and ext-normal both have exactly 2 admins: in at 2, out at 3.
    expect(await names({ minAdminCount: 2 })).toEqual(expect.arrayContaining(['wpe-prod', 'ext-normal']));
    const strict = await names({ minAdminCount: 3 });
    expect(strict).toContain('myloop');           // 3
    expect(strict).not.toContain('wpe-prod');     // 2
    expect(strict).not.toContain('ext-normal');   // 2
  });

  it('excludes a NULL user_count_by_role as UNKNOWN, on each chain separately', async () => {
    // The rule is the settings_json precedent already stated on all three
    // chains: unknown state is excluded from the filter, never defaulted. A
    // site whose admin count was never collected must not be reported as
    // having N admins. minAdminCount:1 is the weakest possible threshold — if
    // NULL were being read as 0 these would still be out, but if it were being
    // read as "no constraint" (or the column ignored) they would be IN.
    const results = await names({ minAdminCount: 1 });
    for (const name of ['newsite', 'hiddensite', 'regopen']) {   // local, NULL
      expect([name, results.includes(name)]).toEqual([name, false]);
    }
    for (const name of ['wpe-inact', 'wpe-special', 'wpe-normal']) { // wpe, NULL
      expect([name, results.includes(name)]).toEqual([name, false]);
    }
    expect([results.includes('ext-special')]).toEqual([false]);   // external, NULL
    // …and the sites that DO have a count are still there, so the assertion
    // above is not passing because the filter excluded everything.
    expect(results).toEqual(expect.arrayContaining(['myloop', 'oldsite', 'wpe-prod', 'ext-host']));
  });

  it('no longer returns the whole fleet — the WP-04b defect', async () => {
    const results = await names({ minAdminCount: 2 });
    expect(results.length).toBeLessThan(SITES.length);
    expect(results).not.toContain('oldsite');
  });
});

// ---------------------------------------------------------------------------
// Composite — combinations of filters
// ---------------------------------------------------------------------------

describe('composite filters', () => {
  it('WooCommerce sites on EOL PHP', async () => {
    const results = await names({ plugins: ['woocommerce'], phpEolOnly: true });
    expect(results).toContain('oldsite');    // WooCommerce + PHP 7.4
    expect(results).not.toContain('myloop'); // has WooCommerce, but PHP 8.2
  });

  it('[new] the plugins predicate ignores is_active — myloop matches on an INACTIVE WooCommerce', async () => {
    // This is why the composite above excludes myloop on PHP alone, and not,
    // as the copy's comment claimed, because its WooCommerce is inactive.
    expect(await names({ plugins: ['woocommerce'] })).toContain('myloop');
  });

  it('recently active large sites', async () => {
    const results = await names({ recentPostDays: 10, minPostCount: 20 });
    expect(results).toContain('myloop');       // -2d, 59 posts
    expect(results).toContain('wpe-prod');     // -3d, 100 posts
    expect(results).not.toContain('newsite');  // -5d but 2 posts
    expect(results).not.toContain('ext-host'); // 12 posts, and -20d
  });

  it('WPE sites on outdated WP', async () => {
    const results = await names({ source: 'wpe', wpVersionOlderThan: '7.0' });
    expect(results).toContain('wpe-prod');
    expect(results).toContain('wpe-stg');
    expect(results).not.toContain('myloop');
    expect(results).not.toContain('ext-host'); // also WP 6.9 — excluded by source
  });
});

// ---------------------------------------------------------------------------
// Empty-filter guard — must never return all sites
// ---------------------------------------------------------------------------

describe('empty-filter guard', () => {
  // The copy asserted a re-declared `hasFilter()` directly. The real one is a
  // closure-local const, so these assert the same four inputs through the
  // handler's own result instead (waiver (b) in the header).
  it('an empty filter returns no results', async () => {
    const res = await apply({});
    expect(res.siteIds).toEqual([]);
  });

  it('an all-empty-array filter returns no results', async () => {
    const res = await apply({ plugins: [] });
    expect(res.siteIds).toEqual([]);
  });

  it('a real filter returns something', async () => {
    expect((await apply({ recentPostDays: 30 })).siteIds.length).toBeGreaterThan(0);
    expect((await apply({ phpEolOnly: true })).siteIds.length).toBeGreaterThan(0);
  });

  it('the guard is not merely returning everything under another name', async () => {
    // A guard that passed by returning all sites would make this identical.
    const filtered = (await apply({ phpEolOnly: true })).siteIds;
    expect(filtered.length).toBeLessThan(SITES.length);
  });
});
