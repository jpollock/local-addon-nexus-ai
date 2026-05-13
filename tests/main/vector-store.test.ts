import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { VectorStore } from '../../src/main/vector-store/VectorStore';
import { VectorDocument } from '../../src/common/types';
import { VECTOR_DIMENSIONS } from '../../src/common/constants';

function makeVector(seed: number): Float32Array {
  const vec = new Float32Array(VECTOR_DIMENSIONS);
  for (let i = 0; i < VECTOR_DIMENSIONS; i++) {
    vec[i] = Math.sin(seed * (i + 1));
  }
  // L2 normalize
  let norm = 0;
  for (let i = 0; i < VECTOR_DIMENSIONS; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm);
  for (let i = 0; i < VECTOR_DIMENSIONS; i++) vec[i] /= norm;
  return vec;
}

function makeDoc(
  siteId: string,
  postId: number,
  overrides?: Partial<VectorDocument>
): VectorDocument {
  return {
    id: `wp_${siteId}_${postId}`,
    siteId,
    title: `Post ${postId}`,
    content: `Content for post ${postId}`,
    postType: 'post',
    postId,
    chunkIndex: 0,
    vector: makeVector(postId),
    metadata: JSON.stringify({ excerpt: `Excerpt ${postId}` }),
    indexedAt: Date.now(),
    post_date_gmt: '',
    post_modified_gmt: '',
    doc_url: '',
    ...overrides,
  };
}

describe('VectorStore', () => {
  let store: VectorStore;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-test-'));
    store = new VectorStore(tmpDir);
    await store.initialize();
  });

  afterEach(async () => {
    await store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('inserts and retrieves documents', async () => {
    const docs = [makeDoc('site1', 1), makeDoc('site1', 2), makeDoc('site1', 3)];
    await store.upsert('site1', docs);

    const stats = await store.getSiteStats('site1');
    expect(stats.documentCount).toBe(3);
    expect(stats.chunkCount).toBe(3);
  });

  test('searches by vector similarity', async () => {
    const docs = [makeDoc('site1', 1), makeDoc('site1', 2), makeDoc('site1', 3)];
    await store.upsert('site1', docs);

    // Search with the same vector as doc 1 — it should rank highest
    // relevanceFloor: 0 to include all results regardless of cosine similarity
    const results = await store.search('site1', docs[0].vector, { limit: 3, relevanceFloor: 0 });
    expect(results.length).toBe(3);
    expect(results[0].postId).toBe(1);
    expect(results[0].score).toBeGreaterThan(0);
  });

  test('isolates sites — site A docs not in site B results', async () => {
    await store.upsert('siteA', [makeDoc('siteA', 1)]);
    await store.upsert('siteB', [makeDoc('siteB', 2)]);

    const resultsA = await store.search('siteA', makeVector(1), { limit: 10 });
    const resultsB = await store.search('siteB', makeVector(2), { limit: 10 });

    expect(resultsA.length).toBe(1);
    expect(resultsA[0].postId).toBe(1);
    expect(resultsB.length).toBe(1);
    expect(resultsB[0].postId).toBe(2);
  });

  test('upsert overwrites existing documents', async () => {
    await store.upsert('site1', [makeDoc('site1', 1, { title: 'Original' })]);
    await store.upsert('site1', [makeDoc('site1', 1, { title: 'Updated' })]);

    const stats = await store.getSiteStats('site1');
    expect(stats.chunkCount).toBe(1);

    const results = await store.search('site1', makeVector(1), { limit: 1 });
    expect(results[0].title).toBe('Updated');
  });

  test('deletes specific documents', async () => {
    await store.upsert('site1', [makeDoc('site1', 1), makeDoc('site1', 2)]);
    await store.delete('site1', ['wp_site1_1']);

    const stats = await store.getSiteStats('site1');
    expect(stats.chunkCount).toBe(1);
  });

  test('drops entire site table', async () => {
    await store.upsert('site1', [makeDoc('site1', 1)]);
    await store.dropSite('site1');

    const sites = await store.listSites();
    expect(sites).not.toContain('site1');
  });

  test('listSites returns all indexed sites', async () => {
    await store.upsert('alpha', [makeDoc('alpha', 1)]);
    await store.upsert('beta', [makeDoc('beta', 1)]);
    await store.upsert('gamma', [makeDoc('gamma', 1)]);

    const sites = await store.listSites();
    expect(sites.sort()).toEqual(['alpha', 'beta', 'gamma']);
  });

  test('search on non-existent site returns empty', async () => {
    const results = await store.search('nosite', makeVector(1), { limit: 5 });
    expect(results).toEqual([]);
  });

  test('stats on non-existent site returns zeros', async () => {
    const stats = await store.getSiteStats('nosite');
    expect(stats.documentCount).toBe(0);
    expect(stats.chunkCount).toBe(0);
  });

  test('filters by postType', async () => {
    await store.upsert('site1', [
      makeDoc('site1', 1, { postType: 'post' }),
      makeDoc('site1', 2, { postType: 'page' }),
      makeDoc('site1', 3, { postType: 'post' }),
    ]);

    const results = await store.search('site1', makeVector(1), {
      limit: 10,
      postType: 'page',
      relevanceFloor: 0,
    });
    expect(results.length).toBe(1);
    expect(results[0].postType).toBe('page');
  });

  test('handles empty upsert', async () => {
    await store.upsert('site1', []);
    const stats = await store.getSiteStats('site1');
    expect(stats.documentCount).toBe(0);
  });

  // --- postType injection guard (regression tests for issue #8) ---

  test('accepts valid postType slugs', async () => {
    const validTypes = ['post', 'page', 'attachment', 'custom-post-type', 'my_type', 'CPT123'];
    for (const postType of validTypes) {
      await store.upsert('site1', [makeDoc('site1', 1, { postType })]);
      // Should not throw
      const results = await store.search('site1', makeVector(1), {
        limit: 1,
        postType,
        relevanceFloor: 0,
      });
      expect(results.length).toBeGreaterThanOrEqual(0);
    }
  });

  test('rejects injection payloads in postType for search()', async () => {
    await store.upsert('site1', [makeDoc('site1', 1)]);
    const malicious = [
      "x' OR '1'='1",
      "post'; DROP TABLE nexus_site1_content; --",
      'post" OR "1"="1',
      'post\'; SELECT * FROM nexus_site1_content; --',
      '<script>alert(1)</script>',
      'post type',  // space
      'post/page',  // slash
    ];
    for (const payload of malicious) {
      await expect(
        store.search('site1', makeVector(1), { limit: 1, postType: payload }),
      ).rejects.toThrow('Invalid postType');
    }
  });

  test('rejects injection payloads in postType for searchAcrossSites()', async () => {
    await store.upsert('site1', [makeDoc('site1', 1)]);
    await expect(
      store.searchAcrossSites(['site1'], makeVector(1), {
        limit: 1,
        postType: "post' OR 'x'='x",
      }),
    ).rejects.toThrow('Invalid postType');
  });

  test('rejects injection payloads in excludedTypes for cleanupExcludedTypes()', async () => {
    await store.upsert('site1', [makeDoc('site1', 1)]);
    await expect(
      store.cleanupExcludedTypes(["post'; DROP TABLE nexus_site1_content; --"]),
    ).rejects.toThrow('Invalid postType');
  });
});
