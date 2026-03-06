/**
 * Unit tests for SearchService
 */
import { SearchService } from '../../../src/main/search/SearchService';
import type { VectorStore } from '../../../src/main/vector-store/VectorStore';
import type { GraphService } from '../../../src/main/events/GraphService';
import type { EmbeddingService } from '../../../src/main/embeddings/EmbeddingService';
import type { IndexRegistry } from '../../../src/main/content/IndexRegistry';

describe('SearchService', () => {
  let searchService: SearchService;
  let mockVectorStore: jest.Mocked<VectorStore>;
  let mockGraphService: jest.Mocked<GraphService>;
  let mockEmbeddingService: jest.Mocked<EmbeddingService>;
  let mockIndexRegistry: jest.Mocked<IndexRegistry>;
  let mockVectorResults: any[];

  beforeEach(() => {
    mockVectorResults = [];

    mockVectorStore = {
      search: jest.fn().mockImplementation(async (siteId: string) => {
        return siteId === 'site-1' ? mockVectorResults : [];
      }),
    } as any;

    mockGraphService = {
      searchPlugins: jest.fn().mockResolvedValue([]),
      searchThemes: jest.fn().mockResolvedValue([]),
      searchUsers: jest.fn().mockResolvedValue([]),
    } as any;

    mockEmbeddingService = {
      embedBatch: jest.fn().mockResolvedValue([[0.1, 0.2, 0.3]]),
    } as any;

    mockIndexRegistry = {
      listAll: jest.fn().mockReturnValue([
        { siteId: 'site-1', siteName: 'Site 1', state: 'indexed', lastIndexed: Date.now() },
        { siteId: 'site-2', siteName: 'Site 2', state: 'indexed', lastIndexed: Date.now() },
      ]),
    } as any;

    searchService = new SearchService(
      mockVectorStore,
      mockGraphService,
      mockEmbeddingService,
      mockIndexRegistry
    );
  });

  describe('searchFleet', () => {
    test('should search all indexed sites', async () => {
      const results = await searchService.searchFleet('test query');

      expect(mockEmbeddingService.embedBatch).toHaveBeenCalledWith(['test query']);
      expect(mockVectorStore.search).toHaveBeenCalledTimes(2);
      expect(results.results).toBeDefined();
      expect(results.total).toBe(0);
    });

    test('should respect siteId filter', async () => {
      await searchService.searchFleet('test query', { siteIds: ['site-1'] });

      expect(mockVectorStore.search).toHaveBeenCalledTimes(1);
      expect(mockVectorStore.search).toHaveBeenCalledWith(
        'site-1',
        expect.any(Array),
        expect.any(Object)
      );
    });

    test('should respect content type filter', async () => {
      mockVectorResults = [
        {
          id: '1', title: 'Test Post', content: 'Test content',
          postType: 'post', postId: 1, score: 0.9,
          metadata: JSON.stringify({ updated_at: Date.now() }),
        },
      ];

      mockGraphService.searchPlugins.mockResolvedValue([
        {
          siteId: 'site-1', siteName: 'Site 1', type: 'plugin',
          title: 'Test Plugin', excerpt: 'Description',
          metadata: {}, score: 0.8, lastUpdated: Date.now(),
        },
      ]);

      const results = await searchService.searchFleet('test', {
        contentTypes: ['plugin'],
      });

      expect(results.results.every(r => r.type === 'plugin')).toBe(true);
    });

    test('should return empty results for no matches', async () => {
      mockVectorResults = [];
      mockGraphService.searchPlugins.mockResolvedValue([]);
      mockGraphService.searchThemes.mockResolvedValue([]);
      mockGraphService.searchUsers.mockResolvedValue([]);

      const results = await searchService.searchFleet('nonexistent');

      expect(results.results).toEqual([]);
      expect(results.total).toBe(0);
    });

    test('should handle empty query', async () => {
      const results = await searchService.searchFleet('');

      expect(mockEmbeddingService.embedBatch).toHaveBeenCalledWith(['']);
      expect(results.results).toBeDefined();
    });

    test('should apply date range filter', async () => {
      const oldTimestamp = Date.now() - 1000000000;
      const newTimestamp = Date.now();

      mockVectorResults = [
        {
          id: '1', title: 'Old Post', content: 'Old content',
          postType: 'post', postId: 1, score: 0.9,
          metadata: JSON.stringify({ updated_at: oldTimestamp }),
        },
        {
          id: '2', title: 'New Post', content: 'New content',
          postType: 'post', postId: 2, score: 0.9,
          metadata: JSON.stringify({ updated_at: newTimestamp }),
        },
      ];

      const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
      const results = await searchService.searchFleet('test', {
        dateRange: { start: oneDayAgo, end: Date.now() },
      });

      expect(results.results.length).toBe(1);
      expect(results.results[0].title).toBe('New Post');
    });

    test('should paginate results', async () => {
      const now = Date.now();
      mockVectorResults = Array.from({ length: 30 }, (_, i) => ({
        id: `${i}`, title: `Post ${i}`, content: `Content ${i}`,
        postType: 'post', postId: i, score: 0.9 - i * 0.01,
        metadata: JSON.stringify({ updated_at: now }),
      }));

      const results = await searchService.searchFleet('test', undefined, {
        limit: 10,
        offset: 0,
      });

      expect(results.results.length).toBe(10);
      expect(results.total).toBeGreaterThan(10);
    });

    test('should sort by relevance by default', async () => {
      const now = Date.now();
      mockVectorResults = [
        {
          id: '1', title: 'Low', content: 'Low score',
          postType: 'post', postId: 1, score: 0.3,
          metadata: JSON.stringify({ updated_at: now }),
        },
        {
          id: '2', title: 'High', content: 'High score',
          postType: 'post', postId: 2, score: 0.9,
          metadata: JSON.stringify({ updated_at: now }),
        },
      ];

      const results = await searchService.searchFleet('test');

      expect(results.results[0].title).toBe('High');
      expect(results.results[1].title).toBe('Low');
    });

    test('should sort by date when specified', async () => {
      const oldDate = Date.now() - 10000;
      const newDate = Date.now();

      mockVectorResults = [
        {
          id: '1', title: 'Old Post', content: 'Old',
          postType: 'post', postId: 1, score: 0.9,
          metadata: JSON.stringify({ updated_at: oldDate }),
        },
        {
          id: '2', title: 'New Post', content: 'New',
          postType: 'post', postId: 2, score: 0.5,
          metadata: JSON.stringify({ updated_at: newDate }),
        },
      ];

      const results = await searchService.searchFleet('test', undefined, {
        sortBy: 'date',
      });

      expect(results.results[0].title).toBe('New Post');
      expect(results.results[1].title).toBe('Old Post');
    });

    test('should compute facets correctly', async () => {
      const now = Date.now();
      mockVectorResults = [
        {
          id: '1', title: 'Post', content: 'Post content',
          postType: 'post', postId: 1, score: 0.9,
          metadata: JSON.stringify({ updated_at: now }),
        },
      ];

      mockGraphService.searchPlugins.mockResolvedValue([
        {
          siteId: 'site-1', siteName: 'Site 1', type: 'plugin',
          title: 'Plugin', excerpt: 'Desc',
          metadata: {}, score: 0.8, lastUpdated: now,
        },
      ]);

      const results = await searchService.searchFleet('test');

      expect(results.facets).toBeDefined();
      expect(results.facets.types).toEqual({ post: 1, plugin: 1 });
      expect(results.facets.sites['site-1']).toBe(2);
    });
  });
});
