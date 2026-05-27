import { ContentPipeline, IndexStatus } from '../../../src/main/content/ContentPipeline';

describe('ContentPipeline.setStatusCallback', () => {
  it('routes setStatus calls to the registered callback', async () => {
    const received: { siteId: string; status: IndexStatus }[] = [];

    const pipeline = new ContentPipeline({
      vectorStore: {} as any,
      embeddingService: { embedBatch: async () => [], isReady: () => true } as any,
      mysqlExtractor: { isAvailable: () => false, extract: async () => ({ posts: [], siteInfo: { name: '', url: '', wpVersion: '' }, extractedAt: Date.now(), warnings: [] }) } as any,
      fileScanner: { scan: async () => ({}) } as any,
      indexRegistry: { get: () => null, update: () => {}, listAll: () => [], remove: () => {} } as any,
    });

    pipeline.setStatusCallback((siteId, status) => {
      received.push({ siteId, status });
    });

    await pipeline.indexSite({ siteId: 'test-site', siteName: 'Test', sitePath: '/tmp' });

    expect(received.length).toBeGreaterThan(0);
    expect(received[0].siteId).toBe('test-site');
  });

  it('does not throw when no callback is set', async () => {
    const pipeline = new ContentPipeline({
      vectorStore: {} as any,
      embeddingService: { embedBatch: async () => [], isReady: () => true } as any,
      mysqlExtractor: { isAvailable: () => false, extract: async () => ({ posts: [], siteInfo: { name: '', url: '', wpVersion: '' }, extractedAt: Date.now(), warnings: [] }) } as any,
      fileScanner: { scan: async () => ({}) } as any,
      indexRegistry: { get: () => null, update: () => {}, listAll: () => [], remove: () => {} } as any,
    });

    await expect(pipeline.indexSite({ siteId: 'test-site', siteName: 'Test', sitePath: '/tmp' })).resolves.not.toThrow();
  });
});
