import { resolveSite } from '../../src/main/mcp/site-resolver';
import { SiteDataAccessor, LocalSiteInfo } from '../../src/main/mcp/types';

function createSiteData(sites: LocalSiteInfo[]): SiteDataAccessor {
  const byId = new Map(sites.map((s) => [s.id, s]));
  return {
    getSite: (id: string) => byId.get(id) ?? null,
    getSites: () => Object.fromEntries(byId),
  };
}

describe('resolveSite edge cases', () => {
  test('Unicode name (CJK) matches exactly', () => {
    const data = createSiteData([
      { id: 'cn1', name: '我的网站', path: '/sites/cn', domain: 'cn.local' },
    ]);
    const result = resolveSite('我的网站', data);
    expect(result?.id).toBe('cn1');
  });

  test('special characters in name — parentheses', () => {
    const data = createSiteData([
      { id: 'dev1', name: 'My Site (Dev)', path: '/sites/dev', domain: 'dev.local' },
    ]);
    const result = resolveSite('My Site (Dev)', data);
    expect(result?.id).toBe('dev1');
  });

  test('apostrophe in name — case-insensitive match', () => {
    const data = createSiteData([
      { id: 'blog1', name: "John's Blog", path: '/sites/john', domain: 'john.local' },
    ]);
    const result = resolveSite("john's blog", data);
    expect(result?.id).toBe('blog1');
  });

  test('partial Unicode match (Japanese)', () => {
    const data = createSiteData([
      { id: 'jp1', name: 'テストサイト', path: '/sites/jp', domain: 'jp.local' },
    ]);
    const result = resolveSite('テスト', data);
    expect(result?.id).toBe('jp1');
  });

  test('mixed Unicode and ASCII name', () => {
    const data = createSiteData([
      { id: 'mix1', name: 'WordPress 中文站', path: '/sites/mix', domain: 'mix.local' },
    ]);
    const result = resolveSite('WordPress 中文站', data);
    expect(result?.id).toBe('mix1');
  });

  test('emoji in site name', () => {
    const data = createSiteData([
      { id: 'emoji1', name: '🚀 Launch Site', path: '/sites/emoji', domain: 'emoji.local' },
    ]);
    const result = resolveSite('🚀 Launch Site', data);
    expect(result?.id).toBe('emoji1');
  });

  test('partial emoji match', () => {
    const data = createSiteData([
      { id: 'emoji2', name: '🚀 Launch Site', path: '/sites/emoji', domain: 'emoji.local' },
    ]);
    const result = resolveSite('launch', data);
    expect(result?.id).toBe('emoji2');
  });

  test('Korean name — exact match', () => {
    const data = createSiteData([
      { id: 'kr1', name: '내 블로그', path: '/sites/kr', domain: 'kr.local' },
    ]);
    const result = resolveSite('내 블로그', data);
    expect(result?.id).toBe('kr1');
  });
});
