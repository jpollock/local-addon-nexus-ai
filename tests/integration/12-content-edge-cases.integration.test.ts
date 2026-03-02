import { TestHarness } from './helpers/harness';
import { ExtractedPost } from '../../src/common/types';

function makePost(id: number, overrides?: Partial<ExtractedPost>): ExtractedPost {
  return {
    id,
    title: `Post ${id}`,
    content: `<p>Content for post ${id}</p>`,
    cleanedContent: `Content for post ${id}`,
    excerpt: `Excerpt ${id}`,
    postType: 'post',
    postStatus: 'publish',
    author: '1',
    date: '2024-01-01',
    categories: ['Uncategorized'],
    tags: [],
    customFields: {},
    ...overrides,
  };
}

describe('Content Edge Cases (integration)', () => {
  let harness: TestHarness;

  beforeAll(async () => {
    harness = await TestHarness.create({ skipServer: true });
  });

  afterAll(async () => {
    await harness.cleanup();
  });

  test('index and search Unicode content', async () => {
    const posts = [
      makePost(1, {
        title: '中文测试文章',
        cleanedContent: 'WordPress 中文内容管理系统。这是一篇关于测试的文章。',
      }),
      makePost(2, {
        title: '日本語テスト',
        cleanedContent: 'これはテスト記事です。WordPress は人気のあるCMSです。',
      }),
    ];

    const result = await harness.indexFixturePosts('unicode-site', 'Unicode Site', posts);

    expect(result.documentsIndexed).toBe(2);
    expect(result.chunksIndexed).toBeGreaterThanOrEqual(2);
    expect(result.errors).toEqual([]);

    // Search for Chinese content
    const queryVec = await harness.embeddingService.embed('中文内容管理');
    const results = await harness.vectorStore.search('unicode-site', queryVec, {
      limit: 5,
      relevanceFloor: 0,
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].score).toBeGreaterThan(0);
  });

  test('index long post (2000+ words) produces multiple chunks with searchable mid-post content', async () => {
    // Build a post with 2000+ words and a distinctive phrase in the middle
    const sentences: string[] = [];
    for (let i = 0; i < 100; i++) {
      sentences.push(`This is sentence number ${i} about WordPress site development and management.`);
    }
    // Insert a distinctive phrase in the middle
    sentences.splice(50, 0, 'The quantum singularity processor enables unprecedented computational speed.');
    for (let i = 100; i < 200; i++) {
      sentences.push(`Continuation sentence ${i} covering additional WordPress content.`);
    }
    const longContent = sentences.join(' ');

    const posts = [makePost(1, { title: 'Long Post', cleanedContent: longContent })];

    const result = await harness.indexFixturePosts('long-site', 'Long Site', posts);

    expect(result.documentsIndexed).toBe(1);
    expect(result.chunksIndexed).toBeGreaterThan(1);

    // Search for the distinctive mid-post phrase
    const queryVec = await harness.embeddingService.embed('quantum singularity processor');
    const results = await harness.vectorStore.search('long-site', queryVec, {
      limit: 5,
      relevanceFloor: 0,
    });

    expect(results.length).toBeGreaterThan(0);
    // The result should be from our long post
    expect(results[0].postId).toBe(1);
  });

  test('empty site (0 posts) produces valid zero-count index entry', async () => {
    const result = await harness.indexFixturePosts('empty-site', 'Empty Site', []);

    expect(result.documentsIndexed).toBe(0);
    expect(result.chunksIndexed).toBe(0);
    expect(result.errors).toEqual([]);

    // Verify registry entry
    const entry = harness.indexRegistry.get('empty-site');
    expect(entry).not.toBeNull();
    expect(entry!.state).toBe('indexed');
    expect(entry!.documentCount).toBe(0);
    expect(entry!.chunkCount).toBe(0);
  });
});
