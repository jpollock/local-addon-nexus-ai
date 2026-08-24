// tests/unit/vector-store/sqlite-vec-store.test.ts
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { SqliteVecStore } from '../../../src/main/vector-store/SqliteVecStore';
import type { VectorDocument } from '../../../src/common/types';
import { VECTOR_DIMENSIONS } from '../../../src/common/constants';
import { vectorSiteId } from '../../../src/main/vector-store/vectorSiteId';

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

  it('accepts every id vectorSiteId can produce, including a multi-site external id', async () => {
    const siteId = vectorSiteId('ssh:hostinger-test/site-a');
    await expect(store.upsert(siteId, [])).resolves.not.toThrow();
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
    const results = await store.search('no-such-site', new Float32Array(VECTOR_DIMENSIONS).fill(0), { limit: 5 });
    expect(results).toEqual([]);
  });

  it('returns results ranked by score descending', async () => {
    const docA = makeDoc({ id: 'wp_s_1', postId: 1, vector: new Float32Array(VECTOR_DIMENSIONS).fill(0.5) });
    const docB = makeDoc({ id: 'wp_s_2', postId: 2, vector: new Float32Array(VECTOR_DIMENSIONS).fill(1.0) });
    await store.upsert('site-1', [docA, docB]);

    const query = new Float32Array(VECTOR_DIMENSIONS).fill(1.0);
    const results = await store.search('site-1', query, { limit: 5 });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].postId).toBe(2); // docB is closest to query
    for (let i = 1; i < results.length; i++) {
      expect(results[i].score).toBeLessThanOrEqual(results[i - 1].score);
    }
  });

  it('deduplicates — only the highest-scoring chunk per postId is returned', async () => {
    const chunk0 = makeDoc({ id: 'wp_s_1_c0', postId: 1, chunkIndex: 0, vector: new Float32Array(VECTOR_DIMENSIONS).fill(0.5) });
    const chunk1 = makeDoc({ id: 'wp_s_1_c1', postId: 1, chunkIndex: 1, vector: new Float32Array(VECTOR_DIMENSIONS).fill(1.0) });
    await store.upsert('site-1', [chunk0, chunk1]);

    const results = await store.search('site-1', new Float32Array(VECTOR_DIMENSIONS).fill(1.0), { limit: 10 });
    const postOneHits = results.filter(r => r.postId === 1);
    expect(postOneHits.length).toBe(1);
  });

  it('filters by relevanceFloor', async () => {
    // Very dissimilar vector (all zeros vs query of all ones — maximum distance)
    const doc = makeDoc({ id: 'wp_s_1', postId: 1, vector: new Float32Array(VECTOR_DIMENSIONS).fill(0.0) });
    await store.upsert('site-1', [doc]);

    const query = new Float32Array(VECTOR_DIMENSIONS).fill(1.0);
    const results = await store.search('site-1', query, { limit: 10, relevanceFloor: 0.99 });
    expect(results).toEqual([]);
  });

  it('filters by postType when specified', async () => {
    const postDoc = makeDoc({ id: 'wp_s_1', postId: 1, postType: 'post', vector: new Float32Array(VECTOR_DIMENSIONS).fill(1.0) });
    const pageDoc = makeDoc({ id: 'wp_s_2', postId: 2, postType: 'page', vector: new Float32Array(VECTOR_DIMENSIONS).fill(1.0) });
    await store.upsert('site-1', [postDoc, pageDoc]);

    const results = await store.search('site-1', new Float32Array(VECTOR_DIMENSIONS).fill(1.0), { limit: 10, postType: 'post' });
    expect(results.every(r => r.postType === 'post')).toBe(true);
    expect(results.length).toBeGreaterThan(0);
  });

  it('rejects invalid postType to prevent injection', async () => {
    await store.upsert('site-1', [makeDoc()]);
    await expect(
      store.search('site-1', new Float32Array(VECTOR_DIMENSIONS).fill(0), { limit: 5, postType: "post'; DROP TABLE docs;--" }),
    ).rejects.toThrow('Invalid postType');
  });
});

describe('searchAcrossSites', () => {
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

  it('returns empty map for unindexed sites', async () => {
    const results = await store.searchAcrossSites(['no-site'], new Float32Array(VECTOR_DIMENSIONS).fill(0), { limit: 5 });
    expect(results.size).toBe(0);
  });

  it('returns results for each indexed site', async () => {
    await store.upsert('site-a', [makeDoc({ id: 'wp_a_1', siteId: 'site-a', vector: new Float32Array(VECTOR_DIMENSIONS).fill(1.0) })]);
    await store.upsert('site-b', [makeDoc({ id: 'wp_b_1', siteId: 'site-b', vector: new Float32Array(VECTOR_DIMENSIONS).fill(1.0) })]);

    const results = await store.searchAcrossSites(
      ['site-a', 'site-b'],
      new Float32Array(VECTOR_DIMENSIONS).fill(1.0),
      { limit: 5 },
    );
    expect(results.has('site-a')).toBe(true);
    expect(results.has('site-b')).toBe(true);
  });

  it('FTS boost: document matching queryText scores higher than vector-only peer', async () => {
    // Both docs have the same vector (fill(0.98)) and the query is fill(1.0).
    // L2 distance ≈ 0.39 → score ≈ 0.61 for both (above the 0.35 floor).
    // The FTS-matching doc receives a +0.1 boost → ≈ 0.71, clearly above the peer at ≈ 0.61.
    // Using identical-but-non-query vectors avoids the score-1.0 cap that would mask the boost.
    const withKeyword = makeDoc({
      id: 'wp_s_1', postId: 1,
      title: 'woocommerce payment gateway',
      content: 'Configure woocommerce payment gateway for your store.',
      vector: new Float32Array(VECTOR_DIMENSIONS).fill(0.98),
    });
    const withoutKeyword = makeDoc({
      id: 'wp_s_2', postId: 2,
      title: 'Shopping cart setup',
      content: 'Setting up your shopping cart for checkout.',
      vector: new Float32Array(VECTOR_DIMENSIONS).fill(0.98),
    });
    await store.upsert('site-1', [withKeyword, withoutKeyword]);

    const results = await store.searchAcrossSites(
      ['site-1'],
      new Float32Array(VECTOR_DIMENSIONS).fill(1.0),
      { limit: 10, queryText: 'woocommerce payment' },
    );
    const hits = results.get('site-1') ?? [];
    const keywordHit = hits.find(r => r.postId === 1);
    const noKeywordHit = hits.find(r => r.postId === 2);
    expect(keywordHit).toBeDefined();
    expect(noKeywordHit).toBeDefined();
    expect(keywordHit!.score).toBeGreaterThan(noKeywordHit!.score);
  });

  it('FTS-only result is included with score 0.45 when vector match is below floor', async () => {
    const ftsOnlyDoc = makeDoc({
      id: 'wp_s_1', postId: 1,
      title: 'uniquekeyword alpha',
      content: 'This post is about uniquekeyword alpha concepts.',
      vector: new Float32Array(VECTOR_DIMENSIONS).fill(0.0), // will be far from query
    });
    await store.upsert('site-1', [ftsOnlyDoc]);

    const results = await store.searchAcrossSites(
      ['site-1'],
      new Float32Array(VECTOR_DIMENSIONS).fill(1.0),     // opposite vector → low similarity
      { limit: 10, queryText: 'uniquekeyword', relevanceFloor: 0.99 }, // floor kills vector result
    );
    const hits = results.get('site-1') ?? [];
    const ftsResult = hits.find(r => r.postId === 1);
    expect(ftsResult).toBeDefined();
    expect(ftsResult!.score).toBe(0.45);
  });

  it('excludes post types in excludedTypes', async () => {
    await store.upsert('site-1', [
      makeDoc({ id: 'wp_s_1', postId: 1, postType: 'post', vector: new Float32Array(VECTOR_DIMENSIONS).fill(1.0) }),
      makeDoc({ id: 'wp_s_2', postId: 2, postType: 'attachment', vector: new Float32Array(VECTOR_DIMENSIONS).fill(1.0) }),
    ]);
    const results = await store.searchAcrossSites(
      ['site-1'],
      new Float32Array(VECTOR_DIMENSIONS).fill(1.0),
      { limit: 10, excludedTypes: ['attachment'] },
    );
    const hits = results.get('site-1') ?? [];
    expect(hits.every(r => r.postType !== 'attachment')).toBe(true);
  });
});

describe('getAllDocuments', () => {
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

  it('returns [] when site has not been indexed', async () => {
    const docs = await store.getAllDocuments('nonexistent-site');
    expect(docs).toEqual([]);
  });

  it('returns one entry per post (chunk_index=0 only)', async () => {
    // Upsert two chunks for the same post + one chunk for a second post
    const embed384 = new Float32Array(384).fill(0.1);
    await store.upsert('test-site', [
      {
        id: 'wp_test-site_1',
        siteId: 'test-site',
        title: 'Post One',
        content: 'First chunk of post one',
        postType: 'post',
        postId: 1,
        chunkIndex: 0,
        metadata: JSON.stringify({ author: 'alice' }),
        indexedAt: Date.now(),
        vector: embed384,
        post_date_gmt: '',
        post_modified_gmt: '',
        doc_url: '',
      },
      {
        id: 'wp_test-site_1_chunk_1',
        siteId: 'test-site',
        title: 'Post One',
        content: 'Second chunk of post one',
        postType: 'post',
        postId: 1,
        chunkIndex: 1,
        metadata: JSON.stringify({ author: 'alice' }),
        indexedAt: Date.now(),
        vector: embed384,
        post_date_gmt: '',
        post_modified_gmt: '',
        doc_url: '',
      },
      {
        id: 'wp_test-site_2',
        siteId: 'test-site',
        title: 'Post Two',
        content: 'Only chunk of post two',
        postType: 'page',
        postId: 2,
        chunkIndex: 0,
        metadata: JSON.stringify({ author: 'bob' }),
        indexedAt: Date.now(),
        vector: new Float32Array(384).fill(0.5),
        post_date_gmt: '',
        post_modified_gmt: '',
        doc_url: '',
      },
    ]);

    const docs = await store.getAllDocuments('test-site');

    expect(docs).toHaveLength(2);
    expect(docs.map(d => d.postId).sort()).toEqual([1, 2]);
    expect(docs.every(d => d.embedding instanceof Float32Array)).toBe(true);
    expect(docs.every(d => d.embedding.length === 384)).toBe(true);
  });

  it('returns correct metadata fields', async () => {
    const embed384 = new Float32Array(384).fill(0.2);
    await store.upsert('meta-site', [{
      id: 'wp_meta-site_5',
      siteId: 'meta-site',
      title: 'My Post',
      content: 'Some content here',
      postType: 'post',
      postId: 5,
      chunkIndex: 0,
      metadata: JSON.stringify({ author: 'carol', categories: ['news'] }),
      indexedAt: Date.now(),
      vector: embed384,
      post_date_gmt: '',
      post_modified_gmt: '',
      doc_url: '',
    }]);

    const docs = await store.getAllDocuments('meta-site');
    expect(docs).toHaveLength(1);
    const doc = docs[0];
    expect(doc.id).toBe('wp_meta-site_5');
    expect(doc.postId).toBe(5);
    expect(doc.postType).toBe('post');
    expect(doc.title).toBe('My Post');
    expect(doc.content).toBe('Some content here');
    expect(JSON.parse(doc.metadata)).toMatchObject({ author: 'carol' });
  });
});

describe('CRUD — lookupById / delete / dropSite / dropAllTables / listSites / cleanupExcludedTypes', () => {
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

  // lookupById
  it('lookupById returns null for non-existent site', async () => {
    expect(await store.lookupById('no-site', 'any-id')).toBeNull();
  });

  it('lookupById returns null for non-existent document', async () => {
    await store.upsert('site-1', [makeDoc()]);
    expect(await store.lookupById('site-1', 'no-such-doc')).toBeNull();
  });

  it('lookupById returns id, title, content for existing document', async () => {
    await store.upsert('site-1', [makeDoc({ id: 'wp_s_1', title: 'My Post', content: 'My Content' })]);
    const result = await store.lookupById('site-1', 'wp_s_1');
    expect(result).toMatchObject({ id: 'wp_s_1', title: 'My Post', content: 'My Content' });
  });

  // delete
  it('delete removes specific document ids from all three tables', async () => {
    await store.upsert('site-1', [
      makeDoc({ id: 'wp_s_1', postId: 1 }),
      makeDoc({ id: 'wp_s_2', postId: 2 }),
    ]);
    await store.delete('site-1', ['wp_s_1']);
    const stats = await store.getSiteStats('site-1');
    expect(stats.chunkCount).toBe(1);
  });

  it('delete with __all__ sentinel clears all docs for the site', async () => {
    await store.upsert('site-1', [
      makeDoc({ id: 'wp_s_1', postId: 1 }),
      makeDoc({ id: 'wp_s_2', postId: 2 }),
    ]);
    await store.delete('site-1', ['__all__']);
    const stats = await store.getSiteStats('site-1');
    expect(stats.chunkCount).toBe(0);
  });

  // dropSite
  it('dropSite removes all three tables so getSiteStats returns zeros', async () => {
    await store.upsert('site-1', [makeDoc()]);
    await store.dropSite('site-1');
    const stats = await store.getSiteStats('site-1');
    expect(stats.chunkCount).toBe(0);
  });

  it('dropSite does not throw for non-existent site', async () => {
    await expect(store.dropSite('no-such-site')).resolves.not.toThrow();
  });

  // dropAllTables
  it('dropAllTables clears all sites and returns a positive count', async () => {
    await store.upsert('site-x', [makeDoc({ id: 'wp_x_1', siteId: 'site-x' })]);
    await store.upsert('site-y', [makeDoc({ id: 'wp_y_1', siteId: 'site-y' })]);
    const count = await store.dropAllTables();
    expect(count).toBeGreaterThan(0);
    expect(await store.listSites()).toEqual([]);
  });

  // listSites
  it('listSites returns empty when nothing is indexed', async () => {
    expect(await store.listSites()).toEqual([]);
  });

  it('listSites returns siteIds of indexed sites', async () => {
    await store.upsert('site-a', [makeDoc({ id: 'wp_a_1', siteId: 'site-a' })]);
    await store.upsert('site-b', [makeDoc({ id: 'wp_b_1', siteId: 'site-b' })]);
    const sites = await store.listSites();
    expect(sites).toContain('site-a');
    expect(sites).toContain('site-b');
  });

  // cleanupExcludedTypes
  it('cleanupExcludedTypes removes docs of excluded post types', async () => {
    await store.upsert('site-1', [
      makeDoc({ id: 'wp_s_1', postId: 1, postType: 'post' }),
      makeDoc({ id: 'wp_s_2', postId: 2, postType: 'attachment' }),
    ]);
    const result = await store.cleanupExcludedTypes(['attachment']);
    expect(result.docsRemoved).toBe(1);
    expect(result.tablesScanned).toBe(1);
    const stats = await store.getSiteStats('site-1');
    expect(stats.chunkCount).toBe(1);
  });

  it('cleanupExcludedTypes returns zeros for empty types list', async () => {
    await store.upsert('site-1', [makeDoc()]);
    const result = await store.cleanupExcludedTypes([]);
    expect(result.docsRemoved).toBe(0);
    expect(result.tablesScanned).toBe(0);
  });
});

/**
 * D8 — keyword and hybrid search were broken for any site whose id contains a
 * hyphen: the FTS table name was CREATED quoted but QUERIED unquoted in
 * searchBM25, so SQLite read `--` in a nanoid as a line comment ("no such
 * table: site_oXhu") and a single hyphen as a syntax error. The semantic path
 * was always quoted, which is why only keyword/hybrid failed.
 *
 * Both real symptom shapes from the register are pinned: the local nanoid with
 * a double hyphen (oXhu--v0j / cedarvale) and the WPE UUID (cedarvalehealt).
 */
describe('D8 — keyword/hybrid search on hyphenated site ids', () => {
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

  const HYPHENATED = [
    ['local nanoid with double hyphen', 'oXhu--v0j'],
    ['WPE uuid', '99ef6161-13f1-4bd0-9c1e-2f65a1b0c3d4'],
  ] as const;

  for (const [label, siteId] of HYPHENATED) {
    it(`keyword search works on a ${label}`, async () => {
      await store.upsert(siteId, [makeDoc({
        siteId, id: `wp_${siteId}_7`, postId: 7,
        title: 'Dermatology provider',
        content: 'Our dermatology provider sees patients weekly.',
      })]);

      const results = await store.search(
        siteId, new Float32Array(VECTOR_DIMENSIONS).fill(0.1),
        { searchMode: 'keyword', queryText: 'dermatology provider', limit: 10 },
      );

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].postId).toBe(7);
    });

    it(`hybrid search works on a ${label}`, async () => {
      await store.upsert(siteId, [makeDoc({
        siteId, id: `wp_${siteId}_7`, postId: 7,
        title: 'Dermatology provider',
        content: 'Our dermatology provider sees patients weekly.',
      })]);

      const results = await store.search(
        siteId, new Float32Array(VECTOR_DIMENSIONS).fill(0.1),
        { searchMode: 'hybrid', queryText: 'dermatology provider', limit: 10 },
      );

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].postId).toBe(7);
    });
  }

  it('a keyword miss on a hyphenated id is an empty result, not a thrown SQL error', async () => {
    await store.upsert('oXhu--v0j', [makeDoc({ siteId: 'oXhu--v0j', id: 'wp_oXhu--v0j_1' })]);

    const results = await store.search(
      'oXhu--v0j', new Float32Array(VECTOR_DIMENSIONS).fill(0.1),
      { searchMode: 'keyword', queryText: 'nomatchanywhere', limit: 10 },
    );

    expect(results).toEqual([]);
  });
});

/**
 * D23 — the census: membership in a structured filter is evaluated over the
 * FULL population, never a retrieval candidate set. The Meridian gate proved
 * the defect: the same filter returned 9 or 20 of 200 true matches depending
 * on the query wording, because filters only saw retrieval candidates.
 */
describe('D23 — countMetadataMatches', () => {
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

  async function seed(counts: number[]) {
    await store.upsert('census-site', counts.map((wc, i) => makeDoc({
      siteId: 'census-site', id: `wp_c_${i}`, postId: i + 1,
      title: `Post ${i}`, content: `content ${i}`,
      metadata: JSON.stringify({ customFields: { word_count: String(wc) } }),
    })));
  }

  test('counts every matching post — independent of any query or relevance', async () => {
    await seed([100, 200, 900, 350, 4000]);
    const census = store.countMetadataMatches('census-site',
      [{ field: 'word_count', op: 'lt', value: 400 }]);
    expect(census).toEqual({ matched: 3, examined: 5 });
  });

  test('postType narrows the population and the denominator says so', async () => {
    await store.upsert('census-site', [
      makeDoc({ siteId: 'census-site', id: 'wp_a_1', postId: 1, postType: 'doc',
        metadata: JSON.stringify({ customFields: { v: '2.10' } }) }),
      makeDoc({ siteId: 'census-site', id: 'wp_a_2', postId: 2, postType: 'post',
        metadata: JSON.stringify({ customFields: { v: '1.0' } }) }),
    ]);
    const census = store.countMetadataMatches('census-site',
      [{ field: 'v', op: 'gte', value: '2.9' }], 'doc');
    expect(census).toEqual({ matched: 1, examined: 1 });
  });

  test('an unindexed site is a zero census, and chunks never double-count a post', async () => {
    expect(store.countMetadataMatches('never-indexed', [{ field: 'x', op: 'eq', value: '1' }]))
      .toEqual({ matched: 0, examined: 0 });

    await store.upsert('census-site', [0, 1].map((chunk) => makeDoc({
      siteId: 'census-site', id: `wp_m_1_${chunk}`, postId: 7, chunkIndex: chunk,
      metadata: JSON.stringify({ customFields: { flag: 'on' } }),
    })));
    expect(store.countMetadataMatches('census-site', [{ field: 'flag', op: 'eq', value: 'on' }]))
      .toEqual({ matched: 1, examined: 1 });
  });

  test('a filter that cannot work refuses the census too — never reports zero', async () => {
    await seed([100]);
    expect(() => store.countMetadataMatches('census-site',
      [{ field: 'word_count', op: 'lt', value: 'stale' }])).toThrow(/cannot be applied/);
  });
});
