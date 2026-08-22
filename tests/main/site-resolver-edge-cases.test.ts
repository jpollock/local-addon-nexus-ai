import { resolveLocalSite } from '../../src/main/mcp/site-resolver';
import { SiteDataAccessor, LocalSiteInfo } from '../../src/main/mcp/types';

/**
 * WP-58: the third argument is the graph handle, and it is REQUIRED so a new
 * call site cannot narrow this resolver's scope back to Local-only by
 * forgetting. These fixtures model a fleet with no graph at all, where no
 * cross-source collision can exist — which is exactly when `undefined` is the
 * honest answer rather than an omission.
 */
const noGraph = undefined;

function createSiteData(sites: LocalSiteInfo[]): SiteDataAccessor {
  const byId = new Map(sites.map((s) => [s.id, s]));
  return {
    getSite: (id: string) => byId.get(id) ?? null,
    getSites: () => Object.fromEntries(byId),
  };
}

describe('resolveLocalSite edge cases', () => {
  test('Unicode name (CJK) matches exactly', () => {
    const data = createSiteData([
      { id: 'cn1', name: '我的网站', path: '/sites/cn', domain: 'cn.local' },
    ]);
    const result = resolveLocalSite('我的网站', data, noGraph);
    expect(result?.id).toBe('cn1');
  });

  test('special characters in name — parentheses', () => {
    const data = createSiteData([
      { id: 'dev1', name: 'My Site (Dev)', path: '/sites/dev', domain: 'dev.local' },
    ]);
    const result = resolveLocalSite('My Site (Dev)', data, noGraph);
    expect(result?.id).toBe('dev1');
  });

  test('apostrophe in name — case-insensitive match', () => {
    const data = createSiteData([
      { id: 'blog1', name: "John's Blog", path: '/sites/john', domain: 'john.local' },
    ]);
    const result = resolveLocalSite("john's blog", data, noGraph);
    expect(result?.id).toBe('blog1');
  });

  test('partial Unicode match does not resolve (Japanese)', () => {
    const data = createSiteData([
      { id: 'jp1', name: 'テストサイト', path: '/sites/jp', domain: 'jp.local' },
    ]);
    const result = resolveLocalSite('テスト', data, noGraph);
    expect(result).toBeNull();
  });

  test('mixed Unicode and ASCII name', () => {
    const data = createSiteData([
      { id: 'mix1', name: 'WordPress 中文站', path: '/sites/mix', domain: 'mix.local' },
    ]);
    const result = resolveLocalSite('WordPress 中文站', data, noGraph);
    expect(result?.id).toBe('mix1');
  });

  test('emoji in site name', () => {
    const data = createSiteData([
      { id: 'emoji1', name: '🚀 Launch Site', path: '/sites/emoji', domain: 'emoji.local' },
    ]);
    const result = resolveLocalSite('🚀 Launch Site', data, noGraph);
    expect(result?.id).toBe('emoji1');
  });

  test('partial emoji match does not resolve', () => {
    const data = createSiteData([
      { id: 'emoji2', name: '🚀 Launch Site', path: '/sites/emoji', domain: 'emoji.local' },
    ]);
    const result = resolveLocalSite('launch', data, noGraph);
    expect(result).toBeNull();
  });

  test('Korean name — exact match', () => {
    const data = createSiteData([
      { id: 'kr1', name: '내 블로그', path: '/sites/kr', domain: 'kr.local' },
    ]);
    const result = resolveLocalSite('내 블로그', data, noGraph);
    expect(result?.id).toBe('kr1');
  });
});
