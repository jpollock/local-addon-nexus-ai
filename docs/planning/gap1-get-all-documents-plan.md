# IVectorStore.getAllDocuments() — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `getAllDocuments(siteId)` to `IVectorStore` and `SqliteVecStore`, exposing every indexed document's embedding for semantic clustering in the SEO Insights agent.

**Architecture:** One new method on the interface; one SQL query joining `_docs` (metadata) to `_vec` (embeddings) filtered to `chunk_index = 0` — one representative document per post. The vec0 virtual table returns embeddings as BLOBs, converted to `Float32Array`. The SEO agent's `build_topic_map` and `find_overlap_candidates` handlers activate fully once this lands.

**Tech Stack:** TypeScript, better-sqlite3, sqlite-vec vec0 virtual table, Jest

## Global Constraints

- Return type: one entry per `postId`, using `chunk_index = 0` (first/only chunk per post)
- Embedding dimension: 384 (matches `VECTOR_DIMENSIONS` constant in `constants.ts`)
- BLOB → `Float32Array`: `new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4)` where `blob` is `Buffer`
- Return `[]` when site table does not exist (not an error)
- Method is NOT exported from `agent-sdk/index.ts` — internal platform interface only
- Tests run with: `npm test -- --testPathPattern="sqlite-vec-store" --no-coverage`
- Do NOT touch `ContentPipeline`, `IndexRegistry`, or any embedding logic

---

## File Map

### Modified files
| File | What changes |
|------|-------------|
| `src/main/vector-store/IVectorStore.ts` | Add `getAllDocuments` method signature |
| `src/main/vector-store/SqliteVecStore.ts` | Implement `getAllDocuments` |
| `tests/unit/vector-store/sqlite-vec-store.test.ts` | Add tests for `getAllDocuments` |

### Modified (SEO agent — outside addon repo)
| File | What changes |
|------|-------------|
| `~/Library/Application Support/Local/nexus-ai/agents/seo-insights/agent.ts` | Activate `build_topic_map` and `find_overlap_candidates` handlers |

---

## Task 1: Interface + implementation + tests

**Files:**
- Modify: `src/main/vector-store/IVectorStore.ts:1-50`
- Modify: `src/main/vector-store/SqliteVecStore.ts`
- Test: `tests/unit/vector-store/sqlite-vec-store.test.ts`

**Interfaces:**
- Produces:
```typescript
// Added to IVectorStore
getAllDocuments(siteId: string): Promise<Array<{
  id: string;
  postId: number;
  postType: string;
  title: string;
  content: string;
  embedding: Float32Array;
  metadata: string;
}>>;
```

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/vector-store/sqlite-vec-store.test.ts` (inside the existing describe block, after the existing test setup):

```typescript
describe('getAllDocuments', () => {
  it('returns [] when site has not been indexed', async () => {
    const docs = await store.getAllDocuments('nonexistent-site');
    expect(docs).toEqual([]);
  });

  it('returns one entry per post (chunk_index=0 only)', async () => {
    // Upsert two chunks for the same post + one chunk for a second post
    const embed384 = new Float32Array(384).fill(0.1);
    await store.upsert('test-site', [
      {
        id: 'wp_test-site_1',
        siteId: 'test-site',
        title: 'Post One',
        content: 'First chunk of post one',
        postType: 'post',
        postId: 1,
        chunkIndex: 0,
        metadata: JSON.stringify({ author: 'alice' }),
        indexedAt: Date.now(),
        embedding: embed384,
      },
      {
        id: 'wp_test-site_1_chunk_1',
        siteId: 'test-site',
        title: 'Post One',
        content: 'Second chunk of post one',
        postType: 'post',
        postId: 1,
        chunkIndex: 1,
        metadata: JSON.stringify({ author: 'alice' }),
        indexedAt: Date.now(),
        embedding: embed384,
      },
      {
        id: 'wp_test-site_2',
        siteId: 'test-site',
        title: 'Post Two',
        content: 'Only chunk of post two',
        postType: 'page',
        postId: 2,
        chunkIndex: 0,
        metadata: JSON.stringify({ author: 'bob' }),
        indexedAt: Date.now(),
        embedding: new Float32Array(384).fill(0.5),
      },
    ]);

    const docs = await store.getAllDocuments('test-site');

    expect(docs).toHaveLength(2);
    expect(docs.map(d => d.postId).sort()).toEqual([1, 2]);
    expect(docs.every(d => d.embedding instanceof Float32Array)).toBe(true);
    expect(docs.every(d => d.embedding.length === 384)).toBe(true);
  });

  it('returns correct metadata fields', async () => {
    const embed384 = new Float32Array(384).fill(0.2);
    await store.upsert('meta-site', [{
      id: 'wp_meta-site_5',
      siteId: 'meta-site',
      title: 'My Post',
      content: 'Some content here',
      postType: 'post',
      postId: 5,
      chunkIndex: 0,
      metadata: JSON.stringify({ author: 'carol', categories: ['news'] }),
      indexedAt: Date.now(),
      embedding: embed384,
    }]);

    const docs = await store.getAllDocuments('meta-site');
    expect(docs).toHaveLength(1);
    const doc = docs[0];
    expect(doc.id).toBe('wp_meta-site_5');
    expect(doc.postId).toBe(5);
    expect(doc.postType).toBe('post');
    expect(doc.title).toBe('My Post');
    expect(doc.content).toBe('Some content here');
    expect(JSON.parse(doc.metadata)).toMatchObject({ author: 'carol' });
  });
});
```

- [ ] **Step 2: Run to confirm tests fail**

```bash
npm test -- --testPathPattern="sqlite-vec-store" --no-coverage 2>&1 | tail -10
```

Expected: `getAllDocuments is not a function` or similar.

- [ ] **Step 3: Add `getAllDocuments` to `IVectorStore`**

In `src/main/vector-store/IVectorStore.ts`, add this method after `lookupById`:

```typescript
/**
 * Returns all indexed documents for a site, one entry per post (chunk_index = 0).
 * Includes embeddings for semantic clustering and analysis.
 * Returns [] when the site has no index.
 *
 * Primary consumer: SEO Insights agent build_topic_map and find_overlap_candidates.
 */
getAllDocuments(siteId: string): Promise<Array<{
  id: string;
  postId: number;
  postType: string;
  title: string;
  content: string;
  embedding: Float32Array;
  metadata: string;
}>>;
```

- [ ] **Step 4: Implement `getAllDocuments` in `SqliteVecStore`**

Add this method to the `SqliteVecStore` class, after the `lookupById` implementation:

```typescript
async getAllDocuments(siteId: string): Promise<Array<{
  id: string;
  postId: number;
  postType: string;
  title: string;
  content: string;
  embedding: Float32Array;
  metadata: string;
}>> {
  const p = tablePrefix(siteId);

  // Return [] if site hasn't been indexed yet
  const tableExists = this.db
    .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`)
    .get(`${p}_docs`);
  if (!tableExists) return [];

  // Join _docs to _vec on rowid, one row per post (chunk_index = 0)
  // chunk_index = 0 is the first (or only) chunk per post — representative embedding
  const rows = this.db
    .prepare(`
      SELECT d.id, d.post_id, d.post_type, d.title, d.content, d.metadata,
             v.embedding
      FROM "${p}_docs" d
      JOIN "${p}_vec" v ON d.rowid = v.rowid
      WHERE d.chunk_index = 0
    `)
    .all() as Array<{
      id: string;
      post_id: number;
      post_type: string;
      title: string;
      content: string;
      metadata: string;
      embedding: Buffer;
    }>;

  return rows.map(row => ({
    id: row.id,
    postId: row.post_id,
    postType: row.post_type,
    title: row.title,
    content: row.content,
    metadata: row.metadata,
    // sqlite-vec returns embedding as a raw Buffer (BLOB) — convert to Float32Array
    embedding: new Float32Array(
      row.embedding.buffer,
      row.embedding.byteOffset,
      row.embedding.byteLength / 4,
    ),
  }));
}
```

- [ ] **Step 5: Run tests**

```bash
npm test -- --testPathPattern="sqlite-vec-store" --no-coverage 2>&1 | tail -15
```

Expected: all 3 new `getAllDocuments` tests pass; existing store tests unchanged.

- [ ] **Step 6: Build check**

```bash
npm run build 2>&1 | grep "error TS" | head -5
```

Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/main/vector-store/IVectorStore.ts \
        src/main/vector-store/SqliteVecStore.ts \
        tests/unit/vector-store/sqlite-vec-store.test.ts
git commit -m "feat(vector-store): IVectorStore.getAllDocuments() — enumerate all doc embeddings for semantic clustering"
```

---

## Task 2: Activate build_topic_map and find_overlap_candidates in seo-insights agent

**Files:**
- Modify: `~/Library/Application Support/Local/nexus-ai/agents/seo-insights/agent.ts`

**Interfaces:**
- Consumes: `search_site_content` (MCP tool, already available) and `getAllDocuments` via a new MCP tool that wraps it, OR direct access through a new MCP tool `get_all_site_documents`

**Note on access pattern:** The SEO agent accesses the vector store through MCP tools, not directly. `getAllDocuments` needs to be exposed as an MCP tool for the agent to call it. Add `get_all_site_documents` as a new MCP tool that calls `vectorStore.getAllDocuments(siteId)`.

### Step 2a: Add `get_all_site_documents` MCP tool

**File:** Create `src/main/mcp/modules/content/get-all-documents.ts`

```typescript
import type { McpToolHandler } from '../../types';
import { ok, error } from '../wp-cli/preflight';
import { resolveSite } from '../../site-resolver';

export const getAllDocumentsHandler: McpToolHandler = {
  definition: {
    name: 'get_all_site_documents',
    description:
      'Returns all indexed documents for a site with their embeddings. ' +
      'One entry per post (chunk_index=0). Used for topical clustering and semantic analysis. ' +
      'Returns empty array if site has not been indexed. ' +
      'Note: embeddings are returned as base64-encoded Float32 arrays.',
    inputSchema: {
      type: 'object',
      properties: {
        site: {
          type: 'string',
          description: 'Local site name, ID, or domain',
        },
        include_embeddings: {
          type: 'boolean',
          description: 'Include raw embeddings in response (default: false — metadata only)',
          default: false,
        },
      },
      required: ['site'],
    },
    annotations: { readOnlyHint: true },
  },

  async execute(args, services) {
    const site = resolveSite(args.site as string, services.siteData);
    if (!site) return error(`Site "${args.site}" not found`);

    const includeEmbeddings = (args.include_embeddings as boolean | undefined) ?? false;

    const docs = await services.vectorStore.getAllDocuments(site.id);

    if (docs.length === 0) {
      return ok(`No indexed documents found for site "${site.name}". Start the site in Local to trigger indexing.`);
    }

    const output = docs.map(doc => {
      const base: Record<string, unknown> = {
        id: doc.id,
        postId: doc.postId,
        postType: doc.postType,
        title: doc.title,
        content: doc.content.slice(0, 200), // truncate for transport
        metadata: doc.metadata,
      };
      if (includeEmbeddings) {
        // Convert Float32Array to base64 for JSON transport
        const buf = Buffer.from(doc.embedding.buffer, doc.embedding.byteOffset, doc.embedding.byteLength);
        base.embedding = buf.toString('base64');
      }
      return base;
    });

    return ok(JSON.stringify({
      siteId: site.id,
      siteName: site.name,
      documentCount: docs.length,
      documents: output,
    }));
  },
};
```

Register in `src/main/mcp/modules/content/index.ts` (or wherever content tools are registered):

```typescript
import { getAllDocumentsHandler } from './get-all-documents';
// Add to registerContentTools():
registry.register(getAllDocumentsHandler);
```

Add `get_all_site_documents` to the SEO agent's `tools` list in `agent.ts`.

### Step 2b: Implement clustering in `build_topic_map`

Replace the stub handler with the real implementation:

```typescript
build_topic_map: {
  description: 'Build a topical map of the site by clustering document embeddings. Groups posts by semantic similarity and labels each cluster with its dominant topics.',
  inputSchema: {
    type: 'object',
    properties: {
      siteId: { type: 'string', description: 'Local site name or ID' },
      clusters: { type: 'number', default: 10, description: 'Target number of topic clusters' },
    },
    required: ['siteId'],
  },
  executionMode: 'run' as const,
  handler: async (args: TopicMapArgs, ctx) => {
    ctx.log.phase('build_topic_map');
    const targetClusters = args.clusters ?? 10;

    // Fetch all documents with embeddings
    const raw = await ctx.tools.invoke('get_all_site_documents', {
      site: args.siteId,
      include_embeddings: true,
    }) as string;

    let parsed: { documentCount: number; documents: Array<{ id: string; postId: number; postType: string; title: string; embedding: string }> };
    try {
      parsed = JSON.parse(raw);
    } catch {
      return ok(`⚠ Could not retrieve documents: ${raw.slice(0, 200)}`);
    }

    if (parsed.documentCount === 0) {
      return ok(`⚠ No indexed documents found for "${args.siteId}". Start the site to trigger indexing.`);
    }

    ctx.log.info(`Clustering ${parsed.documentCount} documents into ~${targetClusters} topics`);

    // Decode embeddings from base64
    const docs = parsed.documents.map(doc => ({
      ...doc,
      vec: new Float32Array(Buffer.from(doc.embedding, 'base64').buffer),
    }));

    // K-means clustering (simple implementation — no external dep)
    const k = Math.min(targetClusters, docs.length);
    const clusters = kMeans(docs.map(d => d.vec), k);

    // Label clusters with representative titles
    const clusterLabels = clusters.map((memberIndices, i) => {
      const members = memberIndices.map(idx => docs[idx]);
      const titles = members.map(m => m.title);
      return {
        clusterId: i + 1,
        label: titles[0] ?? `Topic ${i + 1}`, // use top member title as label
        postCount: members.length,
        posts: titles.slice(0, 5),
        postIds: members.map(m => m.postId),
      };
    });

    const report = [
      `# Topic Map: ${args.siteId}`,
      `${parsed.documentCount} posts grouped into ${k} topic clusters`,
      '',
      ...clusterLabels.map(c =>
        `## Cluster ${c.clusterId}: ${c.label} (${c.postCount} posts)\n` +
        c.posts.map(t => `  • ${t}`).join('\n')
      ),
    ].join('\n');

    ctx.log.info(`Topic map built: ${k} clusters from ${parsed.documentCount} documents`);
    return ok(report);
  },
},
```

Add the `kMeans` helper function (no external dep — pure JS, ~60 lines):

```typescript
// Simple k-means over Float32Array embeddings — no external dependency
function cosineSim(a: Float32Array, b: Float32Array): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] ** 2; nb += b[i] ** 2; }
  return na === 0 || nb === 0 ? 0 : dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function kMeans(vecs: Float32Array[], k: number, maxIter = 20): number[][] {
  if (vecs.length <= k) return vecs.map((_, i) => [i]);
  const dim = vecs[0].length;

  // Init centroids: spread picks (Forgy-style, deterministic for reproducibility)
  const step = Math.floor(vecs.length / k);
  let centroids = Array.from({ length: k }, (_, i) => vecs[i * step].slice());

  let assignments = new Array<number>(vecs.length).fill(0);

  for (let iter = 0; iter < maxIter; iter++) {
    // Assign each doc to nearest centroid
    const prev = [...assignments];
    for (let i = 0; i < vecs.length; i++) {
      let bestSim = -Infinity, bestK = 0;
      for (let c = 0; c < k; c++) {
        const s = cosineSim(vecs[i], centroids[c]);
        if (s > bestSim) { bestSim = s; bestK = c; }
      }
      assignments[i] = bestK;
    }

    // Check convergence
    if (assignments.every((a, i) => a === prev[i])) break;

    // Recompute centroids
    centroids = Array.from({ length: k }, (_, c) => {
      const members = vecs.filter((_, i) => assignments[i] === c);
      if (members.length === 0) return centroids[c].slice();
      const avg = new Float32Array(dim);
      for (const v of members) for (let d = 0; d < dim; d++) avg[d] += v[d] / members.length;
      return avg;
    });
  }

  // Group doc indices by cluster
  return Array.from({ length: k }, (_, c) =>
    assignments.map((a, i) => a === c ? i : -1).filter(i => i >= 0)
  );
}
```

### Step 2c: Activate `find_overlap_candidates`

Replace the stub with the real implementation:

```typescript
find_overlap_candidates: {
  description: 'Find semantically similar page pairs that may compete for the same queries. Uses cosine similarity over document embeddings.',
  inputSchema: {
    type: 'object',
    properties: {
      siteId: { type: 'string' },
      threshold: { type: 'number', default: 0.85, description: 'Cosine similarity threshold (0–1)' },
    },
    required: ['siteId'],
  },
  executionMode: 'function' as const,
  handler: async (args: OverlapArgs, ctx) => {
    ctx.log.phase('find_overlap_candidates');
    const threshold = args.threshold ?? 0.85;

    const raw = await ctx.tools.invoke('get_all_site_documents', {
      site: args.siteId,
      include_embeddings: true,
    }) as string;

    let parsed: { documentCount: number; documents: Array<{ postId: number; title: string; embedding: string }> };
    try { parsed = JSON.parse(raw); } catch {
      return ok(`⚠ Could not retrieve documents.`);
    }

    if (parsed.documentCount < 2) return ok('Need at least 2 indexed posts to find overlap candidates.');

    const docs = parsed.documents.map(d => ({
      ...d,
      vec: new Float32Array(Buffer.from(d.embedding, 'base64').buffer),
    }));

    const pairs: Array<{ a: string; b: string; similarity: number }> = [];
    for (let i = 0; i < docs.length; i++) {
      for (let j = i + 1; j < docs.length; j++) {
        const sim = cosineSim(docs[i].vec, docs[j].vec);
        if (sim >= threshold) {
          pairs.push({ a: docs[i].title, b: docs[j].title, similarity: sim });
        }
      }
    }

    pairs.sort((a, b) => b.similarity - a.similarity);

    const lines = [
      `# Overlap Candidates: ${args.siteId}`,
      `Threshold: ${threshold} | Found: ${pairs.length} pairs`,
      '',
      '⚠ These are SEMANTIC candidates — two similar pages can rank for different queries.',
      '  Connect Search Console (T1) to confirm which pairs are actual cannibalization.',
      '',
      ...pairs.slice(0, 20).map(p =>
        `  ${(p.similarity * 100).toFixed(1)}% similar: "${p.a}" ↔ "${p.b}"`
      ),
      pairs.length > 20 ? `  … and ${pairs.length - 20} more pairs` : '',
    ].filter(l => l !== '').join('\n');

    if (pairs.length > 0) {
      ctx.log.finding({
        id: 'overlap-candidates',
        severity: pairs.length > 5 ? 'medium' : 'low',
        title: `${pairs.length} page pairs with >${Math.round(threshold * 100)}% semantic overlap`,
        description: pairs.slice(0, 3).map(p => `"${p.a}" ↔ "${p.b}"`).join('; '),
      });
    }

    return ok(lines);
  },
},
```

- [ ] **Step 2d: Commit the agent changes**

```bash
# Agent file is outside the addon repo — no git commit needed, hot-reload picks it up
node lib/cli/index.js agent tools build "/Users/jeremy.pollock/Library/Application Support/Local/nexus-ai/agents/seo-insights" 2>&1
node lib/cli/index.js agent validate seo-insights 2>&1
```

---

## Testing the full flow

After both tasks are done:

```bash
# 1. Confirm getAllDocuments works
node lib/cli/index.js agent tools invoke seo-insights check_index_health \
  --arg siteId=jeremypollockblog 2>&1

# 2. Activate build_topic_map (requires site to be running and indexed)
node lib/cli/index.js agent tools invoke seo-insights build_topic_map \
  --arg siteId=jeremypollockblog 2>&1

# 3. Test find_overlap_candidates
node lib/cli/index.js agent tools invoke seo-insights find_overlap_candidates \
  --arg siteId=jeremypollockblog 2>&1
```
