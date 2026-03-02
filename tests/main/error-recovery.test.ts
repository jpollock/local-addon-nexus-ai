import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { ContentPipeline } from '../../src/main/content/ContentPipeline';
import { VectorStore } from '../../src/main/vector-store/VectorStore';
import { IndexRegistry, RegistryStorage } from '../../src/main/content/IndexRegistry';
import { MySQLExtractor, SiteConnectionInfo } from '../../src/main/content/MySQLExtractor';
import { FileScanner } from '../../src/main/content/FileScanner';
import { EmbeddingService } from '../../src/main/embeddings/EmbeddingService';
import { ExtractedPost } from '../../src/common/types';
import { VECTOR_DIMENSIONS } from '../../src/common/constants';

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

describe('Error Recovery', () => {
  let tmpDir: string;
  let vectorStore: VectorStore;
  let indexRegistry: IndexRegistry;
  let mockExtractor: jest.Mocked<MySQLExtractor>;
  let mockScanner: jest.Mocked<FileScanner>;
  let mockEmbedding: jest.Mocked<EmbeddingService>;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-recovery-'));
    vectorStore = new VectorStore(tmpDir);
    await vectorStore.initialize();

    indexRegistry = new IndexRegistry(createMockStorage());

    mockExtractor = {
      isAvailable: jest.fn().mockReturnValue(true),
      extract: jest.fn(),
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
    });
  }

  describe('EmbeddingService', () => {
    test('throws when not initialized', async () => {
      const service = new EmbeddingService('/nonexistent/path');
      await expect(service.embedBatch(['test'])).rejects.toThrow(
        'EmbeddingService not initialized',
      );
    });

    test('rejects for missing model path', async () => {
      const service = new EmbeddingService('/nonexistent/model/dir');
      await expect(service.initialize()).rejects.toThrow();
    });
  });

  describe('ContentPipeline partial batch failure', () => {
    test('batch 1 OK, batch 2 fails, batch 3 OK → indexes batches 1 and 3', async () => {
      // Create enough posts for 3 batches (batch size = 16)
      const posts = Array.from({ length: 48 }, (_, i) => makePost(i + 1));

      mockExtractor.extract.mockResolvedValue({
        posts,
        siteInfo: { name: 'Test', url: '', wpVersion: '6.5' },
        extractedAt: Date.now(),
      });

      let callCount = 0;
      mockEmbedding.embedBatch.mockImplementation((texts: string[]) => {
        callCount++;
        if (callCount === 2) {
          return Promise.reject(new Error('ONNX batch 2 failed'));
        }
        return Promise.resolve(texts.map(() => makeFakeVector()));
      });

      const pipeline = createPipeline();
      const result = await pipeline.indexSite(SITE_INFO);

      // Batches 1 and 3 succeeded (32 chunks), batch 2 failed (16 chunks lost)
      expect(result.chunksIndexed).toBe(32);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some((e) => e.includes('ONNX batch 2 failed'))).toBe(true);
    });

    test('all batches fail → 0 chunks indexed, errors populated, no crash', async () => {
      const posts = Array.from({ length: 5 }, (_, i) => makePost(i + 1));

      mockExtractor.extract.mockResolvedValue({
        posts,
        siteInfo: { name: 'Test', url: '', wpVersion: '6.5' },
        extractedAt: Date.now(),
      });

      mockEmbedding.embedBatch.mockRejectedValue(new Error('ONNX total failure'));

      const pipeline = createPipeline();
      const result = await pipeline.indexSite(SITE_INFO);

      expect(result.chunksIndexed).toBe(0);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some((e) => e.includes('ONNX total failure'))).toBe(true);
    });
  });

  describe('VectorStore error recovery', () => {
    test('upsert after close throws descriptive error', async () => {
      await vectorStore.close();

      await expect(
        vectorStore.upsert('test-site', [
          {
            id: 'test_1',
            siteId: 'test-site',
            title: 'Test',
            content: 'content',
            postType: 'post',
            postId: 1,
            chunkIndex: 0,
            vector: makeFakeVector(),
            metadata: '{}',
            indexedAt: Date.now(),
          },
        ]),
      ).rejects.toThrow(/not initialized/i);
    });

    test('search with no table returns empty results', async () => {
      const results = await vectorStore.search(
        'nonexistent-site',
        makeFakeVector(),
        { limit: 10 },
      );
      expect(results).toEqual([]);
    });
  });
});
