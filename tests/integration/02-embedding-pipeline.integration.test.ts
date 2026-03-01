import { TestHarness } from './helpers/harness';
import { loadPosts, createSiteData } from './helpers/fixtures';

describe('Embedding Pipeline (real ONNX + real LanceDB)', () => {
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

  test('semantically similar query returns relevant post', async () => {
    const results = await harness.vectorStore.search(
      'site-abc123',
      await harness.embeddingService.embed('how to build WordPress plugins'),
      { limit: 5 },
    );
    expect(results.length).toBeGreaterThan(0);
    // Post #1 "Getting Started with WordPress Development" should rank highly
    const topResult = results[0];
    expect(topResult.score).toBeGreaterThan(0.3);
    expect(topResult.title).toContain('WordPress');
  });

  test('unrelated query returns low or no results', async () => {
    const results = await harness.vectorStore.search(
      'site-abc123',
      await harness.embeddingService.embed('chocolate cake recipe baking instructions'),
      { limit: 5, relevanceFloor: 0.5 },
    );
    // Either no results or very low scores
    expect(results.length).toBeLessThanOrEqual(1);
  });

  test('postType filter restricts results', async () => {
    const results = await harness.vectorStore.search(
      'site-abc123',
      await harness.embeddingService.embed('contact information'),
      { limit: 10, postType: 'page', relevanceFloor: 0 },
    );
    for (const r of results) {
      expect(r.postType).toBe('page');
    }
  });

  test('multi-chunk post deduplicates to single result', async () => {
    // Post #3 is >500 words and should produce multiple chunks
    const results = await harness.vectorStore.search(
      'site-abc123',
      await harness.embeddingService.embed('WordPress performance optimization caching CDN'),
      { limit: 10 },
    );

    // Count results for post #3
    const post3Results = results.filter((r) => r.postId === 3);
    expect(post3Results.length).toBe(1); // Deduplicated to single result
  });

  test('limit parameter caps results', async () => {
    const results = await harness.vectorStore.search(
      'site-abc123',
      await harness.embeddingService.embed('WordPress'),
      { limit: 2, relevanceFloor: 0 },
    );
    expect(results.length).toBeLessThanOrEqual(2);
  });

  test('min_score parameter raises relevance floor', async () => {
    const resultsLow = await harness.vectorStore.search(
      'site-abc123',
      await harness.embeddingService.embed('WordPress development'),
      { limit: 10, relevanceFloor: 0.1 },
    );
    const resultsHigh = await harness.vectorStore.search(
      'site-abc123',
      await harness.embeddingService.embed('WordPress development'),
      { limit: 10, relevanceFloor: 0.7 },
    );

    // Higher floor should return fewer or equal results
    expect(resultsHigh.length).toBeLessThanOrEqual(resultsLow.length);

    // All high-floor results should have score >= 0.7
    for (const r of resultsHigh) {
      expect(r.score).toBeGreaterThanOrEqual(0.7);
    }
  });

  test('cross-site search returns results from multiple sites', async () => {
    // Index posts into second site
    const posts = loadPosts('blog-posts').slice(0, 2);
    await harness.indexFixturePosts('site-def456', 'Store Site', posts);

    const sites = await harness.vectorStore.listSites();
    expect(sites.length).toBeGreaterThanOrEqual(2);
    expect(sites).toContain('site-abc123');
    expect(sites).toContain('site-def456');
  });

  test('getSiteStats returns accurate counts', async () => {
    const stats = await harness.vectorStore.getSiteStats('site-abc123');
    expect(stats).not.toBeNull();
    expect(stats!.documentCount).toBe(5); // 5 unique posts
    expect(stats!.chunkCount).toBeGreaterThanOrEqual(5); // At least 5 (post #3 has multiple chunks)
  });

  test('dropSite removes all data for a site', async () => {
    // Index into a fresh site, then drop it
    const posts = loadPosts('blog-posts').slice(0, 1);
    await harness.indexFixturePosts('site-drop-test', 'Drop Test', posts);

    // Verify data exists
    const statsBefore = await harness.vectorStore.getSiteStats('site-drop-test');
    expect(statsBefore).not.toBeNull();

    // Drop the site
    await harness.vectorStore.dropSite('site-drop-test');

    // Verify data is gone
    const sites = await harness.vectorStore.listSites();
    expect(sites).not.toContain('site-drop-test');
  });
});
