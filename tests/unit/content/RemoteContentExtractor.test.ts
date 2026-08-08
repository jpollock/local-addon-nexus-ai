import { RemoteContentExtractor } from '../../../src/main/content/RemoteContentExtractor';
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

describe('RemoteContentExtractor.extract', () => {
  it('extracts posts from any transport, not just WP Engine', async () => {
    const posts = [
      { ID: 1, post_title: 'Hello', post_content: '<p>World</p>', post_excerpt: '', post_type: 'post', post_status: 'publish', post_author: '1', post_date: '2026-01-01 00:00:00' },
    ];
    const transport = makeTransport(async () => ({ stdout: JSON.stringify(posts), success: true }));
    const extractor = new RemoteContentExtractor({ logger: { info: () => {}, warn: () => {}, error: () => {} } });
    const result = await extractor.extract(transport, 'myhost');
    expect(result.posts).toHaveLength(1);
    expect(result.posts[0].title).toBe('Hello');
    expect(result.siteInfo.name).toBe('myhost');
    expect(result.siteInfo.url).toBe('');
  });

  it('passes skipPlugins:false, skipThemes:false through to the transport', async () => {
    const runWpCli = jest.fn(async () => ({ stdout: '[]', success: true }));
    const transport = makeTransport(runWpCli);
    const extractor = new RemoteContentExtractor({ logger: { info: () => {}, warn: () => {}, error: () => {} } });
    await extractor.extract(transport, 'myhost');
    expect(runWpCli).toHaveBeenCalledWith(expect.any(Array), { skipPlugins: false, skipThemes: false });
  });

  it('returns an empty result when the transport call fails, does not throw', async () => {
    const transport = makeTransport(async () => ({ stdout: '', success: false }));
    const extractor = new RemoteContentExtractor({ logger: { info: () => {}, warn: () => {}, error: () => {} } });
    const result = await extractor.extract(transport, 'myhost');
    expect(result.posts).toEqual([]);
  });

  it('filters out excluded post types', async () => {
    const posts = [
      { ID: 1, post_title: 'A', post_content: 'x', post_type: 'post', post_status: 'publish', post_author: '1', post_date: '2026-01-01' },
      { ID: 2, post_title: 'B', post_content: 'y', post_type: 'revision', post_status: 'publish', post_author: '1', post_date: '2026-01-01' },
    ];
    const transport = makeTransport(async () => ({ stdout: JSON.stringify(posts), success: true }));
    const extractor = new RemoteContentExtractor({ logger: { info: () => {}, warn: () => {}, error: () => {} } });
    const result = await extractor.extract(transport, 'myhost');
    expect(result.posts.map(p => p.id)).toEqual([1]);
  });

  it('drops posts whose cleaned content is empty', async () => {
    const posts = [
      { ID: 1, post_title: 'Empty', post_content: '', post_type: 'post', post_status: 'publish', post_author: '1', post_date: '2026-01-01' },
    ];
    const transport = makeTransport(async () => ({ stdout: JSON.stringify(posts), success: true }));
    const extractor = new RemoteContentExtractor({ logger: { info: () => {}, warn: () => {}, error: () => {} } });
    const result = await extractor.extract(transport, 'myhost');
    expect(result.posts).toEqual([]);
  });
});
