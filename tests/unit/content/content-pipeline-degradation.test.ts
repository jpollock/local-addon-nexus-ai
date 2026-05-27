import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// ---------------------------------------------------------------------------
// Mocks for all ContentPipeline dependencies
// ---------------------------------------------------------------------------

// Mock discoverRestApi to avoid any real network calls
jest.mock('../../../src/main/content/extractors/RestApiScanner', () => ({
  discoverRestApi: jest.fn<any>().mockResolvedValue(null),
}));

const mockFileScanner = {
  scan: jest.fn<any>(),
};

const mockMySQLExtractor = {
  isAvailable: jest.fn<any>(),
  extract: jest.fn<any>(),
};

const mockEmbeddingService = {
  embedBatch: jest.fn<any>(),
};

const mockVectorStore = {
  upsert: jest.fn<any>(),
  dropSite: jest.fn<any>(),
};

const mockIndexRegistry = {
  update: jest.fn<any>(),
  remove: jest.fn<any>(),
  get: jest.fn<any>().mockReturnValue(null),
};

import { ContentPipeline } from '../../../src/main/content/ContentPipeline';
import type { ExtractedPost } from '../../../src/common/types';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const SITE_INFO = {
  siteId: 'test-site-1',
  siteName: 'Test Site',
  sitePath: '/Users/test/Local Sites/test-site',
};

const MINIMAL_STRUCTURE = {
  plugins: [],
  themes: [],
  wpVersion: '6.5',
  phpVersion: '8.2',
  customTables: [],
};

function makePost(id: number): ExtractedPost {
  return {
    id,
    title: `Post ${id}`,
    content: 'Hello world content here.',
    cleanedContent: 'Hello world content here.',
    excerpt: 'Hello world.',
    postType: 'post',
    postStatus: 'publish',
    author: 'admin',
    date: '2024-01-01',
    categories: [],
    tags: [],
    customFields: {},
  };
}

function makePipeline() {
  return new ContentPipeline({
    vectorStore: mockVectorStore as any,
    embeddingService: mockEmbeddingService as any,
    mysqlExtractor: mockMySQLExtractor as any,
    fileScanner: mockFileScanner as any,
    indexRegistry: mockIndexRegistry as any,
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clearAllMocks() {
  mockFileScanner.scan.mockReset();
  mockMySQLExtractor.isAvailable.mockReset();
  mockMySQLExtractor.extract.mockReset();
  mockEmbeddingService.embedBatch.mockReset();
  mockVectorStore.upsert.mockReset();
  mockVectorStore.dropSite.mockReset();
  mockIndexRegistry.update.mockReset();
  mockIndexRegistry.remove.mockReset();
  (mockIndexRegistry.get as jest.Mock<any>).mockReturnValue(null);
}

// ---------------------------------------------------------------------------
// 1. L2 unavailable (MySQL not reachable) — 4 tests
// ---------------------------------------------------------------------------

describe('ContentPipeline — L2 unavailable (MySQL not reachable)', () => {
  beforeEach(() => {
    clearAllMocks();
    mockFileScanner.scan.mockResolvedValue({
      ...MINIMAL_STRUCTURE,
      wpVersion: '6.5.0',
      plugins: [{ slug: 'akismet', name: 'Akismet', version: '5.3.1', isActive: false }],
    });
    mockMySQLExtractor.isAvailable.mockReturnValue(false);
  });

  it('returns documentsIndexed=0 when MySQL is unavailable', async () => {
    const pipeline = makePipeline();
    const result = await pipeline.indexSite(SITE_INFO);
    expect(result.documentsIndexed).toBe(0);
  });

  it('calls fileScanner.scan even when MySQL is unavailable', async () => {
    const pipeline = makePipeline();
    await pipeline.indexSite(SITE_INFO);
    expect(mockFileScanner.scan).toHaveBeenCalledWith(SITE_INFO.sitePath);
  });

  it('does NOT call mysqlExtractor.extract when MySQL is unavailable', async () => {
    const pipeline = makePipeline();
    await pipeline.indexSite(SITE_INFO);
    expect(mockMySQLExtractor.extract).not.toHaveBeenCalled();
  });

  it('updates IndexRegistry with documentCount=0 and state=error when MySQL unavailable', async () => {
    const pipeline = makePipeline();
    await pipeline.indexSite(SITE_INFO);
    expect(mockIndexRegistry.update).toHaveBeenCalledWith(
      SITE_INFO.siteId,
      expect.objectContaining({
        documentCount: 0,
        state: 'error',
      }),
    );
  });

  it('does NOT call VectorStore.upsert when there are no posts', async () => {
    const pipeline = makePipeline();
    await pipeline.indexSite(SITE_INFO);
    expect(mockVectorStore.upsert).not.toHaveBeenCalled();
  });

  it('includes L1 structure data in registry even when L2 skipped', async () => {
    const pipeline = makePipeline();
    await pipeline.indexSite(SITE_INFO);
    const call = (mockIndexRegistry.update as any).mock.calls[0][1];
    expect(call.structure).toBeDefined();
    expect(call.structure.wpVersion).toBe('6.5.0');
    expect(call.structure.plugins).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 2. L3 partial embedding failure — 3 tests
// ---------------------------------------------------------------------------

describe('ContentPipeline — L3 partial embedding failure', () => {
  beforeEach(() => {
    clearAllMocks();
    mockFileScanner.scan.mockResolvedValue(MINIMAL_STRUCTURE);
    mockMySQLExtractor.isAvailable.mockReturnValue(true);
    mockMySQLExtractor.extract.mockResolvedValue({
      posts: [makePost(1), makePost(2)],
      siteInfo: { name: 'Test', url: 'http://test.local', wpVersion: '6.5' },
      extractedAt: Date.now(),
    });
    // Default upsert succeeds
    mockVectorStore.upsert.mockResolvedValue(undefined);
  });

  it('records error in result.errors when first embedding batch throws', async () => {
    // First batch fails, but there is only one batch for 2 posts
    mockEmbeddingService.embedBatch.mockRejectedValue(new Error('ONNX inference failed'));

    const pipeline = makePipeline();
    const result = await pipeline.indexSite(SITE_INFO);

    const hasEmbeddingError = result.errors.some((e) => e.includes('ONNX inference failed'));
    expect(hasEmbeddingError).toBe(true);
  });

  it('sets state=error in IndexRegistry when all batches fail', async () => {
    mockEmbeddingService.embedBatch.mockRejectedValue(new Error('embedding failed'));

    const pipeline = makePipeline();
    await pipeline.indexSite(SITE_INFO);

    expect(mockIndexRegistry.update).toHaveBeenCalledWith(
      SITE_INFO.siteId,
      expect.objectContaining({ state: 'error' }),
    );
  });

  it('still calls vectorStore.upsert even when one embedding batch fails', async () => {
    // Three posts: batch 0 fails, batch 1 succeeds (batch size is 16 so all
    // fit in one batch — use a large post count to force two batches by
    // providing posts explicitly but here we test that upsert is always called
    // regardless of embedding outcome, even if embeddedDocs is empty)
    mockEmbeddingService.embedBatch.mockRejectedValue(new Error('partial failure'));

    const pipeline = makePipeline();
    await pipeline.indexSite(SITE_INFO);

    // upsert is called (with an empty array since all embeddings failed)
    expect(mockVectorStore.upsert).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 3. VectorStore upsert failure — 2 tests
// ---------------------------------------------------------------------------

describe('ContentPipeline — VectorStore upsert failure', () => {
  beforeEach(() => {
    clearAllMocks();
    mockFileScanner.scan.mockResolvedValue(MINIMAL_STRUCTURE);
    mockMySQLExtractor.isAvailable.mockReturnValue(true);
    mockMySQLExtractor.extract.mockResolvedValue({
      posts: [makePost(10)],
      siteInfo: { name: 'Test', url: 'http://test.local', wpVersion: '6.5' },
      extractedAt: Date.now(),
    });
    // Embedding succeeds
    mockEmbeddingService.embedBatch.mockResolvedValue([new Float32Array(384).fill(0.1)]);
  });

  it('includes VectorStore error in result.errors when upsert throws', async () => {
    mockVectorStore.upsert.mockRejectedValue(new Error('LanceDB write failed: disk full'));

    const pipeline = makePipeline();
    const result = await pipeline.indexSite(SITE_INFO);

    expect(result.errors.some((e: string) => e.includes('LanceDB write failed'))).toBe(true);
  });

  it('sets state=error in IndexRegistry when upsert throws', async () => {
    mockVectorStore.upsert.mockRejectedValue(new Error('lancedb write failed'));

    const pipeline = makePipeline();
    await pipeline.indexSite(SITE_INFO);

    expect(mockIndexRegistry.update).toHaveBeenCalledWith(
      SITE_INFO.siteId,
      expect.objectContaining({ state: 'error' }),
    );
  });
});

// ---------------------------------------------------------------------------
// 4. FileScanner (L1) failure — 2 tests
// ---------------------------------------------------------------------------

describe('ContentPipeline — FileScanner (L1) failure', () => {
  beforeEach(() => {
    clearAllMocks();
    mockMySQLExtractor.isAvailable.mockReturnValue(false);
    mockVectorStore.upsert.mockResolvedValue(undefined);
  });

  it('does not throw when fileScanner.scan throws an ENOENT error', async () => {
    mockFileScanner.scan.mockRejectedValue(new Error('ENOENT: no such file or directory'));

    const pipeline = makePipeline();
    await expect(pipeline.indexSite(SITE_INFO)).resolves.toBeDefined();
  });

  it('includes ENOENT message in result.errors when fileScanner.scan throws', async () => {
    mockFileScanner.scan.mockRejectedValue(new Error('ENOENT: no such file or directory'));

    const pipeline = makePipeline();
    const result = await pipeline.indexSite(SITE_INFO);

    const hasFileError = result.errors.some((e) => e.includes('ENOENT'));
    expect(hasFileError).toBe(true);
  });
});
