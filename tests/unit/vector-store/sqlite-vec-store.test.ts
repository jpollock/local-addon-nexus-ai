// tests/unit/vector-store/sqlite-vec-store.test.ts
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { SqliteVecStore } from '../../../src/main/vector-store/SqliteVecStore';
import type { VectorDocument } from '../../../src/common/types';
import { VECTOR_DIMENSIONS } from '../../../src/common/constants';

function tmpDb(): string {
  return path.join(os.tmpdir(), `test-vec-${process.hrtime.bigint()}.db`);
}

export function makeDoc(overrides: Partial<VectorDocument> = {}): VectorDocument {
  return {
    id: 'wp_site1_1',
    siteId: 'site-1',
    title: 'Hello World',
    content: 'This is a test post about hello world.',
    postType: 'post',
    postId: 1,
    chunkIndex: 0,
    vector: new Float32Array(VECTOR_DIMENSIONS).fill(0.1),
    metadata: JSON.stringify({ excerpt: 'test' }),
    indexedAt: Date.now(),
    post_date_gmt: '2024-01-01T00:00:00',
    post_modified_gmt: '2024-01-01T00:00:00',
    doc_url: 'https://example.com/hello-world',
    ...overrides,
  };
}

describe('SqliteVecStore — initialize/close', () => {
  it('initializes and closes without error', async () => {
    const dbPath = tmpDb();
    const store = new SqliteVecStore(dbPath);
    await store.initialize();
    await store.close();
    fs.unlinkSync(dbPath);
  });

  it('throws when upsert is called before initialize', async () => {
    const store = new SqliteVecStore(tmpDb());
    await expect(store.upsert('site-1', [])).rejects.toThrow('not initialized');
  });
});

describe('upsert + getSiteStats', () => {
  let store: SqliteVecStore;
  let dbPath: string;

  beforeEach(async () => {
    dbPath = tmpDb();
    store = new SqliteVecStore(dbPath);
    await store.initialize();
  });

  afterEach(async () => {
    await store.close();
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  });

  it('inserts a document without error', async () => {
    await expect(store.upsert('site-1', [makeDoc()])).resolves.not.toThrow();
  });

  it('is idempotent — same id twice yields count of 1', async () => {
    const doc = makeDoc();
    await store.upsert('site-1', [doc]);
    await store.upsert('site-1', [doc]);
    const stats = await store.getSiteStats('site-1');
    expect(stats.chunkCount).toBe(1);
  });

  it('inserts a batch and all rows appear in stats', async () => {
    const docs = Array.from({ length: 5 }, (_, i) =>
      makeDoc({ id: `wp_s_${i}`, postId: i }),
    );
    await store.upsert('site-1', docs);
    const stats = await store.getSiteStats('site-1');
    expect(stats.chunkCount).toBe(5);
    expect(stats.documentCount).toBe(5);
  });

  it('skips empty array without error', async () => {
    await expect(store.upsert('site-1', [])).resolves.not.toThrow();
  });

  it('getSiteStats returns zeros for unindexed site', async () => {
    const stats = await store.getSiteStats('no-such-site');
    expect(stats).toEqual({ siteId: 'no-such-site', documentCount: 0, chunkCount: 0, lastIndexed: 0 });
  });

  it('getSiteStats counts chunks vs unique posts correctly', async () => {
    const docs = [
      makeDoc({ id: 'wp_s_1_c0', postId: 1, chunkIndex: 0 }),
      makeDoc({ id: 'wp_s_1_c1', postId: 1, chunkIndex: 1 }),
      makeDoc({ id: 'wp_s_2_c0', postId: 2, chunkIndex: 0 }),
    ];
    await store.upsert('site-1', docs);
    const stats = await store.getSiteStats('site-1');
    expect(stats.chunkCount).toBe(3);
    expect(stats.documentCount).toBe(2); // 2 unique post IDs
  });
});

describe('search', () => {
  let store: SqliteVecStore;
  let dbPath: string;

  beforeEach(async () => {
    dbPath = tmpDb();
    store = new SqliteVecStore(dbPath);
    await store.initialize();
  });

  afterEach(async () => {
    await store.close();
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  });

  it('returns empty array for non-existent site', async () => {
    const results = await store.search('no-such-site', new Float32Array(384).fill(0), { limit: 5 });
    expect(results).toEqual([]);
  });

  it('returns results ranked by score descending', async () => {
    const docA = makeDoc({ id: 'wp_s_1', postId: 1, vector: new Float32Array(384).fill(0.5) });
    const docB = makeDoc({ id: 'wp_s_2', postId: 2, vector: new Float32Array(384).fill(1.0) });
    await store.upsert('site-1', [docA, docB]);

    const query = new Float32Array(384).fill(1.0);
    const results = await store.search('site-1', query, { limit: 5 });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].postId).toBe(2); // docB is closest to query
    for (let i = 1; i < results.length; i++) {
      expect(results[i].score).toBeLessThanOrEqual(results[i - 1].score);
    }
  });

  it('deduplicates — only the highest-scoring chunk per postId is returned', async () => {
    const chunk0 = makeDoc({ id: 'wp_s_1_c0', postId: 1, chunkIndex: 0, vector: new Float32Array(384).fill(0.5) });
    const chunk1 = makeDoc({ id: 'wp_s_1_c1', postId: 1, chunkIndex: 1, vector: new Float32Array(384).fill(1.0) });
    await store.upsert('site-1', [chunk0, chunk1]);

    const results = await store.search('site-1', new Float32Array(384).fill(1.0), { limit: 10 });
    const postOneHits = results.filter(r => r.postId === 1);
    expect(postOneHits.length).toBe(1);
  });

  it('filters by relevanceFloor', async () => {
    // Very dissimilar vector (all zeros vs query of all ones — maximum distance)
    const doc = makeDoc({ id: 'wp_s_1', postId: 1, vector: new Float32Array(384).fill(0.0) });
    await store.upsert('site-1', [doc]);

    const query = new Float32Array(384).fill(1.0);
    const results = await store.search('site-1', query, { limit: 10, relevanceFloor: 0.99 });
    expect(results).toEqual([]);
  });

  it('filters by postType when specified', async () => {
    const postDoc = makeDoc({ id: 'wp_s_1', postId: 1, postType: 'post', vector: new Float32Array(384).fill(1.0) });
    const pageDoc = makeDoc({ id: 'wp_s_2', postId: 2, postType: 'page', vector: new Float32Array(384).fill(1.0) });
    await store.upsert('site-1', [postDoc, pageDoc]);

    const results = await store.search('site-1', new Float32Array(384).fill(1.0), { limit: 10, postType: 'post' });
    expect(results.every(r => r.postType === 'post')).toBe(true);
    expect(results.length).toBeGreaterThan(0);
  });

  it('rejects invalid postType to prevent injection', async () => {
    await store.upsert('site-1', [makeDoc()]);
    await expect(
      store.search('site-1', new Float32Array(384).fill(0), { limit: 5, postType: "post'; DROP TABLE docs;--" }),
    ).rejects.toThrow('Invalid postType');
  });
});
