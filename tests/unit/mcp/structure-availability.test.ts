/**
 * The structure decline — D2, D3, D4.
 *
 * Five call sites said **"has no index data"** for every source. That sentence
 * was wrong twice over: it named the content index (a store that is fine, and
 * that `get_index_status` will happily report as populated for the same site),
 * and it implied the data could arrive, which for a WP Engine install or an
 * external SSH host it cannot — `entry.structure`'s only creator is
 * `ContentPipeline`'s local filesystem walk, and its two other writers are
 * each guarded by `if (existingEntry?.structure)`.
 *
 * The helper is driven directly across its whole input domain (WP-46: a render
 * test cannot pin a guard the render never reaches), AND through both tools,
 * because a correct helper nobody calls is not a fix.
 */
import { structureUnavailableMessage } from '../../../src/main/mcp/modules/fleet/structure-availability';
import { compareSitesHandler } from '../../../src/main/mcp/modules/fleet/compare-sites';
import { detectDriftHandler } from '../../../src/main/mcp/modules/fleet/detect-drift';
import { ToolRegistry } from '../../../src/main/mcp/tool-registry';
import { registerFleetTools } from '../../../src/main/mcp/modules/fleet/index';
import { registerWpeTools } from '../../../src/main/mcp/modules/wpe/index';
import { registerFleetIntelligenceTools } from '../../../src/main/mcp/modules/fleet-intelligence/index';
import { registerSiteContextTools } from '../../../src/main/mcp/modules/site-context/index';
import type { NexusServices } from '../../../src/main/mcp/types';

const SOURCES = ['local', 'wpe', 'external'] as const;

describe('structureUnavailableMessage — driven over its whole input domain', () => {
  test('no source produces the sentence that caused the defect', () => {
    // The literal string, at every input. This is the regression, named.
    for (const source of SOURCES) {
      const msg = structureUnavailableMessage('cedarvalehealt', source, 'compare_sites');
      expect(msg).not.toContain('has no index data');
    }
  });

  test('every message names the site and the tool that declined', () => {
    for (const source of SOURCES) {
      const msg = structureUnavailableMessage('cedarvalehealt', source, 'compare_sites');
      expect(msg).toContain('cedarvalehealt');
      expect(msg).toContain('compare_sites');
    }
  });

  test('a LOCAL site gets the remedy that works, because for it there is one', () => {
    const msg = structureUnavailableMessage('myloop', 'local', 'compare_sites');
    expect(msg).toContain('reindex_site');
    // ...and does not claim a product limitation that does not apply to it.
    expect(msg).not.toContain('no sync or re-index will create');
  });

  test('a REMOTE site is told the data cannot exist, not that it is missing', () => {
    for (const source of ['wpe', 'external'] as const) {
      const msg = structureUnavailableMessage('piedmontdermgroup', source, 'compare_sites');
      expect(msg).toContain('no sync or re-index will create');
      // The specific misdirection D2 cost an hour to: the reader must not be
      // sent to fix the content index, which is fine.
      expect(msg).toContain('content index and graph records are unaffected');
      // And it must NOT offer reindex_site, which is local-only by construction.
      expect(msg).not.toContain('reindex_site');
    }
  });

  test('the alternatives offered differ by source, because the tools do', () => {
    const wpe = structureUnavailableMessage('x', 'wpe', 'compare_sites');
    const ext = structureUnavailableMessage('x', 'external', 'compare_sites');

    expect(wpe).toContain('wpe_detect_drift');
    // wpe_detect_drift compares a LOCAL site to its linked WPE install. It has
    // nothing to say about an external SSH host, and offering it there would
    // be a fresh instance of the defect being fixed.
    expect(ext).not.toContain('wpe_detect_drift');
    expect(ext).toContain('get_site_health');
  });

  test('the subject label distinguishes a tool\'s argument roles', () => {
    const baseline = structureUnavailableMessage('x', 'wpe', 'detect_drift', 'Baseline site');
    expect(baseline.startsWith('Baseline site "x"')).toBe(true);
    expect(structureUnavailableMessage('x', 'wpe', 'detect_drift').startsWith('Site "x"')).toBe(true);
  });

  test('every tool this message recommends is one the registry actually carries', () => {
    // The outside anchor (WP-54): the message and the sweep could agree with
    // each other and both be wrong. This ties the recommendations to the
    // registry itself — the same failure class as D5, one layer along.
    const registry = new ToolRegistry();
    registerFleetTools(registry);
    registerWpeTools(registry);
    registerFleetIntelligenceTools(registry);
    registerSiteContextTools(registry);
    const registered = new Set(registry.allToolNames());

    const recommended = new Set<string>();
    for (const source of SOURCES) {
      const msg = structureUnavailableMessage('x', source, 'compare_sites');
      for (const m of msg.matchAll(/\b([a-z][a-z0-9]*(?:_[a-z0-9]+)+)\b/g)) {
        if (m[1] !== 'compare_sites') recommended.add(m[1]);
      }
    }

    // Non-emptiness first — an empty set would pass the loop vacuously.
    expect(recommended.size).toBeGreaterThanOrEqual(4);
    for (const name of recommended) expect(registered.has(name)).toBe(true);
  });
});

// ── Through the tools ───────────────────────────────────────────────────────

type SiteRow = { id: string; name: string; source: string; account_id: string | null };

function makeServices(opts: {
  localSites?: Record<string, { id: string; name: string; path: string; domain?: string }>;
  graphRows?: SiteRow[];
  registry?: Record<string, { siteId: string; siteName: string; structure: unknown; documentCount: number; chunkCount: number }>;
}): NexusServices {
  const { localSites = {}, graphRows = [], registry = {} } = opts;
  return {
    siteData: {
      getSite: (id: string) => localSites[id],
      getSites: () => localSites,
    },
    graphService: {
      getDb: () => ({
        prepare: (sql: string) => ({
          all: (...params: unknown[]) => {
            // Both resolver queries filter to the remote sources and match on
            // name; the case-insensitive probe lowercases its parameter.
            const wanted = String(params[0] ?? '').toLowerCase();
            const rows = graphRows.filter((r) => r.name.toLowerCase() === wanted);
            return sql.includes('LOWER(name)') ? rows : rows.filter((r) => r.name === params[0]);
          },
        }),
      }),
    },
    indexRegistry: {
      get: (id: string) => registry[id],
      listAll: () => Object.values(registry),
    },
  } as never as NexusServices;
}

const WPE_ROW: SiteRow = { id: 'wpe-1', name: 'piedmontdermgroup', source: 'wpe', account_id: 'acc-1' };

describe('compare_sites declines a remote site with the real reason', () => {
  test('a WP Engine install is refused for the reason that is true', async () => {
    // The reproduction from the report: a site freshly registered, refreshed
    // and content-indexed, still refused — and previously told its index was
    // empty when it holds 102 documents.
    const services = makeServices({
      graphRows: [WPE_ROW],
      registry: {
        'wpe-1': { siteId: 'wpe-1', siteName: 'piedmontdermgroup', structure: null, documentCount: 102, chunkCount: 102 },
      },
    });

    const r = await compareSitesHandler.execute(
      { site_a: 'piedmontdermgroup', site_b: 'piedmontdermgroup' },
      services,
    );

    expect(r.isError).toBe(true);
    expect(r.content[0].text).not.toContain('has no index data');
    expect(r.content[0].text).toContain('WP Engine install');
    expect(r.content[0].text).toContain('wpe_detect_drift');
  });

  test('a LOCAL site that was never scanned still gets its own working remedy', async () => {
    const services = makeServices({
      localSites: { 'local-1': { id: 'local-1', name: 'freshsite', path: '/sites/freshsite' } },
      registry: {},
    });

    const r = await compareSitesHandler.execute({ site_a: 'freshsite', site_b: 'freshsite' }, services);

    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('reindex_site');
    expect(r.content[0].text).not.toContain('no sync or re-index will create');
  });
});

describe('detect_drift declines the same way — the sibling that carried the same sentence', () => {
  test('a remote BASELINE names its role and the real reason', async () => {
    const services = makeServices({
      graphRows: [WPE_ROW],
      registry: {
        'wpe-1': { siteId: 'wpe-1', siteName: 'piedmontdermgroup', structure: null, documentCount: 102, chunkCount: 102 },
      },
    });

    const r = await detectDriftHandler.execute({ baseline_site: 'piedmontdermgroup' }, services);

    expect(r.isError).toBe(true);
    expect(r.content[0].text).not.toContain('has no index data');
    expect(r.content[0].text).toContain('Baseline site');
    expect(r.content[0].text).toContain('detect_drift');
  });

  test('a remote COMPARISON site names its role', async () => {
    const services = makeServices({
      localSites: { 'local-1': { id: 'local-1', name: 'baseline-local', path: '/sites/b' } },
      graphRows: [WPE_ROW],
      registry: {
        'local-1': {
          siteId: 'local-1', siteName: 'baseline-local', documentCount: 1, chunkCount: 1,
          structure: { wpVersion: '6.7', phpVersion: '8.2', plugins: [], themes: [] },
        },
        'wpe-1': { siteId: 'wpe-1', siteName: 'piedmontdermgroup', structure: null, documentCount: 102, chunkCount: 102 },
      },
    });

    const r = await detectDriftHandler.execute(
      { baseline_site: 'baseline-local', compare_sites: ['piedmontdermgroup'] },
      services,
    );

    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('Comparison site');
    expect(r.content[0].text).not.toContain('has no index data');
  });
});

describe('the tool descriptions stop implying cross-source support', () => {
  test('compare_sites says Local-only and no longer offers local-vs-WPE as its example', () => {
    const d = compareSitesHandler.definition.description;
    expect(d).toContain('Local sites only');
    // The exact phrase that sent the reporter down this path: the old text
    // offered "confirm local matches WPE production" as what the tool is FOR.
    expect(d).not.toContain('confirm local matches WPE production');
    expect(d).toContain('wpe_detect_drift');
  });

  test('detect_drift says the same', () => {
    const d = detectDriftHandler.definition.description;
    expect(d).toContain('Local sites only');
    expect(d).toContain('wpe_detect_drift');
  });
});
