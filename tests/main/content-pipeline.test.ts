import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { ContentPipeline, ContentPipelineDeps } from '../../src/main/content/ContentPipeline';
import { VectorStore } from '../../src/main/vector-store/VectorStore';
import { IndexRegistry, RegistryStorage } from '../../src/main/content/IndexRegistry';
import { MySQLExtractor, SiteConnectionInfo } from '../../src/main/content/MySQLExtractor';
import { FileScanner } from '../../src/main/content/FileScanner';
import { EmbeddingService } from '../../src/main/embeddings/EmbeddingService';
import { ExtractedContent, ExtractedPost } from '../../src/common/types';
import { VECTOR_DIMENSIONS, CHUNK_MAX_WORDS } from '../../src/common/constants';

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

function makeFakeVector(): Float32Array {
  const vec = new Float32Array(VECTOR_DIMENSIONS);
  for (let i = 0; i < VECTOR_DIMENSIONS; i++) vec[i] = Math.random();
  // L2 normalize
  let norm = 0;
  for (let i = 0; i < VECTOR_DIMENSIONS; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm);
  for (let i = 0; i < VECTOR_DIMENSIONS; i++) vec[i] /= norm;
  return vec;
}

function createMockStorage(): RegistryStorage {
  const store = new Map<string, any>();
  return {
    get: (key: string) => store.get(key) ?? null,
    set: (key: string, value: any) => store.set(key, value),
  };
}

const SITE_INFO: SiteConnectionInfo = {
  siteId: 'test-site',
  siteName: 'Test Site',
  sitePath: '/tmp/fake-site',
};

describe('ContentPipeline', () => {
  let tmpDir: string;
  let vectorStore: VectorStore;
  let indexRegistry: IndexRegistry;
  let mockExtractor: jest.Mocked<MySQLExtractor>;
  let mockScanner: jest.Mocked<FileScanner>;
  let mockEmbedding: jest.Mocked<EmbeddingService>;
  let statusChanges: Array<{ siteId: string; state: string }>;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-pipeline-'));
    vectorStore = new VectorStore(tmpDir);
    await vectorStore.initialize();

    indexRegistry = new IndexRegistry(createMockStorage());

    mockExtractor = {
      isAvailable: jest.fn().mockReturnValue(true),
      extract: jest.fn().mockResolvedValue({
        posts: [makePost(1), makePost(2), makePost(3)],
        siteInfo: { name: 'Test', url: 'http://test.local', wpVersion: '6.5' },
        extractedAt: Date.now(),
      } as ExtractedContent),
    } as any;

    mockScanner = {
      scan: jest.fn().mockResolvedValue({
        themes: [],
        plugins: [],
        phpVersion: '8.2',
        wpVersion: '6.5',
        isMultisite: false,
        hasWooCommerce: false,
        hasACF: false,
      }),
    } as any;

    mockEmbedding = {
      embedBatch: jest.fn().mockImplementation((texts: string[]) =>
        Promise.resolve(texts.map(() => makeFakeVector())),
      ),
    } as any;

    statusChanges = [];
  });

  afterEach(async () => {
    await vectorStore.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function createPipeline(): ContentPipeline {
    return new ContentPipeline({
      vectorStore,
      embeddingService: mockEmbedding,
      mysqlExtractor: mockExtractor,
      fileScanner: mockScanner,
      indexRegistry,
      onStatusChange: (siteId, status) => {
        statusChanges.push({ siteId, state: status.state });
      },
    });
  }

  test('indexes a site end-to-end', async () => {
    const pipeline = createPipeline();
    const result = await pipeline.indexSite(SITE_INFO);

    expect(result.siteId).toBe('test-site');
    expect(result.documentsIndexed).toBe(3);
    expect(result.chunksIndexed).toBe(3);
    expect(result.errors).toEqual([]);
    expect(result.durationMs).toBeGreaterThan(0);

    // Verify vectors were stored
    const stats = await vectorStore.getSiteStats('test-site');
    expect(stats.chunkCount).toBe(3);

    // Verify registry was updated
    const entry = indexRegistry.get('test-site');
    expect(entry).not.toBeNull();
    expect(entry!.state).toBe('indexed');
    expect(entry!.documentCount).toBe(3);
  });

  test('emits status changes during indexing', async () => {
    const pipeline = createPipeline();
    await pipeline.indexSite(SITE_INFO);

    expect(statusChanges.length).toBeGreaterThan(0);
    expect(statusChanges[0].state).toBe('indexing');
    expect(statusChanges[statusChanges.length - 1].state).toBe('indexed');
  });

  test('handles MySQL unavailable gracefully', async () => {
    mockExtractor.isAvailable.mockReturnValue(false);
    const pipeline = createPipeline();
    const result = await pipeline.indexSite(SITE_INFO);

    expect(result.documentsIndexed).toBe(0);
    expect(result.errors).toContain('MySQL not available — site may not be running');
  });

  test('handles empty site (no posts)', async () => {
    mockExtractor.extract.mockResolvedValue({
      posts: [],
      siteInfo: { name: 'Empty', url: '', wpVersion: '' },
      extractedAt: Date.now(),
    });

    const pipeline = createPipeline();
    const result = await pipeline.indexSite(SITE_INFO);

    expect(result.documentsIndexed).toBe(0);
    expect(result.chunksIndexed).toBe(0);
  });

  test('chunks long posts', async () => {
    // Build content with sentence boundaries so the chunker can split
    const sentences = Array(Math.ceil((CHUNK_MAX_WORDS + 200) / 10))
      .fill(null)
      .map((_, i) => `This is sentence number ${i} with some filler words added.`);
    const longContent = sentences.join(' ');

    mockExtractor.extract.mockResolvedValue({
      posts: [makePost(1, { cleanedContent: longContent })],
      siteInfo: { name: 'Long', url: '', wpVersion: '' },
      extractedAt: Date.now(),
    });

    const pipeline = createPipeline();
    const result = await pipeline.indexSite(SITE_INFO);

    // Should have more than 1 chunk for a 700-word post
    expect(result.chunksIndexed).toBeGreaterThan(1);
    expect(result.documentsIndexed).toBe(1); // Still 1 unique post
  });

  test('reindexSite drops existing data first', async () => {
    const pipeline = createPipeline();

    // Index once
    await pipeline.indexSite(SITE_INFO);
    let stats = await vectorStore.getSiteStats('test-site');
    expect(stats.chunkCount).toBe(3);

    // Reindex with different data
    mockExtractor.extract.mockResolvedValue({
      posts: [makePost(10)],
      siteInfo: { name: 'Test', url: '', wpVersion: '' },
      extractedAt: Date.now(),
    });

    const result = await pipeline.reindexSite(SITE_INFO);
    expect(result.documentsIndexed).toBe(1);

    stats = await vectorStore.getSiteStats('test-site');
    expect(stats.chunkCount).toBe(1);
  });

  test('removeSite cleans up vector store and registry', async () => {
    const pipeline = createPipeline();
    await pipeline.indexSite(SITE_INFO);

    await pipeline.removeSite('test-site');

    const stats = await vectorStore.getSiteStats('test-site');
    expect(stats.chunkCount).toBe(0);
    expect(indexRegistry.get('test-site')).toBeNull();
  });

  test('getStatus reflects current state', async () => {
    const pipeline = createPipeline();

    expect(pipeline.getStatus('test-site')).toEqual({ state: 'idle' });

    await pipeline.indexSite(SITE_INFO);

    const status = pipeline.getStatus('test-site');
    expect(status.state).toBe('indexed');
  });

  test('handles embedding errors without crashing', async () => {
    mockEmbedding.embedBatch.mockRejectedValueOnce(new Error('ONNX crash'));

    const pipeline = createPipeline();
    const result = await pipeline.indexSite(SITE_INFO);

    // Should have recorded the error but not thrown
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('ONNX crash');
  });

  test('passes structure to extract() as second argument', async () => {
    const pipeline = createPipeline();
    await pipeline.indexSite(SITE_INFO);

    // extract should have been called with structure as second arg
    expect(mockExtractor.extract).toHaveBeenCalledWith(
      SITE_INFO,
      expect.objectContaining({
        hasWooCommerce: false,
        hasACF: false,
      }),
    );
  });

  test('includes products when hasWooCommerce is true', async () => {
    // Scanner returns WooCommerce detected
    mockScanner.scan.mockResolvedValue({
      themes: [],
      plugins: [],
      phpVersion: '8.2',
      wpVersion: '6.5',
      isMultisite: false,
      hasWooCommerce: true,
      hasACF: false,
    });

    // Extractor returns posts + products
    mockExtractor.extract.mockResolvedValue({
      posts: [
        makePost(1),
        makePost(100, { postType: 'product', title: 'Blue Mug', cleanedContent: 'Blue Mug. simple product priced at $24.99' }),
      ],
      siteInfo: { name: 'Shop', url: 'http://shop.local', wpVersion: '6.5' },
      extractedAt: Date.now(),
    });

    const pipeline = createPipeline();
    const result = await pipeline.indexSite(SITE_INFO);

    expect(result.documentsIndexed).toBe(2);
    // Verify structure was passed with hasWooCommerce: true
    expect(mockExtractor.extract).toHaveBeenCalledWith(
      SITE_INFO,
      expect.objectContaining({ hasWooCommerce: true }),
    );
  });

  test('includes media attachments in results', async () => {
    mockExtractor.extract.mockResolvedValue({
      posts: [
        makePost(1),
        makePost(50, {
          postType: 'attachment',
          title: 'Hero Image',
          cleanedContent: 'Image: Hero Image. Alt text: Beautiful sunset',
        }),
      ],
      siteInfo: { name: 'Test', url: '', wpVersion: '6.5' },
      extractedAt: Date.now(),
    });

    const pipeline = createPipeline();
    const result = await pipeline.indexSite(SITE_INFO);

    expect(result.documentsIndexed).toBe(2);
  });

  test('merges custom tables into saved structure', async () => {
    mockExtractor.extract.mockResolvedValue({
      posts: [makePost(1)],
      siteInfo: { name: 'Test', url: '', wpVersion: '6.5' },
      extractedAt: Date.now(),
      customTables: [
        { name: 'wp_wc_orders', prefix: 'wc_orders', rowCount: 42, pluginGuess: 'WooCommerce' },
      ],
    });

    const pipeline = createPipeline();
    await pipeline.indexSite(SITE_INFO);

    const entry = indexRegistry.get('test-site');
    expect(entry).not.toBeNull();
    expect(entry!.structure?.customTables).toHaveLength(1);
    expect(entry!.structure?.customTables![0].name).toBe('wp_wc_orders');
  });

  test('collects sub-extractor warnings', async () => {
    mockExtractor.extract.mockResolvedValue({
      posts: [makePost(1)],
      siteInfo: { name: 'Test', url: '', wpVersion: '6.5' },
      extractedAt: Date.now(),
      warnings: ['WooCommerceExtractor: table not found'],
    });

    const pipeline = createPipeline();
    const result = await pipeline.indexSite(SITE_INFO);

    expect(result.errors).toContain('WooCommerceExtractor: table not found');
  });

  test('works when neither WooCommerce nor ACF present (regression)', async () => {
    // Default mocks have hasWooCommerce: false, hasACF: false
    const pipeline = createPipeline();
    const result = await pipeline.indexSite(SITE_INFO);

    expect(result.siteId).toBe('test-site');
    expect(result.documentsIndexed).toBe(3);
    expect(result.errors).toEqual([]);
  });
});
