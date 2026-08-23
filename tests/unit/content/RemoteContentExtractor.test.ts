import {
  RemoteContentExtractor, REMOTE_PAGE_SIZE, REMOTE_MAX_POSTS,
} from '../../../src/main/content/RemoteContentExtractor';
import type { SiteTransport, RunOpts, WpCliResult } from '../../../src/main/transport/types';

function makeTransport(runWpCli: (args: string[], opts?: RunOpts) => Promise<WpCliResult>): SiteTransport {
  return {
    kind: 'external-ssh' as any,
    siteRef: { kind: 'external', alias: 'test' } as any,
    probe: async () => ({ reachable: true }),
    deleteRemoteFile: async () => ({ success: false, output: 'n/a' }),
    runWpCli,
  };
}

const silentLogger = () => ({ info: () => {}, warn: () => {}, error: () => {} });

const row = (id: number) => ({
  ID: id, post_title: `Post ${id}`, post_content: `<p>Content ${id}</p>`,
  post_excerpt: '', post_type: 'post', post_status: 'publish', post_author: '1',
  post_date: '2026-01-01 00:00:00',
});

/** Parse `--offset=N` / `--posts_per_page=N` back out of a WP-CLI argv. */
function flagValue(args: string[], name: string): number | undefined {
  const hit = args.find(a => a.startsWith(`--${name}=`));
  return hit === undefined ? undefined : Number(hit.split('=')[1]);
}

function isPostList(args: string[]): boolean {
  return args[0] === 'post' && args[1] === 'list';
}

function isExport(args: string[]): boolean {
  return args[0] === 'export';
}

/**
 * A transport backed by a real population, paging the way WordPress does.
 * Custom-field reads return an empty WXR document unless `wxr` is supplied.
 */
function pagingTransport(population: any[], opts: { wxr?: (ids: number[]) => WpCliResult } = {}) {
  const calls: string[][] = [];
  const transport = makeTransport(async (args) => {
    calls.push(args);
    if (isExport(args)) {
      const ids = String(args.find(a => a.startsWith('--post__in='))).split('=')[1].split(',').map(Number);
      return opts.wxr ? opts.wxr(ids) : { stdout: '<?xml version="1.0"?><rss></rss>', success: true };
    }
    const offset = flagValue(args, 'offset') ?? 0;
    const per = flagValue(args, 'posts_per_page') ?? population.length;
    return { stdout: JSON.stringify(population.slice(offset, offset + per)), success: true };
  });
  return { transport, calls };
}

describe('RemoteContentExtractor.extract — behaviour preserved from before WP-62', () => {
  it('extracts posts from any transport, not just WP Engine', async () => {
    const { transport } = pagingTransport([
      { ...row(1), post_title: 'Hello', post_content: '<p>World</p>' },
    ]);
    const extractor = new RemoteContentExtractor({ logger: silentLogger() });
    const result = await extractor.extract(transport, 'myhost');
    expect(result.posts).toHaveLength(1);
    expect(result.posts[0].title).toBe('Hello');
    expect(result.siteInfo.name).toBe('myhost');
    expect(result.siteInfo.url).toBe('');
  });

  it('passes skipPlugins:false, skipThemes:false through to the transport', async () => {
    const runWpCli = jest.fn(async () => ({ stdout: '[]', success: true }));
    const transport = makeTransport(runWpCli);
    const extractor = new RemoteContentExtractor({ logger: silentLogger() });
    await extractor.extract(transport, 'myhost');
    expect(runWpCli).toHaveBeenCalledWith(expect.any(Array), { skipPlugins: false, skipThemes: false });
  });

  it('returns an empty result when the transport call fails, does not throw', async () => {
    const transport = makeTransport(async () => ({ stdout: '', success: false }));
    const extractor = new RemoteContentExtractor({ logger: silentLogger() });
    const result = await extractor.extract(transport, 'myhost');
    expect(result.posts).toEqual([]);
  });

  it('filters out excluded post types', async () => {
    const { transport } = pagingTransport([
      { ...row(1), post_content: 'x' },
      { ...row(2), post_type: 'revision', post_content: 'y' },
    ]);
    const extractor = new RemoteContentExtractor({ logger: silentLogger() });
    const result = await extractor.extract(transport, 'myhost');
    expect(result.posts.map(p => p.id)).toEqual([1]);
  });

  it('drops posts whose cleaned content is empty', async () => {
    const { transport } = pagingTransport([{ ...row(1), post_content: '' }]);
    const extractor = new RemoteContentExtractor({ logger: silentLogger() });
    const result = await extractor.extract(transport, 'myhost');
    expect(result.posts).toEqual([]);
  });
});

/**
 * D7: `--posts_per_page=200` with no offset indexed 2 of qwerky's 30,628
 * published posts and 200 of cedarvalehealt's 602.
 *
 * SHAPE #18 GUARD: a fixture UNDER the page size passes identically on the
 * bug and on the fix, so every test here asserts its own population exceeds
 * the boundary BEFORE asserting anything about the result.
 */
describe('RemoteContentExtractor.extract — rows (the silent 200-row cap)', () => {
  const PAGE = 4; // small page size, real boundary — the population must exceed it

  it('reads EVERY post when the population exceeds the page size', async () => {
    const population = Array.from({ length: 11 }, (_, i) => row(i + 1));
    expect(population.length).toBeGreaterThan(PAGE); // the case is built

    const { transport, calls } = pagingTransport(population);
    const extractor = new RemoteContentExtractor({ logger: silentLogger(), pageSize: PAGE });
    const result = await extractor.extract(transport, 'myhost');

    expect(result.posts).toHaveLength(11);
    expect(result.posts.map(p => p.id)).toEqual(population.map(p => p.ID));

    // 11 posts over pages of 4 is 3 pages: 4, 4, 3 — the third is short, which
    // is how the end of the population is OBSERVED rather than assumed.
    const listCalls = calls.filter(isPostList);
    expect(listCalls).toHaveLength(3);
    expect(listCalls.map(c => flagValue(c, 'offset'))).toEqual([0, 4, 8]);
    expect(result.coverage!.complete).toBe(true);
    expect(result.coverage!.pagesFetched).toBe(3);
    expect(result.coverage!.rowsReturned).toBe(11);
  });

  it('reads one more page when the population is an EXACT multiple of the page size', async () => {
    // The boundary case the old code could never distinguish: a full last page
    // is not evidence of the end. Completeness requires reading a short page,
    // even when that page is empty.
    const population = Array.from({ length: 8 }, (_, i) => row(i + 1));
    expect(population.length % PAGE).toBe(0); // the case is built

    const { transport, calls } = pagingTransport(population);
    const extractor = new RemoteContentExtractor({ logger: silentLogger(), pageSize: PAGE });
    const result = await extractor.extract(transport, 'myhost');

    expect(result.posts).toHaveLength(8);
    const listCalls = calls.filter(isPostList);
    expect(listCalls.map(c => flagValue(c, 'offset'))).toEqual([0, 4, 8]); // third page comes back empty
    expect(result.coverage!.complete).toBe(true);
  });

  it('pins a TOTAL ORDER on the query, because offset paging over ties drops rows', async () => {
    // Measured on cedarvalehealt: 200+ published posts share one post_date to
    // the second. WP_Query's default `orderby=date` leaves ties unspecified,
    // so paging over it can drop and duplicate rows.
    const { transport, calls } = pagingTransport([row(1)]);
    const extractor = new RemoteContentExtractor({ logger: silentLogger() });
    await extractor.extract(transport, 'myhost');

    const list = calls.find(isPostList)!;
    expect(list).toContain('--orderby=ID');
    expect(list).toContain('--order=ASC');
  });

  it('does not raise the cap — the page size is still 200 and pages, not truncates', () => {
    expect(REMOTE_PAGE_SIZE).toBe(200);
  });
});

describe('RemoteContentExtractor.extract — truncation is STATED, not merely avoided', () => {
  it('marks the result incomplete, with a reason, when the stated ceiling is hit', async () => {
    const MAX = 8;
    const population = Array.from({ length: 40 }, (_, i) => row(i + 1));
    expect(population.length).toBeGreaterThan(MAX); // the case is built

    const { transport } = pagingTransport(population);
    const extractor = new RemoteContentExtractor({ logger: silentLogger(), pageSize: 4, maxPosts: MAX });
    const result = await extractor.extract(transport, 'myhost');

    expect(result.posts).toHaveLength(MAX);
    expect(result.coverage!.complete).toBe(false);
    expect(result.coverage!.truncatedReason).toBe('max-posts');
    expect(result.coverage!.truncatedDetail).toContain('ceiling');
  });

  it('warns at the seam when the extraction is incomplete', async () => {
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const population = Array.from({ length: 40 }, (_, i) => row(i + 1));
    const { transport } = pagingTransport(population);
    await new RemoteContentExtractor({ logger, pageSize: 4, maxPosts: 8 })
      .extract(transport, 'myhost');

    const warned = logger.warn.mock.calls.map(c => String(c[0])).join('\n');
    expect(warned).toContain('INCOMPLETE');
    expect(warned).toContain('floor, not a total');
  });

  it('never labels a bounded row count "total" in the log', async () => {
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const population = Array.from({ length: 11 }, (_, i) => row(i + 1));
    expect(population.length).toBeGreaterThan(4); // the case is built
    const { transport } = pagingTransport(population);
    await new RemoteContentExtractor({ logger, pageSize: 4 }).extract(transport, 'myhost');

    const said = logger.info.mock.calls.map(c => String(c[0])).join('\n');
    expect(said).not.toMatch(/\d+ total/);
    expect(said).toContain('rows read');
  });

  it('marks a MID-RUN page failure incomplete, keeping the rows already read', async () => {
    let listCalls = 0;
    const transport = makeTransport(async (args) => {
      if (isExport(args)) return { stdout: '', success: true };
      listCalls++;
      if (listCalls === 1) return { stdout: JSON.stringify([row(1), row(2), row(3), row(4)]), success: true };
      return { stdout: 'Error: SSH connection closed', success: false };
    });
    const result = await new RemoteContentExtractor({ logger: silentLogger(), pageSize: 4 })
      .extract(transport, 'myhost');

    expect(result.posts).toHaveLength(4);
    expect(result.coverage!.complete).toBe(false);
    expect(result.coverage!.truncatedReason).toBe('page-failed');
    expect(result.coverage!.truncatedDetail).toContain('offset 4');
  });

  it('distinguishes a site that could not be READ from a site that is EMPTY', async () => {
    const unreadable = makeTransport(async () => ({ stdout: 'Error: no such install', success: false }));
    const unread = await new RemoteContentExtractor({ logger: silentLogger() }).extract(unreadable, 'myhost');
    expect(unread.posts).toEqual([]);
    expect(unread.coverage!.complete).toBe(false);
    expect(unread.coverage!.truncatedReason).toBe('page-failed');

    const { transport: emptySite } = pagingTransport([]);
    const empty = await new RemoteContentExtractor({ logger: silentLogger() }).extract(emptySite, 'myhost');
    expect(empty.posts).toEqual([]);
    expect(empty.coverage!.complete).toBe(true);
  });
});

/**
 * The third truncation: the remote `--fields=` list asked for no post meta at
 * all, while the local path appends every public custom field into the
 * searchable text. It produced no count to be wrong, which is why it was
 * never reported.
 */
describe('RemoteContentExtractor.extract — custom fields', () => {
  const wxrFor = (entries: Array<{ id: number; meta: Array<[string, string]> }>) => `<?xml version="1.0"?>
<rss><channel>
${entries.map(e => `  <item>
    <wp:post_id>${e.id}</wp:post_id>
${e.meta.map(([k, v]) => `    <wp:postmeta><wp:meta_key>${k}</wp:meta_key><wp:meta_value><![CDATA[${v}]]></wp:meta_value></wp:postmeta>`).join('\n')}
  </item>`).join('\n')}
</channel></rss>`;

  it('collects public post meta onto the posts it extracted', async () => {
    const { transport, calls } = pagingTransport([row(1), row(2)], {
      wxr: () => ({
        success: true,
        stdout: wxrFor([
          { id: 1, meta: [['tier', 'composite'], ['_internal', 'hidden']] },
          { id: 2, meta: [['condition_focus', 'impetigo']] },
        ]),
      }),
    });
    const result = await new RemoteContentExtractor({ logger: silentLogger() }).extract(transport, 'myhost');

    expect(result.posts[0].customFields).toEqual({ tier: 'composite' });
    expect(result.posts[1].customFields).toEqual({ condition_focus: 'impetigo' });
    expect(result.coverage!.customFields).toBe('collected');

    // One bulk read per page of ids, not one per post: `wp post meta list`
    // costs 2.9s each, which is 29 minutes for a 602-post install.
    expect(calls.filter(isExport)).toHaveLength(1);
  });

  it('batches the meta read by page, exceeding one page of ids', async () => {
    const population = Array.from({ length: 11 }, (_, i) => row(i + 1));
    expect(population.length).toBeGreaterThan(4); // the case is built
    const { transport, calls } = pagingTransport(population, {
      wxr: (ids) => ({ success: true, stdout: wxrFor(ids.map(id => ({ id, meta: [['k', `v${id}`]] }))) }),
    });
    const result = await new RemoteContentExtractor({ logger: silentLogger(), pageSize: 4 })
      .extract(transport, 'myhost');

    expect(calls.filter(isExport)).toHaveLength(3); // 4 + 4 + 3
    expect(result.posts.map(p => p.customFields.k)).toEqual(population.map(p => `v${p.ID}`));
  });

  it('STATES that custom fields are unavailable rather than reporting none', async () => {
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const { transport } = pagingTransport([row(1)], {
      wxr: () => ({ success: false, stdout: "Error: 'export' is not a registered wp command." }),
    });
    const result = await new RemoteContentExtractor({ logger }).extract(transport, 'myhost');

    expect(result.posts).toHaveLength(1);
    expect(result.posts[0].customFields).toEqual({});
    expect(result.coverage!.customFields).toBe('unavailable');
    expect(result.coverage!.customFieldsDetail).toContain('not a registered wp command');
    expect(logger.warn.mock.calls.map(c => String(c[0])).join('\n')).toContain('custom fields NOT collected');
  });

  it('treats a successful export that yields no WXR items as unavailable, not empty', async () => {
    // An old WP-CLI without `--stdout`, or a host that disables export, exits
    // 0 with something that is not a WXR document. Reporting zero fields there
    // is indistinguishable from a site that genuinely has none.
    const { transport } = pagingTransport([row(1)], {
      wxr: () => ({ success: true, stdout: 'Success: All done.' }),
    });
    const result = await new RemoteContentExtractor({ logger: silentLogger() }).extract(transport, 'myhost');
    expect(result.coverage!.customFields).toBe('unavailable');
  });

  it('does NOT pay for meta on posts that the empty-content filter discards', async () => {
    // Measured on qwerky: 5,000 rows survive the post-type filter and TWO
    // survive the empty-content filter. Reading meta before that filter cost
    // 25 export calls — a WordPress bootstrap each — for posts that never
    // reach the index.
    const population = [
      { ...row(1), post_content: '<p>real</p>' },
      { ...row(2), post_content: '' },
      { ...row(3), post_content: '' },
      { ...row(4), post_content: '<p>also real</p>' },
    ];
    const empties = population.filter(p => p.post_content === '').length;
    expect(empties).toBeGreaterThan(0); // the case is built

    const exported: number[][] = [];
    const { transport } = pagingTransport(population, {
      wxr: (ids) => { exported.push(ids); return { success: true, stdout: wxrFor(ids.map(id => ({ id, meta: [['k', 'v']] }))) }; },
    });
    const result = await new RemoteContentExtractor({ logger: silentLogger() }).extract(transport, 'myhost');

    expect(result.posts.map(p => p.id)).toEqual([1, 4]);
    expect(exported).toEqual([[1, 4]]);
  });

  it('does not let a thrown export abort the extraction', async () => {
    const { transport } = pagingTransport([row(1)], {
      wxr: () => { throw new Error('SSH closed'); },
    });
    const result = await new RemoteContentExtractor({ logger: silentLogger() }).extract(transport, 'myhost');
    expect(result.posts).toHaveLength(1);
    expect(result.coverage!.customFields).toBe('unavailable');
  });
});

describe('RemoteContentExtractor — the stated ceiling is stated', () => {
  it('exports its ceiling so a caller can name the number in a message', () => {
    expect(REMOTE_MAX_POSTS).toBeGreaterThan(REMOTE_PAGE_SIZE);
  });
});

/**
 * D12 — a failed read and an empty site must not look alike.
 *
 * Measured 2026-08-22 on a 413-site run: 106 installs were reported as
 * "Did not run — No content returned by the extractor". Six sampled installs
 * held 215, 50, 44, 6, 2 and 2 published posts and were reachable over SSH
 * minutes later; one re-indexed successfully through the addon's own path in
 * 17.4s. The sites were not empty — the reads failed.
 *
 * `WpeSshTransport` builds a precise reason via `describeRemoteFailure` and
 * returns it in `result.stdout`. `fetchAllPages` already captures it into
 * `coverage.truncatedDetail`. Nothing logged it and nothing read it, so the
 * one piece of evidence needed to diagnose the run was generated and thrown
 * away.
 */
describe('RemoteContentExtractor — a failed read says why', () => {
  test('the first-page failure is logged with the transport reason, not just "no posts"', async () => {
    const warns: string[] = [];
    const logger = { info: () => {}, warn: (m: string) => warns.push(m), error: () => {} };
    const extractor = new RemoteContentExtractor({ logger } as any);

    const transport = makeTransport(async () => ({
      stdout: 'ssh: connect to host x.ssh.wpengine.net port 22: Connection refused',
      success: false,
    }));

    await extractor.extract(transport, 'acflikebutton');

    const line = warns.join(' | ');
    expect(line).toContain('Connection refused');
    expect(line).toContain('acflikebutton');
  });

  test('a failed read is marked page-failed, so callers can tell it from an empty site', async () => {
    const extractor = new RemoteContentExtractor({ logger: silentLogger() } as any);
    const transport = makeTransport(async () => ({ stdout: 'ssh: Connection refused', success: false }));

    const out = await extractor.extract(transport, 'acflikebutton');

    expect(out.posts).toEqual([]);
    expect(out.coverage?.complete).toBe(false);
    expect(out.coverage?.truncatedReason).toBe('page-failed');
    expect(out.coverage?.truncatedDetail).toContain('Connection refused');
  });

  // The counterpart. Without it, "always report page-failed" passes both cases
  // above and a genuinely empty site would be reported as broken.
  test('a genuinely empty site is complete, with no failure reason', async () => {
    const extractor = new RemoteContentExtractor({ logger: silentLogger() } as any);
    const transport = makeTransport(async () => ({ stdout: '[]', success: true }));

    const out = await extractor.extract(transport, 'emptysite');

    expect(out.posts).toEqual([]);
    expect(out.coverage?.complete).toBe(true);
    expect(out.coverage?.truncatedReason).toBeUndefined();
  });
});
