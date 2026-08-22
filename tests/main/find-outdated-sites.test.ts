import { ToolRegistry } from '../../src/main/mcp/tool-registry';
import { NexusServices } from '../../src/main/mcp/types';
import { registerFleetTools } from '../../src/main/mcp/modules/fleet/index';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDb(siteRows: any[], pluginRows: any[] = []) {
  return {
    prepare: jest.fn().mockImplementation((sql: string) => {
      const statement = {
        all: jest.fn().mockImplementation((...params: any[]) => {
          if (sql.includes('FROM plugins')) return pluginRows;
          // Filter sites by is_active if WHERE clause includes is_active
          if (sql.includes('is_active = 1')) {
            return siteRows.filter(s => s.is_active === 1 || s.is_active === undefined);
          }
          return siteRows;
        }),
        get: jest.fn().mockImplementation(() => {
          // For COUNT or single value queries
          if (sql.includes('COUNT(*)')) {
            let filtered;
            if (sql.includes('is_active = 1')) {
              filtered = siteRows.filter(s => s.is_active === 1 || s.is_active === undefined);
            } else {
              filtered = siteRows;
            }
            return { c: filtered.length };
          }
          if (sql.includes('MIN(last_sync_at)')) {
            let filtered;
            if (sql.includes('is_active = 1')) {
              filtered = siteRows.filter(s => s.is_active === 1 || s.is_active === undefined);
            } else {
              filtered = siteRows;
            }
            return {
              oldest: null,
              total: filtered.length,
              never_synced: 0,
            };
          }
          return siteRows[0];
        }),
      };
      return statement;
    }),
  };
}

function makeServices(db?: ReturnType<typeof makeDb>): NexusServices {
  const s = {
    siteData: { getSite: () => null, getSites: () => ({}) },
    indexRegistry: { get: () => null, listAll: () => [] },
    logger: { info: jest.fn(), error: jest.fn() },
  } as unknown as NexusServices;
  if (db) {
    (s as any).graphService = { getDb: () => db };
  }
  return s;
}

function getText(result: any): string {
  return result.content[0].text;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('find_outdated_sites', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
    registerFleetTools(registry);
  });

  test('reads from graph DB when graphService is available', async () => {
    const db = makeDb([
      { id: 's1', name: 'prod-site', source: 'wpe', wp_version: '6.8.0', php_version: '8.2' },
    ]);
    const s = makeServices(db);
    const result = await registry.call('find_outdated_sites', {}, s);
    expect(result.isError).toBeUndefined();
    // DB was queried
    expect(db.prepare).toHaveBeenCalled();
    // Report mentions the single site in scope
    expect(getText(result)).toContain('1 sites in scope');
  });

  test('source filter "wpe" — only queries graph for WPE rows', async () => {
    const db = makeDb([
      { id: 'w1', name: 'wpe-site', source: 'wpe', wp_version: '6.7.0', php_version: '8.1' },
      { id: 'l1', name: 'local-site', source: 'local', wp_version: '6.9.1', php_version: '8.2' },
    ]);
    // When source='wpe', find-outdated-sites passes [sourceFilter] as param and adds WHERE source=?
    // The mock returns all rows regardless — filter logic tested via output
    const s = makeServices(db);
    const result = await registry.call('find_outdated_sites', { source: 'wpe' }, s);
    expect(result.isError).toBeUndefined();
    const text = getText(result);
    // Report header should note WPE-only scope
    expect(text).toContain('WP Engine installs only');
  });

  test('source filter "local" — skips WPE rows and supplements with index registry', async () => {
    const db = makeDb([
      { id: 'l1', name: 'local-site', source: 'local', wp_version: '6.9.1', php_version: '8.2' },
    ]);
    const s = makeServices(db);
    const result = await registry.call('find_outdated_sites', { source: 'local' }, s);
    const text = getText(result);
    expect(text).toContain('local sites only');
  });

  test('sites with null wp_version are reported in "no version data" note', async () => {
    const db = makeDb([
      { id: 'w1', name: 'versioned-wpe', source: 'wpe', wp_version: '6.8.0', php_version: '8.2' },
      { id: 'w2', name: 'no-version-wpe', source: 'wpe', wp_version: null, php_version: null },
      { id: 'w3', name: 'also-versioned', source: 'wpe', wp_version: '6.7.0', php_version: '8.1' },
    ]);
    const s = makeServices(db);
    const result = await registry.call('find_outdated_sites', { source: 'wpe', component: 'wordpress' }, s);
    const text = getText(result);
    // Three sites total, one with null wp_version
    expect(text).toContain('1 site with no WordPress version data');
  });

  test('shows "no site version data" hint when graph is empty and source is wpe', async () => {
    const db = makeDb([]);
    const s = makeServices(db);
    const result = await registry.call('find_outdated_sites', { source: 'wpe' }, s);
    expect(getText(result)).toContain('Run "Sync WP Engine Sites" first');
  });

  test('falls back to index registry for local sites not in graph', async () => {
    // graph returns nothing; indexRegistry has a local site
    const db = makeDb([]);
    const s = makeServices(db);
    (s as any).indexRegistry = {
      listAll: () => [
        {
          siteId: 'local-fallback',
          siteName: 'Fallback Site',
          structure: { wpVersion: '6.9.1', phpVersion: '8.2' },
        },
      ],
    };
    const result = await registry.call('find_outdated_sites', {}, s);
    // The fallback site is included in scope
    expect(getText(result)).toContain('1 sites in scope');
    // Single version group — report confirms all on same version
    expect(getText(result)).toContain('6.9.1');
  });

  test('plugin section shows no plugin data when graph has no plugin rows', async () => {
    const db = makeDb(
      [{ id: 'w1', name: 'wpe-site', source: 'wpe', wp_version: '6.8.0', php_version: '8.2' }],
      [], // no plugins
    );
    const s = makeServices(db);
    const result = await registry.call('find_outdated_sites', { component: 'plugins' }, s);
    expect(getText(result)).toContain('No plugin data available');
  });

  test('plugin section detects version mismatches across sites', async () => {
    const sites = [
      { id: 's1', name: 'site-one', source: 'wpe', wp_version: '6.8.0', php_version: '8.2' },
      { id: 's2', name: 'site-two', source: 'wpe', wp_version: '6.8.0', php_version: '8.2' },
    ];
    const plugins = [
      { site_id: 's1', slug: 'woocommerce', version: '9.0.0' },
      { site_id: 's2', slug: 'woocommerce', version: '8.5.0' },
    ];
    const db = makeDb(sites, plugins);
    const s = makeServices(db);
    const result = await registry.call('find_outdated_sites', { component: 'plugins' }, s);
    const text = getText(result);
    expect(text).toContain('woocommerce');
    expect(text).toContain('9.0.0');
    expect(text).toContain('8.5.0');
  });

  test('returns no-data hint when graphService is missing and no index entries', async () => {
    const s = makeServices(); // no graphService, empty indexRegistry
    const result = await registry.call('find_outdated_sites', {}, s);
    expect(getText(result)).toContain('No site version data available');
  });

  test('excludes a soft-deleted external host even if it has version data', async () => {
    // Seed one active external site + one is_active:false external site.
    // Assert only the active site is included in scope count.
    const db = makeDb([
      { id: 'ext1', name: 'active-host', source: 'external', is_active: 1, wp_version: '6.8.0', php_version: '8.2' },
      { id: 'ext2', name: 'deleted-host', source: 'external', is_active: 0, wp_version: '6.8.0', php_version: '8.2' },
    ]);
    const s = makeServices(db);
    const result = await registry.call('find_outdated_sites', {}, s);
    expect(result.isError).toBeUndefined();
    const text = getText(result);
    // Only active site should be in scope
    expect(text).toContain('1 sites in scope');
    // Result should NOT mention the deleted host
    expect(text).not.toContain('deleted-host');
    // The report shows version groups; with only one site, it will say "All 1 site"
    expect(text).toContain('All 1 site');
  });

  test('excludes a soft-deleted WPE install even if it has version data', async () => {
    // Same test but with WPE sources
    const db = makeDb([
      { id: 'wpe1', name: 'active-install', source: 'wpe', is_active: 1, wp_version: '6.8.0', php_version: '8.2' },
      { id: 'wpe2', name: 'deleted-install', source: 'wpe', is_active: 0, wp_version: '6.8.0', php_version: '8.2' },
    ]);
    const s = makeServices(db);
    const result = await registry.call('find_outdated_sites', {}, s);
    expect(result.isError).toBeUndefined();
    const text = getText(result);
    expect(text).toContain('1 sites in scope');
    expect(text).not.toContain('deleted-install');
    expect(text).toContain('All 1 site');
  });
});

// ---------------------------------------------------------------------------
// WP-60 — the source filter and its label, pinned over the whole value set
//
// `source` has FOUR legal values and this file was written against two.
// f88614ec added 'external' to the schema enum and changed nothing else, so
// three separate expressions of the predicate were left behind: the registry
// supplement (`sourceFilter !== 'wpe'`), the header label (`'wpe' ? … :
// 'local' ? … : ''`), and the freshness denominator. An `external` report
// therefore returned the LOCAL fleet under NO scope label.
//
// The pin is over the value set, not over those lines:
//   - the expectation table is `Record<SiteSource | 'all', …>`, so a fourth
//     SiteSource fails `tsc` here rather than shipping;
//   - its keys are asserted against the handler's own schema enum, so the
//     two cannot drift apart in either direction;
//   - membership is read through a UNIQUE wp_version per site, because
//     formatVersionSection names only the non-latest groups — a version
//     string is a bijection with a site where a name is not.
// ---------------------------------------------------------------------------

import type { SiteSource } from '../../src/common/types';
import { findOutdatedSitesHandler } from '../../src/main/mcp/modules/fleet/find-outdated-sites';

/**
 * A db fake that actually honours its parameters.
 *
 * `makeDb` above returns every seeded row regardless of the WHERE clause, so a
 * set assertion written against it would pass on the defect. This one applies
 * `source = ?`, `source IN (…)`, a `source='literal'`, `is_active` and
 * `site_id IN (…)` — the five shapes this module's SQL actually uses, across
 * both the pre-fix and post-fix forms.
 */
function makeFilteringDb(siteRows: any[], pluginRows: any[] = []) {
  return {
    prepare: jest.fn().mockImplementation((rawSql: string) => {
      const sql = rawSql.replace(/\s+/g, ' ').trim();

      const selectSites = (params: any[]) => {
        let rows = siteRows.filter((r) => (r.is_active ?? 1) === 1);
        const inList = /source IN \(([^)]*)\)/.exec(sql);
        const literal = /source ?= ?'([a-z]+)'/.exec(sql);
        if (/source ?= ?\?/.test(sql)) {
          rows = rows.filter((r) => r.source === params[0]);
        } else if (inList) {
          const allowed = inList[1].split(',').map((s) => s.trim().replace(/'/g, ''));
          rows = rows.filter((r) => allowed.includes(r.source));
        } else if (literal) {
          rows = rows.filter((r) => r.source === literal[1]);
        }
        return rows;
      };

      return {
        all: jest.fn().mockImplementation((...params: any[]) => {
          if (/FROM plugins/.test(sql)) {
            return pluginRows.filter((p) => params.includes(p.site_id));
          }
          return selectSites(params);
        }),
        get: jest.fn().mockImplementation((...params: any[]) => {
          const rows = selectSites(params);
          const synced = rows.map((r) => r.last_sync_at).filter((v) => v != null);
          return {
            oldest: synced.length ? Math.min(...synced) : null,
            total: rows.length,
            never_synced: rows.length - synced.length,
          };
        }),
      };
    }),
  };
}

/** Every fixture site carries a version no other site carries. */
const FIXTURE = {
  alphaLocal:   { id: 'wp60-a', name: 'wp60-alpha-local',   source: 'local',    wp_version: '6.7.0', php_version: '8.2', is_active: 1, last_sync_at: null },
  bravoLocal:   { id: 'wp60-b', name: 'wp60-bravo-local',   source: 'local',    wp_version: '6.6.0', php_version: '8.2', is_active: 1, last_sync_at: null },
  charlieWpe:   { id: 'wp60-c', name: 'wp60-charlie-wpe',   source: 'wpe',      wp_version: '6.5.0', php_version: '8.1', is_active: 1, last_sync_at: null },
  deltaWpe:     { id: 'wp60-d', name: 'wp60-delta-wpe',     source: 'wpe',      wp_version: '6.4.0', php_version: '8.1', is_active: 1, last_sync_at: null },
  echoExt:      { id: 'wp60-e', name: 'wp60-echo-ext',      source: 'external', wp_version: '6.3.0', php_version: '8.3', is_active: 1, last_sync_at: null },
  foxtrotExt:   { id: 'wp60-f', name: 'wp60-foxtrot-ext',   source: 'external', wp_version: '6.2.0', php_version: '8.3', is_active: 1, last_sync_at: null },
};

/** In the index registry, NOT in the graph — the supplement's only subject. */
const INDEX_ONLY = {
  id: 'wp60-g',
  name: 'wp60-golf-index',
  source: 'local' as const,
  wp_version: '6.1.0',
  php_version: '8.0',
};

const GRAPH_ROWS = Object.values(FIXTURE);
const ALL_SITES = [...GRAPH_ROWS, INDEX_ONLY];

interface FilterExpectation {
  /** Exactly what follows "## Outdated Sites Report" on the header line. */
  label: string;
  /** Every site the report must account for, index-supplemented ones included. */
  scope: Array<{ name: string; wp_version: string }>;
  /**
   * The freshness warning's denominator. A distinct quantity from `scope`:
   * it counts GRAPH rows only, so an index-only site is legitimately absent
   * from it. It must still agree with the filter.
   */
  graphScope: number;
}

// Record over the union — a fourth SiteSource is a compile error here.
const EXPECTATIONS: Record<SiteSource | 'all', FilterExpectation> = {
  all: {
    label: '',
    scope: ALL_SITES,
    graphScope: 6,
  },
  local: {
    label: ' (local sites only)',
    scope: [FIXTURE.alphaLocal, FIXTURE.bravoLocal, INDEX_ONLY],
    graphScope: 2,
  },
  wpe: {
    label: ' (WP Engine installs only)',
    scope: [FIXTURE.charlieWpe, FIXTURE.deltaWpe],
    graphScope: 2,
  },
  external: {
    label: ' (external SSH hosts only)',
    scope: [FIXTURE.echoExt, FIXTURE.foxtrotExt],
    graphScope: 2,
  },
};

describe('find_outdated_sites — every legal source filter agrees with its scope and its label', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
    registerFleetTools(registry);
  });

  function servicesWithFixture(): NexusServices {
    const s = makeServices(makeFilteringDb(GRAPH_ROWS) as any);
    (s as any).indexRegistry = {
      get: () => null,
      listAll: () => [
        {
          siteId: INDEX_ONLY.id,
          siteName: INDEX_ONLY.name,
          structure: { wpVersion: INDEX_ONLY.wp_version, phpVersion: INDEX_ONLY.php_version },
        },
      ],
    };
    return s;
  }

  test('the expectation table covers exactly the schema enum — no more, no fewer', () => {
    const schemaEnum = (findOutdatedSitesHandler.definition.inputSchema as any)
      .properties.source.enum as string[];
    expect([...schemaEnum].sort()).toEqual(Object.keys(EXPECTATIONS).sort());
  });

  for (const [sourceFilter, expected] of Object.entries(EXPECTATIONS)) {
    describe(`source="${sourceFilter}"`, () => {
      async function report(): Promise<string> {
        const result = await registry.call(
          'find_outdated_sites',
          { source: sourceFilter, component: 'wordpress' },
          servicesWithFixture(),
        );
        expect(result.isError).toBeUndefined();
        return getText(result);
      }

      test('the header names the scope', async () => {
        const text = await report();
        expect(text.split('\n')[0]).toBe(`## Outdated Sites Report${expected.label}`);
      });

      test('the returned set is exactly the sites of that source', async () => {
        const text = await report();
        expect(text).toContain(`${expected.scope.length} sites in scope`);

        const inScope = new Set(expected.scope.map((s) => s.name));
        for (const site of ALL_SITES) {
          const shouldBeThere = inScope.has(site.name);
          // Present: every in-scope site's unique version is reported.
          expect({ site: site.name, version: site.wp_version, present: text.includes(site.wp_version) })
            .toEqual({ site: site.name, version: site.wp_version, present: shouldBeThere });
          // Absent: an out-of-scope site is not named either.
          if (!shouldBeThere) expect(text).not.toContain(site.name);
        }
      });

      test('the freshness warning counts the same source set the report does', async () => {
        const text = await report();
        expect(text).toContain(
          `${expected.graphScope} of ${expected.graphScope} sites have never been synced`,
        );
      });
    });
  }
});
