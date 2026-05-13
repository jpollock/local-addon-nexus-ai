# Smart Search Local Backend — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Nexus AI the local GraphQL backend for the WP Engine AI Toolkit (`atlas-search`) plugin, so Smart Search, Recommendations, Insights, and Tracker all work against LanceDB + SQLite when running in Local.

**Architecture:** A `SmartSearchHandler` class handles all `atlas-search` GraphQL operations on a new `/smart-search/graphql` route added to the existing `HttpEventInterface` server. The MU plugin overrides `wpe_content_engine_option_name` to point at Nexus. The plugin requires no modification.

**Tech Stack:** TypeScript, LanceDB (`@lancedb/lancedb`), better-sqlite3, ONNX Runtime, Node.js `http`

**Branch:** `feature/smart-search-local-backend`

---

## File Map

**New files:**
- `src/main/smart-search/SmartSearchHandler.ts` — HTTP handler + GraphQL dispatch
- `src/main/smart-search/SynonymStore.ts` — synonym rule CRUD on SQLite
- `src/main/smart-search/SemanticConfig.ts` — semantic field config on SQLite
- `src/main/smart-search/TrackerStore.ts` — event storage, TTL cleanup, aggregations
- `src/main/smart-search/filter-parser.ts` — parse Smart Search filter strings
- `src/main/smart-search/find-pipeline.ts` — find orchestration: expand synonyms, search, post-process
- `src/main/smart-search/index.ts` — barrel export
- `tests/unit/smart-search/SynonymStore.test.ts`
- `tests/unit/smart-search/SemanticConfig.test.ts`
- `tests/unit/smart-search/TrackerStore.test.ts`
- `tests/unit/smart-search/filter-parser.test.ts`
- `tests/unit/smart-search/find-pipeline.test.ts`
- `tests/unit/smart-search/SmartSearchHandler.test.ts`
- `tests/integration/smart-search/smart-search.integration.test.ts`

**Modified files:**
- `src/main/vector-store/schema.ts` — add `post_date_gmt`, `post_modified_gmt`, `doc_url` fields
- `src/common/types.ts` — extend `VectorDocument` with new fields
- `src/main/vector-store/VectorStore.ts` — schema migration on `getOrCreateTable`, extend `upsert`
- `src/main/events/HttpEventInterface.ts` — add `/smart-search/graphql` route, accept `SmartSearchHandler`
- `src/main/index.ts` — instantiate `SmartSearchHandler`, pass to `HttpEventInterface`
- `src/main/ai-gateway/mu-plugin-template.ts` — add `smartSearchUrl`/`smartSearchToken` fields
- `src/main/content/lifecycle-hooks.ts` — detect atlas-search on site start

---

## Task 1: Create Branch and Scaffold New Directories

- [ ] **Create the branch**

```bash
git checkout -b feature/smart-search-local-backend
```

- [ ] **Scaffold the new directories**

```bash
mkdir -p src/main/smart-search
mkdir -p tests/unit/smart-search
mkdir -p tests/integration/smart-search
```

- [ ] **Create barrel export placeholder** (`src/main/smart-search/index.ts`)

```typescript
export { SmartSearchHandler } from './SmartSearchHandler';
export { SynonymStore } from './SynonymStore';
export { SemanticConfig } from './SemanticConfig';
export { TrackerStore } from './TrackerStore';
```

- [ ] **Commit**

```bash
git add src/main/smart-search/ tests/unit/smart-search/ tests/integration/smart-search/
git commit -m "chore(smart-search): scaffold directory structure"
```

---

## Task 2: Extend VectorDocument Schema + LanceDB Migration

The existing `VectorDocument` and LanceDB tables lack `post_date_gmt`, `post_modified_gmt`, and `doc_url`. Smart Search `orderBy` and `timeDecay` need these as real columns (not buried in the JSON `metadata` string).

**Files:** `src/common/types.ts`, `src/main/vector-store/schema.ts`, `src/main/vector-store/VectorStore.ts`

- [ ] **Extend `VectorDocument` in `src/common/types.ts`**

Add three fields to the existing `VectorDocument` interface (around line 26):

```typescript
export interface VectorDocument {
  id: string;
  siteId: string;
  title: string;
  content: string;
  postType: string;
  postId: number;
  chunkIndex: number;
  vector: Float32Array;
  metadata: string;
  indexedAt: number;
  // Smart Search fields (empty string default for Nexus-indexed docs)
  post_date_gmt: string;
  post_modified_gmt: string;
  doc_url: string;
}
```

- [ ] **Update `createSeedRecord` and `toRecord` in `src/main/vector-store/schema.ts`**

```typescript
import { VECTOR_DIMENSIONS } from '../../common/constants';

export function createSeedRecord() {
  return {
    id: '__seed__',
    siteId: '',
    title: '',
    content: '',
    postType: '',
    postId: 0,
    chunkIndex: 0,
    vector: new Array(VECTOR_DIMENSIONS).fill(0),
    metadata: '{}',
    indexedAt: 0,
    post_date_gmt: '',
    post_modified_gmt: '',
    doc_url: '',
  };
}

export function toRecord(doc: {
  id: string;
  siteId: string;
  title: string;
  content: string;
  postType: string;
  postId: number;
  chunkIndex: number;
  vector: Float32Array | number[];
  metadata: string;
  indexedAt: number;
  post_date_gmt?: string;
  post_modified_gmt?: string;
  doc_url?: string;
}) {
  return {
    id: doc.id,
    siteId: doc.siteId,
    title: doc.title,
    content: doc.content,
    postType: doc.postType,
    postId: doc.postId,
    chunkIndex: doc.chunkIndex,
    vector: Array.from(doc.vector),
    metadata: doc.metadata,
    indexedAt: doc.indexedAt,
    post_date_gmt: doc.post_date_gmt ?? '',
    post_modified_gmt: doc.post_modified_gmt ?? '',
    doc_url: doc.doc_url ?? '',
  };
}
```

- [ ] **Add schema migration to `getOrCreateTable` in `src/main/vector-store/VectorStore.ts`**

Find the `getOrCreateTable` private method and replace it:

```typescript
private async getOrCreateTable(siteId: string): Promise<lancedb.Table> {
  const db = this.getDb();
  const name = this.tableName(siteId);
  const existing = await db.tableNames();

  if (existing.includes(name)) {
    const table = await db.openTable(name);
    // Migrate: add new Smart Search columns if absent
    await this.migrateTableSchema(table);
    return table;
  }

  const table = await db.createTable(name, [createSeedRecord()]);
  await table.delete('id = "__seed__"');
  return table;
}

private async migrateTableSchema(table: lancedb.Table): Promise<void> {
  try {
    const schema = await table.schema();
    const fieldNames = schema.fields.map((f: any) => f.name);
    const newCols: Array<{ name: string; valueSql: string }> = [];

    if (!fieldNames.includes('post_date_gmt')) {
      newCols.push({ name: 'post_date_gmt', valueSql: "cast('' as varchar)" });
    }
    if (!fieldNames.includes('post_modified_gmt')) {
      newCols.push({ name: 'post_modified_gmt', valueSql: "cast('' as varchar)" });
    }
    if (!fieldNames.includes('doc_url')) {
      newCols.push({ name: 'doc_url', valueSql: "cast('' as varchar)" });
    }

    if (newCols.length > 0) {
      await table.addColumns(newCols);
    }
  } catch {
    // Migration is best-effort — search still works without new columns
  }
}
```

- [ ] **Build to verify no TypeScript errors**

```bash
npm run build 2>&1 | grep -E "error|warning" | head -20
```

Expected: no errors (warnings about optional chaining are acceptable).

- [ ] **Commit**

```bash
git add src/common/types.ts src/main/vector-store/schema.ts src/main/vector-store/VectorStore.ts
git commit -m "feat(smart-search): extend VectorDocument schema + LanceDB migration"
```

---

## Task 3: SynonymStore

Stores synonym rules in SQLite. Three operations: CRUD on rules. Expansion logic (query rewriting) lives in `find-pipeline.ts` — this class is pure storage.

**Files:** `src/main/smart-search/SynonymStore.ts`, `tests/unit/smart-search/SynonymStore.test.ts`

- [ ] **Write the failing tests** (`tests/unit/smart-search/SynonymStore.test.ts`)

```typescript
import Database from 'better-sqlite3';
import { SynonymStore } from '../../../src/main/smart-search/SynonymStore';

let db: InstanceType<typeof Database>;
let store: SynonymStore;

beforeEach(() => {
  db = new Database(':memory:');
  store = new SynonymStore(db);
  store.initialize();
});

afterEach(() => db.close());

describe('SynonymStore', () => {
  it('saves and retrieves a synonym rule', () => {
    const rule = store.saveRule('site1', 'laptop, notebook, computer');
    expect(rule.id).toBeTruthy();
    expect(rule.synonyms).toBe('laptop, notebook, computer');

    const rules = store.getRules('site1');
    expect(rules).toHaveLength(1);
    expect(rules[0].synonyms).toBe('laptop, notebook, computer');
  });

  it('updates an existing rule when id provided', () => {
    const rule = store.saveRule('site1', 'laptop, notebook');
    const updated = store.saveRule('site1', 'laptop, notebook, computer', rule.id);
    expect(updated.id).toBe(rule.id);

    const rules = store.getRules('site1');
    expect(rules).toHaveLength(1);
    expect(rules[0].synonyms).toBe('laptop, notebook, computer');
  });

  it('deletes a rule by id', () => {
    const rule = store.saveRule('site1', 'laptop, notebook');
    store.deleteRule('site1', rule.id);
    expect(store.getRules('site1')).toHaveLength(0);
  });

  it('deleteAll removes all rules for a site', () => {
    store.saveRule('site1', 'laptop, notebook');
    store.saveRule('site1', 'phone, mobile');
    store.deleteAllRules('site1');
    expect(store.getRules('site1')).toHaveLength(0);
  });

  it('getRule returns a single rule by id', () => {
    const saved = store.saveRule('site1', 'phone, mobile');
    const found = store.getRule('site1', saved.id);
    expect(found).not.toBeNull();
    expect(found!.synonyms).toBe('phone, mobile');
  });

  it('isolates rules by siteId', () => {
    store.saveRule('site1', 'laptop, notebook');
    store.saveRule('site2', 'phone, mobile');
    expect(store.getRules('site1')).toHaveLength(1);
    expect(store.getRules('site2')).toHaveLength(1);
  });

  it('getRules supports offset and limit', () => {
    for (let i = 0; i < 5; i++) store.saveRule('site1', `term${i}, alias${i}`);
    const page = store.getRules('site1', { offset: 2, limit: 2 });
    expect(page).toHaveLength(2);
  });
});
```

- [ ] **Run tests to verify they fail**

```bash
npx jest --testPathPattern="SynonymStore" --no-coverage 2>&1 | tail -5
```

Expected: `Cannot find module '../../../src/main/smart-search/SynonymStore'`

- [ ] **Implement `SynonymStore`** (`src/main/smart-search/SynonymStore.ts`)

```typescript
import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';

export interface SynonymRule {
  id: string;
  siteId: string;
  synonyms: string;
  createdAt: number;
}

export class SynonymStore {
  constructor(private db: InstanceType<typeof Database>) {}

  initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS smart_search_synonyms (
        id         TEXT PRIMARY KEY,
        site_id    TEXT NOT NULL,
        synonyms   TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_synonyms_site
        ON smart_search_synonyms(site_id);
    `);
  }

  saveRule(siteId: string, synonyms: string, id?: string): SynonymRule {
    if (id) {
      this.db.prepare(
        'UPDATE smart_search_synonyms SET synonyms = ? WHERE id = ? AND site_id = ?'
      ).run(synonyms, id, siteId);
      return { id, siteId, synonyms, createdAt: Date.now() };
    }
    const newId = randomUUID();
    const now = Date.now();
    this.db.prepare(
      'INSERT INTO smart_search_synonyms (id, site_id, synonyms, created_at) VALUES (?, ?, ?, ?)'
    ).run(newId, siteId, synonyms, now);
    return { id: newId, siteId, synonyms, createdAt: now };
  }

  getRules(siteId: string, opts?: { offset?: number; limit?: number }): SynonymRule[] {
    const offset = opts?.offset ?? 0;
    const limit = opts?.limit ?? 1000;
    const rows = this.db.prepare(
      'SELECT id, site_id, synonyms, created_at FROM smart_search_synonyms WHERE site_id = ? ORDER BY created_at LIMIT ? OFFSET ?'
    ).all(siteId, limit, offset) as any[];
    return rows.map(r => ({ id: r.id, siteId: r.site_id, synonyms: r.synonyms, createdAt: r.created_at }));
  }

  getRule(siteId: string, id: string): SynonymRule | null {
    const row = this.db.prepare(
      'SELECT id, site_id, synonyms, created_at FROM smart_search_synonyms WHERE id = ? AND site_id = ?'
    ).get(id, siteId) as any;
    if (!row) return null;
    return { id: row.id, siteId: row.site_id, synonyms: row.synonyms, createdAt: row.created_at };
  }

  deleteRule(siteId: string, id: string): void {
    this.db.prepare('DELETE FROM smart_search_synonyms WHERE id = ? AND site_id = ?').run(id, siteId);
  }

  deleteAllRules(siteId: string): void {
    this.db.prepare('DELETE FROM smart_search_synonyms WHERE site_id = ?').run(siteId);
  }

  countRules(siteId: string): number {
    const row = this.db.prepare(
      'SELECT COUNT(*) as c FROM smart_search_synonyms WHERE site_id = ?'
    ).get(siteId) as any;
    return row.c;
  }
}
```

- [ ] **Run tests to verify they pass**

```bash
npx jest --testPathPattern="SynonymStore" --no-coverage 2>&1 | tail -10
```

Expected: `Tests: 7 passed`

- [ ] **Commit**

```bash
git add src/main/smart-search/SynonymStore.ts tests/unit/smart-search/SynonymStore.test.ts
git commit -m "feat(smart-search): SynonymStore — CRUD on SQLite synonym rules"
```

---

## Task 4: SemanticConfig

Stores which fields to embed per site. Defaults to `["post_title","post_content"]` if nothing configured.

**Files:** `src/main/smart-search/SemanticConfig.ts`, `tests/unit/smart-search/SemanticConfig.test.ts`

- [ ] **Write the failing tests** (`tests/unit/smart-search/SemanticConfig.test.ts`)

```typescript
import Database from 'better-sqlite3';
import { SemanticConfig } from '../../../src/main/smart-search/SemanticConfig';

let db: InstanceType<typeof Database>;
let config: SemanticConfig;

beforeEach(() => {
  db = new Database(':memory:');
  config = new SemanticConfig(db);
  config.initialize();
});

afterEach(() => db.close());

describe('SemanticConfig', () => {
  it('returns default config when nothing configured', () => {
    const cfg = config.get('site1');
    expect(cfg.fields).toEqual(['post_title', 'post_content']);
    expect(cfg.type).toBe('BASIC');
  });

  it('saves and retrieves a config', () => {
    config.set('site1', ['post_title']);
    const cfg = config.get('site1');
    expect(cfg.fields).toEqual(['post_title']);
    expect(cfg.type).toBe('BASIC');
  });

  it('overwrites existing config on second set', () => {
    config.set('site1', ['post_title']);
    config.set('site1', ['post_title', 'post_content', 'custom_field']);
    expect(config.get('site1').fields).toEqual(['post_title', 'post_content', 'custom_field']);
  });

  it('isolates config by siteId', () => {
    config.set('site1', ['post_title']);
    config.set('site2', ['post_content']);
    expect(config.get('site1').fields).toEqual(['post_title']);
    expect(config.get('site2').fields).toEqual(['post_content']);
  });
});
```

- [ ] **Run tests to verify they fail**

```bash
npx jest --testPathPattern="SemanticConfig" --no-coverage 2>&1 | tail -5
```

- [ ] **Implement `SemanticConfig`** (`src/main/smart-search/SemanticConfig.ts`)

```typescript
import Database from 'better-sqlite3';

const DEFAULT_FIELDS = ['post_title', 'post_content'];

export interface SemanticConfigData {
  fields: string[];
  type: string;
}

export class SemanticConfig {
  constructor(private db: InstanceType<typeof Database>) {}

  initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS smart_search_semantic_config (
        site_id    TEXT PRIMARY KEY,
        fields     TEXT NOT NULL,
        type       TEXT NOT NULL DEFAULT 'BASIC',
        updated_at INTEGER NOT NULL
      );
    `);
  }

  get(siteId: string): SemanticConfigData {
    const row = this.db.prepare(
      'SELECT fields, type FROM smart_search_semantic_config WHERE site_id = ?'
    ).get(siteId) as any;
    if (!row) return { fields: DEFAULT_FIELDS, type: 'BASIC' };
    return { fields: JSON.parse(row.fields), type: row.type };
  }

  set(siteId: string, fields: string[], type = 'BASIC'): SemanticConfigData {
    this.db.prepare(`
      INSERT INTO smart_search_semantic_config (site_id, fields, type, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(site_id) DO UPDATE SET fields = excluded.fields, type = excluded.type, updated_at = excluded.updated_at
    `).run(siteId, JSON.stringify(fields), type, Date.now());
    return { fields, type };
  }
}
```

- [ ] **Run tests to verify they pass**

```bash
npx jest --testPathPattern="SemanticConfig" --no-coverage 2>&1 | tail -5
```

- [ ] **Commit**

```bash
git add src/main/smart-search/SemanticConfig.ts tests/unit/smart-search/SemanticConfig.test.ts
git commit -m "feat(smart-search): SemanticConfig — per-site semantic field configuration"
```

---

## Task 5: TrackerStore

Stores `trackPageView`, `trackSearch`, `trackSearchClick` events. Provides aggregations for `recommendations.trendingDocuments` and `insights.*`. Cleans up events older than 7 days.

**Files:** `src/main/smart-search/TrackerStore.ts`, `tests/unit/smart-search/TrackerStore.test.ts`

- [ ] **Write failing tests** (`tests/unit/smart-search/TrackerStore.test.ts`)

```typescript
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
```

- [ ] **Run tests to verify they fail**

```bash
npx jest --testPathPattern="TrackerStore" --no-coverage 2>&1 | tail -5
```

- [ ] **Implement `TrackerStore`** (`src/main/smart-search/TrackerStore.ts`)

```typescript
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
    `).all(siteId, Date.now() - TTL_MS, top) as any[];

    const clickMap = new Map(clicks.map((r: any) => [r.document_id, r.clicks]));

    return views.map(r => {
      const clicks = clickMap.get(r.document_id) ?? 0;
      return {
        documentID: r.document_id,
        totalImpressions: r.views,
        clickThroughRate: { total: r.views > 0 ? (clicks / r.views) * 100 : 0 },
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
```

- [ ] **Run tests to verify they pass**

```bash
npx jest --testPathPattern="TrackerStore" --no-coverage 2>&1 | tail -10
```

Expected: `Tests: 7 passed`

- [ ] **Commit**

```bash
git add src/main/smart-search/TrackerStore.ts tests/unit/smart-search/TrackerStore.test.ts
git commit -m "feat(smart-search): TrackerStore — event storage, TTL cleanup, aggregations"
```

---

## Task 6: Filter Parser

Translates Smart Search filter strings like `"post_type:post AND categories.name:Sports"` into a function that matches against a parsed document's `data` object. Pure function module — no classes.

**Files:** `src/main/smart-search/filter-parser.ts`, `tests/unit/smart-search/filter-parser.test.ts`

- [ ] **Write failing tests** (`tests/unit/smart-search/filter-parser.test.ts`)

```typescript
import { matchesFilter } from '../../../src/main/smart-search/filter-parser';

describe('matchesFilter', () => {
  const doc = {
    post_type: 'post',
    post_title: 'Hello World',
    post_date_gmt: '2024-06-01T00:00:00',
    categories: [{ name: 'Sports' }, { name: 'News' }],
    tags: [{ name: 'breaking' }],
  };

  it('returns true when filter is empty or null', () => {
    expect(matchesFilter(doc, '')).toBe(true);
    expect(matchesFilter(doc, null)).toBe(true);
  });

  it('matches simple field:value', () => {
    expect(matchesFilter(doc, 'post_type:post')).toBe(true);
    expect(matchesFilter(doc, 'post_type:page')).toBe(false);
  });

  it('matches nested field (categories.name)', () => {
    expect(matchesFilter(doc, 'categories.name:Sports')).toBe(true);
    expect(matchesFilter(doc, 'categories.name:Politics')).toBe(false);
  });

  it('handles AND operator', () => {
    expect(matchesFilter(doc, 'post_type:post AND categories.name:Sports')).toBe(true);
    expect(matchesFilter(doc, 'post_type:post AND categories.name:Politics')).toBe(false);
  });

  it('handles OR operator', () => {
    expect(matchesFilter(doc, 'post_type:page OR categories.name:Sports')).toBe(true);
    expect(matchesFilter(doc, 'post_type:page OR categories.name:Politics')).toBe(false);
  });

  it('handles NOT operator', () => {
    expect(matchesFilter(doc, 'NOT post_type:page')).toBe(true);
    expect(matchesFilter(doc, 'NOT post_type:post')).toBe(false);
  });

  it('matches quoted values', () => {
    expect(matchesFilter(doc, 'post_title:"Hello World"')).toBe(true);
  });

  it('silently passes unknown fields (returns true)', () => {
    expect(matchesFilter(doc, 'unknown_field:value')).toBe(true);
  });
});
```

- [ ] **Run tests to verify they fail**

```bash
npx jest --testPathPattern="filter-parser" --no-coverage 2>&1 | tail -5
```

- [ ] **Implement `filter-parser.ts`** (`src/main/smart-search/filter-parser.ts`)

```typescript
/**
 * Evaluates a Smart Search filter string against a document data object.
 * Supports: field:value, nested.field:value, AND, OR, NOT, quoted values.
 * Unknown fields → always true (don't reject docs we can't evaluate).
 */
export function matchesFilter(doc: Record<string, any>, filter: string | null | undefined): boolean {
  if (!filter || !filter.trim()) return true;
  try {
    return evaluateExpr(filter.trim(), doc);
  } catch {
    return true; // parse error → don't filter out
  }
}

function evaluateExpr(expr: string, doc: Record<string, any>): boolean {
  // Handle NOT prefix
  if (expr.startsWith('NOT ')) {
    return !evaluateExpr(expr.slice(4).trim(), doc);
  }

  // Split on top-level AND (not inside quotes)
  const andParts = splitTopLevel(expr, ' AND ');
  if (andParts.length > 1) {
    return andParts.every(p => evaluateExpr(p.trim(), doc));
  }

  // Split on top-level OR
  const orParts = splitTopLevel(expr, ' OR ');
  if (orParts.length > 1) {
    return orParts.some(p => evaluateExpr(p.trim(), doc));
  }

  // Base: field:value or field:"quoted value"
  const colonIdx = expr.indexOf(':');
  if (colonIdx === -1) return true;

  const field = expr.slice(0, colonIdx).trim();
  let value = expr.slice(colonIdx + 1).trim().replace(/^"(.*)"$/, '$1');

  const docValue = getNestedField(doc, field);
  if (docValue === undefined) return true; // unknown field → pass

  return fieldMatches(docValue, value);
}

function fieldMatches(docValue: any, filterValue: string): boolean {
  if (Array.isArray(docValue)) {
    return docValue.some(item =>
      typeof item === 'object' ? Object.values(item).some(v => String(v).toLowerCase() === filterValue.toLowerCase())
                               : String(item).toLowerCase() === filterValue.toLowerCase()
    );
  }
  return String(docValue).toLowerCase() === filterValue.toLowerCase();
}

function getNestedField(obj: Record<string, any>, path: string): any {
  // Handle nested.field paths (e.g. categories.name)
  const parts = path.split('.');
  let cur: any = obj;
  for (const part of parts) {
    if (cur === undefined || cur === null) return undefined;
    if (Array.isArray(cur)) {
      cur = cur.map(item => (typeof item === 'object' ? item[part] : undefined));
    } else {
      cur = cur[part];
    }
  }
  return cur;
}

function splitTopLevel(expr: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let inQuote = false;
  let start = 0;

  for (let i = 0; i < expr.length; i++) {
    if (expr[i] === '"') inQuote = !inQuote;
    if (!inQuote && expr[i] === '(') depth++;
    if (!inQuote && expr[i] === ')') depth--;
    if (!inQuote && depth === 0 && expr.slice(i, i + separator.length) === separator) {
      parts.push(expr.slice(start, i));
      start = i + separator.length;
      i += separator.length - 1;
    }
  }
  parts.push(expr.slice(start));
  return parts;
}
```

- [ ] **Run tests to verify they pass**

```bash
npx jest --testPathPattern="filter-parser" --no-coverage 2>&1 | tail -5
```

- [ ] **Commit**

```bash
git add src/main/smart-search/filter-parser.ts tests/unit/smart-search/filter-parser.test.ts
git commit -m "feat(smart-search): filter-parser — Smart Search filter string evaluation"
```

---

## Task 7: Find Pipeline

Orchestrates the `find` operation: expand synonyms → embed → search → post-process (filter, promotions, customResults, timeDecay, aggregations, includeFields).

**Files:** `src/main/smart-search/find-pipeline.ts`, `tests/unit/smart-search/find-pipeline.test.ts`

- [ ] **Write failing tests** (`tests/unit/smart-search/find-pipeline.test.ts`)

```typescript
import { expandSynonyms, applySearchBias, applyPostProcess, computeAggregations } from '../../../src/main/smart-search/find-pipeline';
import type { SynonymRule } from '../../../src/main/smart-search/SynonymStore';

describe('expandSynonyms', () => {
  it('returns query unchanged when no rules', () => {
    expect(expandSynonyms('laptop', [])).toBe('laptop');
  });

  it('expands equivalent synonyms bidirectionally', () => {
    const rules: SynonymRule[] = [
      { id: '1', siteId: 'x', synonyms: 'laptop, notebook, computer', createdAt: 0 }
    ];
    const result = expandSynonyms('laptop', rules);
    expect(result).toContain('notebook');
    expect(result).toContain('computer');
  });

  it('expands one-way synonyms (left => right only)', () => {
    const rules: SynonymRule[] = [
      { id: '1', siteId: 'x', synonyms: 'phone => smartphone', createdAt: 0 }
    ];
    expect(expandSynonyms('phone', rules)).toContain('smartphone');
    expect(expandSynonyms('smartphone', rules)).not.toContain('phone');
  });
});

describe('applySearchBias', () => {
  it('returns vectorWeight 0 for bias 0', () => {
    expect(applySearchBias(0)).toBe(0);
  });

  it('returns vectorWeight 1 for bias 10', () => {
    expect(applySearchBias(10)).toBe(1);
  });

  it('returns 0.5 for bias 5', () => {
    expect(applySearchBias(5)).toBeCloseTo(0.5);
  });
});

describe('applyPostProcess', () => {
  const makeDocs = (ids: string[]) => ids.map(id => ({
    id,
    score: 0.9,
    sort: [String(0.9), id],
    data: { post_type: 'post', post_title: `Title ${id}`, post_date_gmt: '2024-01-01T00:00:00', categories: [] },
  }));

  it('prepends promoted documents', () => {
    const docs = makeDocs(['post:1', 'post:2']);
    const promoted = [{ id: 'post:99', score: 1, sort: ['1', 'post:99'], data: { post_type: 'post', post_title: 'Pinned', post_date_gmt: '', categories: [] } }];
    const result = applyPostProcess(docs, { promotedDocs: promoted });
    expect(result[0].id).toBe('post:99');
  });

  it('applies includeFields to data', () => {
    const docs = makeDocs(['post:1']);
    const result = applyPostProcess(docs, { includeFields: ['post_title'] });
    expect(Object.keys(result[0].data)).toEqual(['post_title']);
  });

  it('applies excludeFields to data', () => {
    const docs = makeDocs(['post:1']);
    const result = applyPostProcess(docs, { excludeFields: ['post_type'] });
    expect(result[0].data).not.toHaveProperty('post_type');
    expect(result[0].data).toHaveProperty('post_title');
  });
});

describe('computeAggregations', () => {
  const docs = [
    { id: '1', score: 1, sort: [], data: { post_type: 'post', categories: [{ name: 'Sports' }] } },
    { id: '2', score: 1, sort: [], data: { post_type: 'page', categories: [{ name: 'Sports' }] } },
    { id: '3', score: 1, sort: [], data: { post_type: 'post', categories: [{ name: 'News' }] } },
  ];

  it('computes term counts for a field', () => {
    const agg = computeAggregations(docs, [{ field: 'post_type', size: 10 }]);
    const postType = agg.terms.find(t => t.field === 'post_type');
    expect(postType?.terms.find(t => t.term === 'post')?.count).toBe(2);
    expect(postType?.terms.find(t => t.term === 'page')?.count).toBe(1);
  });
});
```

- [ ] **Run tests to verify they fail**

```bash
npx jest --testPathPattern="find-pipeline" --no-coverage 2>&1 | tail -5
```

- [ ] **Implement `find-pipeline.ts`** (`src/main/smart-search/find-pipeline.ts`)

```typescript
import type { SynonymRule } from './SynonymStore';

export interface FindDoc {
  id: string;
  score: number;
  sort: string[];
  data: Record<string, any>;
}

export interface PostProcessOptions {
  filter?: string | null;
  promotedDocs?: FindDoc[];
  customResultDocs?: FindDoc[];
  includeFields?: string[];
  excludeFields?: string[];
  timeDecay?: Array<{ field: string; scale: string; decayRate: number }>;
}

export interface AggregationTermInput {
  field: string;
  size?: number;
}

/** Expand query string using synonym rules */
export function expandSynonyms(query: string, rules: SynonymRule[]): string {
  let result = query;
  for (const rule of rules) {
    if (rule.synonyms.includes('=>')) {
      // One-way: "phone => smartphone"
      const [lhs, rhs] = rule.synonyms.split('=>').map(s => s.trim());
      const lefts = lhs.split(',').map(s => s.trim());
      const rights = rhs.split(',').map(s => s.trim());
      if (lefts.some(t => result.toLowerCase().includes(t.toLowerCase()))) {
        result = `(${result} OR ${rights.join(' OR ')})`;
      }
    } else {
      // Equivalent: "laptop, notebook, computer"
      const terms = rule.synonyms.split(',').map(s => s.trim());
      if (terms.some(t => result.toLowerCase().includes(t.toLowerCase()))) {
        result = `(${terms.join(' OR ')})`;
      }
    }
  }
  return result;
}

/** Map searchBias 0-10 to vectorWeight 0.0-1.0 */
export function applySearchBias(searchBias: number): number {
  return Math.max(0, Math.min(10, searchBias)) / 10;
}

/** Apply time decay scoring based on post_date_gmt */
export function applyTimeDecay(docs: FindDoc[], decayConfig: Array<{ field: string; scale: string; decayRate: number }>): FindDoc[] {
  if (!decayConfig.length) return docs;
  const now = Date.now();
  return docs.map(doc => {
    let multiplier = 1;
    for (const cfg of decayConfig) {
      const dateStr = doc.data[cfg.field];
      if (!dateStr) continue;
      const docTs = new Date(dateStr).getTime();
      if (isNaN(docTs)) continue;
      const scaleDays = parseFloat(cfg.scale) || 30;
      const ageMs = now - docTs;
      const ageDays = ageMs / 86400000;
      multiplier *= Math.exp(-cfg.decayRate * (ageDays / scaleDays));
    }
    return { ...doc, score: doc.score * multiplier };
  }).sort((a, b) => b.score - a.score);
}

/** Apply post-processing to result set */
export function applyPostProcess(docs: FindDoc[], opts: PostProcessOptions): FindDoc[] {
  let result = [...docs];

  // Time decay re-scoring
  if (opts.timeDecay?.length) {
    result = applyTimeDecay(result, opts.timeDecay);
  }

  // Prepend custom results (before promotions)
  if (opts.customResultDocs?.length) {
    const customIds = new Set(opts.customResultDocs.map(d => d.id));
    result = [...opts.customResultDocs, ...result.filter(d => !customIds.has(d.id))];
  }

  // Prepend promotions (first in results)
  if (opts.promotedDocs?.length) {
    const promotedIds = new Set(opts.promotedDocs.map(d => d.id));
    result = [...opts.promotedDocs, ...result.filter(d => !promotedIds.has(d.id))];
  }

  // Field filtering
  if (opts.includeFields?.length) {
    const keep = new Set(opts.includeFields);
    result = result.map(d => ({ ...d, data: filterKeys(d.data, k => keep.has(k)) }));
  } else if (opts.excludeFields?.length) {
    const drop = new Set(opts.excludeFields);
    result = result.map(d => ({ ...d, data: filterKeys(d.data, k => !drop.has(k)) }));
  }

  return result;
}

export function computeAggregations(docs: FindDoc[], termAggs: AggregationTermInput[]): {
  terms: Array<{ field: string; terms: Array<{ term: string; count: number }> }>;
} {
  return {
    terms: termAggs.map(agg => {
      const counts = new Map<string, number>();
      for (const doc of docs) {
        const val = doc.data[agg.field];
        if (val === undefined || val === null) continue;
        const vals = Array.isArray(val) ? val : [val];
        for (const v of vals) {
          const key = typeof v === 'object' ? (v.name ?? JSON.stringify(v)) : String(v);
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
      }
      const sorted = [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, agg.size ?? 10)
        .map(([term, count]) => ({ term, count }));
      return { field: agg.field, terms: sorted };
    }),
  };
}

function filterKeys(obj: Record<string, any>, predicate: (k: string) => boolean): Record<string, any> {
  return Object.fromEntries(Object.entries(obj).filter(([k]) => predicate(k)));
}
```

- [ ] **Run tests to verify they pass**

```bash
npx jest --testPathPattern="find-pipeline" --no-coverage 2>&1 | tail -5
```

- [ ] **Commit**

```bash
git add src/main/smart-search/find-pipeline.ts tests/unit/smart-search/find-pipeline.test.ts
git commit -m "feat(smart-search): find-pipeline — synonym expansion, bias, post-processing"
```

---

## Task 8: SmartSearchHandler — Write Path + Routing Skeleton

The handler parses the GraphQL body, identifies the operation, and dispatches. This task covers the skeleton plus the write path: `index`, `bulkIndex`, `delete`, `deleteAll`.

**Files:** `src/main/smart-search/SmartSearchHandler.ts`, `tests/unit/smart-search/SmartSearchHandler.test.ts`

- [ ] **Write failing tests for write path** (`tests/unit/smart-search/SmartSearchHandler.test.ts`)

```typescript
import { IncomingMessage, ServerResponse } from 'http';
import { SmartSearchHandler } from '../../../src/main/smart-search/SmartSearchHandler';
import { VectorStore } from '../../../src/main/vector-store/VectorStore';
import { EmbeddingService } from '../../../src/main/embeddings/EmbeddingService';
import { SynonymStore } from '../../../src/main/smart-search/SynonymStore';
import { SemanticConfig } from '../../../src/main/smart-search/SemanticConfig';
import { TrackerStore } from '../../../src/main/smart-search/TrackerStore';

// Minimal request/response mocks
function mockReq(body: object, siteId = 'site1'): IncomingMessage {
  const req = {
    headers: { 'x-nexus-site-id': siteId },
    on: jest.fn((event: string, cb: any) => {
      if (event === 'data') cb(JSON.stringify(body));
      if (event === 'end') cb();
      return req;
    }),
  } as unknown as IncomingMessage;
  return req;
}

function mockRes(): { res: ServerResponse; getBody: () => any } {
  let body = '';
  const res = {
    writeHead: jest.fn(),
    end: jest.fn((data: string) => { body = data; }),
    setHeader: jest.fn(),
  } as unknown as ServerResponse;
  return { res, getBody: () => JSON.parse(body) };
}

const mockVectorStore = {
  upsert: jest.fn().mockResolvedValue(undefined),
  delete: jest.fn().mockResolvedValue(undefined),
  search: jest.fn().mockResolvedValue([]),
  searchAcrossSites: jest.fn().mockResolvedValue([]),
  getTableNames: jest.fn().mockResolvedValue([]),
} as unknown as VectorStore;

const mockEmbedding = {
  isReady: jest.fn().mockReturnValue(true),
  embed: jest.fn().mockResolvedValue(new Float32Array(384)),
  embedBatch: jest.fn().mockResolvedValue([new Float32Array(384)]),
} as unknown as EmbeddingService;

import Database from 'better-sqlite3';
let db: InstanceType<typeof Database>;
let synonymStore: SynonymStore;
let semanticConfig: SemanticConfig;
let trackerStore: TrackerStore;
let handler: SmartSearchHandler;

beforeEach(() => {
  db = new Database(':memory:');
  synonymStore = new SynonymStore(db);
  synonymStore.initialize();
  semanticConfig = new SemanticConfig(db);
  semanticConfig.initialize();
  trackerStore = new TrackerStore(db);
  trackerStore.initialize();
  jest.clearAllMocks();
  handler = new SmartSearchHandler(mockVectorStore, mockEmbedding, synonymStore, semanticConfig, trackerStore);
});

afterEach(() => db.close());

describe('SmartSearchHandler — write path', () => {
  it('handles index mutation and calls vectorStore.upsert', async () => {
    const { res, getBody } = mockRes();
    await handler.handle(mockReq({
      query: 'mutation IndexRecord($input: DocumentInput!) { index(input: $input) { success code } }',
      variables: {
        input: {
          id: 'post:1',
          data: { post_title: 'Hello', post_content: 'World', post_type: 'post', post_date_gmt: '2024-01-01T00:00:00', post_modified_gmt: '2024-01-01T00:00:00', post_url: 'https://example.com/hello' },
        },
      },
    }), res);
    expect(mockVectorStore.upsert).toHaveBeenCalledTimes(1);
    const body = getBody();
    expect(body.data.index.success).toBe(true);
    expect(body.data.index.code).toBe('200');
  });

  it('handles bulkIndex mutation', async () => {
    const { res, getBody } = mockRes();
    await handler.handle(mockReq({
      query: 'mutation BulkIndex($docs: [DocumentInput!], $meta: MetaInput) { bulkIndex(input: { documents: $docs meta: $meta }) { code } }',
      variables: {
        docs: [
          { id: 'post:1', data: { post_title: 'One', post_content: 'A', post_type: 'post', post_date_gmt: '', post_modified_gmt: '', post_url: '' } },
          { id: 'post:2', data: { post_title: 'Two', post_content: 'B', post_type: 'post', post_date_gmt: '', post_modified_gmt: '', post_url: '' } },
        ],
      },
    }), res);
    expect(mockVectorStore.upsert).toHaveBeenCalledTimes(1);
    expect(getBody().data.bulkIndex.code).toBe('200');
  });

  it('handles delete mutation', async () => {
    const { res, getBody } = mockRes();
    await handler.handle(mockReq({
      query: 'mutation DeleteRecord($id: ID!, $meta: MetaInput) { delete(id: $id, meta: $meta) { success code } }',
      variables: { id: 'post:1' },
    }), res);
    expect(mockVectorStore.delete).toHaveBeenCalledWith('site1', ['post:1']);
    expect(getBody().data.delete.success).toBe(true);
  });

  it('handles deleteAll mutation', async () => {
    const { res, getBody } = mockRes();
    await handler.handle(mockReq({
      query: 'mutation DeleteAllRecords($meta: MetaInput) { deleteAll(meta: $meta) { success code } }',
      variables: {},
    }), res);
    expect(mockVectorStore.delete).toHaveBeenCalledWith('site1', ['__all__']);
    expect(getBody().data.deleteAll.success).toBe(true);
  });

  it('returns error envelope for unknown operation', async () => {
    const { res, getBody } = mockRes();
    await handler.handle(mockReq({ query: '{ unknownOp { id } }', variables: {} }), res);
    expect(getBody().errors).toBeDefined();
  });
});
```

- [ ] **Run tests to verify they fail**

```bash
npx jest --testPathPattern="SmartSearchHandler" --no-coverage 2>&1 | tail -5
```

- [ ] **Implement `SmartSearchHandler.ts`** (`src/main/smart-search/SmartSearchHandler.ts`)

```typescript
import { IncomingMessage, ServerResponse } from 'http';
import type { VectorStore } from '../vector-store/VectorStore';
import type { EmbeddingService } from '../embeddings/EmbeddingService';
import type { SynonymStore } from './SynonymStore';
import type { SemanticConfig } from './SemanticConfig';
import type { TrackerStore } from './TrackerStore';
import { expandSynonyms, applySearchBias, applyPostProcess, computeAggregations, type FindDoc } from './find-pipeline';
import { matchesFilter } from './filter-parser';

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk: Buffer | string) => { data += chunk.toString(); });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function jsonResponse(res: ServerResponse, body: object): void {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function errorResponse(res: ServerResponse, message: string): void {
  jsonResponse(res, { errors: [{ message, extensions: { code: 'INTERNAL_ERROR' } }] });
}

function detectOperation(query: string, variables: Record<string, any>): string {
  if (/\bdeleteAll\b/.test(query)) return 'deleteAll';
  if (/\bdelete\b/.test(query) && variables?.id) return 'delete';
  if (/\bbulkIndex\b/.test(query)) return 'bulkIndex';
  if (/\bindex\b/.test(query) && variables?.input) return 'index';
  if (/\bfind\b/.test(query)) return 'find';
  if (/\bsynonyms\b/.test(query)) return 'synonyms';
  if (/\bsemanticSearch\b/.test(query) && /\bconfig\b/.test(query)) return 'semanticConfig';
  if (/\btracker\b/.test(query)) return 'tracker';
  if (/\brecommendations\b/.test(query)) return 'recommendations';
  if (/\binsights\b/.test(query)) return 'insights';
  return 'unknown';
}

export class SmartSearchHandler {
  constructor(
    private vectorStore: VectorStore,
    private embeddingService: EmbeddingService,
    private synonymStore: SynonymStore,
    private semanticConfig: SemanticConfig,
    private trackerStore: TrackerStore,
  ) {}

  async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const raw = await readBody(req);
      const body = JSON.parse(raw);
      const { query = '', variables = {} } = body;
      const siteId = (req.headers['x-nexus-site-id'] as string) || 'default';
      const op = detectOperation(query, variables);

      switch (op) {
        case 'index': return await this.handleIndex(res, siteId, variables.input);
        case 'bulkIndex': return await this.handleBulkIndex(res, siteId, variables.docs ?? variables.input?.documents ?? []);
        case 'delete': return await this.handleDelete(res, siteId, variables.id);
        case 'deleteAll': return await this.handleDeleteAll(res, siteId);
        case 'find': return await this.handleFind(res, siteId, variables);
        case 'synonyms': return this.handleSynonyms(res, siteId, query, variables);
        case 'semanticConfig': return this.handleSemanticConfig(res, siteId, query, variables);
        case 'tracker': return this.handleTracker(res, siteId, query, variables);
        case 'recommendations': return this.handleRecommendations(res, siteId, variables);
        case 'insights': return this.handleInsights(res, siteId, variables);
        default: return errorResponse(res, `Unknown operation`);
      }
    } catch (err: any) {
      errorResponse(res, err?.message ?? 'Internal error');
    }
  }

  // ── Write path ────────────────────────────────────────────────────────────

  private async handleIndex(res: ServerResponse, siteId: string, input: any): Promise<void> {
    if (!input?.id || !input?.data) {
      return errorResponse(res, 'index: missing input.id or input.data');
    }
    await this.upsertDocuments(siteId, [input]);
    jsonResponse(res, { data: { index: { success: true, code: '200', message: 'Document was indexed successfully', document: { id: input.id } } } });
  }

  private async handleBulkIndex(res: ServerResponse, siteId: string, docs: any[]): Promise<void> {
    if (!docs.length) {
      return jsonResponse(res, { data: { bulkIndex: { code: '200', success: true, documents: [] } } });
    }
    await this.upsertDocuments(siteId, docs);
    jsonResponse(res, { data: { bulkIndex: { code: '200', success: true, documents: docs.map(d => ({ id: d.id })) } } });
  }

  private async handleDelete(res: ServerResponse, siteId: string, id: string): Promise<void> {
    await this.vectorStore.delete(siteId, [id]);
    jsonResponse(res, { data: { delete: { success: true, code: '200', message: 'Document deleted' } } });
  }

  private async handleDeleteAll(res: ServerResponse, siteId: string): Promise<void> {
    // Signal full clear — VectorStore.delete with sentinel
    await this.vectorStore.delete(siteId, ['__all__']);
    jsonResponse(res, { data: { deleteAll: { success: true, code: '200', message: 'All documents deleted' } } });
  }

  private async upsertDocuments(siteId: string, inputs: any[]): Promise<void> {
    const cfg = this.semanticConfig.get(siteId);
    const texts = inputs.map(inp => {
      const data = inp.data ?? {};
      return cfg.fields.map((f: string) => data[f] ?? '').filter(Boolean).join(' ');
    });

    let vectors: Float32Array[];
    if (this.embeddingService.isReady()) {
      vectors = await this.embeddingService.embedBatch(texts);
    } else {
      vectors = texts.map(() => new Float32Array(384));
    }

    const docs = inputs.map((inp, i) => ({
      id: inp.id,
      siteId,
      title: inp.data?.post_title ?? '',
      content: texts[i],
      postType: inp.data?.post_type ?? 'post',
      postId: 0,
      chunkIndex: 0,
      vector: vectors[i],
      metadata: JSON.stringify(inp.data ?? {}),
      indexedAt: Date.now(),
      post_date_gmt: inp.data?.post_date_gmt ?? '',
      post_modified_gmt: inp.data?.post_modified_gmt ?? '',
      doc_url: inp.data?.post_url ?? '',
    }));

    await this.vectorStore.upsert(siteId, docs);
  }

  // ── Find ──────────────────────────────────────────────────────────────────

  private async handleFind(res: ServerResponse, siteId: string, vars: any): Promise<void> {
    const {
      query = '', filter, semanticSearch, limit = 10, offset = 0,
      orderBy, promotions, customResults, aggregate, tolerance,
      timeDecay, includeFields, excludeFields,
    } = vars;

    const rules = this.synonymStore.getRules(siteId);
    const expanded = expandSynonyms(query, rules);
    const bias = semanticSearch?.searchBias ?? 5;
    const vectorWeight = applySearchBias(bias);

    let queryVector: Float32Array | undefined;
    if (vectorWeight > 0 && this.embeddingService.isReady()) {
      queryVector = await this.embeddingService.embed(expanded);
    }

    const searchLimit = limit + (promotions?.documents?.length ?? 0) + (customResults?.length ?? 0) * 10;
    const rawResults = await this.vectorStore.search(siteId, queryVector ?? new Float32Array(384), {
      limit: searchLimit,
      postType: undefined,
    });

    let docs: FindDoc[] = rawResults.map(r => {
      let data: Record<string, any> = {};
      try { data = JSON.parse(r.metadata); } catch {}
      return { id: r.id, score: r.score, sort: [String(r.score), r.id], data };
    });

    // Apply filter
    if (filter) {
      docs = docs.filter(d => matchesFilter(d.data, filter));
    }

    // Fetch promoted docs from vector store
    let promotedDocs: FindDoc[] = [];
    if (promotions?.documents?.length) {
      const promoResults = await Promise.allSettled(
        promotions.documents.map((id: string) =>
          this.vectorStore.search(siteId, new Float32Array(384), { limit: 1 })
            .then(res => res.find(r => r.id === id))
        )
      );
      promotedDocs = promoResults
        .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled' && r.value)
        .map(r => {
          let data: Record<string, any> = {};
          try { data = JSON.parse(r.value.metadata); } catch {}
          return { id: r.value.id, score: 1, sort: ['1', r.value.id], data };
        });
    }

    // Custom results
    let customResultDocs: FindDoc[] = [];
    if (customResults?.length) {
      const qLower = query.toLowerCase();
      for (const cr of customResults) {
        if ((cr.query ?? '').toLowerCase() === qLower) {
          customResultDocs = (cr.documents ?? []).map((id: string) =>
            docs.find(d => d.id === id) ?? { id, score: 1, sort: ['1', id], data: {} }
          );
          break;
        }
      }
    }

    // Aggregate (before post-process changes the set)
    const aggregations = aggregate?.terms
      ? computeAggregations(docs, aggregate.terms)
      : { terms: [] };

    // Apply orderBy by date
    if (orderBy?.length) {
      for (const ob of [...orderBy].reverse()) {
        if (ob.field === 'post_date_gmt' || ob.field === 'post_modified_gmt') {
          docs.sort((a, b) => {
            const aDate = new Date(a.data[ob.field] ?? 0).getTime();
            const bDate = new Date(b.data[ob.field] ?? 0).getTime();
            return ob.direction === 'asc' ? aDate - bDate : bDate - aDate;
          });
        }
      }
    }

    const processed = applyPostProcess(docs, {
      filter,
      promotedDocs,
      customResultDocs,
      includeFields,
      excludeFields,
      timeDecay: timeDecay ?? [],
    });

    const paginated = processed.slice(offset, offset + limit);

    jsonResponse(res, {
      data: {
        find: {
          total: processed.length,
          documents: paginated,
          aggregations,
        },
      },
    });
  }

  // ── Config: synonyms ──────────────────────────────────────────────────────

  private handleSynonyms(res: ServerResponse, siteId: string, query: string, vars: any): void {
    // Detect sub-operation
    if (/deleteAllRules/.test(query)) {
      this.synonymStore.deleteAllRules(siteId);
      return jsonResponse(res, { data: { config: { synonyms: { deleteAllRules: true } } } });
    }
    if (/deleteRule/.test(query) && vars?.id) {
      this.synonymStore.deleteRule(siteId, vars.id);
      return jsonResponse(res, { data: { config: { synonyms: { deleteRule: { success: true, code: '200' } } } } });
    }
    if (/saveRule/.test(query) && vars?.synonyms !== undefined) {
      const rule = this.synonymStore.saveRule(siteId, vars.synonyms, vars.id ?? undefined);
      return jsonResponse(res, { data: { config: { synonyms: { saveRule: { success: true, code: '200', rule } } } } });
    }
    if (/rule\(/.test(query) && vars?.id) {
      const rule = this.synonymStore.getRule(siteId, vars.id);
      return jsonResponse(res, { data: { config: { synonyms: { rule } } } });
    }
    // Default: list rules
    const total = this.synonymStore.countRules(siteId);
    const rules = this.synonymStore.getRules(siteId, { offset: vars?.offset ?? 0, limit: vars?.limit ?? 100 });
    jsonResponse(res, { data: { config: { synonyms: { rules: { total, offset: vars?.offset ?? 0, limit: vars?.limit ?? 100, rules } } } } });
  }

  // ── Config: semanticSearch ────────────────────────────────────────────────

  private handleSemanticConfig(res: ServerResponse, siteId: string, query: string, vars: any): void {
    if (/mutation/.test(query) && vars?.fields) {
      const cfg = this.semanticConfig.set(siteId, vars.fields, vars.type ?? 'BASIC');
      return jsonResponse(res, { data: { config: { semanticSearch: cfg } } });
    }
    const cfg = this.semanticConfig.get(siteId);
    jsonResponse(res, { data: { config: { semanticSearch: cfg } } });
  }

  // ── Tracker ───────────────────────────────────────────────────────────────

  private handleTracker(res: ServerResponse, siteId: string, query: string, vars: any): void {
    if (/trackPageView/.test(query) && vars?.data?.documentID) {
      this.trackerStore.trackPageView(siteId, { sessionId: vars.session?.id ?? '', userId: vars.userID, documentId: vars.data.documentID });
      return jsonResponse(res, { data: { tracker: { trackPageView: { success: true, message: 'ok' } } } });
    }
    if (/trackSearchClick/.test(query) && vars?.data?.documentID) {
      this.trackerStore.trackSearchClick(siteId, { sessionId: vars.session?.id ?? '', userId: vars.userID, documentId: vars.data.documentID, position: vars.data.position ?? 0 });
      return jsonResponse(res, { data: { tracker: { trackSearchClick: { success: true, message: 'ok' } } } });
    }
    if (/trackSearch/.test(query) && vars?.data?.search?.query !== undefined) {
      this.trackerStore.trackSearch(siteId, { sessionId: vars.session?.id ?? '', userId: vars.userID, query: vars.data.search.query, resultCount: vars.data.search.results?.length ?? 0 });
      return jsonResponse(res, { data: { tracker: { trackSearch: { success: true, message: 'ok' } } } });
    }
    errorResponse(res, 'tracker: unrecognized event type');
  }

  // ── Recommendations ───────────────────────────────────────────────────────

  private async handleRecommendations(res: ServerResponse, siteId: string, vars: any): Promise<void> {
    const count = vars?.count ?? 5;

    if (vars?.docID !== undefined) {
      // Related documents: vector similarity
      const refResults = await this.vectorStore.search(siteId, new Float32Array(384), { limit: 1 });
      const ref = refResults.find(r => r.id === vars.docID);
      const refVec = ref ? await this.embeddingService.embed(ref.content) : new Float32Array(384);
      const similar = await this.vectorStore.search(siteId, refVec, { limit: count + 1 });
      const related = similar
        .filter(r => r.id !== vars.docID)
        .slice(0, count)
        .map(r => ({ docID: r.id, score: r.score, source: { id: r.id, post_title: r.title } }));
      return jsonResponse(res, { data: { recommendations: { relatedDocuments: related } } });
    }

    // Trending: frequency from tracker
    const trending = this.trackerStore.getTrendingDocuments(siteId, count)
      .map(t => ({ docID: t.docID, count: t.count, source: { id: t.docID } }));
    jsonResponse(res, { data: { recommendations: { trendingDocuments: trending } } });
  }

  // ── Insights ──────────────────────────────────────────────────────────────

  private handleInsights(res: ServerResponse, siteId: string, vars: any): void {
    const top = vars?.top ?? 10;
    const searchTerms = this.trackerStore.getSearchTerms(siteId, top);
    const searchTermsNoResults = this.trackerStore.getSearchTermsNoResults(siteId, top);
    const siteAnalytics = this.trackerStore.getSiteAnalytics(siteId, top);
    jsonResponse(res, { data: { insights: { searchTerms, searchTermsNoResults, siteAnalytics } } });
  }
}
```

- [ ] **Run tests to verify they pass**

```bash
npx jest --testPathPattern="SmartSearchHandler" --no-coverage 2>&1 | tail -10
```

Expected: `Tests: 5 passed`

- [ ] **Build to confirm no TypeScript errors**

```bash
npm run build 2>&1 | grep "error TS" | head -10
```

- [ ] **Commit**

```bash
git add src/main/smart-search/SmartSearchHandler.ts tests/unit/smart-search/SmartSearchHandler.test.ts
git commit -m "feat(smart-search): SmartSearchHandler — full GraphQL dispatch + write/find/config/tracker/recommendations/insights"
```

---

## Task 9: Handle `deleteAll` in VectorStore

The `SmartSearchHandler` calls `vectorStore.delete(siteId, ['__all__'])` as a sentinel to clear all documents. `VectorStore.delete` currently iterates IDs — we need to handle this sentinel.

**Files:** `src/main/vector-store/VectorStore.ts`

- [ ] **Find the `delete` method in VectorStore.ts** (around line 326) and add sentinel handling:

```typescript
async delete(siteId: string, documentIds: string[]): Promise<void> {
  // Sentinel: ['__all__'] clears the entire site table
  if (documentIds.length === 1 && documentIds[0] === '__all__') {
    try {
      const db = this.getDb();
      const name = this.tableName(siteId);
      const existing = await db.tableNames();
      if (existing.includes(name)) {
        const table = await db.openTable(name);
        await table.delete('id IS NOT NULL');
      }
    } catch { /* table may not exist yet */ }
    return;
  }
  // ... existing per-ID delete logic unchanged ...
```

- [ ] **Build and run write-path tests**

```bash
npm run build 2>&1 | grep "error TS" | head -5
npx jest --testPathPattern="SmartSearchHandler" --no-coverage 2>&1 | tail -5
```

- [ ] **Commit**

```bash
git add src/main/vector-store/VectorStore.ts
git commit -m "feat(smart-search): VectorStore.delete — support __all__ sentinel for deleteAll"
```

---

## Task 10: Wire into HttpEventInterface and `index.ts`

Add the `/smart-search/graphql` route to `HttpEventInterface` and instantiate `SmartSearchHandler` in the main startup.

**Files:** `src/main/events/HttpEventInterface.ts`, `src/main/index.ts`

- [ ] **Add `SmartSearchHandler` to `HttpEventInterface`**

In `src/main/events/HttpEventInterface.ts`, add a `smartSearchHandler` constructor parameter and route:

Find the constructor and add the parameter:
```typescript
// Add to constructor signature (after existing params):
private smartSearchHandler?: SmartSearchHandler
```

Find `handleRequest` and add the route before the `validateAuth` block (around line 185):

```typescript
// Smart Search route — Bearer auth already validated below, but we need
// to add X-Nexus-Site-Id to the CORS headers
if (url === '/smart-search/graphql' && req.method === 'POST') {
  if (!this.validateAuth(req)) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized' }));
    return;
  }
  if (!this.smartSearchHandler) {
    res.writeHead(503);
    res.end(JSON.stringify({ errors: [{ message: 'SmartSearch not initialized' }] }));
    return;
  }
  this.smartSearchHandler.handle(req, res).catch((err) => {
    res.writeHead(500);
    res.end(JSON.stringify({ errors: [{ message: err?.message ?? 'Internal error' }] }));
  });
  return;
}
```

Also add `X-Nexus-Site-Id` to the CORS allowed headers line:
```typescript
res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Auth-Token, X-WP-Site-ID, X-Nexus-Site-Id');
```

- [ ] **Add the import to HttpEventInterface.ts**

At the top of the file, add:
```typescript
import type { SmartSearchHandler } from '../smart-search/SmartSearchHandler';
```

- [ ] **Wire in `src/main/index.ts`**

Find where `HttpEventInterface` is instantiated. Import the required classes and add after the existing service instantiations (before `httpEventInterface` is created):

```typescript
import { SmartSearchHandler } from './smart-search/SmartSearchHandler';
import { SynonymStore } from './smart-search/SynonymStore';
import { SemanticConfig } from './smart-search/SemanticConfig';
import { TrackerStore } from './smart-search/TrackerStore';

// After graphService.initialize():
const synonymStore = new SynonymStore(graphService.getDb());
synonymStore.initialize();
const semanticConfig = new SemanticConfig(graphService.getDb());
semanticConfig.initialize();
const trackerStore = new TrackerStore(graphService.getDb());
trackerStore.initialize();
trackerStore.cleanup(); // purge events older than 7 days on startup

const smartSearchHandler = new SmartSearchHandler(
  vectorStore,
  embeddingService,
  synonymStore,
  semanticConfig,
  trackerStore,
);
```

Then pass `smartSearchHandler` to `HttpEventInterface` constructor.

**Important:** `GraphService.getDb()` is a private method. Add a public getter to `GraphService`:

```typescript
// In GraphService.ts, add this public method:
getDb(): InstanceType<typeof Database> {
  if (!this.db) throw new Error('GraphService not initialized');
  return this.db;
}
```

- [ ] **Build to confirm no TypeScript errors**

```bash
npm run build 2>&1 | grep "error TS" | head -20
```

Fix any errors. Common ones:
- `smartSearchHandler` needs to be optional in constructor → add `?` and update constructor signature
- Import order issues → check tsconfig

- [ ] **Commit**

```bash
git add src/main/events/HttpEventInterface.ts src/main/index.ts src/main/events/GraphService.ts
git commit -m "feat(smart-search): wire SmartSearchHandler into HttpEventInterface and startup"
```

---

## Task 11: MU Plugin — Atlas-Search Detection + URL Override

On site start, detect if `atlas-search` is active and inject the Smart Search endpoint + site ID header into the MU plugin.

**Files:** `src/main/ai-gateway/mu-plugin-template.ts`, `src/main/content/lifecycle-hooks.ts`

- [ ] **Extend `MuPluginConfig` in `mu-plugin-template.ts`**

```typescript
export interface MuPluginConfig {
  // ... existing fields ...
  smartSearchUrl?: string;
  smartSearchToken?: string;
}
```

- [ ] **Add Smart Search PHP block to `generateMuPluginContent`**

After the existing gateway block, add (inside the template string):

```typescript
const smartSearchBlock = (config.smartSearchUrl && config.smartSearchToken) ? `

// ============================================================================
// Smart Search Local Backend (WP Engine AI Toolkit)
// ============================================================================

add_filter('option_wpe_content_engine_option_name', function($value) {
    if (!function_exists('is_plugin_active')) {
        require_once ABSPATH . 'wp-admin/includes/plugin.php';
    }
    if (!is_plugin_active('atlas-search/atlas-search.php')) {
        return $value;
    }
    return [
        'url'          => '${config.smartSearchUrl}',
        'access_token' => '${config.smartSearchToken}',
    ];
}, 10, 1);

// Inject site ID header on Smart Search requests
add_filter('http_request_args', function($args, $url) {
    $smart_search_base = '${config.smartSearchUrl}';
    if (strpos($url, $smart_search_base) === false) {
        return $args;
    }
    if (!isset($args['headers'])) {
        $args['headers'] = [];
    }
    $args['headers']['X-Nexus-Site-Id'] = defined('NEXUS_AI_SITE_ID') ? NEXUS_AI_SITE_ID : '';
    return $args;
}, 10, 2);
` : '';
```

Then append `${smartSearchBlock}` to the PHP template string before the closing `?>`.

- [ ] **Add atlas-search detection in `lifecycle-hooks.ts`**

Find the function that generates MU plugin config on site start (look for `generateMuPluginContent` call or `installNexusAiConnectorPlugin`). After the existing config assembly, add:

```typescript
// Detect atlas-search plugin
let smartSearchUrl: string | undefined;
let smartSearchToken: string | undefined;

try {
  const { stdout } = await runWpCli(site, ['plugin', 'is-active', 'atlas-search']);
  // is-active exits 0 if active
  smartSearchUrl = `http://127.0.0.1:${httpPort}/smart-search/graphql`;
  smartSearchToken = authToken;
} catch {
  // atlas-search not active — don't inject Smart Search config
}
```

Then include `smartSearchUrl` and `smartSearchToken` in the `MuPluginConfig` object passed to `generateMuPluginContent`.

- [ ] **Build to confirm no TypeScript errors**

```bash
npm run build 2>&1 | grep "error TS" | head -10
```

- [ ] **Commit**

```bash
git add src/main/ai-gateway/mu-plugin-template.ts src/main/content/lifecycle-hooks.ts
git commit -m "feat(smart-search): MU plugin — atlas-search detection + endpoint override + site ID header"
```

---

## Task 12: Integration Tests

Full round-trip tests hitting the actual HTTP endpoint with a real LanceDB + SQLite in a temp directory.

**Files:** `tests/integration/smart-search/smart-search.integration.test.ts`

- [ ] **Write integration tests**

```typescript
import * as http from 'http';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import Database from 'better-sqlite3';
import { VectorStore } from '../../../src/main/vector-store/VectorStore';
import { EmbeddingService } from '../../../src/main/embeddings/EmbeddingService';
import { SmartSearchHandler } from '../../../src/main/smart-search/SmartSearchHandler';
import { SynonymStore } from '../../../src/main/smart-search/SynonymStore';
import { SemanticConfig } from '../../../src/main/smart-search/SemanticConfig';
import { TrackerStore } from '../../../src/main/smart-search/TrackerStore';

const SITE_ID = 'integration-test-site';
const MODEL_DIR = path.join(__dirname, '../../../models/all-MiniLM-L6-v2-quantized');

// Skip if model not present (CI without model download)
const hasModel = fs.existsSync(path.join(MODEL_DIR, 'model.onnx'));

let tmpDir: string;
let vectorStore: VectorStore;
let embeddingService: EmbeddingService;
let db: InstanceType<typeof Database>;
let handler: SmartSearchHandler;

async function post(body: object): Promise<any> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({ method: 'POST', host: 'localhost', path: '/unused', headers: { 'Content-Type': 'application/json', 'x-nexus-site-id': SITE_ID } }, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve(JSON.parse(body)));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// Simpler: call handler directly via in-process mock
async function callHandler(body: object): Promise<any> {
  return new Promise((resolve) => {
    let responseBody = '';
    const req = {
      headers: { 'x-nexus-site-id': SITE_ID },
      on: jest.fn((event: string, cb: any) => {
        if (event === 'data') cb(JSON.stringify(body));
        if (event === 'end') cb();
        return req;
      }),
    } as any;
    const res = {
      writeHead: jest.fn(),
      setHeader: jest.fn(),
      end: jest.fn((data: string) => { responseBody = data; resolve(JSON.parse(data)); }),
    } as any;
    handler.handle(req, res);
  });
}

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-ss-int-'));
  vectorStore = new VectorStore(path.join(tmpDir, 'vectors'));
  await vectorStore.initialize();

  embeddingService = new EmbeddingService(MODEL_DIR);
  if (hasModel) await embeddingService.initialize();

  db = new Database(path.join(tmpDir, 'graph.db'));
  const synonymStore = new SynonymStore(db);
  synonymStore.initialize();
  const semanticConfig = new SemanticConfig(db);
  semanticConfig.initialize();
  const trackerStore = new TrackerStore(db);
  trackerStore.initialize();

  handler = new SmartSearchHandler(vectorStore, embeddingService, synonymStore, semanticConfig, trackerStore);
}, 30000);

afterAll(async () => {
  db?.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('Smart Search integration', () => {
  it('index → find round-trip', async () => {
    const indexResp = await callHandler({
      query: 'mutation IndexRecord($input: DocumentInput!) { index(input: $input) { success code } }',
      variables: { input: { id: 'post:1', data: { post_title: 'WordPress performance tips', post_content: 'Caching makes sites faster', post_type: 'post', post_date_gmt: '2024-06-01T00:00:00', post_modified_gmt: '2024-06-01T00:00:00', post_url: 'https://example.com/performance' } } },
    });
    expect(indexResp.data.index.success).toBe(true);

    const findResp = await callHandler({
      query: 'query Search($query: String!) { find(query: $query limit: 5 offset: 0) { total documents { id score } } }',
      variables: { query: 'performance', limit: 5, offset: 0 },
    });
    expect(findResp.data.find.total).toBeGreaterThan(0);
    expect(findResp.data.find.documents[0].id).toBe('post:1');
  });

  it('deleteAll → find returns empty', async () => {
    await callHandler({
      query: 'mutation DeleteAllRecords { deleteAll { success code } }',
      variables: {},
    });
    const findResp = await callHandler({
      query: 'query Search($query: String!) { find(query: $query) { total documents { id } } }',
      variables: { query: 'performance', limit: 5, offset: 0 },
    });
    expect(findResp.data.find.total).toBe(0);
  });

  it('synonym round-trip', async () => {
    // Index a doc with "notebook"
    await callHandler({
      query: 'mutation IndexRecord($input: DocumentInput!) { index(input: $input) { success } }',
      variables: { input: { id: 'post:2', data: { post_title: 'Notebook review', post_content: 'The best notebook for coding', post_type: 'post', post_date_gmt: '', post_modified_gmt: '', post_url: '' } } },
    });

    // Save synonym: laptop = notebook
    const saveResp = await callHandler({
      query: 'mutation { config { synonyms { saveRule(synonyms: "laptop, notebook") { success rule { id } } } } }',
      variables: { synonyms: 'laptop, notebook' },
    });
    expect(saveResp.data.config.synonyms.saveRule.success).toBe(true);

    // Search for "laptop" — should find "notebook" doc via synonym expansion
    const findResp = await callHandler({
      query: 'query Search($query: String!) { find(query: $query) { total documents { id } } }',
      variables: { query: 'laptop', limit: 5, offset: 0 },
    });
    expect(findResp.data.find.documents.some((d: any) => d.id === 'post:2')).toBe(true);
  });

  it('tracker → trendingDocuments round-trip', async () => {
    await callHandler({
      query: 'mutation { tracker { trackSearchClick(session: $session userID: $userID data: $data) { success } } }',
      variables: { session: { id: 's1' }, userID: 'u1', data: { documentID: 'post:2', position: 1 } },
    });
    await callHandler({
      query: 'mutation { tracker { trackSearchClick(session: $session userID: $userID data: $data) { success } } }',
      variables: { session: { id: 's2' }, userID: 'u2', data: { documentID: 'post:2', position: 1 } },
    });

    const recResp = await callHandler({
      query: 'query { recommendations(count: 5) { trendingDocuments(from: "2024-01-01" to: "2099-01-01") { docID count } } }',
      variables: { count: 5 },
    });
    expect(recResp.data.recommendations.trendingDocuments[0].docID).toBe('post:2');
    expect(recResp.data.recommendations.trendingDocuments[0].count).toBe(2);
  });
});
```

- [ ] **Run integration tests**

```bash
npx jest --testPathPattern="smart-search.integration" --no-coverage --testTimeout=30000 2>&1 | tail -20
```

Expected: all tests pass. If model not present, `index → find` works via FTS (score-based order may vary but doc is found).

- [ ] **Run full test suite to check for regressions**

```bash
npm test 2>&1 | tail -20
```

Expected: all pre-existing tests pass; new tests pass.

- [ ] **Commit**

```bash
git add tests/integration/smart-search/smart-search.integration.test.ts
git commit -m "test(smart-search): integration tests — index/find, deleteAll, synonyms, tracker"
```

---

## Task 13: Update Barrel Export + Final Build

- [ ] **Update `src/main/smart-search/index.ts`** with all exports (replace placeholder from Task 1):

```typescript
export { SmartSearchHandler } from './SmartSearchHandler';
export { SynonymStore } from './SynonymStore';
export { SemanticConfig } from './SemanticConfig';
export { TrackerStore } from './TrackerStore';
export { expandSynonyms, applySearchBias, applyPostProcess, computeAggregations } from './find-pipeline';
export { matchesFilter } from './filter-parser';
```

- [ ] **Final build**

```bash
npm run build 2>&1 | grep "error TS"
```

Expected: no errors.

- [ ] **Full test run**

```bash
npm test 2>&1 | tail -20
```

Expected: all tests pass (the pre-existing `CustomGC` open handle warning is expected and harmless).

- [ ] **Final commit**

```bash
git add src/main/smart-search/index.ts
git commit -m "feat(smart-search): complete local backend for WP Engine AI Toolkit

- SmartSearchHandler: GraphQL dispatch for all atlas-search operations
- SynonymStore, SemanticConfig, TrackerStore: SQLite-backed data stores
- FindPipeline: synonym expansion, searchBias → vectorWeight, post-processing
- FilterParser: Smart Search filter string evaluation
- LanceDB schema migration: post_date_gmt, post_modified_gmt, doc_url
- HttpEventInterface: /smart-search/graphql route
- MU plugin: atlas-search detection + endpoint override + site ID header injection
- Integration tests: index/find, deleteAll, synonyms, tracker round-trips"
```

---

## Self-Review Notes

- All Smart Search GraphQL operations from the spec are handled in `SmartSearchHandler`
- `deleteAll` sentinel (`__all__`) handled in both `SmartSearchHandler` and `VectorStore`
- `GraphService.getDb()` must be added as a public method — don't forget
- `HttpEventInterface` constructor signature change: mark `smartSearchHandler` as optional to avoid breaking existing tests
- The LanceDB `addColumns` API may vary by version — `migrateTableSchema` has a try/catch fallback
- Stubs (geoConstraints, queryRescorer, field weighting) silently pass through — no spec deviation
