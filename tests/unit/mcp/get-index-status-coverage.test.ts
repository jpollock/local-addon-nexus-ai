/**
 * `get_index_status` printed `**Documents:** ${entry.documentCount}` and
 * nothing else. Re-reporting a truncated figure as a document count makes a
 * partial index pass every check a reader would think to run — which is how
 * an install with 30,628 published posts and 2 indexed looked healthy.
 *
 * A count crosses a boundary carrying how it was bounded, or it stops being
 * evidence.
 */

import { getIndexStatusHandler } from '../../../src/main/mcp/modules/site-context/get-index-status';
import { reindexSiteHandler } from '../../../src/main/mcp/modules/site-context/reindex-site';
import type { ExtractionCoverage } from '../../../src/common/types';

function services(opts: {
  source: 'local' | 'wpe' | 'external';
  coverage?: ExtractionCoverage;
  documentCount?: number;
  chunkCount?: number;
}) {
  const id = opts.source === 'local' ? 'local-1' : opts.source === 'wpe' ? 'wpe-1' : 'ssh:h/s';
  const entry: any = {
    siteId: id,
    siteName: 'thesite',
    state: 'indexed',
    documentCount: opts.documentCount ?? 200,
    chunkCount: opts.chunkCount ?? 200,
    lastIndexed: 1_700_000_000_000,
    durationMs: 1234,
  };
  if (opts.coverage) entry.coverage = opts.coverage;

  const isLocal = opts.source === 'local';
  const localSites = isLocal ? { [id]: { id, name: 'thesite', path: '/tmp', domain: 'thesite.local' } } : {};
  const graphRows = isLocal ? [] : [{ id, name: 'thesite', source: opts.source, account_id: 'h' }];

  return {
    siteData: {
      getSite: (q: string) => (localSites as any)[q] ?? null,
      getSites: () => localSites,
    },
    graphService: {
      getDb: () => ({
        prepare: () => ({ all: () => graphRows, get: () => graphRows[0] }),
      }),
    },
    indexRegistry: { get: () => entry },
  } as any;
}

async function run(opts: Parameters<typeof services>[0]): Promise<string> {
  const res = await getIndexStatusHandler.execute({ site: 'thesite' } as any, services(opts));
  return res.content[0].text as string;
}

const complete: ExtractionCoverage = {
  pageSize: 200, pagesFetched: 4, rowsReturned: 602, complete: true, customFields: 'collected',
};

const truncated: ExtractionCoverage = {
  pageSize: 200,
  pagesFetched: 25,
  rowsReturned: 5000,
  complete: false,
  truncatedReason: 'max-posts',
  truncatedDetail: 'stopped at the stated 5000-post ceiling (REMOTE_MAX_POSTS) with a full page still returning',
  customFields: 'collected',
};

describe('get_index_status — the count carries how it was bounded', () => {
  it('says COMPLETE, and does not hedge the numbers, when the end was observed', async () => {
    const out = await run({ source: 'wpe', coverage: complete });
    expect(out).toContain('**Coverage:** complete');
    expect(out).toContain('602 rows read over 4 pages');
    expect(out).not.toContain('(at least)');
    expect(out).not.toContain('FLOOR');
  });

  it('marks a truncated index PARTIAL, hedges both counts, and names what stopped it', async () => {
    const out = await run({ source: 'wpe', coverage: truncated, documentCount: 5000, chunkCount: 14000 });
    expect(out).toContain('**Documents:** 5000 (at least)');
    expect(out).toContain('**Chunks:** 14000 (at least)');
    expect(out).toContain('**Coverage:** PARTIAL');
    expect(out).toContain('5000-post ceiling');
    expect(out).toContain('FLOOR, not a total');
  });

  it('reads ABSENT coverage as "not recorded", never as complete', async () => {
    // This is the live state of every WP Engine install indexed before WP-62:
    // at most 200 posts, with no way to say so. Absence is not completeness.
    const out = await run({ source: 'wpe' });
    expect(out).toContain('**Coverage:** not recorded');
    expect(out).toContain('predates coverage tracking');
    expect(out).toContain('FLOOR, not a total');
    expect(out).toContain('**Documents:** 200 (at least)');
    expect(out).not.toContain('complete —');
  });

  it('states an unavailable custom-field read rather than implying the site has none', async () => {
    const out = await run({
      source: 'external',
      coverage: { ...complete, customFields: 'unavailable', customFieldsDetail: 'wp export returned no WXR items' },
    });
    expect(out).toContain('**Custom fields:** NOT collected');
    expect(out).toContain('wp export returned no WXR items');
    expect(out).toContain('Searches will not match text held only in custom fields');
  });
});

/**
 * WP-61: a check that a remedy EXISTS is not a check that the remedy WORKS.
 * `reindex_site` resolves through `resolveLocalSite` and cannot serve a
 * remote id, so naming it on a WP Engine row would be a message whose tool
 * resolves, runs, and leaves the reader exactly where they were.
 */
describe('get_index_status — the re-index it names is one that can run on that site', () => {
  it('names reindex_site for a LOCAL site', async () => {
    const out = await run({ source: 'local' });
    expect(out).toContain('`reindex_site`');
  });

  it('names bulk_reindex — never reindex_site — for WP Engine and external sites', async () => {
    for (const source of ['wpe', 'external'] as const) {
      const out = await run({ source });
      expect(out).toContain('`bulk_reindex`');
      expect(out).not.toContain('`reindex_site`');
    }
  });

  it('offers NO remedy for a ceiling stop, because none exists for the reader to run', async () => {
    // The ceiling is a memory constraint in this process, not a setting. An
    // offered fix that cannot work is worse than an honest absence.
    const out = await run({ source: 'wpe', coverage: truncated });
    expect(out).not.toContain('**Fix:**');
  });

  it('DOES offer a retry for a failed page, which a re-run can genuinely clear', async () => {
    const out = await run({
      source: 'wpe',
      coverage: { ...truncated, truncatedReason: 'page-failed', truncatedDetail: 'page 3 (offset 400) failed' },
    });
    expect(out).toContain('**Fix:** re-run the index (`bulk_reindex`)');
  });

  it('the tool it names for a remote site is not the one that would refuse it', () => {
    // The anchor outside the message: reindex_site's own resolver is
    // Local-only, which is WHY it must not be named for wpe/external.
    const source = require('fs').readFileSync(
      require('path').join(__dirname, '../../../src/main/mcp/modules/site-context/reindex-site.ts'), 'utf8',
    );
    expect(reindexSiteHandler.definition.name).toBe('reindex_site');
    expect(source).toContain('resolveLocalSite(');
    expect(source).not.toContain('resolveAnySite(');
  });
});
