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

const sites: LocalSiteInfo[] = [
  { id: 'abc123', name: 'My Blog', path: '/sites/my-blog', domain: 'myblog.local' },
  { id: 'def456', name: 'WooCommerce Store', path: '/sites/woo', domain: 'woo.local' },
  { id: 'ghi789', name: 'Client Site', path: '/sites/client', domain: 'client.local' },
];

describe('resolveLocalSite', () => {
  const siteData = createSiteData(sites);

  test('resolves by exact ID', () => {
    const result = resolveLocalSite('abc123', siteData, noGraph);
    expect(result?.name).toBe('My Blog');
  });

  test('resolves by exact name (case-insensitive)', () => {
    const result = resolveLocalSite('my blog', siteData, noGraph);
    expect(result?.id).toBe('abc123');
  });

  test('DOES NOT resolve by partial name (substring match)', () => {
    const result = resolveLocalSite('woo', siteData, noGraph);
    expect(result).toBeNull();
  });

  test('resolves by domain', () => {
    const result = resolveLocalSite('client.local', siteData, noGraph);
    expect(result?.id).toBe('ghi789');
  });

  test('returns null for no match', () => {
    expect(resolveLocalSite('nonexistent', siteData, noGraph)).toBeNull();
  });

  test('returns null for empty query', () => {
    expect(resolveLocalSite('', siteData, noGraph)).toBeNull();
  });

  test('still resolves exact name', () => {
    const result = resolveLocalSite('WooCommerce Store', siteData, noGraph);
    expect(result?.id).toBe('def456');
  });

  test('still resolves exact ID', () => {
    const result = resolveLocalSite('ghi789', siteData, noGraph);
    expect(result?.id).toBe('ghi789');
  });

  test('still resolves exact domain', () => {
    const result = resolveLocalSite('myblog.local', siteData, noGraph);
    expect(result?.id).toBe('abc123');
  });

  test('case-insensitive exact name still resolves', () => {
    const result = resolveLocalSite('CLIENT SITE', siteData, noGraph);
    expect(result?.id).toBe('ghi789');
  });
});
