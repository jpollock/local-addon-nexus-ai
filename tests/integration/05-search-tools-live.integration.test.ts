import { TestHarness } from './helpers/harness';
import { loadPosts, createSiteData } from './helpers/fixtures';
import { expectToolError, expectToolSuccess } from './helpers/assertions';

describe('search_site_content (live)', () => {
  let harness: TestHarness;

  beforeAll(async () => {
    const siteData = createSiteData({
      'site-abc123': {
        id: 'site-abc123',
        name: 'Dev Blog',
        path: '/tmp/nexus-test/dev-blog',
        domain: 'dev-blog.local',
      },
      'site-def456': {
        id: 'site-def456',
        name: 'Store Site',
        path: '/tmp/nexus-test/store',
        domain: 'store.local',
      },
    });

    harness = await TestHarness.create({ skipServer: true, siteData });
    const posts = loadPosts('blog-posts');
    await harness.indexFixturePosts('site-abc123', 'Dev Blog', posts);
  }, 60000);

  afterAll(async () => {
    await harness.cleanup();
  });

  test('returns formatted results for valid query', async () => {
    const result = await harness.callTool('search_site_content', {
      site: 'Dev Blog',
      query: 'WordPress plugin development',
    });
    expectToolSuccess(result);
    expect(result.content[0].text).toContain('results');
  });

  test('resolves site by partial name', async () => {
    const result = await harness.callTool('search_site_content', {
      site: 'Dev',
      query: 'WordPress',
    });
    expectToolSuccess(result);
  });

  test('resolves site by ID', async () => {
    const result = await harness.callTool('search_site_content', {
      site: 'site-abc123',
      query: 'WordPress',
    });
    expectToolSuccess(result);
  });

  test('returns error for non-existent site', async () => {
    const result = await harness.callTool('search_site_content', {
      site: 'nonexistent-site-xyz',
      query: 'anything',
    });
    expectToolError(result, 'not found');
  });

  test('returns error for site that is not indexed', async () => {
    // site-def456 exists in siteData but has NOT been indexed
    const result = await harness.callTool('search_site_content', {
      site: 'Store Site',
      query: 'anything',
    });
    expectToolError(result);
  });

  test('no results message for irrelevant query with high min_score', async () => {
    const result = await harness.callTool('search_site_content', {
      site: 'Dev Blog',
      query: 'quantum physics superconductor experiments',
      min_score: 0.95,
    });
    expectToolSuccess(result);
    expect(result.content[0].text).toContain('No results');
  });
});

describe('search_across_sites (live)', () => {
  test('returns error when no sites are indexed', async () => {
    const harness = await TestHarness.create({ skipServer: true });
    const result = await harness.callTool('search_across_sites', {
      query: 'anything',
    });
    expectToolError(result, 'No sites');
    await harness.cleanup();
  }, 60000);
});
