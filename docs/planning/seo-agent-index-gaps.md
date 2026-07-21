# SEO Insights Agent — Index Interface Gaps

**Status:** Blocking for M1 entry. Platform work, not agent work.  
**Filed:** 2026-07-20  
**Context:** SEO agent consumes the existing Nexus index rather than owning one. Two gaps in the current `IVectorStore` / `IndexEntry` contract block the agent's core analysis loop.

---

## Gap 1: No enumerate-all API on `IVectorStore`

**File:** `src/main/vector-store/IVectorStore.ts`

**What's missing:**

```typescript
// Needed — does not exist today
getAllDocuments(siteId: string): Promise<VectorDocument[]>
// or, more efficiently:
getAllDocumentsWithVectors(siteId: string): Promise<Array<{ id: string; postId: number; title: string; embedding: Float32Array; metadata: string }>>
```

**Why it's blocking:**

Topical clustering requires the full document vector set for a site — every post's embedding — to run agglomerative or k-means clustering. The existing `search()` method returns only top-K results for a given query vector. There is no way to enumerate the corpus without issuing O(N) individual `lookupById()` calls, which don't return embeddings anyway.

The underlying data is already there: `site_{siteId}_vec` (the sqlite-vec virtual table) and `site_{siteId}_docs` (metadata) are both per-site. A join of the two gives exactly what's needed.

**Proposed signature (for platform discussion):**

```typescript
interface IVectorStore {
  // existing methods...
  
  /**
   * Returns all indexed documents for a site, including their embeddings.
   * For clustering and corpus-level analysis. Documents are deduplicated by
   * postId — one entry per post, using chunkIndex=0 or best-representative chunk.
   * Returns empty array if site has no index.
   */
  getAllDocuments(siteId: string): Promise<Array<{
    id: string;
    postId: number;
    postType: string;
    title: string;
    content: string;          // first chunk's text
    embedding: Float32Array;  // 384-dim
    metadata: string;         // JSON: { excerpt, author, date, categories, tags }
  }>>;
}
```

**Implementation notes for platform:**
- Query: `SELECT d.id, d.post_id, d.post_type, d.title, d.content, d.metadata, v.embedding FROM site_{siteId}_docs d JOIN site_{siteId}_vec v ON d.rowid = v.rowid WHERE d.chunk_index = 0`
- `chunk_index = 0` gives one row per post (the first chunk, or the only chunk for short posts). For long posts this is the opening chunk, not the whole document — acceptable for topical mapping; the alternative (mean-pool all chunks) can be a separate method if needed.
- Embeddings from sqlite-vec are stored as binary blobs; return as `Float32Array`.
- No pagination required for v1 — typical WordPress sites are under 10k posts. Add pagination hint if > 50k documents becomes a concern.

---

## Gap 2: No schema/model version in `IndexEntry`

**File:** `src/main/content/IndexRegistry.ts`

**What's missing:**

```typescript
interface IndexEntry {
  siteId: string;
  siteName: string;
  lastIndexed: number;    // Unix ms — EXISTS
  documentCount: number;  // EXISTS
  chunkCount: number;     // EXISTS
  durationMs: number;     // EXISTS
  structure: SiteStructure; // EXISTS
  state: 'indexed' | 'indexing' | 'error' | 'stale'; // EXISTS
  
  // MISSING:
  modelId: string;        // e.g. 'all-MiniLM-L6-v2-quantized'
  modelDimensions: number; // e.g. 384
  chunkMaxWords: number;  // e.g. 500
  indexSchemaVersion: number; // monotonically increasing integer
}
```

**Why it matters:**

The SEO agent must embed its own query vectors using the same model that produced the stored embeddings. Today it can only hardcode `all-MiniLM-L6-v2-quantized` at 384 dimensions and hope the platform never changes it. If the model is updated — or if a different site was indexed by a different version of the addon — the cosine similarities are garbage and clustering output is silently wrong.

This is also the blocker for the agent's manifest-pinning design: the spec calls for the agent to refuse or warn on a schema/model mismatch. It cannot do that without a version to compare against.

**The wider argument (worth raising with platform):**

"Index once, many agents consume" only works if the contract is versioned. The SEO agent, the Security Sentinel, and any future content agent all want the same index. Each has its own query patterns and assumptions. A versioned `IndexEntry` makes this composable; without it, every agent hardcodes the same implicit assumptions and breaks silently when they diverge.

**Proposed addition:**

```typescript
interface IndexEntry {
  // ... existing fields unchanged ...
  modelId: string;              // written by ContentPipeline at index time
  modelDimensions: number;      // written by ContentPipeline at index time
  chunkMaxWords: number;        // written by ContentPipeline at index time
  indexSchemaVersion: number;   // bumped when schema changes require a full reindex
}
```

`ContentPipeline` writes these fields from `constants.ts` values (`EMBEDDING_MODEL_NAME`, `VECTOR_DIMENSIONS`, `CHUNK_MAX_WORDS`) at the end of each successful `indexSite()` run. Existing entries without these fields are treated as `indexSchemaVersion: 0` (legacy, may need reindex).

---

## SEO Agent's position pending platform fixes

Until both gaps are closed, the SEO agent can:

- Use `search_site_content` for query-driven retrieval (works today)
- Use `IndexRegistry` / `getSiteStats()` for staleness detection (works today)
- Use WP-CLI for metadata not in the index (dates, link graph, word count)

It **cannot** until Gap 1 is closed:

- Run topical clustering (`build_topic_map` core loop)
- Build full corpus similarity matrix for overlap detection

**M1 entry check:** Confirm Gap 1 is resolved (method exists, returns embeddings) before starting SEO agent implementation. Gap 2 is strongly recommended but not blocking M1 if the model is pinned explicitly in the agent manifest and validated against `IndexEntry.lastIndexed` as a proxy.
