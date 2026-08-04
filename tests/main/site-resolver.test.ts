import { resolveSite } from '../../src/main/mcp/site-resolver';
import { SiteDataAccessor, LocalSiteInfo } from '../../src/main/mcp/types';

function createSiteData(sites: LocalSiteInfo[]): SiteDataAccessor {
  const byId = new Map(sites.map((s) => [s.id, s]));
  return {
    getSite: (id: string) => byId.get(id) ?? null,
    getSites: () => Object.fromEntries(byId),
  };
}

const sites: LocalSiteInfo[] = [
  { id: 'abc123', name: 'My Blog', path: '/sites/my-blog', domain: 'myblog.local' },
  { id: 'def456', name: 'WooCommerce Store', path: '/sites/woo', domain: 'woo.local' },
  { id: 'ghi789', name: 'Client Site', path: '/sites/client', domain: 'client.local' },
];

describe('resolveSite', () => {
  const siteData = createSiteData(sites);

  test('resolves by exact ID', () => {
    const result = resolveSite('abc123', siteData);
    expect(result?.name).toBe('My Blog');
  });

  test('resolves by exact name (case-insensitive)', () => {
    const result = resolveSite('my blog', siteData);
    expect(result?.id).toBe('abc123');
  });

  test('DOES NOT resolve by partial name (substring match)', () => {
    const result = resolveSite('woo', siteData);
    expect(result).toBeNull();
  });

  test('resolves by domain', () => {
    const result = resolveSite('client.local', siteData);
    expect(result?.id).toBe('ghi789');
  });

  test('returns null for no match', () => {
    expect(resolveSite('nonexistent', siteData)).toBeNull();
  });

  test('returns null for empty query', () => {
    expect(resolveSite('', siteData)).toBeNull();
  });

  test('still resolves exact name', () => {
    const result = resolveSite('WooCommerce Store', siteData);
    expect(result?.id).toBe('def456');
  });

  test('still resolves exact ID', () => {
    const result = resolveSite('ghi789', siteData);
    expect(result?.id).toBe('ghi789');
  });

  test('still resolves exact domain', () => {
    const result = resolveSite('myblog.local', siteData);
    expect(result?.id).toBe('abc123');
  });

  test('case-insensitive exact name still resolves', () => {
    const result = resolveSite('CLIENT SITE', siteData);
    expect(result?.id).toBe('ghi789');
  });
});
