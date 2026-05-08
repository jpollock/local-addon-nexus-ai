import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';

const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export class TrackerStore {
  constructor(private db: InstanceType<typeof Database>) {}

  initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS smart_search_tracker (
        id           TEXT PRIMARY KEY,
        site_id      TEXT NOT NULL,
        event_type   TEXT NOT NULL,
        session_id   TEXT NOT NULL,
        user_id      TEXT,
        document_id  TEXT,
        query        TEXT,
        result_count INTEGER,
        position     INTEGER,
        created_at   INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_tracker_site_event
        ON smart_search_tracker(site_id, event_type, created_at);
    `);
  }

  cleanup(): void {
    const cutoff = Date.now() - TTL_MS;
    this.db.prepare('DELETE FROM smart_search_tracker WHERE created_at < ?').run(cutoff);
  }

  trackPageView(siteId: string, opts: { sessionId: string; userId?: string; documentId: string }): void {
    this.insert(siteId, 'page_view', opts.sessionId, opts.userId, opts.documentId, null, null);
  }

  trackSearch(siteId: string, opts: { sessionId: string; userId?: string; query: string; resultCount: number }): void {
    this.insert(siteId, 'search', opts.sessionId, opts.userId, null, opts.query, opts.resultCount);
  }

  trackSearchClick(siteId: string, opts: { sessionId: string; userId?: string; documentId: string; position: number }): void {
    this.insert(siteId, 'search_click', opts.sessionId, opts.userId, opts.documentId, null, null, opts.position);
  }

  getSearchTerms(siteId: string, top: number): Array<{ term: string; numberOfSearches: number }> {
    return (this.db.prepare(`
      SELECT query as term, COUNT(*) as numberOfSearches
      FROM smart_search_tracker
      WHERE site_id = ? AND event_type = 'search' AND query IS NOT NULL
        AND result_count > 0 AND created_at > ?
      GROUP BY query ORDER BY numberOfSearches DESC LIMIT ?
    `).all(siteId, Date.now() - TTL_MS, top) as any[]).map(r => ({
      term: r.term,
      numberOfSearches: r.numberOfSearches,
    }));
  }

  getSearchTermsNoResults(siteId: string, top: number): Array<{ term: string; numberOfSearches: number }> {
    return (this.db.prepare(`
      SELECT query as term, COUNT(*) as numberOfSearches
      FROM smart_search_tracker
      WHERE site_id = ? AND event_type = 'search' AND query IS NOT NULL
        AND result_count = 0 AND created_at > ?
      GROUP BY query ORDER BY numberOfSearches DESC LIMIT ?
    `).all(siteId, Date.now() - TTL_MS, top) as any[]).map(r => ({
      term: r.term,
      numberOfSearches: r.numberOfSearches,
    }));
  }

  getTrendingDocuments(siteId: string, count: number): Array<{ docID: string; count: number }> {
    return (this.db.prepare(`
      SELECT document_id as docID, COUNT(*) as count
      FROM smart_search_tracker
      WHERE site_id = ? AND event_type = 'search_click'
        AND document_id IS NOT NULL AND created_at > ?
      GROUP BY document_id ORDER BY count DESC LIMIT ?
    `).all(siteId, Date.now() - TTL_MS, count) as any[]).map(r => ({
      docID: r.docID,
      count: r.count,
    }));
  }

  getSiteAnalytics(siteId: string, top: number): Array<{ documentID: string; totalImpressions: number; clickThroughRate: { total: number } }> {
    const views = this.db.prepare(`
      SELECT document_id, COUNT(*) as views
      FROM smart_search_tracker
      WHERE site_id = ? AND event_type = 'page_view' AND document_id IS NOT NULL AND created_at > ?
      GROUP BY document_id ORDER BY views DESC LIMIT ?
    `).all(siteId, Date.now() - TTL_MS, top) as any[];

    const clicks = this.db.prepare(`
      SELECT document_id, COUNT(*) as clicks
      FROM smart_search_tracker
      WHERE site_id = ? AND event_type = 'search_click' AND document_id IS NOT NULL AND created_at > ?
      GROUP BY document_id
    `).all(siteId, Date.now() - TTL_MS) as any[];

    const clickMap = new Map(clicks.map((r: any) => [r.document_id, r.clicks]));

    return views.map(r => {
      const clickCount = clickMap.get(r.document_id) ?? 0;
      return {
        documentID: r.document_id,
        totalImpressions: r.views,
        clickThroughRate: { total: r.views > 0 ? (clickCount / r.views) * 100 : 0 },
      };
    });
  }

  private insert(siteId: string, eventType: string, sessionId: string, userId?: string, documentId?: string | null, query?: string | null, resultCount?: number | null, position?: number | null): void {
    this.db.prepare(`
      INSERT INTO smart_search_tracker
        (id, site_id, event_type, session_id, user_id, document_id, query, result_count, position, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(randomUUID(), siteId, eventType, sessionId, userId ?? null, documentId ?? null, query ?? null, resultCount ?? null, position ?? null, Date.now());
  }
}
