/**
 * QueryStorage - JSON file-based storage for saved search queries.
 *
 * Persists saved queries to disk so users can recall and reuse
 * fleet search configurations across sessions.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface SavedQuery {
  id: string;
  name: string;
  description?: string;
  filters: {
    contentTypes?: string[];
    siteIds?: string[];
    searchText?: string;
  };
  createdAt: number;
  lastRun: number | null;
  resultCount: number;
  pinned: boolean;
}

export class QueryStorage {
  private storagePath: string;
  private filePath: string;
  private queries: Map<string, SavedQuery> = new Map();

  constructor(storagePath: string) {
    this.storagePath = storagePath;
    this.filePath = path.join(storagePath, 'saved-queries.json');
  }

  /**
   * Load queries from disk. If the file doesn't exist, starts with empty state.
   */
  async load(): Promise<void> {
    try {
      const data = fs.readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(data);
      this.queries = new Map();

      if (Array.isArray(parsed)) {
        for (const query of parsed) {
          if (query && typeof query.id === 'string') {
            this.queries.set(query.id, query);
          }
        }
      }
    } catch {
      // File doesn't exist or is invalid - start fresh
      this.queries = new Map();
    }
  }

  /**
   * Create and persist a new saved query.
   */
  async save(
    query: Omit<SavedQuery, 'id' | 'createdAt' | 'lastRun' | 'resultCount'>
  ): Promise<SavedQuery> {
    const id = `query-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const savedQuery: SavedQuery = {
      ...query,
      id,
      createdAt: Date.now(),
      lastRun: null,
      resultCount: 0,
    };

    this.queries.set(id, savedQuery);
    this.writeToDisk();
    return savedQuery;
  }

  /**
   * Update an existing query with partial changes.
   */
  async update(id: string, changes: Partial<SavedQuery>): Promise<SavedQuery> {
    const existing = this.queries.get(id);
    if (!existing) {
      throw new Error(`Query not found: ${id}`);
    }

    const updated: SavedQuery = { ...existing, ...changes, id };
    this.queries.set(id, updated);
    this.writeToDisk();
    return updated;
  }

  /**
   * Delete a saved query by ID.
   */
  async delete(id: string): Promise<void> {
    this.queries.delete(id);
    this.writeToDisk();
  }

  /**
   * List all queries sorted: pinned first, then by createdAt descending.
   */
  list(): SavedQuery[] {
    const all = Array.from(this.queries.values());
    return all.sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return b.createdAt - a.createdAt;
    });
  }

  /**
   * Get a single query by ID.
   */
  get(id: string): SavedQuery | undefined {
    return this.queries.get(id);
  }

  /**
   * Write current queries to disk.
   */
  private writeToDisk(): void {
    try {
      if (!fs.existsSync(this.storagePath)) {
        fs.mkdirSync(this.storagePath, { recursive: true });
      }
      const data = JSON.stringify(Array.from(this.queries.values()), null, 2);
      fs.writeFileSync(this.filePath, data, 'utf-8');
    } catch {
      // Silently fail - storage is best-effort
    }
  }
}
