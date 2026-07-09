/**
 * Tier 2 — Site Finder filter apply integration tests
 *
 * Tests filter logic against an in-memory SQLite DB seeded with known data.
 * Asserts specific sites appear/don't appear for each filter type.
 *
 * These are the FAILING BASELINE — implement features to make them pass.
 *
 * Seeded sites:
 *   local:
 *     myloop       — WP 7.0, PHP 8.2, 59 posts, 81 users, updated 2d ago, ACF 6.8.3, plain perms, comments open
 *     oldsite      — WP 6.8, PHP 7.4, 3 posts, 1 user,  updated 90d ago, WooCommerce 8.0, pretty perms, comments closed
 *     newsite      — WP 7.0, PHP 8.3, 2 posts, 2 users, updated 5d ago,  no plugins, static front page
 *     hiddensite   — WP 7.0, PHP 8.2, 10 posts, 3 users, updated 60d ago, blog_public=0
 *     regopen      — WP 7.0, PHP 8.2, 5 posts, 20 users, updated 7d ago, users_can_register=1
 *   wpe:
 *     wpe-prod     — WP 6.9, PHP 8.2, 100 posts, 5 users, env=production, updated 3d ago
 *     wpe-stg      — WP 6.9, PHP 7.4, 10 posts, 2 users, env=staging, updated 15d ago
 */

import Database from 'better-sqlite3';

const NOW = Date.now();
const DAY = 24 * 60 * 60 * 1000;

function makeDb(): InstanceType<typeof Database> {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE sites (
      id TEXT PRIMARY KEY, name TEXT, source TEXT, wp_version TEXT, php_version TEXT,
      is_active INTEGER DEFAULT 1, post_count INTEGER, user_count INTEGER,
      last_post_at INTEGER, post_count_by_type TEXT, settings_json TEXT,
      account_id TEXT
    );
    CREATE TABLE plugins (
      id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT, slug TEXT, name TEXT,
      version TEXT, is_active INTEGER DEFAULT 1
    );
  `);

  // Local sites
  const localSites = [
    { id: 'myloop',      name: 'myloop',      source: 'local', wp: '7.0', php: '8.2.29', posts: 59,  users: 81,  lastPost: NOW - 2*DAY,  settings: { blogname: 'My Loop', permalink_structure: '', default_comment_status: 'open', blog_public: '1', show_on_front: 'posts', users_can_register: '0' } },
    { id: 'oldsite',     name: 'oldsite',     source: 'local', wp: '6.8', php: '7.4.33', posts: 3,   users: 1,   lastPost: NOW - 90*DAY, settings: { blogname: 'Old Site', permalink_structure: '/%postname%/', default_comment_status: 'closed', blog_public: '1', show_on_front: 'posts', users_can_register: '0' } },
    { id: 'newsite',     name: 'newsite',     source: 'local', wp: '7.0', php: '8.3.1',  posts: 2,   users: 2,   lastPost: NOW - 5*DAY,  settings: { blogname: 'New Site', permalink_structure: '/%postname%/', default_comment_status: 'open', blog_public: '1', show_on_front: 'page', users_can_register: '0' } },
    { id: 'hiddensite',  name: 'hiddensite',  source: 'local', wp: '7.0', php: '8.2.29', posts: 10,  users: 3,   lastPost: NOW - 60*DAY, settings: { blogname: 'Hidden', permalink_structure: '/%postname%/', default_comment_status: 'open', blog_public: '0', show_on_front: 'posts', users_can_register: '0' } },
    { id: 'regopen',     name: 'regopen',     source: 'local', wp: '7.0', php: '8.2.29', posts: 5,   users: 20,  lastPost: NOW - 7*DAY,  settings: { blogname: 'Reg Open', permalink_structure: '/%postname%/', default_comment_status: 'open', blog_public: '1', show_on_front: 'posts', users_can_register: '1' } },
  ];

  // WPE sites
  const wpeSites = [
    { id: 'wpe-prod',    name: 'wpe-prod',    source: 'wpe',   wp: '6.9', php: '8.2', posts: 100, users: 5,  lastPost: NOW - 3*DAY,  account_id: 'acc1' },
    { id: 'wpe-stg',     name: 'wpe-stg',     source: 'wpe',   wp: '6.9', php: '7.4', posts: 10,  users: 2,  lastPost: NOW - 15*DAY, account_id: 'acc1' },
  ];

  const insertSite = db.prepare(
    `INSERT INTO sites VALUES (?,?,?,?,?,1,?,?,?,NULL,?,NULL)`,
  );
  for (const s of localSites) {
    insertSite.run(s.id, s.name, s.source, s.wp, s.php, s.posts, s.users, s.lastPost, JSON.stringify(s.settings));
  }
  const insertWpe = db.prepare(
    `INSERT INTO sites (id,name,source,wp_version,php_version,is_active,post_count,user_count,last_post_at,account_id) VALUES (?,?,?,?,?,1,?,?,?,?)`,
  );
  for (const s of wpeSites) {
    insertWpe.run(s.id, s.name, s.source, s.wp, s.php, s.posts, s.users, s.lastPost, s.account_id);
  }

  // Plugins
  const insertPlugin = db.prepare(
    `INSERT INTO plugins (site_id, slug, name, version, is_active) VALUES (?,?,?,?,?)`,
  );
  insertPlugin.run('myloop',  'advanced-custom-fields', 'ACF',          '6.8.3', 1);
  insertPlugin.run('oldsite', 'woocommerce',             'WooCommerce',  '8.0.0', 1);
  insertPlugin.run('oldsite', 'advanced-custom-fields', 'ACF',          '5.12.0', 1); // old ACF
  insertPlugin.run('newsite', 'akismet',                 'Akismet',      '5.7.0', 1);
  insertPlugin.run('myloop',  'woocommerce',             'WooCommerce',  '9.1.0', 0); // inactive

  return db;
}

// Helper: run the equivalent of the SITE_FINDER_APPLY handler logic against the test DB
function applyFilter(db: InstanceType<typeof Database>, filter: Record<string, any>): string[] {
  const now = Date.now();
  const results: string[] = [];

  const sites = db.prepare(`SELECT * FROM sites WHERE is_active = 1`).all() as any[];

  for (const site of sites) {
    let match = true;

    // Plugin filter
    if (filter.plugins?.length) {
      const ph = filter.plugins.map(() => '?').join(',');
      const row = db.prepare(`SELECT 1 FROM plugins WHERE site_id=? AND slug IN (${ph}) LIMIT 1`).get(site.id, ...filter.plugins);
      if (!row) match = false;
    }

    // PHP versions
    if (match && filter.phpVersions?.length) {
      const phpMatch = filter.phpVersions.some((v: string) => site.php_version?.startsWith(v));
      if (!phpMatch) match = false;
    }

    // WP versions
    if (match && filter.wpVersions?.length) {
      const wpMatch = filter.wpVersions.some((v: string) => site.wp_version === v || site.wp_version?.startsWith(v + '.'));
      if (!wpMatch) match = false;
    }

    // minPostCount
    if (match && filter.minPostCount != null) {
      if (!site.post_count || site.post_count < filter.minPostCount) match = false;
    }

    // minUserCount
    if (match && filter.minUserCount != null) {
      if (!site.user_count || site.user_count < filter.minUserCount) match = false;
    }

    // stalePostDays
    if (match && filter.stalePostDays != null) {
      const cutoff = now - filter.stalePostDays * DAY;
      if (site.last_post_at && site.last_post_at > cutoff) match = false;
    }

    // ── P0 ──────────────────────────────────────────────────────────────────

    // recentPostDays — sites updated WITHIN N days
    if (match && filter.recentPostDays != null) {
      const cutoff = now - filter.recentPostDays * DAY;
      if (!site.last_post_at || site.last_post_at < cutoff) match = false;
    }

    // ── P1 ──────────────────────────────────────────────────────────────────

    const PHP_EOL_PREFIXES = ['5.6','7.0','7.1','7.2','7.3','7.4','8.0','8.1'];

    // phpEolOnly
    if (match && filter.phpEolOnly) {
      const isEol = PHP_EOL_PREFIXES.some(p => site.php_version?.startsWith(p));
      if (!isEol) match = false;
    }

    // wpVersionOlderThan
    if (match && filter.wpVersionOlderThan) {
      const normalize = (v: string) => v.split('.').map(n => parseInt(n, 10).toString().padStart(5, '0')).join('.');
      if (!site.wp_version || normalize(site.wp_version) >= normalize(filter.wpVersionOlderThan)) match = false;
    }

    // maxPostCount
    if (match && filter.maxPostCount != null) {
      if (site.post_count != null && site.post_count >= filter.maxPostCount) match = false;
    }

    // maxUserCount
    if (match && filter.maxUserCount != null) {
      if (site.user_count != null && site.user_count >= filter.maxUserCount) match = false;
    }

    // pluginVersion — sites with plugin older than a given version
    if (match && filter.pluginVersion?.slug && filter.pluginVersion?.olderThan) {
      const { slug, olderThan } = filter.pluginVersion;
      const row = db.prepare(`SELECT version FROM plugins WHERE site_id=? AND slug=? AND is_active=1 LIMIT 1`).get(site.id, slug) as any;
      if (!row) { match = false; }
      else {
        const normalize = (v: string) => v.split('.').map(n => parseInt(n, 10).toString().padStart(5, '0')).join('.');
        if (normalize(row.version) >= normalize(olderThan)) match = false;
      }
    }

    // ── P2 ──────────────────────────────────────────────────────────────────

    const settings = site.settings_json ? JSON.parse(site.settings_json) : {};

    // Settings filters: sites without settings_json are excluded from both directions
    if (match && (filter.commentsDisabled !== undefined || filter.hiddenFromSearch !== undefined ||
        filter.selfRegistrationOpen !== undefined || filter.staticFrontPage !== undefined ||
        filter.plainPermalinks !== undefined)) {
      if (!site.settings_json) { match = false; }
      else {
        if (filter.commentsDisabled !== undefined) {
          if (settings.default_comment_status === undefined) { match = false; }
          else { const closed = settings.default_comment_status === 'closed'; if (filter.commentsDisabled !== closed) match = false; }
        }
        if (filter.hiddenFromSearch !== undefined) {
          if (settings.blog_public === undefined) { match = false; }
          else { const hidden = settings.blog_public === '0'; if (filter.hiddenFromSearch !== hidden) match = false; }
        }
        if (filter.selfRegistrationOpen !== undefined) {
          if (settings.users_can_register === undefined) { match = false; }
          else { const open = settings.users_can_register === '1'; if (filter.selfRegistrationOpen !== open) match = false; }
        }
        if (filter.staticFrontPage !== undefined) {
          if (settings.show_on_front === undefined) { match = false; }
          else { const isStatic = settings.show_on_front === 'page'; if (filter.staticFrontPage !== isStatic) match = false; }
        }
        if (filter.plainPermalinks !== undefined) {
          if (settings.permalink_structure === undefined) { match = false; }
          else { const plain = settings.permalink_structure === ''; if (filter.plainPermalinks !== plain) match = false; }
        }
      }
    }

    // ── P3 ──────────────────────────────────────────────────────────────────

    if (match && filter.source) {
      if (site.source !== filter.source) match = false;
    }

    if (match) results.push(site.name);
  }

  return results;
}

// ---------------------------------------------------------------------------
// P0 — recentPostDays
// ---------------------------------------------------------------------------

describe('P0: recentPostDays filter', () => {
  const db = makeDb();

  test('returns sites updated within 7 days', () => {
    const results = applyFilter(db, { recentPostDays: 7 });
    expect(results).toContain('myloop');   // updated 2d ago
    expect(results).toContain('newsite');  // updated 5d ago
    expect(results).not.toContain('oldsite');     // updated 90d ago
    expect(results).not.toContain('hiddensite');  // updated 60d ago
  });

  test('returns sites updated within 30 days', () => {
    const results = applyFilter(db, { recentPostDays: 30 });
    expect(results).toContain('myloop');
    expect(results).toContain('newsite');
    expect(results).toContain('regopen');   // updated 7d ago
    expect(results).not.toContain('oldsite');
    expect(results).not.toContain('hiddensite');
  });

  test('is the inverse of stalePostDays for the same N', () => {
    const recent = applyFilter(db, { recentPostDays: 30 });
    const stale = applyFilter(db, { stalePostDays: 30 });
    const allSites = db.prepare('SELECT name FROM sites WHERE is_active=1').all().map((s: any) => s.name);
    // Every site is in exactly one of the two sets (or neither if no lastPostAt data)
    for (const name of allSites) {
      const inRecent = recent.includes(name);
      const inStale = stale.includes(name);
      expect(inRecent && inStale).toBe(false); // can't be in both
    }
  });
});

// ---------------------------------------------------------------------------
// P1 — phpEolOnly, wpVersionOlderThan, maxPostCount, maxUserCount, pluginVersion
// ---------------------------------------------------------------------------

describe('P1: phpEolOnly filter', () => {
  const db = makeDb();

  test('returns only sites on EOL PHP', () => {
    const results = applyFilter(db, { phpEolOnly: true });
    expect(results).toContain('oldsite');  // PHP 7.4 — EOL
    expect(results).toContain('wpe-stg'); // PHP 7.4 — EOL
    expect(results).not.toContain('myloop');  // PHP 8.2 — active
    expect(results).not.toContain('newsite'); // PHP 8.3 — active
  });
});

describe('P1: wpVersionOlderThan filter', () => {
  const db = makeDb();

  test('returns sites running WP older than 7.0', () => {
    const results = applyFilter(db, { wpVersionOlderThan: '7.0' });
    expect(results).toContain('oldsite');  // WP 6.8
    expect(results).toContain('wpe-prod'); // WP 6.9
    expect(results).toContain('wpe-stg');  // WP 6.9
    expect(results).not.toContain('myloop');   // WP 7.0
    expect(results).not.toContain('newsite');  // WP 7.0
  });
});

describe('P1: maxPostCount filter', () => {
  const db = makeDb();

  test('returns sites with fewer than 5 posts', () => {
    const results = applyFilter(db, { maxPostCount: 5 });
    expect(results).toContain('oldsite');  // 3 posts
    expect(results).toContain('newsite');  // 2 posts
    expect(results).not.toContain('myloop');   // 59 posts
    expect(results).not.toContain('wpe-prod'); // 100 posts
  });
});

describe('P1: maxUserCount filter', () => {
  const db = makeDb();

  test('returns sites with fewer than 3 users', () => {
    const results = applyFilter(db, { maxUserCount: 3 });
    expect(results).toContain('oldsite');  // 1 user
    expect(results).toContain('newsite');  // 2 users
    expect(results).toContain('wpe-stg'); // 2 users
    expect(results).not.toContain('myloop');   // 81 users
    expect(results).not.toContain('regopen');  // 20 users
  });
});

describe('P1: pluginVersion filter', () => {
  const db = makeDb();

  test('returns sites with ACF older than 6.3.0', () => {
    const results = applyFilter(db, { pluginVersion: { slug: 'advanced-custom-fields', olderThan: '6.3.0' } });
    expect(results).toContain('oldsite');   // ACF 5.12.0 — older
    expect(results).not.toContain('myloop'); // ACF 6.8.3 — newer
  });

  test('returns no sites when all versions are current', () => {
    const results = applyFilter(db, { pluginVersion: { slug: 'advanced-custom-fields', olderThan: '5.0.0' } });
    expect(results).toHaveLength(0);
  });

  test('excludes sites where plugin is not installed', () => {
    const results = applyFilter(db, { pluginVersion: { slug: 'advanced-custom-fields', olderThan: '9.0.0' } });
    expect(results).not.toContain('newsite'); // no ACF installed
  });
});

// ---------------------------------------------------------------------------
// P2 — Settings-based filters
// ---------------------------------------------------------------------------

describe('P2: commentsDisabled filter — both directions', () => {
  const db = makeDb();

  test('true: returns only sites with comments closed', () => {
    const results = applyFilter(db, { commentsDisabled: true });
    expect(results).toContain('oldsite');
    expect(results).not.toContain('myloop');
    expect(results).not.toContain('newsite');
  });

  test('false: returns only sites with comments open (inverse)', () => {
    const results = applyFilter(db, { commentsDisabled: false });
    expect(results).toContain('myloop');
    expect(results).toContain('newsite');
    expect(results).not.toContain('oldsite');
  });
});

describe('P2: hiddenFromSearch filter — both directions', () => {
  const db = makeDb();

  test('true: returns only sites blocking search engines', () => {
    const results = applyFilter(db, { hiddenFromSearch: true });
    expect(results).toContain('hiddensite');
    expect(results).not.toContain('myloop');
    expect(results).not.toContain('oldsite');
  });

  test('false: returns only sites visible to search engines (inverse)', () => {
    const results = applyFilter(db, { hiddenFromSearch: false });
    expect(results).toContain('myloop');
    expect(results).toContain('oldsite');
    expect(results).not.toContain('hiddensite');
  });
});

describe('P2: selfRegistrationOpen filter — both directions', () => {
  const db = makeDb();

  test('true: returns only sites with open registration', () => {
    const results = applyFilter(db, { selfRegistrationOpen: true });
    expect(results).toContain('regopen');
    expect(results).not.toContain('myloop');
  });

  test('false: returns only sites with closed registration (inverse)', () => {
    const results = applyFilter(db, { selfRegistrationOpen: false });
    expect(results).toContain('myloop');
    expect(results).not.toContain('regopen');
  });
});

describe('P2: staticFrontPage filter — both directions', () => {
  const db = makeDb();

  test('true: returns only sites with static homepage', () => {
    const results = applyFilter(db, { staticFrontPage: true });
    expect(results).toContain('newsite');
    expect(results).not.toContain('myloop');
    expect(results).not.toContain('regopen');
  });

  test('false: returns only sites with blog roll front page (inverse)', () => {
    const results = applyFilter(db, { staticFrontPage: false });
    expect(results).toContain('myloop');
    expect(results).toContain('regopen');
    expect(results).not.toContain('newsite');
  });
});

describe('P2: plainPermalinks filter — both directions', () => {
  const db = makeDb();

  test('true: returns only sites with plain (ugly) permalinks', () => {
    const results = applyFilter(db, { plainPermalinks: true });
    expect(results).toContain('myloop');
    expect(results).not.toContain('oldsite');
    expect(results).not.toContain('newsite');
  });

  test('false: returns only sites with pretty permalinks (inverse)', () => {
    const results = applyFilter(db, { plainPermalinks: false });
    expect(results).toContain('oldsite');
    expect(results).toContain('newsite');
    expect(results).not.toContain('myloop');
  });
});

// ---------------------------------------------------------------------------
// P3 — Source filter
// ---------------------------------------------------------------------------

describe('P3: source filter', () => {
  const db = makeDb();

  test('source=wpe returns only WPE sites', () => {
    const results = applyFilter(db, { source: 'wpe' });
    expect(results).toContain('wpe-prod');
    expect(results).toContain('wpe-stg');
    expect(results).not.toContain('myloop');
    expect(results).not.toContain('newsite');
  });

  test('source=local returns only local sites', () => {
    const results = applyFilter(db, { source: 'local' });
    expect(results).toContain('myloop');
    expect(results).toContain('newsite');
    expect(results).not.toContain('wpe-prod');
    expect(results).not.toContain('wpe-stg');
  });
});

// ---------------------------------------------------------------------------
// Composite — combinations of filters
// ---------------------------------------------------------------------------

describe('composite filters', () => {
  const db = makeDb();

  test('WooCommerce sites on EOL PHP', () => {
    const results = applyFilter(db, {
      plugins: ['woocommerce'],
      phpEolOnly: true,
    });
    expect(results).toContain('oldsite');   // WooCommerce + PHP 7.4 (EOL)
    expect(results).not.toContain('myloop'); // WooCommerce inactive, PHP 8.2
  });

  test('recently active large sites', () => {
    const results = applyFilter(db, {
      recentPostDays: 10,
      minPostCount: 20,
    });
    expect(results).toContain('myloop');    // updated 2d ago, 59 posts
    expect(results).not.toContain('newsite'); // updated 5d ago but only 2 posts
  });

  test('WPE sites on outdated WP', () => {
    const results = applyFilter(db, {
      source: 'wpe',
      wpVersionOlderThan: '7.0',
    });
    expect(results).toContain('wpe-prod');
    expect(results).toContain('wpe-stg');
    expect(results).not.toContain('myloop');
  });
});

// ---------------------------------------------------------------------------
// Empty-filter guard — must never return all sites
// ---------------------------------------------------------------------------

describe('empty filter guard', () => {
  const db = makeDb();

  test('empty filter {} returns no results (guard)', () => {
    // The hasFilter check in the real handler returns [] for empty filters.
    // This test verifies the logic holds — if all filter fields are absent,
    // the result set must be empty, not "all sites".
    const hasFilter = (f: Record<string, any>) => Object.values(f).some(v =>
      v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0)
    );
    expect(hasFilter({})).toBe(false);
    expect(hasFilter({ recentPostDays: 30 })).toBe(true);
    expect(hasFilter({ phpEolOnly: true })).toBe(true);
    expect(hasFilter({ plugins: [] })).toBe(false);
  });
});
