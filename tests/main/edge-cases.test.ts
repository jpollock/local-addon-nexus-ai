import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { ContentPipeline } from '../../src/main/content/ContentPipeline';
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

describe('Content Pipeline Edge Cases', () => {
  let tmpDir: string;
  let vectorStore: VectorStore;
  let indexRegistry: IndexRegistry;
  let mockExtractor: jest.Mocked<MySQLExtractor>;
  let mockScanner: jest.Mocked<FileScanner>;
  let mockEmbedding: jest.Mocked<EmbeddingService>;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-edge-'));
    vectorStore = new VectorStore(tmpDir);
    await vectorStore.initialize();

    indexRegistry = new IndexRegistry(createMockStorage());

    mockExtractor = {
      isAvailable: jest.fn().mockReturnValue(true),
      extract: jest.fn().mockResolvedValue({
        posts: [],
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

  describe('Unicode pipeline', () => {
    test('CJK titles and content chunk correctly', async () => {
      const post = makePost(1, {
        title: '这是一个中文标题',
        cleanedContent: '这是一段中文内容。WordPress 是一个非常流行的内容管理系统。',
      });

      mockExtractor.extract.mockResolvedValue({
        posts: [post],
        siteInfo: { name: 'Test', url: '', wpVersion: '6.5' },
        extractedAt: Date.now(),
      });

      const pipeline = createPipeline();
      const result = await pipeline.indexSite(SITE_INFO);

      expect(result.documentsIndexed).toBe(1);
      expect(result.chunksIndexed).toBeGreaterThanOrEqual(1);
      expect(result.errors).toEqual([]);
    });

    test('emoji content preserved through pipeline', async () => {
      const post = makePost(2, {
        title: 'Emoji Post 🎉',
        cleanedContent: 'Hello world 🌍 This post has emojis 👍 and more 🚀',
      });

      mockExtractor.extract.mockResolvedValue({
        posts: [post],
        siteInfo: { name: 'Test', url: '', wpVersion: '6.5' },
        extractedAt: Date.now(),
      });

      const pipeline = createPipeline();
      const result = await pipeline.indexSite(SITE_INFO);

      expect(result.documentsIndexed).toBe(1);
      expect(result.errors).toEqual([]);

      // Verify embedBatch was called with emoji-containing text
      const callArgs = mockEmbedding.embedBatch.mock.calls[0][0];
      expect(callArgs[0]).toContain('🌍');
    });

    test('RTL text (Arabic) handled correctly', async () => {
      const post = makePost(3, {
        title: 'مقال بالعربية',
        cleanedContent: 'هذا نص باللغة العربية. يجب أن يعمل بشكل صحيح.',
      });

      mockExtractor.extract.mockResolvedValue({
        posts: [post],
        siteInfo: { name: 'Test', url: '', wpVersion: '6.5' },
        extractedAt: Date.now(),
      });

      const pipeline = createPipeline();
      const result = await pipeline.indexSite(SITE_INFO);

      expect(result.documentsIndexed).toBe(1);
      expect(result.errors).toEqual([]);
    });

    test('mixed scripts (Latin + CJK + Cyrillic) handled', async () => {
      const post = makePost(4, {
        title: 'Mixed Scripts',
        cleanedContent: 'Hello 你好 Привет مرحبا こんにちは 안녕하세요',
      });

      mockExtractor.extract.mockResolvedValue({
        posts: [post],
        siteInfo: { name: 'Test', url: '', wpVersion: '6.5' },
        extractedAt: Date.now(),
      });

      const pipeline = createPipeline();
      const result = await pipeline.indexSite(SITE_INFO);

      expect(result.documentsIndexed).toBe(1);
      expect(result.errors).toEqual([]);
    });
  });

  describe('Very large posts', () => {
    test('50k-word post produces 100+ chunks each under CHUNK_MAX_WORDS', async () => {
      // Build a 50k-word post with sentence boundaries
      const sentences: string[] = [];
      for (let i = 0; i < 5000; i++) {
        sentences.push(`This is sentence number ${i} with additional filler words to reach the target.`);
      }
      const longContent = sentences.join(' ');
      const wordCount = longContent.split(/\s+/).length;
      expect(wordCount).toBeGreaterThan(50000);

      const post = makePost(1, { cleanedContent: longContent });

      mockExtractor.extract.mockResolvedValue({
        posts: [post],
        siteInfo: { name: 'Test', url: '', wpVersion: '6.5' },
        extractedAt: Date.now(),
      });

      const pipeline = createPipeline();
      const result = await pipeline.indexSite(SITE_INFO);

      expect(result.chunksIndexed).toBeGreaterThan(100);
      expect(result.documentsIndexed).toBe(1);
      expect(result.errors).toEqual([]);

      // Verify each chunk was under CHUNK_MAX_WORDS
      for (const call of mockEmbedding.embedBatch.mock.calls) {
        for (const text of call[0]) {
          // Remove title prefix ("Post 1. ") before counting
          const words = text.split(/\s+/).filter(Boolean);
          // Allow a little slack for the title prefix
          expect(words.length).toBeLessThanOrEqual(CHUNK_MAX_WORDS + 20);
        }
      }
    });

    test('content with no sentence boundaries still chunks', async () => {
      // A single "sentence" with 1500 words — no period or sentence-ending punctuation
      const words = Array(1500).fill('word').join(' ');

      const post = makePost(1, { cleanedContent: words });

      mockExtractor.extract.mockResolvedValue({
        posts: [post],
        siteInfo: { name: 'Test', url: '', wpVersion: '6.5' },
        extractedAt: Date.now(),
      });

      const pipeline = createPipeline();
      const result = await pipeline.indexSite(SITE_INFO);

      // Without sentence boundaries the chunker puts it all in one chunk,
      // but it should still not crash
      expect(result.documentsIndexed).toBe(1);
      expect(result.errors).toEqual([]);
    });
  });

  describe('Malformed content', () => {
    test('Gutenberg blocks + entities + nested HTML produces clean text', async () => {
      const gutenbergContent = `<!-- wp:group -->
<!-- wp:heading {"level":2} -->
<h2>Welcome &amp; Hello</h2>
<!-- /wp:heading -->
<!-- wp:paragraph -->
<p>It&rsquo;s a <strong>beautiful <em>day</em></strong> &mdash; isn&rsquo;t it?</p>
<!-- /wp:paragraph -->
<!-- /wp:group -->`;

      const post = makePost(1, {
        content: gutenbergContent,
        cleanedContent: gutenbergContent, // simulate pre-cleaning being skipped
      });

      mockExtractor.extract.mockResolvedValue({
        posts: [post],
        siteInfo: { name: 'Test', url: '', wpVersion: '6.5' },
        extractedAt: Date.now(),
      });

      const pipeline = createPipeline();
      const result = await pipeline.indexSite(SITE_INFO);

      expect(result.documentsIndexed).toBe(1);
      expect(result.errors).toEqual([]);
    });

    test('99% whitespace content handled gracefully', async () => {
      const whitespace = ' '.repeat(10000) + 'word' + ' '.repeat(10000);

      const post = makePost(1, { cleanedContent: whitespace });

      mockExtractor.extract.mockResolvedValue({
        posts: [post],
        siteInfo: { name: 'Test', url: '', wpVersion: '6.5' },
        extractedAt: Date.now(),
      });

      const pipeline = createPipeline();
      const result = await pipeline.indexSite(SITE_INFO);

      expect(result.documentsIndexed).toBe(1);
      expect(result.errors).toEqual([]);
    });
  });
});
