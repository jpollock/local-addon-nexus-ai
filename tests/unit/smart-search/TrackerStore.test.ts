import Database from 'better-sqlite3';
import { TrackerStore } from '../../../src/main/smart-search/TrackerStore';

let db: InstanceType<typeof Database>;
let store: TrackerStore;

beforeEach(() => {
  db = new Database(':memory:');
  store = new TrackerStore(db);
  store.initialize();
});

afterEach(() => db.close());

describe('TrackerStore', () => {
  describe('trackSearch', () => {
    it('stores search events', () => {
      store.trackSearch('site1', { sessionId: 's1', userId: 'u1', query: 'laptop', resultCount: 5 });
      const terms = store.getSearchTerms('site1', 10);
      expect(terms).toHaveLength(1);
      expect(terms[0].term).toBe('laptop');
      expect(terms[0].numberOfSearches).toBe(1);
    });

    it('aggregates repeated search terms', () => {
      store.trackSearch('site1', { sessionId: 's1', userId: 'u1', query: 'laptop', resultCount: 3 });
      store.trackSearch('site1', { sessionId: 's2', userId: 'u2', query: 'laptop', resultCount: 3 });
      const terms = store.getSearchTerms('site1', 10);
      expect(terms[0].numberOfSearches).toBe(2);
    });

    it('tracks no-result searches separately', () => {
      store.trackSearch('site1', { sessionId: 's1', userId: 'u1', query: 'xyzzy', resultCount: 0 });
      const noResult = store.getSearchTermsNoResults('site1', 10);
      expect(noResult).toHaveLength(1);
      expect(noResult[0].term).toBe('xyzzy');
    });
  });

  describe('trackSearchClick', () => {
    it('records click events for trending', () => {
      store.trackSearchClick('site1', { sessionId: 's1', userId: 'u1', documentId: 'post:42', position: 1 });
      store.trackSearchClick('site1', { sessionId: 's2', userId: 'u2', documentId: 'post:42', position: 2 });
      const trending = store.getTrendingDocuments('site1', 5);
      expect(trending).toHaveLength(1);
      expect(trending[0].docID).toBe('post:42');
      expect(trending[0].count).toBe(2);
    });
  });

  describe('trackPageView', () => {
    it('stores page view events', () => {
      store.trackPageView('site1', { sessionId: 's1', userId: 'u1', documentId: 'post:42' });
      const analytics = store.getSiteAnalytics('site1', 10);
      expect(analytics).toHaveLength(1);
      expect(analytics[0].documentID).toBe('post:42');
      expect(analytics[0].totalImpressions).toBe(1);
    });

    it('calculates click-through rate correctly', () => {
      store.trackPageView('site1', { sessionId: 's1', userId: 'u1', documentId: 'post:42' });
      store.trackPageView('site1', { sessionId: 's2', userId: 'u2', documentId: 'post:42' });
      store.trackSearchClick('site1', { sessionId: 's1', userId: 'u1', documentId: 'post:42', position: 1 });
      const analytics = store.getSiteAnalytics('site1', 10);
      expect(analytics[0].clickThroughRate.total).toBe(50); // 1 click / 2 views = 50%
    });
  });

  describe('TTL cleanup', () => {
    it('removes events older than 7 days', () => {
      const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
      db.prepare(
        'INSERT INTO smart_search_tracker (id, site_id, event_type, session_id, user_id, document_id, query, result_count, position, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run('old1', 'site1', 'search', 's1', 'u1', null, 'old query', 3, null, eightDaysAgo);

      store.cleanup();
      const terms = store.getSearchTerms('site1', 10);
      expect(terms).toHaveLength(0);
    });
  });
});
