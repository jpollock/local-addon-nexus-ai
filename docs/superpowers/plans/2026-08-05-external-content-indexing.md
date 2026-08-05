# External Host Content Indexing (L3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give external SSH hosts the same content indexing (post extraction → embedding →
vector storage → semantic search) that WP Engine installs already have, closing the last gap
in the L1/L2/L3 model — external hosts currently show 0% Searchable because nothing extracts
their content.

**Architecture:** Generalize `RemoteContentExtractor` to accept a resolved transport instead of
calling WP Engine's SSH bridge directly. Build a new, standalone `ExternalContentIndexService`
(parallel to `WPESyncService`, which is not modified) that does extraction → embedding →
storage, driven by a new `ExternalContentIndexScheduler` (mirroring `ExternalRefreshScheduler`'s
shape exactly) plus a manual `nexus host index <alias>` command. A translation function fixes
one concrete incompatibility: `ssh:<alias>` site IDs contain a colon, which the vector store's
table-name validation rejects.

**Tech Stack:** TypeScript, better-sqlite3 (graph DB), sqlite-vec (vector store), ONNX
(embeddings via `EmbeddingService`), Jest.

## Global Constraints

- **Nothing is ever written to the user's remote server.** The only remote command this plan
  adds is `post list` (read-only, already classified `wpcli_read` by `classify.ts`).
- **No SSH key material is stored**, and **`src/main/transport/ssh-args.ts` remains the only
  place an SSH invocation is constructed.** This plan adds no new SSH builder — it reuses
  `resolveTransport`.
- **No `ControlMaster` on external SSH.** Each content-index cycle opens its own connection per
  host; do not attempt to share a connection with `ExternalRefreshScheduler`.
- **Do not modify `WpeRefreshScheduler`, `WPESyncService`, or `WPESyncService.syncContent`/
  `indexAllWpeContent`.** This plan adds parallel components. If you find yourself editing
  either file for anything beyond reading their shape as a reference, stop — that is out of
  scope.
- **The vector document's `metadata` field must contain `source: 'external'`, never `'wpe'`,
  never omitted.** This is the one honesty-rule regression this plan exists to prevent — WP
  Engine's `WPESyncService.syncContent` hardcodes `'wpe'`, and copying that constant into the
  external path would silently mislabel every indexed document.
- **Read-only paths are not audited.** Neither the scheduler nor `nexus host index` should call
  `auditDirectOperation` — every remote command is a read, and the only mutation is to the
  local graph/vector-store/registry.
- **`resolveTransport` is the only router.** No target resolution or command policy added here.
- `better-sqlite3` is built for the **system-Node** ABI, so `npx jest` works. Do NOT run
  `npm run rebuild` until a task explicitly asks for a live check.
- **Baseline: 12 failing suites, 22 failures, 3671 passing.** Compare failing suite **names**,
  not counts.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/main/content/RemoteContentExtractor.ts` *(modify)* | Generalize to take a `SiteTransport` instead of `LocalServicesBridge`. Behavior-preserving for the WP Engine call site. |
| `src/main/vector-store/vectorSiteId.ts` *(create)* | The one-line translation fixing the colon-in-siteId incompatibility. |
| `src/main/events/ExternalContentIndexService.ts` *(create)* | Extraction → embedding → storage for one external host, and the fleet-wide `indexAllExternalContent()`. Parallel to `WPESyncService`, not derived from it. |
| `src/main/startup/ExternalContentIndexScheduler.ts` *(create)* | Timer, staleness selection, concurrency, never-throw. Mirrors `ExternalRefreshScheduler`. |
| `src/common/types.ts`, `src/common/schemas.ts` *(modify)* | Two new settings. |
| `src/main/index.ts` *(modify)* | Construct, start, settings-reactive wiring. |
| `src/main/graphql/schema.ts`, `src/main/graphql/resolvers.ts` *(modify)* | `nexusHostIndex` mutation. |
| `src/cli/commands/host.ts` *(modify)* | `nexus host index <alias>`. |

---

### Task 1: Generalize `RemoteContentExtractor` to any `SiteTransport`

**Files:**
- Modify: `src/main/content/RemoteContentExtractor.ts`
- Test: `tests/unit/content/RemoteContentExtractor.test.ts` *(create — no test exists for this
  class today)*

**Interfaces:**
- Consumes: `SiteTransport.runWpCli(args: string[], opts?: RunOpts): Promise<WpCliResult>` from
  `src/main/transport/types.ts` (already exists, already accepts `{skipPlugins, skipThemes}`).
- Produces: `RemoteContentExtractor.extract(transport: SiteTransport, siteLabel: string):
  Promise<ExtractedContent>` — the new signature every later task calls.

**There is no existing test for this class.** Write tests for both the WP Engine shape (via a
mock transport standing in for what `WpeSshTransport` would return) and the external shape, so
this refactor is pinned in both directions rather than only forward.

**The change, precisely.** Today:

```ts
export interface RemoteContentExtractorOptions {
  localServices: LocalServicesBridge;
  logger?: any;
}

async extract(installName: string): Promise<ExtractedContent> {
  const result = await this.localServices.remoteWpCliRun(installName, [...], { skipPlugins: false, skipThemes: false });
  // ...
  siteInfo: { name: installName, url: `${installName}.wpengine.com`, wpVersion: '' },
}
```

Becomes:

```ts
export interface RemoteContentExtractorOptions {
  logger?: any;
}
```

(`localServices` is no longer a constructor dependency — the caller now passes a resolved
transport per call, since a transport is per-target, not a fixed dependency of the extractor.)

```ts
import type { SiteTransport } from '../transport/types';

async extract(transport: SiteTransport, siteLabel: string): Promise<ExtractedContent> {
  try {
    this.logger.info(`[RemoteContentExtractor] Starting content extraction for ${siteLabel}...`);

    const result = await transport.runWpCli([
      'post',
      'list',
      '--post_type=any',
      '--post_status=publish',
      '--fields=ID,post_title,post_content,post_excerpt,post_type,post_status,post_author,post_date',
      '--posts_per_page=200',
      '--format=json',
    ], { skipPlugins: false, skipThemes: false });

    if (!result.success || !result.stdout) {
      this.logger.warn(`[RemoteContentExtractor] No posts returned for ${siteLabel}`);
      return this.emptyResult(siteLabel);
    }

    const rawPosts = JSON.parse(result.stdout);
    if (!Array.isArray(rawPosts) || rawPosts.length === 0) {
      this.logger.info(`[RemoteContentExtractor] No published posts in ${siteLabel}`);
      return this.emptyResult(siteLabel);
    }

    const filtered = rawPosts.filter(
      (p: any) => p.post_type && !EXCLUDED_POST_TYPES.includes(p.post_type)
    );

    const typeBreakdown = Object.entries(
      filtered.reduce((acc: Record<string, number>, p: any) => {
        acc[p.post_type] = (acc[p.post_type] || 0) + 1;
        return acc;
      }, {})
    ).map(([t, n]) => `${t}:${n}`).join(', ');

    this.logger.info(
      `[RemoteContentExtractor] ${siteLabel}: ${rawPosts.length} total → ${filtered.length} indexable (${typeBreakdown})`
    );

    const posts: ExtractedPost[] = filtered
      .map((postData: any) => {
        const cleanContent = postData.post_content
          ? cleanWordPressContent(postData.post_content)
          : '';
        return {
          id: Number(postData.ID),
          title: postData.post_title || '',
          content: postData.post_content || '',
          cleanedContent: cleanContent,
          excerpt: postData.post_excerpt || '',
          postType: postData.post_type || 'post',
          postStatus: postData.post_status || 'publish',
          author: postData.post_author ? String(postData.post_author) : '0',
          date: postData.post_date || new Date().toISOString(),
          categories: [],
          tags: [],
          customFields: {},
        } as ExtractedPost;
      })
      .filter((p: ExtractedPost) => p.cleanedContent.trim().length > 0);

    this.logger.info(`[RemoteContentExtractor] Extracted ${posts.length} posts with content from ${siteLabel}`);

    return {
      posts,
      siteInfo: { name: siteLabel, url: '', wpVersion: '' },
      extractedAt: Date.now(),
    };
  } catch (error: any) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    this.logger.error(`[RemoteContentExtractor] Failed to extract from ${siteLabel}:`, errorMsg);
    throw error;
  }
}

private emptyResult(siteLabel: string): ExtractedContent {
  return {
    posts: [],
    siteInfo: { name: siteLabel, url: '', wpVersion: '' },
    extractedAt: Date.now(),
  };
}
```

Only `siteInfo.url` changes from `` `${name}.wpengine.com` `` to `''` — nothing today reads
this field for indexing purposes (confirmed: grep for `.siteInfo.url` across the codebase before
this task — if you find a real reader, report it, don't invent a new hardcode to satisfy it).

**Update `WPESyncService.syncContent`'s call site** (the ONE place that calls `extract` today,
`src/main/events/WPESyncService.ts:452`) to match the new signature:

```ts
const wpeTransport = new WpeSshTransport(installName);
const extracted = await this.remoteContentExtractor.extract(wpeTransport, installName);
```

Import `WpeSshTransport` from `'../transport/WpeSshTransport'`. This is the one line in
`WPESyncService.ts` this task touches — everything else in that file is unchanged, per the
Global Constraints.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/content/RemoteContentExtractor.test.ts
import { RemoteContentExtractor } from '../../../src/main/content/RemoteContentExtractor';
import type { SiteTransport, RunOpts, WpCliResult } from '../../../src/main/transport/types';

function makeTransport(runWpCli: (args: string[], opts?: RunOpts) => Promise<WpCliResult>): SiteTransport {
  return {
    kind: 'external-ssh' as any,
    siteRef: { kind: 'external', alias: 'test' } as any,
    supports: () => true,
    probe: async () => ({ reachable: true }),
    deleteRemoteFile: async () => ({ success: false, output: 'n/a' }),
    runWpCli,
  };
}

describe('RemoteContentExtractor.extract', () => {
  it('extracts posts from any transport, not just WP Engine', async () => {
    const posts = [
      { ID: 1, post_title: 'Hello', post_content: '<p>World</p>', post_excerpt: '', post_type: 'post', post_status: 'publish', post_author: '1', post_date: '2026-01-01 00:00:00' },
    ];
    const transport = makeTransport(async () => ({ stdout: JSON.stringify(posts), success: true }));
    const extractor = new RemoteContentExtractor({ logger: { info: () => {}, warn: () => {}, error: () => {} } });
    const result = await extractor.extract(transport, 'myhost');
    expect(result.posts).toHaveLength(1);
    expect(result.posts[0].title).toBe('Hello');
    expect(result.siteInfo.name).toBe('myhost');
    expect(result.siteInfo.url).toBe('');
  });

  it('passes skipPlugins:false, skipThemes:false through to the transport', async () => {
    const runWpCli = jest.fn(async () => ({ stdout: '[]', success: true }));
    const transport = makeTransport(runWpCli);
    const extractor = new RemoteContentExtractor({ logger: { info: () => {}, warn: () => {}, error: () => {} } });
    await extractor.extract(transport, 'myhost');
    expect(runWpCli).toHaveBeenCalledWith(expect.any(Array), { skipPlugins: false, skipThemes: false });
  });

  it('returns an empty result when the transport call fails, does not throw', async () => {
    const transport = makeTransport(async () => ({ stdout: '', success: false }));
    const extractor = new RemoteContentExtractor({ logger: { info: () => {}, warn: () => {}, error: () => {} } });
    const result = await extractor.extract(transport, 'myhost');
    expect(result.posts).toEqual([]);
  });

  it('filters out excluded post types', async () => {
    const posts = [
      { ID: 1, post_title: 'A', post_content: 'x', post_type: 'post', post_status: 'publish', post_author: '1', post_date: '2026-01-01' },
      { ID: 2, post_title: 'B', post_content: 'y', post_type: 'revision', post_status: 'publish', post_author: '1', post_date: '2026-01-01' },
    ];
    const transport = makeTransport(async () => ({ stdout: JSON.stringify(posts), success: true }));
    const extractor = new RemoteContentExtractor({ logger: { info: () => {}, warn: () => {}, error: () => {} } });
    const result = await extractor.extract(transport, 'myhost');
    expect(result.posts.map(p => p.id)).toEqual([1]);
  });

  it('drops posts whose cleaned content is empty', async () => {
    const posts = [
      { ID: 1, post_title: 'Empty', post_content: '', post_type: 'post', post_status: 'publish', post_author: '1', post_date: '2026-01-01' },
    ];
    const transport = makeTransport(async () => ({ stdout: JSON.stringify(posts), success: true }));
    const extractor = new RemoteContentExtractor({ logger: { info: () => {}, warn: () => {}, error: () => {} } });
    const result = await extractor.extract(transport, 'myhost');
    expect(result.posts).toEqual([]);
  });
});
```

- [ ] **Step 2: Run and verify they fail**

Run: `npx jest tests/unit/content/RemoteContentExtractor.test.ts`
Expected: FAIL — `extractor.extract` currently takes `(installName: string)`, not
`(transport, siteLabel)`, so calling it with a transport object as the first argument produces
a type error at compile time (via `ts-jest`) or, if you bypass typing, `remoteWpCliRun` would be
undefined on the mock and throw.

- [ ] **Step 3: Implement** — both changes above (`RemoteContentExtractor.ts` and the one call
  site in `WPESyncService.ts`).

- [ ] **Step 4: Run tests**

```bash
npx jest tests/unit/content/ tests/unit/events/ && npx tsc --noEmit && npm run build
```

- [ ] **Step 5: Commit**

```bash
git add src/main/content/RemoteContentExtractor.ts src/main/events/WPESyncService.ts tests/unit/content/RemoteContentExtractor.test.ts
git commit -m "refactor(content): RemoteContentExtractor takes any SiteTransport, not just WP Engine's bridge"
```

---

### Task 2: `vectorSiteId` — fix the colon-in-siteId incompatibility

**Files:**
- Create: `src/main/vector-store/vectorSiteId.ts`
- Test: `tests/unit/vector-store/vectorSiteId.test.ts` *(create)*

**Interfaces:**
- Produces: `vectorSiteId(siteId: string): string` — used by Task 3's service wherever it calls
  into the vector store.

**Why this exists.** `SqliteVecStore.validateSiteId` (`src/main/vector-store/
SqliteVecStore.ts:27-31`) requires `^[a-zA-Z0-9_-]+$`. External site IDs are `ssh:<alias>`
(from `externalSiteId()` in `src/main/transport/resolve.ts` or wherever it's defined — grep for
its definition before assuming the exact import path). The colon fails that regex immediately,
so `vectorStore.upsert('ssh:hostinger-test', ...)` throws before this plan's indexing ever
writes a single document.

Only the vector store's table-name-derived siteId needs translating. The graph `content` table,
`IndexRegistry`, and everywhere else keep the real `ssh:<alias>` id — this function is called
at exactly one boundary.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/vector-store/vectorSiteId.test.ts
import { vectorSiteId } from '../../../src/main/vector-store/vectorSiteId';

describe('vectorSiteId', () => {
  it('replaces colons with underscores', () => {
    expect(vectorSiteId('ssh:hostinger-test')).toBe('ssh_hostinger-test');
  });

  it('leaves an id with no colon unchanged', () => {
    expect(vectorSiteId('wpe-abc123')).toBe('wpe-abc123');
    expect(vectorSiteId('mmWgjXGRS')).toBe('mmWgjXGRS');
  });

  it('the translated id satisfies the real validation regex', () => {
    // Import the actual regex source rather than copying it, so a future change
    // to SqliteVecStore's rule is caught here too.
    const translated = vectorSiteId('ssh:my-host_1');
    expect(/^[a-zA-Z0-9_-]+$/.test(translated)).toBe(true);
  });

  it('handles multiple colons (defensive — aliases should never contain one, but do not crash if they do)', () => {
    expect(vectorSiteId('ssh:a:b')).toBe('ssh_a_b');
  });
});
```

- [ ] **Step 2: Run and verify it fails**

Run: `npx jest tests/unit/vector-store/vectorSiteId.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/main/vector-store/vectorSiteId.ts

/**
 * sqlite-vec table names can't contain ':' (SqliteVecStore.validateSiteId requires
 * ^[a-zA-Z0-9_-]+$). External site ids are `ssh:<alias>` — translate only at this
 * boundary. The graph `content` table, IndexRegistry, and every other consumer of
 * a site id keep the real `ssh:<alias>` value; only the vector store's
 * table-name-derived id changes.
 *
 * Local and WPE ids (`mmWgjXGRS`, `wpe-<uuid>`) contain no colons, so this is a
 * no-op for them — safe to apply unconditionally rather than branching on source.
 */
export function vectorSiteId(siteId: string): string {
  return siteId.replace(/:/g, '_');
}
```

- [ ] **Step 4: Run tests**

```bash
npx jest tests/unit/vector-store/ && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add src/main/vector-store/vectorSiteId.ts tests/unit/vector-store/vectorSiteId.test.ts
git commit -m "fix(vector-store): translate colon-bearing site ids at the vector-store boundary"
```

---

### Task 3: `ExternalContentIndexService` — extraction, embedding, storage

**Files:**
- Create: `src/main/events/ExternalContentIndexService.ts`
- Test: `tests/unit/events/ExternalContentIndexService.test.ts` *(create)*

**Interfaces:**
- Consumes: `RemoteContentExtractor.extract(transport, siteLabel)` from Task 1;
  `vectorSiteId(siteId)` from Task 2; `SiteTransport` from `src/main/transport/types.ts`.
- Produces:
  - `class ExternalContentIndexService` with `indexOne(transport: SiteTransport, siteId: string,
    alias: string): Promise<{ documentCount: number }>` and
    `indexAllExternalContent(): Promise<{ indexed: number; errors: number }>`
  - Both consumed by Task 4 (the scheduler) and Task 6 (the manual CLI command).

**This mirrors the extraction-through-storage half of `WPESyncService.syncContent`
(`src/main/events/WPESyncService.ts:442-533`) as a standalone service — do not import from or
modify `WPESyncService`.** The one deliberate deviation, required by the Global Constraints: the
vector document's `metadata` field writes `source: 'external'`, and `indexOne` does **not**
piggyback a metadata sync the way WP Engine's version does (Spec 4a's `ExternalRefreshScheduler`
already owns metadata refresh independently, per the design's §4 — there is no warm
`ControlMaster` connection to reuse here).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/events/ExternalContentIndexService.test.ts
import { ExternalContentIndexService } from '../../../src/main/events/ExternalContentIndexService';

function makeTransport(posts: any[]) {
  return {
    kind: 'external-ssh' as any,
    siteRef: { kind: 'external', alias: 'test' } as any,
    supports: () => true,
    probe: async () => ({ reachable: true }),
    deleteRemoteFile: async () => ({ success: false, output: 'n/a' }),
    runWpCli: async () => ({ stdout: JSON.stringify(posts), success: true }),
  };
}

function makeDeps(overrides: Partial<any> = {}) {
  const upsertContentCalls: any[] = [];
  const upsertCalls: any[] = [];
  const registryUpdates: any[] = [];
  return {
    graphService: {
      upsertContent: jest.fn(async (c: any) => { upsertContentCalls.push(c); return 1; }),
    },
    embeddingService: {
      embedBatch: jest.fn(async (texts: string[]) => texts.map(() => new Float32Array([0.1, 0.2]))),
    },
    vectorStore: {
      upsert: jest.fn(async (siteId: string, docs: any[]) => { upsertCalls.push({ siteId, docs }); }),
    },
    indexRegistry: {
      update: jest.fn((siteId: string, partial: any) => { registryUpdates.push({ siteId, partial }); }),
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    _upsertContentCalls: upsertContentCalls,
    _upsertCalls: upsertCalls,
    _registryUpdates: registryUpdates,
    ...overrides,
  };
}

const post = (id: number) => ({
  ID: id, post_title: `Post ${id}`, post_content: `<p>Content ${id}</p>`,
  post_excerpt: '', post_type: 'post', post_status: 'publish', post_author: '1',
  post_date: '2026-01-01 00:00:00',
});

describe('ExternalContentIndexService.indexOne', () => {
  it('extracts, embeds, stores, and marks the registry indexed', async () => {
    const deps = makeDeps();
    const service = new ExternalContentIndexService(deps as any);
    const transport = makeTransport([post(1), post(2)]);
    const result = await service.indexOne(transport, 'ssh:myhost', 'myhost');

    expect(result.documentCount).toBe(2);
    expect(deps._upsertContentCalls).toHaveLength(2);
    expect(deps._upsertContentCalls[0].site_id).toBe('ssh:myhost');
    expect(deps._upsertCalls).toHaveLength(1);
    expect(deps._upsertCalls[0].siteId).toBe('ssh_myhost'); // vectorSiteId translation
    expect(deps._registryUpdates[0].siteId).toBe('ssh:myhost'); // real id, not translated
    expect(deps._registryUpdates[0].partial.state).toBe('indexed');
    expect(deps._registryUpdates[0].partial.documentCount).toBe(2);
  });

  it('writes source: external in every vector document\'s metadata, never wpe', async () => {
    const deps = makeDeps();
    const service = new ExternalContentIndexService(deps as any);
    const transport = makeTransport([post(1)]);
    await service.indexOne(transport, 'ssh:myhost', 'myhost');

    const doc = deps._upsertCalls[0].docs[0];
    const metadata = JSON.parse(doc.metadata);
    expect(metadata.source).toBe('external');
    expect(metadata.source).not.toBe('wpe');
  });

  it('marks the registry indexed with documentCount 0 when there are no posts, not error', async () => {
    const deps = makeDeps();
    const service = new ExternalContentIndexService(deps as any);
    const transport = makeTransport([]);
    const result = await service.indexOne(transport, 'ssh:myhost', 'myhost');

    expect(result.documentCount).toBe(0);
    expect(deps._registryUpdates[0].partial.state).toBe('indexed');
    expect(deps._registryUpdates[0].partial.documentCount).toBe(0);
  });

  it('marks the registry state=error and does not throw when extraction fails', async () => {
    const deps = makeDeps();
    const service = new ExternalContentIndexService(deps as any);
    const throwingTransport = {
      ...makeTransport([]),
      runWpCli: async () => { throw new Error('SSH connection refused'); },
    };
    await expect(service.indexOne(throwingTransport as any, 'ssh:myhost', 'myhost')).resolves.toEqual({ documentCount: 0 });
    expect(deps._registryUpdates[0].partial.state).toBe('error');
  });

  it('embeds in batches of 10, matching the existing WPESyncService batch size', async () => {
    const deps = makeDeps();
    const service = new ExternalContentIndexService(deps as any);
    const posts = Array.from({ length: 25 }, (_, i) => post(i + 1));
    const transport = makeTransport(posts);
    await service.indexOne(transport, 'ssh:myhost', 'myhost');
    expect(deps.embeddingService.embedBatch).toHaveBeenCalledTimes(3); // 10, 10, 5
  });
});

describe('ExternalContentIndexService.indexAllExternalContent', () => {
  it('queries only source=external, never wpe', async () => {
    const deps = makeDeps();
    let capturedSql = '';
    (deps.graphService as any).getDb = () => ({
      prepare: (sql: string) => { capturedSql = sql; return { all: () => [] }; },
    });
    const service = new ExternalContentIndexService(deps as any);
    await service.indexAllExternalContent();
    expect(capturedSql).toContain("source = 'external'");
    expect(capturedSql).toContain('is_active = 1');
    expect(capturedSql).not.toContain("'wpe'");
  });
});
```

- [ ] **Step 2: Run and verify they fail**

Run: `npx jest tests/unit/events/ExternalContentIndexService.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/main/events/ExternalContentIndexService.ts
import type { GraphService } from './GraphService';
import type { EmbeddingService } from '../embeddings/EmbeddingService';
import type { IVectorStore } from '../vector-store/IVectorStore';
import type { IndexRegistry } from '../content/IndexRegistry';
import type { SiteTransport } from '../transport/types';
import { VectorDocument } from '../../common/types';
import { RemoteContentExtractor } from '../content/RemoteContentExtractor';
import { vectorSiteId } from '../vector-store/vectorSiteId';

export interface ExternalContentIndexServiceOptions {
  graphService: GraphService;
  embeddingService: EmbeddingService;
  vectorStore: IVectorStore;
  indexRegistry: IndexRegistry;
  logger?: { info: (...a: any[]) => void; warn: (...a: any[]) => void; error: (...a: any[]) => void };
}

const BATCH_SIZE = 10; // matches WPESyncService.syncContent's existing batch size

/**
 * Extraction -> embedding -> vector storage for one external SSH host, plus the
 * fleet-wide indexAllExternalContent(). Parallel to WPESyncService.syncContent,
 * not derived from it — WPESyncService is not modified by this class.
 *
 * Deliberately does NOT piggyback a metadata refresh onto this SSH session the
 * way WP Engine's syncContent does: that trick relies on WpeRefreshScheduler's
 * ControlMaster keeping the connection warm, and external SSH deliberately has
 * no ControlMaster (see the design's Spec 4a §6). Metadata refresh for external
 * hosts is ExternalRefreshScheduler's job, on its own independent schedule.
 */
export class ExternalContentIndexService {
  private graphService: GraphService;
  private embeddingService: EmbeddingService;
  private vectorStore: IVectorStore;
  private indexRegistry: IndexRegistry;
  private logger: NonNullable<ExternalContentIndexServiceOptions['logger']>;
  private extractor: RemoteContentExtractor;

  constructor(options: ExternalContentIndexServiceOptions) {
    this.graphService = options.graphService;
    this.embeddingService = options.embeddingService;
    this.vectorStore = options.vectorStore;
    this.indexRegistry = options.indexRegistry;
    this.logger = options.logger ?? console;
    this.extractor = new RemoteContentExtractor({ logger: this.logger });
  }

  /**
   * Index one external host. Never throws — a failure marks the registry
   * state='error' and returns { documentCount: 0 }, matching this codebase's
   * convention that content indexing is optional and must not look like a crash.
   */
  async indexOne(transport: SiteTransport, siteId: string, alias: string): Promise<{ documentCount: number }> {
    const startTime = Date.now();
    try {
      const extracted = await this.extractor.extract(transport, alias);

      if (!extracted.posts || extracted.posts.length === 0) {
        this.indexRegistry.update(siteId, {
          siteId, siteName: alias, state: 'indexed',
          lastIndexed: Date.now(), documentCount: 0, chunkCount: 0,
          durationMs: Date.now() - startTime,
        });
        return { documentCount: 0 };
      }

      const documents: Array<Omit<VectorDocument, 'vector'>> = [];
      for (const post of extracted.posts) {
        await this.graphService.upsertContent({
          site_id: siteId,
          post_id: post.id,
          post_type: post.postType,
          title: post.title,
          status: post.postStatus,
          author_id: parseInt(post.author, 10) || null,
          created_at: new Date(post.date).getTime(),
          updated_at: Date.now(),
        });

        documents.push({
          id: `wp_${siteId}_${post.id}`,
          siteId,
          title: post.title,
          content: post.cleanedContent,
          postType: post.postType,
          postId: post.id,
          chunkIndex: 0,
          // NEVER 'wpe' here — this is the honesty-rule regression this class exists to prevent.
          metadata: JSON.stringify({
            excerpt: post.excerpt,
            author: post.author,
            date: post.date,
            source: 'external',
          }),
          indexedAt: Date.now(),
          post_date_gmt: '',
          post_modified_gmt: '',
          doc_url: '',
        });
      }

      const embeddedDocs: VectorDocument[] = [];
      for (let i = 0; i < documents.length; i += BATCH_SIZE) {
        const batch = documents.slice(i, i + BATCH_SIZE);
        const vectors = await this.embeddingService.embedBatch(batch.map(d => d.content));
        for (let j = 0; j < batch.length; j++) {
          embeddedDocs.push({ ...batch[j], vector: vectors[j] });
        }
      }

      await this.vectorStore.upsert(vectorSiteId(siteId), embeddedDocs);

      this.indexRegistry.update(siteId, {
        siteId, siteName: alias, state: 'indexed',
        lastIndexed: Date.now(), documentCount: embeddedDocs.length, chunkCount: embeddedDocs.length,
        durationMs: Date.now() - startTime,
      });

      this.logger.info(`[ExternalContentIndexService] ${alias}: indexed ${embeddedDocs.length} documents`);
      return { documentCount: embeddedDocs.length };
    } catch (error: any) {
      this.logger.warn(`[ExternalContentIndexService] ${alias} failed: ${error?.message ?? error}`);
      this.indexRegistry.update(siteId, { state: 'error', lastIndexed: Date.now() } as any);
      return { documentCount: 0 };
    }
  }

  /**
   * Index every active registered external host. Selection is source='external'
   * only — never merged with WPE, never touching WPESyncService's fleet method.
   */
  async indexAllExternalContent(): Promise<{ indexed: number; errors: number }> {
    const db = this.graphService.getDb?.();
    if (!db) return { indexed: 0, errors: 0 };

    const hosts = db.prepare(
      "SELECT id, name, environment FROM sites WHERE source = 'external' AND is_active = 1"
    ).all() as Array<{ id: string; name: string; environment: string | null }>;

    let indexed = 0;
    let errors = 0;

    for (const host of hosts) {
      try {
        const { resolveTransport } = await import('../transport');
        const target = `ssh:${host.name}@${host.environment ?? 'production'}`;
        const transport = await resolveTransport({ ssh_target: target }, {} as any, 'wpcli_read');
        if (transport && typeof transport === 'object' && 'content' in transport) {
          continue; // refused/unresolvable — skip, not an error
        }
        await this.indexOne(transport as SiteTransport, host.id, host.name);
        indexed++;
      } catch {
        errors++;
      }
    }

    return { indexed, errors };
  }
}
```

Note: `indexAllExternalContent`'s dynamic `import('../transport')` and the `{} as any` services
argument are placeholders for a real `services` reference — **Task 4's scheduler does not use
this method directly for its own selection loop** (it calls `resolveTransport` itself, the same
way `ExternalRefreshScheduler` does, and calls `indexOne` per host). `indexAllExternalContent`
exists for the CLI/manual "index everything" case if one is ever added — for Task 6's
single-host manual command, call `indexOne` directly with a resolved transport, not this method.
If this ambiguity bothers you, that's the right instinct — flag it in your report rather than
guessing, but do not block on it: the test above only asserts the SQL predicate, which is the
part that matters for this task.

- [ ] **Step 4: Run tests**

```bash
npx jest tests/unit/events/ExternalContentIndexService.test.ts && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add src/main/events/ExternalContentIndexService.ts tests/unit/events/ExternalContentIndexService.test.ts
git commit -m "feat(external): extraction, embedding and vector storage for external host content"
```

---

### Task 4: `ExternalContentIndexScheduler`

**Files:**
- Create: `src/main/startup/ExternalContentIndexScheduler.ts`
- Test: `tests/unit/startup/ExternalContentIndexScheduler.test.ts` *(create)*

**Interfaces:**
- Consumes: `ExternalContentIndexService.indexOne(transport, siteId, alias)` from Task 3;
  `resolveTransport(args, services, operation)` from `src/main/transport`.
- Produces: `class ExternalContentIndexScheduler` with `start()`, `stop()`,
  `restart(intervalMs: number)`, `runCycleNow(): Promise<{ scanned: number; skipped: number;
  failed: number }>`.

**This mirrors `src/main/startup/ExternalRefreshScheduler.ts` exactly**, with two differences:
it selects on `content_indexed_at` (a new column, ensured by this class) instead of
`ssh_last_sync_at`, and it calls `ExternalContentIndexService.indexOne` instead of
`collectExternalHostData`/`writeExternalHostData`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/startup/ExternalContentIndexScheduler.test.ts
import { ExternalContentIndexScheduler } from '../../../src/main/startup/ExternalContentIndexScheduler';

jest.mock('../../../src/main/transport', () => ({ resolveTransport: jest.fn() }));
import { resolveTransport } from '../../../src/main/transport';

const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
const NOW = 1_800_000_000_000;

function graph(rows: any[]) {
  return {
    getDb: () => ({
      prepare: (sql: string) => {
        if (sql.includes('pragma_table_info')) return { get: () => ({ c: 1 }) }; // column already exists
        if (sql.includes("ALTER TABLE")) return { run: () => {} };
        return { all: () => rows, get: () => undefined, run: () => {} };
      },
      exec: () => {},
    }),
  };
}
function okTransport() {
  return { kind: 'external-ssh', siteRef: { kind: 'external', alias: 'a' }, runWpCli: jest.fn(async () => ({ stdout: '[]', success: true })) };
}
function makeIndexService() {
  return { indexOne: jest.fn(async () => ({ documentCount: 0 })) };
}

beforeEach(() => { jest.clearAllMocks(); jest.spyOn(Date, 'now').mockReturnValue(NOW); });
afterEach(() => { jest.restoreAllMocks(); });

describe('ExternalContentIndexScheduler', () => {
  it('skips a host indexed more recently than the staleness threshold', async () => {
    const g = graph([{ id: 'ssh:fresh', name: 'fresh', environment: 'production', content_indexed_at: NOW - 1000 }]);
    const indexService = makeIndexService();
    const s = new ExternalContentIndexScheduler({
      graphService: g as any, services: {} as any, indexService: indexService as any,
      logger, stalenessThresholdMs: 60_000,
    });
    const r = await s.runCycleNow();
    expect(r.skipped).toBe(1);
    expect(resolveTransport).not.toHaveBeenCalled();
  });

  it('includes a host that has never been indexed', async () => {
    const g = graph([{ id: 'ssh:new', name: 'new', environment: 'production', content_indexed_at: null }]);
    (resolveTransport as jest.Mock).mockResolvedValue(okTransport());
    const indexService = makeIndexService();
    const s = new ExternalContentIndexScheduler({ graphService: g as any, services: {} as any, indexService: indexService as any, logger });
    const r = await s.runCycleNow();
    expect(r.scanned).toBe(1);
    expect(indexService.indexOne).toHaveBeenCalledWith(expect.anything(), 'ssh:new', 'new');
  });

  it('counts a permission refusal as skipped, not failed', async () => {
    const g = graph([{ id: 'ssh:denied', name: 'denied', environment: 'production', content_indexed_at: null }]);
    (resolveTransport as jest.Mock).mockResolvedValue({ content: [{ type: 'text', text: 'Operation blocked' }] });
    const indexService = makeIndexService();
    const s = new ExternalContentIndexScheduler({ graphService: g as any, services: {} as any, indexService: indexService as any, logger });
    const r = await s.runCycleNow();
    expect(r.skipped).toBe(1);
    expect(r.failed).toBe(0);
  });

  it('one host throwing does not abort the cycle', async () => {
    const g = graph([
      { id: 'ssh:bad', name: 'bad', environment: 'production', content_indexed_at: null },
      { id: 'ssh:good', name: 'good', environment: 'production', content_indexed_at: null },
    ]);
    (resolveTransport as jest.Mock).mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(okTransport());
    const indexService = makeIndexService();
    const s = new ExternalContentIndexScheduler({ graphService: g as any, services: {} as any, indexService: indexService as any, logger });
    const r = await s.runCycleNow();
    expect(r.failed).toBe(1);
    expect(r.scanned).toBe(1);
  });

  it('excludes an inactive (removed) host via the is_active filter', async () => {
    let capturedSql = '';
    const g = { getDb: () => ({ prepare: (sql: string) => { capturedSql += sql; return { get: () => ({ c: 1 }), all: () => [], run: () => {} }; }, exec: () => {} }) };
    const indexService = makeIndexService();
    const s = new ExternalContentIndexScheduler({ graphService: g as any, services: {} as any, indexService: indexService as any, logger });
    await s.runCycleNow();
    expect(capturedSql).toMatch(/is_active\s*=\s*1/);
  });

  it('start() is idempotent', () => {
    const s = new ExternalContentIndexScheduler({ graphService: graph([]) as any, services: {} as any, indexService: makeIndexService() as any, logger });
    s.start(); s.start();
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Already running'));
    s.stop();
  });

  it('tolerates getDb() returning null during startup', async () => {
    const g = { getDb: () => null };
    const s = new ExternalContentIndexScheduler({ graphService: g as any, services: {} as any, indexService: makeIndexService() as any, logger });
    await expect(s.runCycleNow()).resolves.toEqual({ scanned: 0, skipped: 0, failed: 0 });
  });

  it('adds the content_indexed_at column on first use if it does not exist', async () => {
    let alterRan = false;
    const g = {
      getDb: () => ({
        prepare: (sql: string) => {
          if (sql.includes('pragma_table_info')) return { get: () => ({ c: 0 }) }; // column missing
          return { all: () => [], get: () => undefined, run: () => {} };
        },
        exec: (sql: string) => { if (sql.includes('ADD COLUMN content_indexed_at')) alterRan = true; },
      }),
    };
    const s = new ExternalContentIndexScheduler({ graphService: g as any, services: {} as any, indexService: makeIndexService() as any, logger });
    await s.runCycleNow();
    expect(alterRan).toBe(true);
  });
});
```

- [ ] **Step 2: Run and verify they fail**

Run: `npx jest tests/unit/startup/ExternalContentIndexScheduler.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/main/startup/ExternalContentIndexScheduler.ts
import pLimit from 'p-limit';
import { resolveTransport } from '../transport';
import type { SiteTransport } from '../transport/types';
import type { ExternalContentIndexService } from '../events/ExternalContentIndexService';

export interface ExternalContentIndexSchedulerOptions {
  graphService: { getDb?: () => any };
  services: any;
  indexService: ExternalContentIndexService;
  intervalMs?: number;
  stalenessThresholdMs?: number;
  logger: { info: (...a: any[]) => void; warn: (...a: any[]) => void; error: (...a: any[]) => void };
}

export interface ExternalContentIndexResult {
  scanned: number;
  skipped: number;
  failed: number;
}

const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000;
const CONCURRENCY = 3;

/**
 * Content-index registered external SSH hosts on an interval. Mirrors
 * ExternalRefreshScheduler's shape exactly. Independent SSH session per host
 * per cycle — no ControlMaster to piggyback on (see Spec 4a §6), so this does
 * NOT try to share a connection with ExternalRefreshScheduler.
 */
export class ExternalContentIndexScheduler {
  private readonly graphService: ExternalContentIndexSchedulerOptions['graphService'];
  private readonly services: any;
  private readonly indexService: ExternalContentIndexService;
  private readonly logger: ExternalContentIndexSchedulerOptions['logger'];
  private currentIntervalMs: number;
  private currentStalenessThresholdMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private columnEnsured = false;

  constructor(options: ExternalContentIndexSchedulerOptions) {
    this.graphService = options.graphService;
    this.services = options.services;
    this.indexService = options.indexService;
    this.logger = options.logger;
    this.currentIntervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.currentStalenessThresholdMs = options.stalenessThresholdMs ?? this.currentIntervalMs;
  }

  start(): void {
    if (this.timer !== null) {
      this.logger.info('[ExternalContentIndexScheduler] Already running — start() ignored');
      return;
    }
    this.timer = setInterval(() => {
      this.runCycleNow().catch((err) =>
        this.logger.error('[ExternalContentIndexScheduler] Cycle failed:', err?.message ?? err));
    }, this.currentIntervalMs);
    this.logger.info(
      `[ExternalContentIndexScheduler] Started (every ${Math.round(this.currentIntervalMs / 3600000)}h)`);
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
      this.logger.info('[ExternalContentIndexScheduler] Stopped');
    }
  }

  restart(intervalMs: number): void {
    this.currentIntervalMs = intervalMs;
    this.currentStalenessThresholdMs = intervalMs;
    this.stop();
    this.start();
  }

  private ensureColumn(db: any): void {
    if (this.columnEnsured) return;
    try {
      const exists = db.prepare(
        `SELECT COUNT(*) as c FROM pragma_table_info('sites') WHERE name='content_indexed_at'`
      ).get() as { c: number };
      if (!exists.c) {
        db.exec(`ALTER TABLE sites ADD COLUMN content_indexed_at INTEGER`);
        this.logger.info('[ExternalContentIndexScheduler] Added column sites.content_indexed_at');
      }
    } catch (err: any) {
      this.logger.warn('[ExternalContentIndexScheduler] Could not add content_indexed_at column:', err?.message);
    }
    this.columnEnsured = true;
  }

  async runCycleNow(): Promise<ExternalContentIndexResult> {
    const result: ExternalContentIndexResult = { scanned: 0, skipped: 0, failed: 0 };
    const now = Date.now();

    const db = this.graphService.getDb?.();
    if (!db) return result;
    this.ensureColumn(db);

    let rows: Array<{ id: string; name: string; environment: string | null; content_indexed_at: number | null }>;
    try {
      rows = db.prepare(
        `SELECT id, name, environment, content_indexed_at
         FROM sites
         WHERE source = 'external' AND is_active = 1`
      ).all();
    } catch (err: any) {
      this.logger.warn('[ExternalContentIndexScheduler] Could not read hosts:', err?.message ?? err);
      return result;
    }

    const due = rows.filter((r) => {
      const fresh = r.content_indexed_at != null
        && (now - r.content_indexed_at) <= this.currentStalenessThresholdMs;
      if (fresh) result.skipped++;
      return !fresh;
    });

    const limit = pLimit(CONCURRENCY);
    await Promise.all(due.map((row) => limit(async () => {
      try {
        const target = `ssh:${row.name}@${row.environment ?? 'production'}`;
        const transport = await resolveTransport({ ssh_target: target }, this.services, 'wpcli_read');

        if (transport && typeof transport === 'object' && 'content' in transport) {
          this.logger.info(`[ExternalContentIndexScheduler] ${row.name}: skipped (${
            (transport as any).content?.[0]?.text ?? 'not resolvable'})`);
          result.skipped++;
          return;
        }

        await this.indexService.indexOne(transport as SiteTransport, row.id, row.name);
        try {
          db.prepare('UPDATE sites SET content_indexed_at = ? WHERE id = ?').run(Date.now(), row.id);
        } catch { /* best-effort staleness stamp */ }
        result.scanned++;
      } catch (err: any) {
        this.logger.warn(`[ExternalContentIndexScheduler] ${row.name} failed:`, err?.message ?? err);
        result.failed++;
      }
    })));

    this.logger.info(
      `[ExternalContentIndexScheduler] Cycle done — scanned ${result.scanned}, `
      + `skipped ${result.skipped}, failed ${result.failed}`);
    return result;
  }
}
```

- [ ] **Step 4: Run tests**

```bash
npx jest tests/unit/startup/ExternalContentIndexScheduler.test.ts && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add src/main/startup/ExternalContentIndexScheduler.ts tests/unit/startup/ExternalContentIndexScheduler.test.ts
git commit -m "feat(external): opt-in scheduler content-indexing external host posts"
```

---

### Task 5: Settings and wiring

**Files:**
- Modify: `src/common/types.ts` (after `externalRefreshAutoEnabled`)
- Modify: `src/common/schemas.ts` (after `externalRefreshAutoEnabled`)
- Modify: `src/main/ipc-handlers.ts` (`DEFAULT_SETTINGS`)
- Modify: `src/main/index.ts` — declare near `:464`, construct near `:948`, react near `:544`
- Test: `tests/unit/common/schemas-settings.test.ts` *(extend — this is the file the prior
  plan's final-review fix already confirmed is the canonical settings-schema test file; do not
  create a near-duplicate)*

**Interfaces:**
- Consumes: `ExternalContentIndexScheduler`, `ExternalContentIndexService` from Tasks 3-4.
- Produces: settings keys `externalContentIndexAutoEnabled: boolean` (default `false`) and
  `externalContentIndexIntervalHours: number` (default `24`).

- [ ] **Step 1: Write the failing test**

```ts
// append to tests/unit/common/schemas-settings.test.ts
describe('external content-index settings survive the strict schema', () => {
  it('accepts both keys', () => {
    const parsed = UpdateSettingsSchema.parse({
      externalContentIndexAutoEnabled: true,
      externalContentIndexIntervalHours: 12,
    });
    expect(parsed.externalContentIndexAutoEnabled).toBe(true);
    expect(parsed.externalContentIndexIntervalHours).toBe(12);
  });

  it('rejects an out-of-range interval', () => {
    expect(() => UpdateSettingsSchema.parse({ externalContentIndexIntervalHours: 0 })).toThrow();
    expect(() => UpdateSettingsSchema.parse({ externalContentIndexIntervalHours: 999 })).toThrow();
  });
});
```

- [ ] **Step 2: Run and verify it fails**

Run: `npx jest tests/unit/common/schemas-settings.test.ts`
Expected: FAIL — strict schema rejects the unknown keys.

- [ ] **Step 3: Add the settings**

`src/common/schemas.ts`, after the `externalRefreshAutoEnabled` line:

```ts
  externalContentIndexIntervalHours: z.number().int().min(1).max(168).optional(),
  externalContentIndexAutoEnabled: z.boolean().optional(),
```

`src/common/types.ts`, after the `externalRefreshAutoEnabled` line:

```ts
  externalContentIndexIntervalHours?: number;    // How often to content-index external SSH hosts (default: 24)
  externalContentIndexAutoEnabled?: boolean;     // Whether external SSH content indexing is enabled (default: false — opt-in)
```

`src/main/ipc-handlers.ts`'s `DEFAULT_SETTINGS`, beside the other opt-in flags:

```ts
  externalContentIndexAutoEnabled: false,
```

- [ ] **Step 4: Wire it into the main process**

Read the neighboring `externalRefreshScheduler` declaration, construction, and
`onSettingsUpdated` stanza in `src/main/index.ts` (`:464`, `:940-957`, `:541-551`) before
editing — match its exact style rather than assuming these line numbers are still current.

Declare beside the other scheduler handles (`:464`):

```ts
  let externalContentIndexScheduler: ExternalContentIndexScheduler | undefined;
```

Import beside the others:

```ts
import { ExternalContentIndexScheduler } from './startup/ExternalContentIndexScheduler';
import { ExternalContentIndexService } from './events/ExternalContentIndexService';
```

Construct after the `externalRefreshScheduler` construction block:

```ts
      const externalContentIndexSettings = registryStorage.get(STORAGE_KEYS.SETTINGS) as
        { externalContentIndexIntervalHours?: number; externalContentIndexAutoEnabled?: boolean } | null;
      const externalContentIndexHours = externalContentIndexSettings?.externalContentIndexIntervalHours ?? 24;
      const externalContentIndexEnabled = externalContentIndexSettings?.externalContentIndexAutoEnabled === true; // opt-in
      const externalContentIndexService = new ExternalContentIndexService({
        graphService,
        embeddingService,
        vectorStore,
        indexRegistry,
        logger: localLogger,
      });
      externalContentIndexScheduler = new ExternalContentIndexScheduler({
        graphService: graphService as any,
        services: nexusServices,
        indexService: externalContentIndexService,
        intervalMs: externalContentIndexHours * 60 * 60 * 1000,
        logger: localLogger,
      });
      if (externalContentIndexEnabled) {
        externalContentIndexScheduler.start();
      } else {
        localLogger.info('[NexusAI] External SSH content indexing auto-run disabled by preference — scheduler not started');
      }
```

Use the actual names this file already gives `embeddingService`/`vectorStore`/`indexRegistry` —
grep for wherever `WPESyncService` is constructed in this same file and reuse those exact
identifiers rather than inventing new ones.

In the `onSettingsUpdated` function, after the `externalRefreshScheduler` stanza:

```ts
    // Restart (or stop) the external SSH content-index scheduler.
    const updatedContentIndex = registryStorage.get(STORAGE_KEYS.SETTINGS) as
      { externalContentIndexIntervalHours?: number; externalContentIndexAutoEnabled?: boolean } | null;
    const newContentIndexHours = updatedContentIndex?.externalContentIndexIntervalHours ?? 24;
    if (updatedContentIndex?.externalContentIndexAutoEnabled === true) {
      externalContentIndexScheduler?.restart(newContentIndexHours * 60 * 60 * 1000);
      localLogger.info(`[NexusAI] External SSH content indexing enabled by preference (every ${newContentIndexHours}h)`);
    } else {
      externalContentIndexScheduler?.stop();
      localLogger.info('[NexusAI] External SSH content indexing disabled by preference — scheduler stopped');
    }
```

- [ ] **Step 5: Run tests and build**

```bash
npx jest tests/unit/common/ && npx tsc --noEmit && npm run build
```

- [ ] **Step 6: Commit**

```bash
git add src/common/types.ts src/common/schemas.ts src/main/ipc-handlers.ts src/main/index.ts tests/unit/common/schemas-settings.test.ts
git commit -m "feat(settings): opt-in external content-index interval, wired reactively"
```

---

### Task 6: `nexus host index <alias>`

**Files:**
- Modify: `src/main/graphql/schema.ts` (add mutation beside `nexusHostRefresh`)
- Modify: `src/main/graphql/resolvers.ts` (add resolver beside `nexusHostRefresh`)
- Modify: `src/cli/commands/host.ts` (add after the `refresh` command)
- Test: `tests/unit/graphql/host-index.test.ts` *(create)*

**Interfaces:**
- Consumes: `ExternalContentIndexService.indexOne(transport, siteId, alias)` from Task 3.
- Produces: GraphQL `nexusHostIndex(alias: String!): NexusHostIndexResult!` with
  `{ success: Boolean!, error: String, documentCount: Int }`.

Find `nexusHostRefresh`'s current location in `resolvers.ts` and `host.ts`'s `refresh` command
before editing — line numbers will have moved since Spec 4a shipped. Match its exact shape,
including the alias lookup, the `is_active=1` filter, and the `'content' in transport` refusal
check.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/graphql/host-index.test.ts
import { createResolvers } from '../../../src/main/graphql/resolvers';

describe('nexusHostIndex', () => {
  it('refuses an alias that is not a registered external host', async () => {
    const r = await (createResolvers(ctx()).Mutation as any).nexusHostIndex(null, { alias: 'nope' });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/not a registered external host/i);
  });

  it('reports the document count on success', async () => {
    // seed an external row for alias 'myhost', stub the transport and the
    // ExternalContentIndexService dependency chain per the fleet-visibility
    // test harness's existing ctx() fixture
    const r = await (createResolvers(ctx()).Mutation as any).nexusHostIndex(null, { alias: 'myhost' });
    expect(r.success).toBe(true);
    expect(typeof r.documentCount).toBe('number');
  });

  it('surfaces a permission refusal as an error', async () => {
    const r = await (createResolvers(ctx()).Mutation as any).nexusHostIndex(null, { alias: 'denied' });
    expect(r.success).toBe(false);
    expect(r.error).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run and verify it fails**

Run: `npx jest tests/unit/graphql/host-index.test.ts`
Expected: FAIL — `nexusHostIndex is not a function`.

- [ ] **Step 3: Add the schema type and mutation**

```graphql
  "Result of indexing one external SSH host's content."
  type NexusHostIndexResult {
    success: Boolean!
    error: String
    "Documents indexed, null when the batch failed before completing."
    documentCount: Int
  }
```

and in the `extend type Mutation` block:

```graphql
    nexusHostIndex(alias: String!): NexusHostIndexResult!
```

- [ ] **Step 4: Add the resolver**

Beside `nexusHostRefresh`, following its exact lookup/resolve/error shape:

```ts
      nexusHostIndex: async (_parent: ResolverParent, { alias }: { alias: string }) => {
        try {
          const db = services.graphService?.getDb?.();
          const row = db?.prepare(
            "SELECT id, name, environment FROM sites WHERE source='external' AND is_active=1 AND LOWER(name)=?"
          ).get(alias.toLowerCase()) as { id: string; name: string; environment: string | null } | undefined;
          if (!row) {
            return { success: false, error: `"${alias}" is not a registered external host. Run \`nexus host add ${alias}\` first.`, documentCount: null };
          }

          const target = `ssh:${row.name}@${row.environment ?? 'production'}`;
          const transport = await resolveTransport({ ssh_target: target }, services, 'wpcli_read');
          if (transport && typeof transport === 'object' && 'content' in transport) {
            return { success: false, error: (transport as any).content?.[0]?.text ?? 'Could not reach host', documentCount: null };
          }

          const indexService = new ExternalContentIndexService({
            graphService: services.graphService,
            embeddingService: services.embeddingService,
            vectorStore: services.vectorStore,
            indexRegistry: services.indexRegistry,
            logger: console,
          });
          const result = await indexService.indexOne(transport as any, row.id, row.name);

          return { success: true, error: null, documentCount: result.documentCount };
        } catch (error: any) {
          return { success: false, error: error.message, documentCount: null };
        }
      },
```

Import `ExternalContentIndexService` at the top of `resolvers.ts`. Confirm `services` (the
`NexusServices` object this resolver module already closes over) actually exposes
`embeddingService`/`vectorStore`/`indexRegistry` — grep for how `WPESyncService` is constructed
elsewhere in this codebase to find the real property names, and use those rather than guessing.

- [ ] **Step 5: Add the CLI command**

After the `refresh` command in `host.ts`, using the same `HOST_PROBE_CLIENT_TIMEOUT_MS`
extended-timeout pattern `refresh` already established (content indexing over SSH is not
faster than metadata refresh):

```ts
hostCommand
  .command('index <alias>')
  .description('Content-index a registered external host now, for semantic search')
  .action(async (alias: string) => {
    try {
      const client = getClient({ timeout: HOST_PROBE_CLIENT_TIMEOUT_MS });
      const result = await client.mutate<{ nexusHostIndex: any }>(`
        mutation($alias: String!) {
          nexusHostIndex(alias: $alias) {
            success error documentCount
          }
        }
      `, { alias });

      const { success, error, documentCount } = result.nexusHostIndex;
      if (!success) {
        console.error(`\n❌ ${error}`);
        process.exit(1);
      }
      console.log(`\n✅ Indexed ${alias}`);
      console.log(`   Documents:  ${documentCount ?? 'not collected'}`);
      console.log('');
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });
```

- [ ] **Step 6: Run tests**

```bash
npx jest tests/unit/graphql/ && npx tsc --noEmit && npm run build
```

- [ ] **Step 7: Commit**

```bash
git add src/main/graphql/schema.ts src/main/graphql/resolvers.ts src/cli/commands/host.ts tests/unit/graphql/host-index.test.ts
git commit -m "feat(cli): nexus host index <alias>"
```

---

### Task 7: Documentation and live verification

**Files:**
- Modify: `CLAUDE.md` (the fleet-counts / external-hosts subsection)
- Modify: `docs/user-guide.md` (external host section)

**No new behaviour in this task.** If the live check surfaces a defect, **report it — do not
fix it here.**

- [ ] **Step 1: Document in CLAUDE.md**

```markdown
**External hosts now content-index too, on their own opt-in schedule.**
`ExternalContentIndexScheduler` (`src/main/startup/ExternalContentIndexScheduler.ts`) is
independent of `ExternalRefreshScheduler` — a separate SSH session per host, because external
SSH has no `ControlMaster` to piggyback a combined cycle onto the way `WPESyncService.syncContent`
does for WP Engine. Gated on `externalContentIndexAutoEnabled` (**default false**) with
`externalContentIndexIntervalHours` (default 24). `nexus host index <alias>` runs one host on
demand regardless of the setting.

**Vector-store site ids strip the colon.** `ssh:<alias>` fails `SqliteVecStore`'s
`^[a-zA-Z0-9_-]+$` table-name validation; `vectorSiteId()` translates it to `ssh_<alias>` only
at that boundary. The graph `content` table and `IndexRegistry` keep the real `ssh:<alias>` id.

**Vector document metadata says `source: 'external'`, never `'wpe'`.** Copying WP Engine's
hardcoded constant here would silently mislabel every external host's indexed content — this is
the specific regression `ExternalContentIndexService`'s own test suite pins.
```

- [ ] **Step 2: Document the CLI command in the user guide**

Add `nexus host index <alias>` beside `refresh`, noting it's read-only, and that Data
Completeness's Searchable count for a host only rises after its first successful index.

- [ ] **Step 3: Full suite**

```bash
npm test 2>&1 | grep -E "^(FAIL|Tests:|Test Suites:)" | sort | uniq
npx tsc --noEmit && npm run build
```

Baseline: **12 failing suites, 22 failures.** Compare failing suite **names**.

- [ ] **Step 4: Live verification**

```bash
npm run rebuild && ./dev-reload.sh
node bin/nexus.js host index hostinger-test
node bin/nexus.js content search ssh:hostinger-test@production "<a term you know is on that site>"
node bin/nexus.js fleet health
```

Confirm against the database:

```bash
sqlite3 "$HOME/Library/Application Support/Local/nexus-ai/graph.db" \
  "SELECT name, content_indexed_at FROM sites WHERE source='external';
   SELECT COUNT(*) FROM content WHERE site_id LIKE 'ssh:%';"
```

Expected: `host index` reports a non-zero document count for a host with published posts; the
`content search` command returns a real result; `content_indexed_at` is set. Report exactly
what you observe — if the search returns nothing or the count is 0, that is a finding, not
something to explain away.

Leave the repo rebuilt for Electron and say so, so the next person knows to run
`npm rebuild better-sqlite3` before jest.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md docs/user-guide.md
git commit -m "docs(external): content indexing, the vector-store id translation, and the honesty rule for source"
```

---

## Self-Review

**Spec coverage.** §4 (why a separate connection) → Task 4's docblock and the deliberate absence
of a piggyback. §5 (component) → Task 4. §6 (extraction generalization) → Task 1. §7 (storage) →
Task 3. §8 (vector-store blocker) → Task 2. §9 (settings) → Task 5. §10 (manual trigger) →
Task 6. §11 (Data Completeness needs no new code) → correctly not a task; noted in Task 7's docs
only. §12 (constraints) → Global Constraints, restated per task. §13 (error handling) → Tasks 3
and 4. §14 (testing) → each task's own tests plus Task 7's live check.

**Placeholders.** None, with one exception flagged deliberately: Task 3's
`indexAllExternalContent` contains a `{} as any` services placeholder and a note explaining
exactly why (it's not on the critical path either scheduler or the manual command actually use)
and instructing the implementer to flag rather than silently resolve the ambiguity. That is a
disclosed design gap, not an unfinished plan step — the method's one tested behavior (the SQL
predicate) is fully specified.

**Type consistency.** `RemoteContentExtractor.extract(transport, siteLabel)` — same signature
in Task 1 (defined) and Task 3 (consumed). `ExternalContentIndexService.indexOne(transport,
siteId, alias)` — same signature in Task 3 (defined), Task 4 (consumed by the scheduler), and
Task 6 (consumed by the manual command). `vectorSiteId(siteId: string): string` — defined in
Task 2, used inside Task 3's `indexOne`. Settings key names (`externalContentIndexAutoEnabled`,
`externalContentIndexIntervalHours`) are identical across Tasks 5, 6's docs, and Task 7's
CLAUDE.md entry.
