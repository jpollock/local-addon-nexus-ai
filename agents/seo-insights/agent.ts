import { defineAgent, cron } from '@nexus-ai/agent-sdk';

// Buffer is a Node.js global — not in lib.es2020 typings but always present at agent runtime.
// eslint-disable-next-line no-var
declare var Buffer: {
  from(str: string, encoding: string): { buffer: ArrayBufferLike; byteOffset: number; byteLength: number };
};

// ---------------------------------------------------------------------------
// NexusToolProvider.invoke() contract (F7-SDK: undocumented in types.ts):
//   - Returns parsed JSON when tool output is valid JSON (e.g. wp_eval JSON echo)
//   - Returns raw string when tool output is not JSON (e.g. get_index_status markdown)
//   - Throws Error when isError: true
// ---------------------------------------------------------------------------

type SiteRow = { id: string; name: string; source: string; ssh_last_sync_at: string | null; post_count: string };
type PostRecord = { ID: number; post_title: string; post_name: string; post_date: string; post_modified: string; post_type: string; post_content?: string };

type CheckIndexHealthArgs   = { siteId: string; staleThresholdHours?: number };
type InventoryContentArgs   = { siteId: string; postTypes?: string[]; limit?: number };
type FindStructuralArgs     = { siteId: string; staleThresholdDays?: number };
type TopicMapArgs           = { siteId: string; clusters?: number };
type OverlapArgs            = { siteId: string; threshold?: number };
type RefreshWpeArgs         = { installName: string };
type PullToLocalArgs        = { installName: string; localSiteName: string; includeDatabase?: boolean };

// ---------------------------------------------------------------------------
// Log-analysis types — mirrors DayAggregate from log-processor/access-logs.ts
// (inlined here so seo-insights never imports from log-processor modules)
// ---------------------------------------------------------------------------
type BotAgg = { hits: number; statuses: Record<string, number>; topPaths: Record<string, number> };
type DayAggregate = {
  v: 1;
  taxonomyVersion: string;
  site: string;
  day: string;
  skippedLines: number;
  requests: number;
  byClass: Record<string, number>;
  byStatus: Record<string, number>;
  aiTraining: Record<string, BotAgg>;
  aiRetrieval: Record<string, BotAgg>;
  searchBots: Record<string, BotAgg>;
  referrals: { search: Record<string, number>; ai: Record<string, number>; other: number; internal: number; spoofed: number };
  notFound: { scanner: number; contentLike: Record<string, number> };
  attack: {
    requests: number;
    authAttack: Record<string, { loginPosts: Record<string, number>; xmlrpcPosts: Record<string, number> }>;
    enumeration: { userRestApi: Record<string, number>; authorScan: Record<string, number>; restRouteBypass: Record<string, number> };
    probes: Record<string, { hits: number; statuses: Record<string, number> }>;
    ipCardinality: { distinct: number; histogram: { '1': number; '2-5': number; '6-20': number; '21+': number } };
  };
};

// ---------------------------------------------------------------------------
// Date helpers — inlined (NOT imported from log-processor modules)
// ---------------------------------------------------------------------------
function addDays(day: string, n: number): string {
  const d = new Date(day + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function utcToday(): string { return new Date().toISOString().slice(0, 10); }

type ToolInvoker = { invoke(name: string, args: unknown): Promise<unknown> };

// ---------------------------------------------------------------------------
// State keys — per-site / per-property. Agent-global keys meant that on a fleet,
// binding site B's GSC property silently redirected site A's demand analysis.
// ---------------------------------------------------------------------------
// Tunables
const ANALYSIS_COOLDOWN_MS = 6 * 3600 * 1000;   // per-site; blocks background wpe:sync spam
const CRON_MAX_SITES = 5;                        // sites per scheduled run
const TOPIC_CLUSTERS = 10;                       // default k for the report's topical map

const gscPropertyKey = (siteId: string) => `gscProperty:${siteId}`;
const intentCacheKey = (property: string) => `intentCache:${property}`;
const inventoryKey   = (siteId: string) => `inventory:${siteId}`;
const cooldownKeyFor = (siteId: string) => `analyzed:${siteId}`;

/** Soft check that a GSC property plausibly belongs to a site — warn, never block. */
function propertySiteMismatch(property: string, siteId: string): boolean {
  const host = property.replace(/^sc-domain:/, '').replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  const hostLabel = (host.split('.')[0] ?? '').toLowerCase();
  if (!hostLabel) return false;
  const site = siteId.toLowerCase();
  return !site.includes(hostLabel) && !hostLabel.includes(site.replace(/[^a-z0-9]+/g, ''));
}

/** Parse get_log_aggregates result regardless of whether NexusToolProvider auto-parsed it. */
function parseLogAggregates(raw: unknown): { aggregates: Record<string, DayAggregate>; missingDaysNote?: string } | null {
  if (!raw) return null;
  // Already parsed by NexusToolProvider
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = raw as any;
  if (r && typeof r === 'object' && ('aggregates' in r || 'siteId' in r)) return r;
  // Wrapped in MCP content envelope
  const text = typeof r === 'string' ? r : r?.content?.[0]?.text as string | undefined;
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getLogInsights(siteId: string, tools: ToolInvoker, log: any): Promise<string | null> {
  const today = utcToday();
  const from = addDays(today, -30);

  let rawResult: unknown;
  try {
    rawResult = await tools.invoke('get_log_aggregates', { siteId, from, to: today });
  } catch {
    log.info(`[LOG] get_log_aggregates unavailable for ${siteId} — skipping traffic intelligence`);
    return null;
  }

  // NexusToolProvider auto-parses JSON responses — rawResult may be the parsed object
  // directly, or wrapped in { content: [{ text: '...' }] } (F7-SDK)
  let parsed: { aggregates?: Record<string, DayAggregate>; missingDays?: string[] };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = rawResult as any;
  if (raw && typeof raw === 'object' && ('aggregates' in raw || 'siteId' in raw)) {
    parsed = raw;
  } else {
    const text = typeof raw === 'string' ? raw : raw?.content?.[0]?.text as string | undefined;
    if (!text) return null;
    try { parsed = JSON.parse(text); } catch { return null; }
  }

  const aggregates = Object.values(parsed.aggregates ?? {});
  const coverage = aggregates.length;
  if (coverage === 0) {
    return `\n## Traffic Intelligence\n\nNo access log data for **${siteId}** — connect this site via the Log Processor agent for traffic insights.\n`;
  }

  const missingNote = parsed.missingDays?.length
    ? ` *(based on ${coverage} of 30 days — ${parsed.missingDays.length} days not yet ingested)*`
    : '';

  // Fold 30-day totals
  let totalRequests = 0;
  let totalHuman = 0;
  const aiTrainingTotals: Record<string, number> = {};
  const aiRetrievalTotals: Record<string, number> = {};
  const notFoundPaths: Record<string, number> = {};
  let searchRef = 0, aiRef = 0, otherRef = 0, directRef = 0;
  let totalAuthAttacks = 0;

  for (const agg of aggregates) {
    totalRequests += agg.requests ?? 0;
    totalHuman    += agg.byClass?.human_plausible ?? 0;

    for (const [bot, data] of Object.entries(agg.aiTraining ?? {})) {
      aiTrainingTotals[bot] = (aiTrainingTotals[bot] ?? 0) + data.hits;
    }
    for (const [bot, data] of Object.entries(agg.aiRetrieval ?? {})) {
      aiRetrievalTotals[bot] = (aiRetrievalTotals[bot] ?? 0) + data.hits;
    }
    for (const [path, hits] of Object.entries(agg.notFound?.contentLike ?? {})) {
      notFoundPaths[path] = (notFoundPaths[path] ?? 0) + hits;
    }
    searchRef += Object.values(agg.referrals?.search ?? {}).reduce((s, n) => s + n, 0);
    aiRef     += Object.values(agg.referrals?.ai    ?? {}).reduce((s, n) => s + n, 0);
    otherRef  += (agg.referrals?.other    ?? 0) + (agg.referrals?.spoofed ?? 0);
    directRef += agg.referrals?.internal  ?? 0;

    for (const hourData of Object.values(agg.attack?.authAttack ?? {})) {
      // Exclude 302/303 (successful auth redirects) — count only failed/rejected attempts
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const [status, count] of Object.entries((hourData as any).loginPosts  ?? {})) {
        if (status !== '302' && status !== '303') totalAuthAttacks += count as number;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const [status, count] of Object.entries((hourData as any).xmlrpcPosts ?? {})) {
        if (status !== '302' && status !== '303') totalAuthAttacks += count as number;
      }
    }
  }

  // Compute ratios
  const humanPct   = totalRequests > 0 ? Math.round((totalHuman / totalRequests) * 100) : 0;
  const totalRef   = searchRef + aiRef + otherRef + directRef;
  const pct = (n: number) => totalRef > 0 ? `${Math.round((n / totalRef) * 100)}%` : '—';

  // Top AI crawlers (training + retrieval combined, sorted by hits)
  const allAiBots = { ...aiTrainingTotals };
  for (const [bot, hits] of Object.entries(aiRetrievalTotals)) {
    allAiBots[bot] = (allAiBots[bot] ?? 0) + hits;
  }
  const topAiBots = Object.entries(allAiBots).sort((a, b) => b[1] - a[1]).slice(0, 4);

  // Top 404 demand paths
  const top404 = Object.entries(notFoundPaths).sort((a, b) => b[1] - a[1]).slice(0, 5);

  const lines: string[] = [
    ``,
    `## Traffic Intelligence${missingNote}`,
    ``,
    `**Traffic quality:** ${humanPct}% of requests appear human${totalRequests > 0 ? ` (${totalRequests.toLocaleString()} total requests)` : ''}`,
  ];

  if (topAiBots.length > 0) {
    lines.push(`**AI crawlers:** ${topAiBots.map(([b, h]) => `${b} (${h.toLocaleString()} hits)`).join(', ')}`);
  } else {
    lines.push(`**AI crawlers:** None detected in log data`);
  }

  if (top404.length > 0) {
    lines.push(`**404 demand signals:** ${top404.map(([p, h]) => `\`${p}\` (${h} hits)`).join(', ')}`);
  }

  if (totalRef > 0) {
    lines.push(`**Referral mix:** ${pct(searchRef)} search · ${pct(aiRef)} AI · ${pct(directRef)} direct · ${pct(otherRef)} other`);
  }

  if (totalAuthAttacks > 100) {
    lines.push(`**⚠ Attack exposure:** ${totalAuthAttacks.toLocaleString()} auth probes in 30 days — consider running Security Sentinel on this site`);
  }

  return lines.join('\n');
}

function ok(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

function parseFleetSqlRows(result: unknown): SiteRow[] {
  if (typeof result !== 'string') return [];
  const lines = result.split('\n').filter(l => l.startsWith('|') && !l.includes('---'));
  if (lines.length < 2) return [];
  const headers = lines[0].split('|').slice(1, -1).map(h => h.trim());
  return lines.slice(1).map(line => {
    const vals = line.split('|').slice(1, -1).map(v => v.trim());
    return Object.fromEntries(headers.map((h, i) => [h, vals[i] ?? ''])) as unknown as SiteRow;
  });
}

// ---------------------------------------------------------------------------
// Core analysis — shared by run() and inventory_content tool
// ---------------------------------------------------------------------------

// Index-based document type (from get_all_site_documents)
type IndexedDoc = {
  id: string; postId: number; postType: string; title: string; content: string; metadata: string;
};

async function analyzeContent(
  siteId: string,
  tools: { invoke(name: string, args: unknown): Promise<unknown> },
  staleThresholdDays = 365,
  warn?: (m: string) => void,
): Promise<{ posts: PostRecord[]; orphans: PostRecord[]; stale: PostRecord[]; docs: AggDoc[]; truncated: AggDoc[] }> {
  // Use the Nexus content index instead of wp_eval to avoid stdout maxBuffer issues on large sites.
  // The index stores chunked content (<=500 words per chunk) — no PHP execution, no size limit.
  const rawResult = await tools.invoke('get_all_site_documents', {
    site: siteId,
    include_embeddings: false,
    full_content: true,  // need full chunk text for internal link detection
  });
  const parsed = parseSiteDocuments(rawResult);

  if (!parsed.documentCount || !parsed.documents.length) {
    return { posts: [], orphans: [], stale: [], docs: [], truncated: [] };
  }

  // P0: chunks -> documents. Without this every count below is per-chunk.
  const docs = aggregateDocuments(parsed.documents, warn);

  const posts: PostRecord[] = docs.map(d => ({
    ID: d.postId,
    post_title: d.title,
    post_name: d.slug,
    post_date: d.indexDate,
    post_modified: d.indexDate,
    post_type: d.postType,
    post_content: d.content,
  }));

  const inbound = buildInboundCounts(docs);
  const orphanDocs = docs.filter(d => (inbound.get(d.postId) ?? 0) === 0);
  const orphanIds = new Set(orphanDocs.map(d => d.postId));
  const orphans = posts.filter(p => orphanIds.has(p.ID));

  // Stale detection: index dates are often empty (Gap 2) — only flag when a date exists.
  const staleMs = staleThresholdDays * 86400 * 1000;
  const now = Date.now();
  const stale = posts.filter(p => {
    if (!p.post_modified) return false;
    const ms = new Date(p.post_modified).getTime();
    return ms > 0 && now - ms > staleMs;
  });

  return { posts, orphans, stale, docs, truncated: docs.filter(d => d.possiblyTruncated) };
}

// ---------------------------------------------------------------------------
// Sandbox setup for WPE sites (sentinel pattern)
// ---------------------------------------------------------------------------

/** Stable sandbox name per install — reused across runs.
 *  Timestamped names minted a new sandbox (holding a full production database
 *  pull) on every run, and nothing ever deletes them: local_delete_site is
 *  tier 3. Daily cron x fleet = unbounded disk growth of customer data. */
function sandboxNameFor(siteName: string): string {
  return `seo-${siteName.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')}`;
}

async function createAndPullSandbox(
  siteName: string,
  tools: { invoke(name: string, args: unknown): Promise<unknown> },
  log: { info(msg: string, meta?: Record<string, unknown>): void; warn(msg: string, meta?: Record<string, unknown>): void; error(msg: string, meta?: Record<string, unknown>): void },
): Promise<string | null> {
  const sandboxName = sandboxNameFor(siteName);
  log.info(`Preparing sandbox: ${sandboxName}`);

  try {
    await tools.invoke('local_create_site', { name: sandboxName });
    log.info(`Sandbox created`);
  } catch (e: unknown) {
    const msg = (e as Error).message;
    if (/exist/i.test(msg)) {
      log.info(`Reusing existing sandbox: ${sandboxName}`);
    } else {
      log.warn(`Could not create sandbox: ${msg}`);
      return null;
    }
  }

  try {
    await tools.invoke('local_wpe_pull', {
      site: sandboxName,
      remote_install_id: siteName,
      include_database: true,
    });
    log.info(`Pull initiated — polling...`);
  } catch (e: unknown) {
    log.warn(`Pull failed: ${(e as Error).message}`);
    return null;
  }

  let pullDone = false;
  let sawInProgress = false;
  for (let i = 0; i < 30 && !pullDone; i++) {
    await new Promise(r => setTimeout(r, 20_000));
    try {
      const raw = await tools.invoke('local_operation_status', { site: sandboxName });
      const status = typeof raw === 'string' ? raw : JSON.stringify(raw);
      const opStatus = (raw as Record<string, unknown>)?.status as string | undefined;
      log.info(`Pull poll ${i + 1}/30: status=${opStatus ?? '?'}`);
      if (opStatus === 'failed' || status.includes('failed')) { log.error(`Pull failed`); return null; }
      if (opStatus === 'in_progress' || status.includes('in_progress') || status.includes('pulling')) sawInProgress = true;
      else if (opStatus === 'completed' || status.includes('completed') || status.includes('complete')) { pullDone = true; break; }
      else if (sawInProgress) { pullDone = true; break; }
    } catch { /* keep polling */ }
  }

  if (!pullDone) {
    log.warn(`Pull timed out — sandbox may be incomplete`);
    return sandboxName; // still try to use it
  }

  log.info(`Pull complete`);
  try { await tools.invoke('local_start_site', { site: sandboxName }); } catch { /* may already be running */ }
  await new Promise(r => setTimeout(r, 5_000)); // let MySQL come up
  return sandboxName;
}

// ---------------------------------------------------------------------------
// waitForIndex — reindex + poll until ready
// ---------------------------------------------------------------------------
async function waitForIndex(
  siteName: string,
  tools: { invoke(name: string, args: unknown): Promise<unknown> },
  log: { info(msg: string, meta?: Record<string, unknown>): void; warn(msg: string, meta?: Record<string, unknown>): void },
  maxWaitMs = 90_000,
): Promise<boolean> {
  try {
    await tools.invoke('reindex_site', { site: siteName });
    log.info(`[SEO] Reindexing ${siteName}…`);
  } catch (err: unknown) {
    log.warn(`[SEO] reindex_site failed: ${(err as Error).message} — analysis may find 0 posts`);
    return false;
  }

  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 5_000));
    try {
      const status = await tools.invoke('get_index_status', { site: siteName }) as string;
      if (typeof status === 'string' && !status.includes('not been indexed') && !status.toLowerCase().includes('indexing')) {
        log.info(`[SEO] Index ready for ${siteName}`);
        return true;
      }
    } catch { /* keep polling */ }
  }
  log.warn(`[SEO] Index not ready after ${maxWaitMs / 1000}s — proceeding with available data`);
  return false;
}

// ---------------------------------------------------------------------------
// Embedding decode — P0.
// Buffer.from(base64) for payloads <4KB is allocated inside Node's shared 8KB
// pool at a NONZERO byteOffset. A 384d float32 embedding is 1,536 bytes, so it
// is essentially always pooled. `new Float32Array(buf.buffer)` therefore reads
// the whole pool from offset 0 — neighbouring allocations, not the embedding
// (observed: 2048 floats of garbage instead of 384 real ones).
// Always slice by byteOffset/byteLength; copy when the offset isn't 4-aligned.
// ---------------------------------------------------------------------------

export const EXPECTED_EMBEDDING_DIM = 384;   // all-MiniLM-L6-v2-quantized

function decodeEmbedding(b64: string): Float32Array {
  const buf = Buffer.from(b64, 'base64');
  if (buf.byteOffset % 4 === 0) {
    return new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4));
  }
  const copy = new ArrayBuffer(buf.byteLength);
  new Uint8Array(copy).set(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
  return new Float32Array(copy);
}

/** Decode + dimension guard. A wrong-length vector is self-evidently a decode
 *  fault; fail loudly rather than silently clustering noise. */
function decodeEmbeddingChecked(b64: string, label: string, warn?: (m: string) => void): Float32Array | null {
  if (!b64) return null;
  const v = decodeEmbedding(b64);
  if (v.length !== EXPECTED_EMBEDDING_DIM) {
    warn?.(`[SEO] Embedding for ${label} decoded to ${v.length} dims (expected ${EXPECTED_EMBEDDING_DIM}) — skipping`);
    return null;
  }
  return v;
}

// ---------------------------------------------------------------------------
// Chunk -> document aggregation — P0.
// The index stores <=500-word CHUNKS with ids "wp_{site}_{postId}" or
// "wp_{site}_{postId}_chunk_{n}". Every analysis here operates on DOCUMENTS:
// group by postId, mean-pool chunk vectors, concatenate chunk text in order.
// Without this: overlap flags chunk-2-vs-chunk-3 of the same post at ~99%,
// clusters are weighted by post length, and "posts analyzed" counts chunks.
// ---------------------------------------------------------------------------

type RawIndexDoc = {
  id: string; postId: number; postType: string; title: string;
  content?: string; metadata?: string; embedding?: string;
};

type AggDoc = {
  postId: number;
  postType: string;
  title: string;
  slug: string;
  indexDate: string;
  content: string;
  chunkCount: number;
  possiblyTruncated: boolean;   // single unchunked doc w/ substantial content = webhook-path artifact
  vec: Float32Array | null;     // mean-pooled document vector
};

const CONTENT_CAP = 12_000;     // chars retained per document for link detection

function chunkOrdinal(id: string): number {
  const m = /_chunk_(\d+)$/.exec(id ?? '');
  return m ? parseInt(m[1], 10) : 0;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function metaField(doc: RawIndexDoc, field: string): string {
  try {
    const meta = JSON.parse(doc.metadata ?? '') as Record<string, unknown>;
    const v = meta[field];
    return typeof v === 'string' ? v : '';
  } catch { return ''; }
}

function aggregateDocuments(documents: RawIndexDoc[], warn?: (m: string) => void): AggDoc[] {
  const byPost = new Map<number, RawIndexDoc[]>();
  for (const d of documents ?? []) {
    if (d == null || typeof d.postId !== 'number') continue;
    const arr = byPost.get(d.postId);
    if (arr) arr.push(d); else byPost.set(d.postId, [d]);
  }

  const out: AggDoc[] = [];
  for (const [postId, chunks] of byPost) {
    chunks.sort((a, b) => chunkOrdinal(a.id) - chunkOrdinal(b.id));
    const first = chunks[0];

    // Mean-pool chunk vectors into one document vector.
    let vec: Float32Array | null = null;
    const decoded: Float32Array[] = [];
    for (const c of chunks) {
      if (!c.embedding) continue;
      const v = decodeEmbeddingChecked(c.embedding, `post ${postId} chunk ${chunkOrdinal(c.id)}`, warn);
      if (v) decoded.push(v);
    }
    if (decoded.length > 0) {
      const dim = decoded[0].length;
      vec = new Float32Array(dim);
      for (const v of decoded) for (let i = 0; i < dim; i++) vec[i] += v[i] / decoded.length;
    }

    let content = '';
    for (const c of chunks) {
      if (!c.content) continue;
      if (content.length >= CONTENT_CAP) break;
      content += (content ? '\n' : '') + c.content;
    }
    content = content.slice(0, CONTENT_CAP);

    // Webhook-incremental indexing writes a single unchunked ~256-token doc.
    // Lower-fidelity vector -> excluded from similarity scoring.
    const possiblyTruncated =
      chunks.length === 1 && !/_chunk_\d+$/.test(first.id ?? '') && (first.content?.length ?? 0) >= 1000;

    out.push({
      postId,
      postType: first.postType,
      title: first.title,
      slug: metaField(first, 'slug') || slugify(first.title ?? ''),
      indexDate: metaField(first, 'date'),
      content,
      chunkCount: chunks.length,
      possiblyTruncated,
      vec,
    });
  }
  return out;
}

/** Normalize get_all_site_documents output (SDK may hand back parsed JSON or a string). */
function parseSiteDocuments(raw: unknown): { documentCount: number; documents: RawIndexDoc[] } {
  const parsed = (typeof raw === 'string' ? JSON.parse(raw) : raw) as
    { documentCount?: number; documents?: RawIndexDoc[] } | null;
  return { documentCount: parsed?.documentCount ?? 0, documents: parsed?.documents ?? [] };
}

// ---------------------------------------------------------------------------
// Internal link detection — boundary-aware so /local doesn't match /local-labs,
// and single-pass per document (was O(n^2) String.includes over full text).
// ---------------------------------------------------------------------------

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Count inbound internal links per postId in one pass per document. */
function buildInboundCounts(docs: AggDoc[]): Map<number, number> {
  const inbound = new Map<number, number>();
  for (const d of docs) inbound.set(d.postId, 0);

  const bySlug = new Map<string, number>();
  for (const d of docs) if (d.slug && !bySlug.has(d.slug)) bySlug.set(d.slug, d.postId);
  const slugs = Array.from(bySlug.keys()).filter(Boolean);
  if (slugs.length === 0) return inbound;

  // One alternation, longest-first so /local-labs wins over /local.
  slugs.sort((a, b) => b.length - a.length);
  const rx = new RegExp(`/(${slugs.map(escapeRegex).join('|')})(?=[/"'?#\\s)>]|$)`, 'gi');

  for (const d of docs) {
    if (!d.content) continue;
    const seen = new Set<number>();
    rx.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rx.exec(d.content)) !== null) {
      const target = bySlug.get(m[1].toLowerCase());
      if (target === undefined || target === d.postId) continue;
      seen.add(target);   // count each (source -> target) pair once
    }
    for (const t of seen) inbound.set(t, (inbound.get(t) ?? 0) + 1);
  }
  return inbound;
}

// ---------------------------------------------------------------------------
// Cluster labelling — TF-IDF over member documents, so a label describes what
// DISTINGUISHES the cluster rather than what the whole site is about.
// ---------------------------------------------------------------------------

const STOPWORDS = new Set([
  'the','a','an','and','or','but','if','then','else','for','of','to','in','on','at','by','with','from','as',
  'is','are','was','were','be','been','being','it','its','this','that','these','those','you','your','we','our',
  'they','their','he','she','his','her','i','my','me','us','them','what','which','who','whom','how','why','when',
  'where','all','any','both','each','more','most','other','some','such','not','no','nor','only','own','same',
  'so','than','too','very','can','will','just','about','into','over','after','before','between','out','up',
  'down','off','above','below','again','once','here','there','have','has','had','do','does','did','get','got',
  'like','also','use','using','used','one','two','new','make','made','way','via','part','post','page',
]);

function tokenize(s: string): string[] {
  return (s.toLowerCase().match(/[a-z][a-z0-9]{2,}/g) ?? []).filter(t => !STOPWORDS.has(t));
}

function tfidfLabels(clusters: AggDoc[][], topN = 3): string[] {
  const docTerms = clusters.flat().map(d => new Set(tokenize(`${d.title} ${d.content.slice(0, 800)}`)));
  const N = docTerms.length || 1;
  const df = new Map<string, number>();
  for (const terms of docTerms) for (const t of terms) df.set(t, (df.get(t) ?? 0) + 1);

  return clusters.map(members => {
    const tf = new Map<string, number>();
    for (const d of members) {
      // Title double-weighted — it's the most topical text on the document.
      for (const t of tokenize(`${d.title} ${d.title} ${d.content.slice(0, 800)}`)) {
        tf.set(t, (tf.get(t) ?? 0) + 1);
      }
    }
    const scored = Array.from(tf.entries())
      .map(([t, f]) => [t, f * Math.log(N / (df.get(t) ?? 1))] as const)
      .sort((a, b) => b[1] - a[1])
      .slice(0, topN)
      .map(([t]) => t);
    return scored.length > 0 ? scored.join(' · ') : (members[0]?.title ?? 'topic');
  });
}

/** Mean member<->centroid cosine — logged for k calibration during dogfood. */
function clusterCohesion(members: Float32Array[]): number {
  if (members.length === 0) return 0;
  const dim = members[0].length;
  const centroid = new Float32Array(dim);
  for (const v of members) for (let d = 0; d < dim; d++) centroid[d] += v[d] / members.length;
  const sims = members.map(v => cosineSim(v, centroid));
  return sims.reduce((s, x) => s + x, 0) / sims.length;
}

// ---------------------------------------------------------------------------
// Embedding helpers — no external deps
// ---------------------------------------------------------------------------

function cosineSim(a: Float32Array, b: Float32Array): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] ** 2; nb += b[i] ** 2; }
  return na === 0 || nb === 0 ? 0 : dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function kMeans(vecs: Float32Array[], k: number, maxIter = 20): number[][] {
  if (vecs.length <= k) return vecs.map((_, i) => [i]);
  const dim = vecs[0].length;

  // Forgy-style deterministic init: spread picks evenly across corpus
  const step = Math.floor(vecs.length / k);
  let centroids = Array.from({ length: k }, (_, i) => vecs[i * step].slice() as Float32Array);

  let assignments = new Array<number>(vecs.length).fill(0);

  for (let iter = 0; iter < maxIter; iter++) {
    const prev = [...assignments];

    for (let i = 0; i < vecs.length; i++) {
      let bestSim = -Infinity, bestK = 0;
      for (let c = 0; c < k; c++) {
        const s = cosineSim(vecs[i], centroids[c]);
        if (s > bestSim) { bestSim = s; bestK = c; }
      }
      assignments[i] = bestK;
    }

    if (assignments.every((a, i) => a === prev[i])) break;

    centroids = Array.from({ length: k }, (_, c) => {
      const members = vecs.filter((_, i) => assignments[i] === c);
      if (members.length === 0) return centroids[c].slice() as Float32Array;
      const avg = new Float32Array(dim);
      for (const v of members) for (let d = 0; d < dim; d++) avg[d] += v[d] / members.length;
      return avg;
    });
  }

  return Array.from({ length: k }, (_, c) =>
    assignments.map((a, i) => (a === c ? i : -1)).filter(i => i >= 0),
  );
}

/** Keyword fallback when the model is unavailable. Always tagged in output —
 *  mixing heuristic and model classifications without labelling them makes the
 *  totals unreadable. */
function heuristicIntent(q: string): 'informational' | 'navigational' | 'transactional' | 'commercial' {
  if (/\b(buy|shop|price|pricing|cheap|order|purchase|trial|subscribe|coupon|discount)\b/i.test(q)) return 'transactional';
  if (/\b(best|vs|versus|review|reviews|compare|comparison|top|alternative|alternatives)\b/i.test(q)) return 'commercial';
  if (/\b(how|what|why|when|where|guide|tutorial|fix|error|example|examples)\b/i.test(q)) return 'informational';
  return 'navigational';
}

// ---------------------------------------------------------------------------
// Topic map — shared by build_topic_map and run()
// ---------------------------------------------------------------------------

type TopicMap = {
  docCount: number;
  k: number;
  clusters: Array<{ label: string; count: number; titles: string[]; postIds: number[]; cohesion: number }>;
};

async function buildTopicMapForSite(
  siteId: string,
  tools: { invoke(name: string, args: unknown): Promise<unknown> },
  targetClusters: number,
  warn?: (m: string) => void,
): Promise<TopicMap | null> {
  const parsed = parseSiteDocuments(await tools.invoke('get_all_site_documents', {
    site: siteId,
    include_embeddings: true,
    full_content: true,     // chunk text feeds TF-IDF labels
  }));
  if (!parsed.documentCount || !parsed.documents.length) return null;

  // P0: cluster DOCUMENTS (mean-pooled chunks), not raw chunks.
  const docs = aggregateDocuments(parsed.documents, warn).filter(d => d.vec !== null);
  if (docs.length < 2) return null;

  const k = Math.max(1, Math.min(targetClusters, docs.length));
  const assignments = kMeans(docs.map(d => d.vec!), k);
  const clusterDocs = assignments.map(idxs => idxs.map(i => docs[i])).filter(m => m.length > 0);
  const labels = tfidfLabels(clusterDocs);

  const clusters = clusterDocs
    .map((members, i) => ({
      label: labels[i],
      count: members.length,
      titles: members.slice(0, 5).map(m => m.title),
      postIds: members.map(m => m.postId),
      cohesion: Math.round(clusterCohesion(members.map(m => m.vec!)) * 1000) / 1000,
    }))
    .sort((a, b) => b.count - a.count);

  return { docCount: docs.length, k, clusters };
}

// ---------------------------------------------------------------------------
// GSC API helpers
// ---------------------------------------------------------------------------

type GscRow = {
  keys: string[];          // e.g. ['query'] or ['query', 'page']
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

type GscResponse = { rows?: GscRow[]; error?: { message: string } };

async function fetchGsc(
  token: string,
  siteUrl: string,
  body: Record<string, unknown>,
): Promise<GscRow[]> {
  const encoded = encodeURIComponent(siteUrl);
  const res = await fetch(
    `https://searchconsole.googleapis.com/webmasters/v3/sites/${encoded}/searchAnalytics/query`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
  const data = await res.json() as GscResponse;
  if (data.error) throw new Error(`GSC API error: ${data.error.message}`);
  return data.rows ?? [];
}

async function listGscSites(token: string): Promise<string[]> {
  const res = await fetch('https://searchconsole.googleapis.com/webmasters/v3/sites', {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json() as { siteEntry?: Array<{ siteUrl: string }> };
  return (data.siteEntry ?? []).map(e => e.siteUrl);
}

// GSC finalizes data on a ~2-day lag; the trailing days are partial and would
// make the current window look artificially low against the prior one.
const GSC_LAG_DAYS = 2;

// 28-day date range helpers (all windows end GSC_LAG_DAYS ago)
function dateRange(daysAgo: number, windowDays = 28): { startDate: string; endDate: string } {
  const end = new Date(Date.now() - (daysAgo + GSC_LAG_DAYS) * 86400_000);
  const start = new Date(Date.now() - (daysAgo + GSC_LAG_DAYS + windowDays) * 86400_000);
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}

// ---------------------------------------------------------------------------
// Agent definition
// ---------------------------------------------------------------------------

export default defineAgent({
  name: 'seo-insights',
  version: '0.5.0',
  description: 'Content strategy agent — topical map, gap analysis, and overlap detection from your WordPress install',

  // Pulls a WPE install to a local sandbox and creates/starts Local sites during analysis —
  // writes to the local filesystem/site registry, not to the production site itself, but that
  // distinction is finer than the picker's readonly/writes binary supports today. 'writes' is
  // the conservative choice.
  effect: 'writes',

  // run() produces a Site Content Report (markdown, attached to AgentResult.summary) — a
  // finished artifact meant to be read, not an action awaiting sign-off. No gated action exists
  // today for this agent to pause on, so producesApprovals stays false; if a remediation-style
  // action is added later (e.g. auto-applying an SEO fix), that's the point to flip it.
  producesApprovals: false,
  producesReports: true,

  timeoutMs: 20 * 60 * 1000,   // 20 min — WPE pull + analysis can take 10+ min (same as sentinel)

  credentials: [
    {
      provider: 'google',
      scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
      optional: true,
      reason: 'Reads Search Console query data to find demand gaps and confirm cannibalization',
    },
  ],

  // wpe:sync.completed EXCLUDED (2026-08-07) — same incident class documented in
  // agents/security-sentinel/agent.js. Its only real publisher is WpeRefreshScheduler.ts
  // (opt-in, wpeRefreshAutoEnabled), which fires this event automatically for every stale WPE
  // install in a cycle — dozens at once, zero user involvement. The per-site cooldown this
  // trigger used to lean on only rate-limits re-firing the SAME site within 6h; it does nothing
  // to stop a single scheduler cycle from launching a sandbox-pull-and-analyze pass across many
  // DIFFERENT installs at once, which is the identical resource-exhaustion shape as the sentinel
  // incident, just for content analysis instead of security scanning. There is no `source` field
  // on the published event distinguishing "user synced one site" from "scheduler swept the
  // fleet", so — as security-sentinel's own comment prescribes — this cannot be scoped safely
  // and is removed instead.
  //
  // Known cost: `nexus agent run seo-insights --install <site>` (src/cli/commands/agent.ts)
  // scopes a run by emitting this same event via handleAgentEmit(), so that CLI path is now a
  // silent no-op for this agent — the identical tradeoff already accepted for security-sentinel.
  // Run Now (the site scope picker) does NOT depend on this trigger — it calls AgentRunner.run()
  // directly (see AGENT_RUN_NOW in src/main/ipc-handlers.ts) — so it remains the way to run this
  // agent against a specific site on demand. The weekly cron + settings.scope.siteIds covers
  // "run automatically on selected sites."
  triggers: [
    cron('0 7 * * 1'),           // Weekly scheduled report
  ],

  tools: [
    'local_list_sites',
    'search_site_content',
    'get_all_site_documents',
    'wp_eval',
    'get_index_status',
    'reindex_site',
    'fleet_sql',
    'wpe_site_deep_refresh',
    'local_create_site',
    'local_wpe_pull',
    'local_start_site',
    'local_clone_site',
    'local_operation_status',
    'get_log_aggregates',
    'fetch_log_window',
    'local_wpe_link',
  ],

  contributes: {
    tools: {

      // ------------------------------------------------------------------
      // check_index_health — T0 (Local + WPE)
      // ------------------------------------------------------------------
      check_index_health: {
        description: 'Check the Nexus content index health for a site. Works for both Local and WPE sites.',
        inputSchema: {
          type: 'object',
          properties: {
            siteId: { type: 'string', description: 'Local site name or WPE install name' },
            staleThresholdHours: { type: 'number', default: 48 },
          },
          required: ['siteId'],
        },
        executionMode: 'function' as const,
        handler: async (args: CheckIndexHealthArgs, ctx) => {
          ctx.log.phase('check_index_health');

          const siteRows = parseFleetSqlRows(
            await ctx.tools.invoke('fleet_sql', {
              query: 'SELECT id, name, source, ssh_last_sync_at, post_count FROM sites WHERE name = ? LIMIT 1',
              params: [args.siteId],
            })
          );

          if (siteRows.length === 0) {
            return ok(`⚠ Site "${args.siteId}" not found in the fleet database.`);
          }

          const site = siteRows[0];
          const isWpe = site.source === 'wpe';
          const lastSync = site.ssh_last_sync_at ? new Date(parseInt(site.ssh_last_sync_at)).toISOString() : 'never';
          const lines = [
            `# Index Health: ${site.name}`,
            `  Source: ${isWpe ? 'WP Engine' : 'Local'} | Posts: ${site.post_count ?? '?'} | Last sync: ${lastSync}`,
          ];

          if (!isWpe) {
            try {
              const indexText = await ctx.tools.invoke('get_index_status', { site: site.name }) as string;
              lines.push('', indexText);
            } catch (e: unknown) {
              lines.push(`  ⚠ Index error: ${(e as Error).message}`);
            }
          } else {
            const staleMs = (args.staleThresholdHours ?? 48) * 3600 * 1000;
            const syncAge = site.ssh_last_sync_at ? Date.now() - parseInt(site.ssh_last_sync_at) : Infinity;
            if (syncAge > staleMs) lines.push('  ⚠ Content sync is stale — run refresh_wpe_content');
          }

          return ok(lines.join('\n'));
        },
      },

      // ------------------------------------------------------------------
      // refresh_wpe_content — trigger SSH sync for a WPE site
      // ------------------------------------------------------------------
      refresh_wpe_content: {
        description: 'Refresh a WP Engine site\'s content index via SSH.',
        inputSchema: {
          type: 'object',
          properties: { installName: { type: 'string' } },
          required: ['installName'],
        },
        executionMode: 'function' as const,
        handler: async (args: RefreshWpeArgs, ctx) => {
          ctx.log.phase('refresh_wpe_content');
          try {
            const result = await ctx.tools.invoke('wpe_site_deep_refresh', { install_name: args.installName }) as string;
            return ok(`✓ Refresh complete for "${args.installName}"\n\n${result}`);
          } catch (e: unknown) {
            return ok(`⚠ Refresh failed: ${(e as Error).message}`);
          }
        },
      },

      // ------------------------------------------------------------------
      // pull_to_local — create sandbox + pull WPE site for full analysis
      // ------------------------------------------------------------------
      pull_to_local: {
        description: 'Create a Local sandbox and pull a WP Engine site into it for full wp_eval analysis.',
        inputSchema: {
          type: 'object',
          properties: {
            installName: { type: 'string', description: 'WPE install name' },
            localSiteName: { type: 'string', description: 'Name for the new Local sandbox (auto-generated if omitted)' },
            includeDatabase: { type: 'boolean', default: true },
          },
          required: ['installName'],
        },
        executionMode: 'run' as const,
        handler: async (args: PullToLocalArgs, ctx) => {
          const sandboxName = args.localSiteName || `seo-${args.installName}-${Date.now()}`;
          ctx.log.phase('pull_to_local', `${args.installName} → ${sandboxName}`);
          try {
            await ctx.tools.invoke('local_create_site', { name: sandboxName });
            await ctx.tools.invoke('local_wpe_pull', {
              site: sandboxName,
              remote_install_id: args.installName,
              include_database: args.includeDatabase ?? true,
            });
            // Pull is async — caller should poll local_operation_status
            return ok(`✓ Pull initiated: "${args.installName}" → "${sandboxName}"\n\nPoll status with check_index_health siteId="${sandboxName}"\nThen run: inventory_content siteId="${sandboxName}"`);
          } catch (e: unknown) {
            return ok(`⚠ Pull failed: ${(e as Error).message}`);
          }
        },
      },

      // ------------------------------------------------------------------
      // inventory_content — T0 (Local, running sites only)
      // ------------------------------------------------------------------
      inventory_content: {
        description: 'Inventory all published content via WordPress PHP. Requires the site to be running in Local.',
        inputSchema: {
          type: 'object',
          properties: {
            siteId: { type: 'string', description: 'Local site name (must be running)' },
            postTypes: { type: 'array', items: { type: 'string' }, default: ['post', 'page'] },
            limit: { type: 'number', default: 500 },
          },
          required: ['siteId'],
        },
        executionMode: 'function' as const,
        handler: async (args: InventoryContentArgs, ctx) => {
          ctx.log.phase('inventory_content');
          // SECURITY: both values are interpolated into PHP executed by wp_eval.
          // postTypes goes through JSON.stringify; limit must be coerced to a
          // bounded integer — an input schema is not a security boundary.
          const rawTypes = Array.isArray(args.postTypes) ? args.postTypes : ['post', 'page'];
          const postTypes = rawTypes
            .filter((t): t is string => typeof t === 'string')
            .map(t => t.replace(/[^A-Za-z0-9_-]/g, ''))
            .filter(Boolean);
          if (postTypes.length === 0) postTypes.push('post', 'page');
          const limit = Math.min(Math.max(Math.floor(Number(args.limit) || 500), 1), 5000);

          let posts: PostRecord[];
          try {
            posts = await ctx.tools.invoke('wp_eval', {
              site: args.siteId,
              code: `
$posts = get_posts(['post_status'=>'publish','post_type'=>${JSON.stringify(postTypes)},'numberposts'=>${limit}]);
echo json_encode(array_map(function($p){
  return ['ID'=>$p->ID,'post_title'=>$p->post_title,'post_name'=>$p->post_name,
          'post_date'=>$p->post_date,'post_modified'=>$p->post_modified,'post_type'=>$p->post_type];
},$posts));`,
            }) as PostRecord[];
          } catch (e: unknown) {
            const msg = (e as Error).message;
            if (msg.includes('not running') || msg.includes('halted')) {
              return ok(`⚠ Site "${args.siteId}" is not running. Start it in Local.\n\nFor WPE sites, use pull_to_local first.`);
            }
            return ok(`⚠ Could not inventory content: ${msg}`);
          }

          if (!Array.isArray(posts)) return ok('⚠ No posts returned.');

          const lines = [
            `# Content Inventory: ${args.siteId}`,
            `${posts.length} published posts (types: ${postTypes.join(', ')})`,
            '',
            ...posts.slice(0, 25).map(p => `  [${p.post_type}] ${p.post_title} (/${p.post_name}) — ${p.post_modified?.slice(0, 10)}`),
            posts.length > 25 ? `  … and ${posts.length - 25} more` : '',
          ].filter(l => l !== '').join('\n');

          ctx.log.info('inventory_content complete', { count: posts.length });
          return ok(lines + '\n\n```json\n' + JSON.stringify(posts, null, 2) + '\n```');
        },
      },

      // ------------------------------------------------------------------
      // find_structural_issues — T0 (Local, running sites only)
      // ------------------------------------------------------------------
      find_structural_issues: {
        description: 'Find orphaned posts (no inbound internal links) and stale content. Requires the site to be running.',
        inputSchema: {
          type: 'object',
          properties: {
            siteId: { type: 'string' },
            staleThresholdDays: { type: 'number', default: 365 },
          },
          required: ['siteId'],
        },
        executionMode: 'function' as const,
        handler: async (args: FindStructuralArgs, ctx) => {
          ctx.log.phase('find_structural_issues');
          try {
            const { posts, orphans, stale } = await analyzeContent(
              args.siteId,
              ctx.tools,
              args.staleThresholdDays ?? 365,
            );
            if (posts.length === 0) return ok('⚠ No posts found or site is not running.');

            const lines = [
              `# Structural Issues: ${args.siteId}`,
              '',
              `## Orphaned posts (no inbound links): ${orphans.length} of ${posts.length}`,
              ...orphans.slice(0, 10).map(p => `  • ${p.post_title} (/${p.post_name})`),
              orphans.length > 10 ? `  … and ${orphans.length - 10} more` : '',
              '',
              `## Stale content (>${args.staleThresholdDays ?? 365} days): ${stale.length}`,
              ...stale.slice(0, 10).map(p => `  • ${p.post_title} — ${p.post_modified?.slice(0, 10)}`),
            ].filter(l => l !== '').join('\n');

            ctx.log.finding({
              id: 'structural-orphans',
              severity: orphans.length > 10 ? 'high' : 'medium',
              title: `${orphans.length} orphaned posts with no inbound internal links`,
            });

            return ok(lines);
          } catch (e: unknown) {
            return ok(`⚠ Analysis failed: ${(e as Error).message}`);
          }
        },
      },

      // ------------------------------------------------------------------
      // build_topic_map — cluster embeddings into a topical map
      // ------------------------------------------------------------------
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
        executionMode: 'function' as const,
        handler: async (args: TopicMapArgs, ctx) => {
          ctx.log.phase('build_topic_map');
          const targetClusters = args.clusters ?? 10;

          const map = await buildTopicMapForSite(
            args.siteId, ctx.tools, targetClusters, (m) => ctx.log.warn(m),
          );
          if (!map) {
            return ok(`⚠ Not enough indexed documents with embeddings for "${args.siteId}". Start the site in Local and let indexing finish, then retry.`);
          }

          ctx.log.info(`Topic map built: ${map.k} clusters from ${map.docCount} documents`);
          // Cohesion is logged (not shown) so k can be calibrated from real corpora.
          ctx.log.info(`Cluster cohesion: ${map.clusters.map(c => c.cohesion).join(', ')}`);

          const report = [
            `# Topic Map: ${args.siteId}`,
            `${map.docCount} posts grouped into ${map.k} topic clusters`,
            '',
            ...map.clusters.map((c, i) =>
              `## Cluster ${i + 1}: ${c.label} (${c.count} posts, cohesion ${c.cohesion})\n` +
              c.titles.map(t => `  • ${t}`).join('\n'),
            ),
          ].join('\n');

          return ok(report);
        },
      },

      // ------------------------------------------------------------------
      // find_overlap_candidates — cosine similarity over all doc pairs
      // ------------------------------------------------------------------
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

          const parsed = parseSiteDocuments(await ctx.tools.invoke('get_all_site_documents', {
            site: args.siteId,
            include_embeddings: true,
          }));
          if (!parsed.documentCount) {
            return ok('Need at least 2 indexed posts to find overlap candidates.');
          }

          // P0: aggregate chunks into documents first. Comparing raw chunks
          // flags chunk-2 vs chunk-3 of the SAME post at ~99% and floods the list.
          const all = aggregateDocuments(parsed.documents, (m) => ctx.log.warn(m));
          // Webhook-truncated entries have lower-fidelity vectors — excluding
          // them here is the agreed mitigation (check_index_health reports count).
          const excluded = all.filter(d => d.possiblyTruncated).length;
          const docs = all.filter(d => d.vec !== null && !d.possiblyTruncated);

          if (docs.length < 2) {
            return ok(`Need at least 2 indexed posts with embeddings to find overlap candidates.${excluded > 0 ? ` (${excluded} degraded entries excluded — reindex to restore.)` : ''}`);
          }

          // O(n^2) pair scan — bounded so a very large corpus can't hang the run.
          const MAX_PAIR_DOCS = 1500;
          const scanDocs = docs.length > MAX_PAIR_DOCS ? docs.slice(0, MAX_PAIR_DOCS) : docs;
          if (docs.length > MAX_PAIR_DOCS) {
            ctx.log.warn(`[SEO] ${docs.length} documents exceeds the ${MAX_PAIR_DOCS}-document pair-scan cap — comparing the first ${MAX_PAIR_DOCS}`);
          }

          const pairs: Array<{ a: string; b: string; aId: number; bId: number; similarity: number }> = [];
          for (let i = 0; i < scanDocs.length; i++) {
            for (let j = i + 1; j < scanDocs.length; j++) {
              if (scanDocs[i].postId === scanDocs[j].postId) continue;   // belt and braces
              const sim = cosineSim(scanDocs[i].vec!, scanDocs[j].vec!);
              if (sim >= threshold) {
                pairs.push({
                  a: scanDocs[i].title, b: scanDocs[j].title,
                  aId: scanDocs[i].postId, bId: scanDocs[j].postId,
                  similarity: sim,
                });
              }
            }
          }

          pairs.sort((a, b) => b.similarity - a.similarity);

          const lines = [
            `# Overlap Candidates: ${args.siteId}`,
            `Threshold: ${threshold} | Found: ${pairs.length} pairs (from ${scanDocs.length} documents${excluded > 0 ? `, ${excluded} degraded entries excluded` : ''})`,
            '',
            '⚠ These are SEMANTIC candidates — two similar pages can rank for different queries.',
            '  Connect Search Console (T1) to confirm which pairs are actual cannibalization.',
            '',
            ...pairs.slice(0, 20).map(p =>
              `  ${(p.similarity * 100).toFixed(1)}% similar: "${p.a}" (#${p.aId}) ↔ "${p.b}" (#${p.bId})`,
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

      // ------------------------------------------------------------------
      // connect_gsc — T1: connect to Google Search Console and select property
      // ------------------------------------------------------------------
      connect_gsc: {
        description: 'Connect to Google Search Console and select the property to analyze. Required before T1 demand analysis tools (detect_cannibalization, find_demand_gaps, etc.).',
        inputSchema: {
          type: 'object',
          properties: {
            siteId: {
              type: 'string',
              description: 'Site this property belongs to (Local site name or WPE install name). Property bindings are per-site.',
            },
            propertyUrl: {
              type: 'string',
              description: 'Your Search Console property URL (e.g. "https://example.com/" or "sc-domain:example.com"). Leave empty to list available properties.',
            },
          },
        },
        executionMode: 'function' as const,
        handler: async (args: { siteId?: string; propertyUrl?: string }, ctx) => {
          ctx.log.phase('connect_gsc');
          const siteId = args.siteId;
          if (!siteId) {
            return ok('⚠ connect_gsc needs a siteId — Search Console properties are bound per site so one site\'s property can\'t redirect another\'s analysis.\n\nRun: connect_gsc siteId="<site>" [propertyUrl="<url>"]');
          }

          // Check connection status
          const status = await ctx.credentials.getStatus('google');
          if (status === 'not_connected') {
            await ctx.credentials.requestConnection('google');
            return ok('Google not connected. A connection prompt has been queued — check the Nexus UI to authenticate, then run connect_gsc again.');
          }
          if (status === 'revoked') {
            await ctx.credentials.requestConnection('google');
            return ok('Google access was revoked. A reconnect prompt has been queued — re-authenticate in the Nexus UI, then run connect_gsc again.');
          }

          // Get token
          let token: string;
          try {
            const t = await ctx.credentials.getToken('google');
            token = t.token;
          } catch (e: unknown) {
            return ok(`⚠ Could not get Google access token: ${(e as Error).message}`);
          }

          // List available properties
          let sites: string[];
          try {
            sites = await listGscSites(token);
          } catch (e: unknown) {
            return ok(`⚠ Could not list Search Console properties: ${(e as Error).message}`);
          }

          if (sites.length === 0) {
            return ok('No Search Console properties found for this Google account. Verify the site at https://search.google.com/search-console/');
          }

          // If propertyUrl provided, validate and store it
          if (args.propertyUrl) {
            const match = sites.find(s => s === args.propertyUrl || s.includes(args.propertyUrl!));
            if (!match) {
              return ok([
                `⚠ Property "${args.propertyUrl}" not found in your Search Console account.`,
                '',
                'Available properties:',
                ...sites.map(s => `  • ${s}`),
              ].join('\n'));
            }
            ctx.state.set(gscPropertyKey(siteId), match);
            ctx.log.info(`GSC property set: ${match}`);
            return ok(`✓ Connected to Search Console property: ${match}\n\nT1 tools are now active:\n  • detect_cannibalization\n  • find_demand_gaps\n  • classify_intent\n  • detect_decay`);
          }

          // No propertyUrl — show available properties and ask user to specify
          const existing = ctx.state.get<string>(gscPropertyKey(siteId));
          return ok([
            existing ? `Current property: ${existing}` : 'No property selected yet.',
            '',
            'Available Search Console properties:',
            ...sites.map(s => `  • ${s}`),
            '',
            'Run: connect_gsc --arg propertyUrl=<url> to select one.',
          ].join('\n'));
        },
      },

      // ------------------------------------------------------------------
      // detect_cannibalization — T1: GSC query→page pairs
      // ------------------------------------------------------------------
      detect_cannibalization: {
        description: 'Find confirmed cannibalization pairs: GSC queries where ≥2 pages on this site both receive impressions. Confirms or dismisses T0 semantic overlap candidates.',
        inputSchema: {
          type: 'object',
          properties: {
            siteId: { type: 'string', description: 'Local site name or ID (for cross-referencing with T0 overlap candidates)' },
            minImpressions: { type: 'number', default: 10, description: 'Minimum impressions to flag a query' },
          },
          required: ['siteId'],
        },
        executionMode: 'function' as const,
        handler: async (args: { siteId: string; minImpressions?: number }, ctx) => {
          ctx.log.phase('detect_cannibalization');

          const gscProperty = ctx.state.get<string>(gscPropertyKey(args.siteId));
          if (!gscProperty) return ok('⚠ Run connect_gsc first to select a Search Console property.');

          const minImpressions = args.minImpressions ?? 10;

          let token: string;
          try { token = (await ctx.credentials.getToken('google')).token; }
          catch (e: unknown) { return ok(`⚠ Google not connected: ${(e as Error).message}`); }

          // Fetch last 28 days of query+page data
          const { startDate, endDate } = dateRange(0);
          ctx.log.info(`Fetching GSC data: ${startDate} to ${endDate}`);

          let rows: GscRow[];
          try {
            rows = await fetchGsc(token, gscProperty, {
              startDate, endDate,
              dimensions: ['query', 'page'],
              rowLimit: 25000,
            });
          } catch (e: unknown) {
            return ok(`⚠ GSC API error: ${(e as Error).message}`);
          }

          ctx.log.info(`Retrieved ${rows.length} query+page rows`);

          // Group by query → find queries with ≥2 pages
          const byQuery = new Map<string, GscRow[]>();
          for (const row of rows) {
            const query = row.keys[0];
            if (!byQuery.has(query)) byQuery.set(query, []);
            byQuery.get(query)!.push(row);
          }

          const cannibalPairs = Array.from(byQuery.entries())
            .filter(([, pages]) => {
              const total = pages.reduce((s, r) => s + r.impressions, 0);
              return pages.length >= 2 && total >= minImpressions;
            })
            .map(([query, pages]) => {
              const sorted = [...pages].sort((a, b) => b.impressions - a.impressions);
              const total = sorted.reduce((s, r) => s + r.impressions, 0);
              return {
                query,
                pageCount: pages.length,
                totalImpressions: total,
                pages: sorted.map(r => ({
                  url: r.keys[1],
                  impressions: r.impressions,
                  clicks: r.clicks,
                  position: Math.round(r.position * 10) / 10,
                  share: Math.round((r.impressions / total) * 100),
                })),
              };
            })
            .sort((a, b) => b.totalImpressions - a.totalImpressions);

          if (cannibalPairs.length === 0) {
            return ok(`✓ No confirmed cannibalization found for ${gscProperty}\n(${rows.length} query+page pairs analyzed, threshold: ${minImpressions} impressions)`);
          }

          const lines = [
            `# Confirmed Cannibalization: ${gscProperty}`,
            `${cannibalPairs.length} queries with ≥2 competing pages (${rows.length} pairs analyzed)`,
            `Period: ${startDate} → ${endDate}`,
            '',
            ...cannibalPairs.slice(0, 20).map(p => [
              `## "${p.query}" — ${p.totalImpressions} total impressions`,
              ...p.pages.map(pg => `  ${pg.share}% | pos ${pg.position} | ${pg.clicks}clicks — ${pg.url}`),
            ].join('\n')),
            cannibalPairs.length > 20 ? `\n… and ${cannibalPairs.length - 20} more` : '',
          ].filter(Boolean).join('\n');

          ctx.log.finding({
            id: 'gsc-cannibalization',
            severity: cannibalPairs.length > 10 ? 'high' : 'medium',
            title: `${cannibalPairs.length} confirmed cannibalization pairs from Search Console`,
            description: cannibalPairs.slice(0, 3).map(p => `"${p.query}"`).join(', '),
          });

          return ok(lines);
        },
      },

      // ------------------------------------------------------------------
      // find_demand_gaps — T1: GSC queries with impressions but no content
      // ------------------------------------------------------------------
      find_demand_gaps: {
        description: 'Find demand gaps: GSC queries with impressions but no well-ranking page on this site. Includes a striking-distance view (positions 8-20) as the fastest-win queue.',
        inputSchema: {
          type: 'object',
          properties: {
            siteId: { type: 'string', description: 'Local site name or ID — used to search existing content' },
            minImpressions: { type: 'number', default: 50 },
            strikeZoneMin: { type: 'number', default: 8 },
            strikeZoneMax: { type: 'number', default: 20 },
          },
          required: ['siteId'],
        },
        executionMode: 'function' as const,
        handler: async (args: { siteId: string; minImpressions?: number; strikeZoneMin?: number; strikeZoneMax?: number }, ctx) => {
          ctx.log.phase('find_demand_gaps');

          const gscProperty = ctx.state.get<string>(gscPropertyKey(args.siteId));
          if (!gscProperty) return ok('⚠ Run connect_gsc first to select a Search Console property.');

          const minImp = args.minImpressions ?? 50;
          const strikeMin = args.strikeZoneMin ?? 8;
          const strikeMax = args.strikeZoneMax ?? 20;

          let token: string;
          try { token = (await ctx.credentials.getToken('google')).token; }
          catch (e: unknown) { return ok(`⚠ Google not connected: ${(e as Error).message}`); }

          const { startDate, endDate } = dateRange(0);

          // Fetch query-level data (no page dimension — aggregate demand)
          let rows: GscRow[];
          try {
            rows = await fetchGsc(token, gscProperty, {
              startDate, endDate,
              dimensions: ['query'],
              rowLimit: 25000,
            });
          } catch (e: unknown) {
            return ok(`⚠ GSC API error: ${(e as Error).message}`);
          }

          // Filter to queries with meaningful impressions
          const significant = rows.filter(r => r.impressions >= minImp);
          ctx.log.info(`${significant.length} queries with ≥${minImp} impressions`);

          // For each query, check if we have content (using search_site_content)
          // Batch: take top 50 by impressions to limit API calls
          const top = significant.sort((a, b) => b.impressions - a.impressions).slice(0, 50);

          // PERF: these were 50 sequential index lookups (~10s of pure latency in a
          // function-mode tool). Bounded concurrency cuts wall time by ~the pool
          // size without hammering the index.
          const CONCURRENCY = 6;
          const gaps: Array<{ query: string; impressions: number; position: number; hasContent: boolean }> =
            new Array(top.length);

          let cursor = 0;
          const probeWorker = async () => {
            for (;;) {
              const idx = cursor++;
              if (idx >= top.length) return;
              const row = top[idx];
              const query = row.keys[0];
              let hasContent = false;
              try {
                const searchResult = await ctx.tools.invoke('search_site_content', {
                  site: args.siteId, query, limit: 1, min_score: 0.5,
                });
                const text = typeof searchResult === 'string' ? searchResult : JSON.stringify(searchResult ?? '');
                hasContent = !!text && !text.includes('No results') && !text.includes('0 results');
              } catch { /* index unavailable for this query — treat as no strong match */ }
              gaps[idx] = { query, impressions: row.impressions, position: row.position, hasContent };
            }
          };
          await Promise.all(Array.from({ length: Math.min(CONCURRENCY, top.length) }, probeWorker));

          // Striking distance: a page ALREADY ranks here (that's what a position
          // in a site-scoped GSC report means) — the play is to improve it, not
          // to write something new. Filtering by !hasContent made this always empty.
          const strikingDistance = gaps
            .filter(g => g.position >= strikeMin && g.position <= strikeMax)
            .sort((a, b) => b.impressions - a.impressions);

          // Weak coverage: ranking beyond page 1 AND no strongly matching document,
          // i.e. whatever currently ranks is probably tangential. Not "no content".
          const weakCoverage = gaps
            .filter(g => g.position > 10 && !g.hasContent)
            .sort((a, b) => b.impressions - a.impressions);

          const lines = [
            `# Demand Coverage: ${gscProperty}`,
            `Period: ${startDate} → ${endDate} | Min impressions: ${minImp} | Analyzed: top ${top.length} queries`,
            '',
            `## Striking Distance (ranking ${strikeMin}-${strikeMax} — improve the existing page): ${strikingDistance.length}`,
            strikingDistance.length > 0
              ? strikingDistance.map(g =>
                  `  pos ${g.position.toFixed(1)} | ${g.impressions}imp — "${g.query}"` +
                  (g.hasContent ? '' : '  (⚠ no strong semantic match — the ranking page may be tangential)')
                ).join('\n')
              : '  Nothing in this zone right now.',
            '',
            `## Weak Coverage (ranking >10, no strongly matching content — write or expand): ${weakCoverage.length}`,
            '  Note: every query here already has SOME ranking page — that is how it appears in Search Console.',
            '  "Weak coverage" means semantic search found no strong match, so what ranks is likely off-topic.',
            ...weakCoverage.slice(0, 15).map(g => `  pos ${g.position.toFixed(1)} | ${g.impressions}imp — "${g.query}"`),
            weakCoverage.length > 15 ? `  … and ${weakCoverage.length - 15} more` : '',
          ].filter(Boolean).join('\n');

          if (weakCoverage.length > 0 || strikingDistance.length > 0) {
            ctx.log.finding({
              id: 'demand-gaps',
              severity: weakCoverage.length > 10 ? 'high' : 'medium',
              title: `${weakCoverage.length} weak-coverage queries, ${strikingDistance.length} in striking distance`,
              description: `Striking distance = improve existing pages (pos ${strikeMin}-${strikeMax}); weak coverage = write or expand`,
            });
          }

          return ok(lines);
        },
      },

      // ------------------------------------------------------------------
      // classify_intent — T1: batch LLM intent classification, cached
      // ------------------------------------------------------------------
      classify_intent: {
        description: 'Classify Search Console queries by intent: informational, navigational, transactional, commercial. Cached per property — subsequent calls reuse stored results.',
        inputSchema: {
          type: 'object',
          properties: {
            siteId: { type: 'string', description: 'Site whose bound GSC property to analyze (see connect_gsc)' },
            minImpressions: { type: 'number', default: 20, description: 'Only classify queries with this many impressions' },
            refresh: { type: 'boolean', default: false, description: 'Re-classify even if cached results exist' },
          },
          required: ['siteId'],
        },
        executionMode: 'function' as const,
        handler: async (args: { siteId: string; minImpressions?: number; refresh?: boolean }, ctx) => {
          ctx.log.phase('classify_intent');

          const gscProperty = ctx.state.get<string>(gscPropertyKey(args.siteId));
          if (!gscProperty) return ok(`⚠ No Search Console property bound to "${args.siteId}". Run: connect_gsc siteId="${args.siteId}"`);

          // Use cached results unless refresh requested
          const cached = ctx.state.get<string>(intentCacheKey(gscProperty));
          if (cached && !args.refresh) {
            return ok(`# Intent Classification (cached)\n\n${cached}\n\nRun with refresh=true to re-classify.`);
          }

          let token: string;
          try { token = (await ctx.credentials.getToken('google')).token; }
          catch (e: unknown) { return ok(`⚠ Google not connected: ${(e as Error).message}`); }

          const minImp = args.minImpressions ?? 20;
          const { startDate, endDate } = dateRange(0);

          let rows: GscRow[];
          try {
            rows = await fetchGsc(token, gscProperty, {
              startDate, endDate,
              dimensions: ['query'],
              rowLimit: 25000,
            });
          } catch (e: unknown) {
            return ok(`⚠ GSC API error: ${(e as Error).message}`);
          }

          const significant = rows
            .filter(r => r.impressions >= minImp)
            .sort((a, b) => b.impressions - a.impressions)
            .slice(0, 200); // classify top 200

          ctx.log.info(`Classifying ${significant.length} queries...`);

          // Site context grounds classification: "installation" means very
          // different things on a hosting site vs. a home-improvement blog.
          let siteContext = '';
          try {
            const map = await buildTopicMapForSite(args.siteId, ctx.tools, 6, () => {});
            if (map && map.clusters.length > 0) {
              siteContext = `This site's main topics are: ${map.clusters.slice(0, 6).map(c => c.label).join('; ')}.\n\n`;
            }
          } catch { /* topic map is optional context */ }

          // Batch classify using ctx.ai.generateObject — 20 queries per call
          const BATCH = 20;
          const classified: Array<{ query: string; intent: string; impressions: number; heuristic: boolean }> = [];

          for (let i = 0; i < significant.length; i += BATCH) {
            const batch = significant.slice(i, i + BATCH);
            const queries = batch.map(r => r.keys[0]);

            try {
              const result = await ctx.ai.generateObject<{ classifications: Array<{ index: number; intent: 'informational' | 'navigational' | 'transactional' | 'commercial' }> }>({
                prompt:
`You are classifying real Google Search queries that brought visitors to a website, so the site owner can see which kinds of intent their content serves.

${siteContext}Classify each query into exactly one intent:

- informational — wants to learn or understand something: how-tos, definitions, troubleshooting, "what is" questions.
  e.g. "how to speed up wordpress", "what is a cdn", "php memory limit error"
- commercial — comparing or evaluating options before choosing: "best", "vs", reviews, alternatives, price comparisons.
  e.g. "best wordpress hosting", "wp rocket vs nitropack", "cheapest managed hosting"
- transactional — ready to act now: buy, sign up, download, start a trial.
  e.g. "buy nitropack license", "wp engine free trial", "download acf pro"
- navigational — looking for a specific brand, product, site, or page by name, or trying to log in.
  e.g. "wp engine login", "nitropack dashboard", "advanced custom fields docs"

Rules:
- Choose the single best fit. If a query could be commercial or informational, ask whether the person is comparing options (commercial) or learning (informational).
- A brand name alone is navigational; a brand name plus a comparison word is commercial.
- Return one entry per query, identified by its number. Do not skip, merge, reorder, or reword any query.

Queries:
${queries.map((q, idx) => `${idx + 1}. ${q}`).join('\n')}`,
                schema: {
                  type: 'object',
                  properties: {
                    classifications: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          index: { type: 'number', description: 'The query number from the list above (1-based)' },
                          intent: { type: 'string', enum: ['informational', 'navigational', 'transactional', 'commercial'] },
                        },
                        required: ['index', 'intent'],
                      },
                    },
                  },
                  required: ['classifications'],
                },
                noTools: true,
              });

              // Keyed by INDEX, not by echoed query text: any paraphrase, trim,
              // or re-casing by the model used to silently zero that query's
              // impressions via the old batch.find(r => r.keys[0] === c.query).
              const seen = new Set<number>();
              for (const c of result.classifications ?? []) {
                const i = Math.floor(Number(c.index)) - 1;
                if (!Number.isFinite(i) || i < 0 || i >= batch.length || seen.has(i)) continue;
                seen.add(i);
                classified.push({
                  query: batch[i].keys[0],
                  intent: c.intent,
                  impressions: batch[i].impressions,
                  heuristic: false,
                });
              }
              // Anything the model dropped falls back rather than vanishing.
              for (let i = 0; i < batch.length; i++) {
                if (seen.has(i)) continue;
                classified.push({
                  query: batch[i].keys[0],
                  intent: heuristicIntent(batch[i].keys[0]),
                  impressions: batch[i].impressions,
                  heuristic: true,
                });
              }
            } catch {
              // Fall back to keyword heuristics — tagged so the report can say
              // which rows were not model-classified.
              for (const row of batch) {
                classified.push({
                  query: row.keys[0],
                  intent: heuristicIntent(row.keys[0]),
                  impressions: row.impressions,
                  heuristic: true,
                });
              }
            }
          }

          // Summarize by intent
          const byIntent = new Map<string, Array<{ query: string; impressions: number; heuristic: boolean }>>();
          for (const c of classified) {
            if (!byIntent.has(c.intent)) byIntent.set(c.intent, []);
            byIntent.get(c.intent)!.push({ query: c.query, impressions: c.impressions, heuristic: c.heuristic });
          }
          const heuristicCount = classified.filter(c => c.heuristic).length;

          const lines = [
            `# Intent Classification: ${gscProperty}`,
            `${classified.length} queries classified (min ${minImp} impressions)` +
              (heuristicCount > 0 ? ` — ⚠ ${heuristicCount} via keyword heuristic (model unavailable), marked (h)` : ''),
            '',
            ...['informational', 'commercial', 'transactional', 'navigational'].map(intent => {
              const items = byIntent.get(intent) ?? [];
              const totalImp = items.reduce((s, i) => s + i.impressions, 0);
              return [
                `## ${intent.charAt(0).toUpperCase() + intent.slice(1)}: ${items.length} queries (${totalImp.toLocaleString()} impressions)`,
                ...items.slice(0, 5).map(i => `  ${i.impressions}imp — "${i.query}"${i.heuristic ? ' (h)' : ''}`),
                items.length > 5 ? `  … and ${items.length - 5} more` : '',
              ].filter(Boolean).join('\n');
            }),
          ].join('\n');

          ctx.state.set(intentCacheKey(gscProperty), lines);
          return ok(lines);
        },
      },

      // ------------------------------------------------------------------
      // detect_decay — T1: compare two 28-day windows
      // ------------------------------------------------------------------
      detect_decay: {
        description: 'Detect pages with declining clicks or impressions over the past 28 complete days vs. the prior 28-day period. Windows end 2 days back because Search Console data is incomplete for recent days.',
        inputSchema: {
          type: 'object',
          properties: {
            siteId: { type: 'string', description: 'Site whose bound GSC property to analyze (see connect_gsc)' },
            minImpressionsPrior: { type: 'number', default: 50, description: 'Minimum impressions in prior period to be considered' },
            declineThresholdPct: { type: 'number', default: 20, description: 'Flag pages that lost ≥this % of clicks or impressions' },
          },
          required: ['siteId'],
        },
        executionMode: 'function' as const,
        handler: async (args: { siteId: string; minImpressionsPrior?: number; declineThresholdPct?: number }, ctx) => {
          ctx.log.phase('detect_decay');

          const gscProperty = ctx.state.get<string>(gscPropertyKey(args.siteId));
          if (!gscProperty) return ok(`⚠ No Search Console property bound to "${args.siteId}". Run: connect_gsc siteId="${args.siteId}"`);

          const minImp = args.minImpressionsPrior ?? 50;
          const threshold = (args.declineThresholdPct ?? 20) / 100;

          let token: string;
          try { token = (await ctx.credentials.getToken('google')).token; }
          catch (e: unknown) { return ok(`⚠ Google not connected: ${(e as Error).message}`); }

          // Current 28 days vs prior 28 days
          const current = dateRange(0);
          const prior = dateRange(28);

          ctx.log.info(`Comparing ${prior.startDate}–${prior.endDate} vs ${current.startDate}–${current.endDate}`);

          let currentRows: GscRow[] = [];
          let priorRows: GscRow[] = [];
          try {
            [currentRows, priorRows] = await Promise.all([
              fetchGsc(token, gscProperty, { ...current, dimensions: ['page'], rowLimit: 25000 }),
              fetchGsc(token, gscProperty, { ...prior, dimensions: ['page'], rowLimit: 25000 }),
            ]);
          } catch (e: unknown) {
            return ok(`⚠ GSC API error: ${(e as Error).message}`);
          }

          const currentByPage = new Map(currentRows.map(r => [r.keys[0], r]));
          const priorByPage = new Map(priorRows.map(r => [r.keys[0], r]));

          const decayed: Array<{ page: string; priorClicks: number; currentClicks: number; priorImp: number; currentImp: number; clickDelta: number; impDelta: number }> = [];

          for (const [page, priorRow] of priorByPage) {
            if (priorRow.impressions < minImp) continue;
            const currentRow = currentByPage.get(page);
            const currentClicks = currentRow?.clicks ?? 0;
            const currentImp = currentRow?.impressions ?? 0;
            const clickDelta = priorRow.clicks > 0
              ? (currentClicks - priorRow.clicks) / priorRow.clicks
              : 0;
            const impDelta = priorRow.impressions > 0
              ? (currentImp - priorRow.impressions) / priorRow.impressions
              : 0;

            // The description promises clicks OR impressions — check both.
            // Impression decay often leads click decay, so it's the earlier signal.
            if (clickDelta <= -threshold || impDelta <= -threshold) {
              decayed.push({
                page,
                priorClicks: priorRow.clicks,
                currentClicks,
                priorImp: priorRow.impressions,
                currentImp,
                clickDelta,
                impDelta,
              });
            }
          }

          decayed.sort((a, b) => Math.min(a.clickDelta, a.impDelta) - Math.min(b.clickDelta, b.impDelta)); // worst first

          if (decayed.length === 0) {
            return ok(`✓ No significant decay detected (≥${args.declineThresholdPct ?? 20}% click or impression drop, min ${minImp} prior impressions)`);
          }

          const lines = [
            `# Content Decay: ${gscProperty}`,
            `${decayed.length} pages lost ≥${args.declineThresholdPct ?? 20}% of clicks or impressions`,
            `Comparing: ${prior.startDate}–${prior.endDate} → ${current.startDate}–${current.endDate}`,
            '',
            ...decayed.slice(0, 15).map(d => [
              `  clicks ${Math.round(d.clickDelta * 100)}% (${d.priorClicks}→${d.currentClicks}) | impressions ${Math.round(d.impDelta * 100)}% (${d.priorImp}→${d.currentImp})`,
              `  ${d.page}`,
            ].join('\n')),
            decayed.length > 15 ? `\n… and ${decayed.length - 15} more` : '',
          ].filter(Boolean).join('\n');

          ctx.log.finding({
            id: 'content-decay',
            severity: decayed.length > 5 ? 'medium' : 'low',
            title: `${decayed.length} pages showing significant click decline`,
            description: decayed.slice(0, 3).map(d => d.page.split('/').slice(-2).join('/')).join(', '),
          });

          return ok(lines);
        },
      },

      // ------------------------------------------------------------------
      // analyze_ai_crawl_health — log-backed AI bot traffic analysis
      // ------------------------------------------------------------------
      analyze_ai_crawl_health: {
        description: 'Analyze AI crawler traffic (training and retrieval bots) from access log aggregates. Requires log-processor to have ingested logs for this site.',
        inputSchema: {
          type: 'object',
          properties: {
            siteId: { type: 'string', description: 'Site ID to analyze' },
            days: { type: 'number', default: 30, description: 'Number of days to analyze (default 30)' },
          },
          required: ['siteId'],
        },
        executionMode: 'function' as const,
        handler: async (args: { siteId: string; days?: number }, ctx) => {
          ctx.log.phase('analyze_ai_crawl_health');
          const days = args.days ?? 30;
          const to = addDays(utcToday(), -1);
          const from = addDays(to, -(days - 1));

          let aggregates: DayAggregate[];
          let missingNote = '';
          try {
            const raw = await ctx.tools.invoke('get_log_aggregates', { siteId: args.siteId, from, to });
            const parsed = parseLogAggregates(raw);
            if (!parsed) throw new Error('empty or unparseable response');
            aggregates = Object.values(parsed.aggregates ?? {}) as DayAggregate[];
            missingNote = parsed.missingDaysNote ?? '';
          } catch (e: unknown) {
            return ok(`⚠ Could not fetch log aggregates for "${args.siteId}": ${(e as Error).message}\n\nRun sync_access_logs first via the log-processor agent.`);
          }

          if (aggregates.length === 0) {
            return ok(`⚠ No log data available for "${args.siteId}" in range ${from}–${to}.\n\nRun sync_access_logs via the log-processor agent to ingest logs.`);
          }

          // Aggregate AI bot stats across all days
          const trainingTotals: Record<string, { hits: number; paths: number }> = {};
          const retrievalTotals: Record<string, { hits: number; paths: number }> = {};
          let totalRequests = 0;

          for (const agg of aggregates) {
            totalRequests += agg.requests;
            for (const [bot, data] of Object.entries(agg.aiTraining)) {
              if (!trainingTotals[bot]) trainingTotals[bot] = { hits: 0, paths: 0 };
              trainingTotals[bot].hits += data.hits;
              trainingTotals[bot].paths += Object.keys(data.topPaths).length;
            }
            for (const [bot, data] of Object.entries(agg.aiRetrieval)) {
              if (!retrievalTotals[bot]) retrievalTotals[bot] = { hits: 0, paths: 0 };
              retrievalTotals[bot].hits += data.hits;
              retrievalTotals[bot].paths += Object.keys(data.topPaths).length;
            }
          }

          const trainingEntries = Object.entries(trainingTotals).sort((a, b) => b[1].hits - a[1].hits);
          const retrievalEntries = Object.entries(retrievalTotals).sort((a, b) => b[1].hits - a[1].hits);

          const totalAiTraining = trainingEntries.reduce((s, [, v]) => s + v.hits, 0);
          const totalAiRetrieval = retrievalEntries.reduce((s, [, v]) => s + v.hits, 0);
          const aiPct = totalRequests > 0 ? ((totalAiTraining + totalAiRetrieval) / totalRequests * 100).toFixed(1) : '0';

          const lines = [
            `# AI Crawl Health: ${args.siteId}`,
            `Period: ${from} → ${to} (${aggregates.length} days) | Total requests: ${totalRequests.toLocaleString()}`,
            `AI traffic: ${(totalAiTraining + totalAiRetrieval).toLocaleString()} requests (${aiPct}% of total)`,
            '',
            `## AI Training Bots (${totalAiTraining.toLocaleString()} hits)`,
            trainingEntries.length > 0
              ? trainingEntries.slice(0, 10).map(([bot, v]) => `  ${v.hits.toLocaleString()} hits — ${bot}`).join('\n')
              : '  None detected',
            '',
            `## AI Retrieval Bots (${totalAiRetrieval.toLocaleString()} hits)`,
            retrievalEntries.length > 0
              ? retrievalEntries.slice(0, 10).map(([bot, v]) => `  ${v.hits.toLocaleString()} hits — ${bot}`).join('\n')
              : '  None detected',
          ];

          if (missingNote) lines.push('', `⚠ ${missingNote}`);

          if (totalAiTraining + totalAiRetrieval > 0) {
            ctx.log.finding({
              id: 'ai-crawl-detected',
              severity: 'info',
              title: `${(totalAiTraining + totalAiRetrieval).toLocaleString()} AI bot requests in ${days} days`,
              description: `Training: ${totalAiTraining.toLocaleString()}, Retrieval: ${totalAiRetrieval.toLocaleString()}`,
            });
          }

          return ok(lines.join('\n'));
        },
      },

      // ------------------------------------------------------------------
      // analyze_404_demand — log-backed demand gap detection via 404s
      // ------------------------------------------------------------------
      analyze_404_demand: {
        description: 'Analyze 404 errors that look like real content requests (demand signals). Uses access log aggregates from log-processor. High-volume content-like 404s indicate topics the audience wants.',
        inputSchema: {
          type: 'object',
          properties: {
            siteId: { type: 'string', description: 'Site ID to analyze' },
            days: { type: 'number', default: 30, description: 'Number of days to analyze (default 30)' },
            minHits: { type: 'number', default: 5, description: 'Minimum hits to surface a 404 path' },
          },
          required: ['siteId'],
        },
        executionMode: 'function' as const,
        handler: async (args: { siteId: string; days?: number; minHits?: number }, ctx) => {
          ctx.log.phase('analyze_404_demand');
          const days = args.days ?? 30;
          const minHits = args.minHits ?? 5;
          const to = addDays(utcToday(), -1);
          const from = addDays(to, -(days - 1));

          let aggregates: DayAggregate[];
          let missingNote = '';
          try {
            const raw = await ctx.tools.invoke('get_log_aggregates', { siteId: args.siteId, from, to });
            const parsed = parseLogAggregates(raw);
            if (!parsed) throw new Error('empty or unparseable response');
            aggregates = Object.values(parsed.aggregates ?? {}) as DayAggregate[];
            missingNote = parsed.missingDaysNote ?? '';
          } catch (e: unknown) {
            return ok(`⚠ Could not fetch log aggregates for "${args.siteId}": ${(e as Error).message}\n\nRun sync_access_logs first via the log-processor agent.`);
          }

          if (aggregates.length === 0) {
            return ok(`⚠ No log data available for "${args.siteId}" in range ${from}–${to}.\n\nRun sync_access_logs via the log-processor agent to ingest logs.`);
          }

          // Aggregate content-like 404s across days
          const contentLike: Record<string, number> = {};
          let scannerTotal = 0;

          for (const agg of aggregates) {
            scannerTotal += agg.notFound.scanner;
            for (const [path, count] of Object.entries(agg.notFound.contentLike)) {
              contentLike[path] = (contentLike[path] ?? 0) + count;
            }
          }

          const demandSignals = Object.entries(contentLike)
            .filter(([, hits]) => hits >= minHits)
            .sort((a, b) => b[1] - a[1]);

          const lines = [
            `# 404 Demand Analysis: ${args.siteId}`,
            `Period: ${from} → ${to} (${aggregates.length} days)`,
            `Scanner 404s: ${scannerTotal.toLocaleString()} | Content-like 404s: ${Object.values(contentLike).reduce((s, v) => s + v, 0).toLocaleString()}`,
            '',
            `## Top Demand Signals (≥${minHits} hits, ${demandSignals.length} paths)`,
            demandSignals.length > 0
              ? demandSignals.slice(0, 20).map(([path, hits]) => `  ${hits.toLocaleString()} hits — ${path}`).join('\n')
              : '  No significant demand signals detected',
          ];

          if (missingNote) lines.push('', `⚠ ${missingNote}`);

          if (demandSignals.length > 0) {
            ctx.log.finding({
              id: '404-demand-signals',
              severity: demandSignals.length > 10 ? 'medium' : 'low',
              title: `${demandSignals.length} content-demand 404 paths (≥${minHits} hits each)`,
              description: demandSignals.slice(0, 3).map(([p]) => p).join(', '),
            });
          }

          return ok(lines.join('\n'));
        },
      },

      // ------------------------------------------------------------------
      // analyze_referral_sources — log-backed traffic composition analysis
      // ------------------------------------------------------------------
      analyze_referral_sources: {
        description: 'Analyze traffic referral sources from access log aggregates: search engines, AI referrers, direct, and other. Uses log-processor data.',
        inputSchema: {
          type: 'object',
          properties: {
            siteId: { type: 'string', description: 'Site ID to analyze' },
            days: { type: 'number', default: 30, description: 'Number of days to analyze (default 30)' },
          },
          required: ['siteId'],
        },
        executionMode: 'function' as const,
        handler: async (args: { siteId: string; days?: number }, ctx) => {
          ctx.log.phase('analyze_referral_sources');
          const days = args.days ?? 30;
          const to = addDays(utcToday(), -1);
          const from = addDays(to, -(days - 1));

          let aggregates: DayAggregate[];
          let missingNote = '';
          try {
            const raw = await ctx.tools.invoke('get_log_aggregates', { siteId: args.siteId, from, to });
            const parsed = parseLogAggregates(raw);
            if (!parsed) throw new Error('empty or unparseable response');
            aggregates = Object.values(parsed.aggregates ?? {}) as DayAggregate[];
            missingNote = parsed.missingDaysNote ?? '';
          } catch (e: unknown) {
            return ok(`⚠ Could not fetch log aggregates for "${args.siteId}": ${(e as Error).message}\n\nRun sync_access_logs first via the log-processor agent.`);
          }

          if (aggregates.length === 0) {
            return ok(`⚠ No log data available for "${args.siteId}" in range ${from}–${to}.\n\nRun sync_access_logs via the log-processor agent to ingest logs.`);
          }

          // Aggregate referral sources across days
          const searchTotals: Record<string, number> = {};
          const aiTotals: Record<string, number> = {};
          let otherTotal = 0;
          let internalTotal = 0;
          let spoofedTotal = 0;

          for (const agg of aggregates) {
            for (const [src, count] of Object.entries(agg.referrals.search)) {
              searchTotals[src] = (searchTotals[src] ?? 0) + count;
            }
            for (const [src, count] of Object.entries(agg.referrals.ai)) {
              aiTotals[src] = (aiTotals[src] ?? 0) + count;
            }
            otherTotal += agg.referrals.other;
            internalTotal += agg.referrals.internal;
            spoofedTotal += agg.referrals.spoofed;
          }

          const searchTotal = Object.values(searchTotals).reduce((s, v) => s + v, 0);
          const aiTotal = Object.values(aiTotals).reduce((s, v) => s + v, 0);
          const grandTotal = searchTotal + aiTotal + otherTotal + internalTotal + spoofedTotal;

          const pct = (n: number) => grandTotal > 0 ? `${(n / grandTotal * 100).toFixed(1)}%` : '0%';

          const searchEntries = Object.entries(searchTotals).sort((a, b) => b[1] - a[1]);
          const aiEntries = Object.entries(aiTotals).sort((a, b) => b[1] - a[1]);

          const lines = [
            `# Referral Sources: ${args.siteId}`,
            `Period: ${from} → ${to} (${aggregates.length} days) | Total referrals: ${grandTotal.toLocaleString()}`,
            '',
            `## Search Traffic: ${searchTotal.toLocaleString()} (${pct(searchTotal)})`,
            searchEntries.length > 0
              ? searchEntries.slice(0, 10).map(([src, hits]) => `  ${hits.toLocaleString()} — ${src}`).join('\n')
              : '  None detected',
            '',
            `## AI Referrals: ${aiTotal.toLocaleString()} (${pct(aiTotal)})`,
            aiEntries.length > 0
              ? aiEntries.slice(0, 10).map(([src, hits]) => `  ${hits.toLocaleString()} — ${src}`).join('\n')
              : '  None detected',
            '',
            `## Other: ${otherTotal.toLocaleString()} (${pct(otherTotal)}) | Internal: ${internalTotal.toLocaleString()} (${pct(internalTotal)}) | Spoofed: ${spoofedTotal.toLocaleString()}`,
          ];

          if (missingNote) lines.push('', `⚠ ${missingNote}`);

          if (aiTotal > 0) {
            ctx.log.finding({
              id: 'ai-referral-traffic',
              severity: 'info',
              title: `${aiTotal.toLocaleString()} AI referral visits (${pct(aiTotal)} of tracked referrals)`,
              description: aiEntries.slice(0, 3).map(([s]) => s).join(', '),
            });
          }

          return ok(lines.join('\n'));
        },
      },
    },
  },

  // ---------------------------------------------------------------------------
  // run() — triggered by UI site selector (via agentEmit wpe:sync.completed)
  // or weekly cron. Produces the Site Content Report.
  //
  // Per-site cooldown prevents duplicate runs when the weekly cron fires
  // while a site was already analyzed recently.
  // ---------------------------------------------------------------------------
  async run({ event, tools, state, log, credentials, settings }) {
    const payloadSite = (event?.payload as Record<string, unknown> | undefined)
      ?.installName as string | undefined;

    // -----------------------------------------------------------------------
    // Target resolution. An event naming one install (or Run Now) is the user
    // pointing at a site directly and is not constrained by scope — same rule
    // security-sentinel's resolveScanScope documents.
    //
    // The scheduled path used to fall back to a "watchlist" state key, then to
    // auto-picking the largest Local sites by post count — both acted without
    // the user having chosen anything, which is the exact "unconfigured must
    // never mean pick-for-me" bug resolveScanScope exists to prevent. Replaced
    // with the same settings.scope.siteIds field security-sentinel and
    // log-processor use: absent or empty scope analyzes nothing, deliberately.
    // -----------------------------------------------------------------------
    let targets: string[] = [];
    if (payloadSite) {
      targets = [payloadSite];
    } else {
      const scope = (settings as Record<string, unknown> | undefined)?.scope as { siteIds?: unknown } | undefined;
      targets = Array.isArray(scope?.siteIds)
        ? scope!.siteIds.filter((id): id is string => typeof id === 'string' && id.length > 0).slice(0, CRON_MAX_SITES)
        : [];

      if (targets.length === 0) {
        log.info('seo-insights: no sites in scope for scheduled analysis. Select sites in the agent\'s settings.');
        return;
      }
      log.info(`Scheduled run targets: ${targets.join(', ')}`);
    }

    const summaries: string[] = [];

    for (const targetSite of targets) {
      // Per-site cooldown: background wpe:sync.completed events fire for every
      // site on a schedule, and cron may overlap an event-driven run.
      const cdKey = cooldownKeyFor(targetSite);
      const lastAnalyzed = state.get<number>(cdKey);
      if (typeof lastAnalyzed === 'number' && Date.now() - lastAnalyzed < ANALYSIS_COOLDOWN_MS) {
        const mins = Math.round((Date.now() - lastAnalyzed) / 60000);
        log.info(`Skipping ${targetSite} — analyzed ${mins} min ago (cooldown ${ANALYSIS_COOLDOWN_MS / 3600000}h)`);
        continue;
      }

      log.phase('Site Content Report', `Analyzing: ${targetSite}`);

      // Resolve site: Local or WPE?
      let site: SiteRow | null = null;
      try {
        const rows = parseFleetSqlRows(
          await tools.invoke('fleet_sql', {
            query: 'SELECT id, name, source, ssh_last_sync_at, post_count FROM sites WHERE name = ? LIMIT 1',
            params: [targetSite],
          })
        );
        site = rows[0] ?? null;
      } catch { /* fleet_sql unavailable */ }

      const isWpe = site?.source === 'wpe';
      const siteName = site?.name ?? targetSite;
      log.info(`Site resolved: ${siteName} (${isWpe ? 'WP Engine' : 'Local'})`);
      log.siteStatus(siteName, 'running');

      // Determine which site to analyze: sandbox for WPE, siteName for Local
      let analysisSite: string = siteName;
      let createdSandbox = false;

      if (isWpe) {
        const sandbox = await createAndPullSandbox(siteName, tools, log);
        if (!sandbox) {
          log.siteStatus(siteName, 'error');
          log.warn(`Could not prepare sandbox for ${siteName} — skipping analysis`);
          // Still record the attempt so a failing site can't hot-loop.
          state.set(cdKey, Date.now());
          continue;
        }
        analysisSite = sandbox;
        createdSandbox = true;
        state.set('lastSandbox', sandbox);

        // Reindex the sandbox so get_all_site_documents returns posts
        log.info(`[SEO] Starting sandbox site for indexing: ${analysisSite}`);
        try { await tools.invoke('local_start_site', { site: analysisSite }); } catch { /* may already be running */ }
        await waitForIndex(analysisSite, tools, log, 90_000);
      } else {
        // Local site — start it first (sentinel pattern), then analyze
        log.info(`Starting site for analysis: ${siteName}`);
        try {
          await tools.invoke('local_start_site', { site: siteName });
          log.info(`Site started`);
        } catch { /* already running or start not needed */ }
        await new Promise(r => setTimeout(r, 5_000)); // let MySQL come up

        // Check index health
        try {
          const indexText = await tools.invoke('get_index_status', { site: siteName }) as string;
          if (typeof indexText === 'string' && indexText.includes('has not been indexed')) {
            log.finding({
              id: 'stale-index',
              severity: 'medium',
              title: `Index is stale or missing for "${siteName}"`,
              description: 'Content map will be unavailable until the site is reindexed.',
              site: siteName,
            });
          } else if (typeof indexText === 'string') {
            log.info(`Index: ${indexText.split('\n').slice(0, 3).join(' | ')}`);
          }
        } catch { /* not yet indexed */ }
      }

      // ----------------------------------------------------------------
      // Analysis. Everything below runs to completion — the old code
      // returned from inside this try block, so the GSC section, cooldown
      // and bookkeeping only ever executed when analysis THREW.
      // ----------------------------------------------------------------
      log.phase('Content Analysis', analysisSite);

      let reportLines: string | null = null;

      try {
        const { posts, orphans, stale, docs, truncated } =
          await analyzeContent(analysisSite, tools, 365, (m) => log.warn(m));

        log.info(`Analyzed ${posts.length} published posts on "${analysisSite}" (${docs.reduce((s, d) => s + d.chunkCount, 0)} indexed chunks)`);

        if (orphans.length > 0) {
          log.finding({
            id: 'orphaned-content',
            severity: orphans.length > posts.length * 0.3 ? 'high' : 'medium',
            title: `${orphans.length} of ${posts.length} posts have no inbound internal links`,
            description: orphans.slice(0, 5).map(p => `/${p.post_name}`).join(', ') + (orphans.length > 5 ? ` + ${orphans.length - 5} more` : ''),
            site: siteName,
          });
        }

        if (stale.length > 0) {
          log.finding({
            id: 'stale-content',
            severity: 'low',
            title: `${stale.length} posts not updated in over a year`,
            description: stale.slice(0, 3).map(p => p.post_title).join(', ') + (stale.length > 3 ? ` + ${stale.length - 3} more` : ''),
            site: siteName,
          });
        }

        if (truncated.length > 0) {
          log.finding({
            id: 'degraded-index-entries',
            severity: 'low',
            title: `${truncated.length} index entries look truncated (webhook-indexed)`,
            description: 'Excluded from overlap analysis — reindex the site to restore full fidelity.',
            site: siteName,
          });
        }

        if (posts.length > 0 && posts.length < 10) {
          log.finding({
            id: 'thin-corpus',
            severity: 'low',
            title: `Small content corpus: only ${posts.length} published posts/pages`,
            description: 'Topical map analysis works best with 20+ posts.',
            site: siteName,
          });
        }

        // Resolve log siteId — always the WPE install name.
        // For WPE sites: siteName IS the install name.
        // For local sites linked to WPE: resolve via local_wpe_link.
        let logSiteId = siteName;
        if (!isWpe) {
          try {
            const linkResult = await tools.invoke('local_wpe_link', { site: siteName }) as string;
            // Response: "## WPE Link for ...\n- **wpe:** <installName or UUID>"
            const match = typeof linkResult === 'string' ? linkResult.match(/\*\*\w+:\*\*\s+(\S+)/) : null;
            if (match?.[1]) {
              let candidate = match[1];
              const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(candidate);
              if (isUuid) {
                try {
                  const rows = parseFleetSqlRows(await tools.invoke('fleet_sql', {
                    query: `SELECT name FROM sites WHERE source = 'wpe' AND remote_install_id = ? LIMIT 1`,
                    params: [candidate],
                  }));
                  if (rows[0]?.name) candidate = rows[0].name;
                } catch { /* keep UUID */ }
              }
              logSiteId = candidate;
              log.info(`[LOG] Resolved linked WPE install for "${siteName}": ${logSiteId}`);
            }
          } catch { /* no link — log data will likely be absent */ }
        }

        // Traffic Intelligence from log-processor (graceful skip if no data)
        let logSection: string | null = null;
        try {
          logSection = await getLogInsights(logSiteId, tools, log);
        } catch (err: unknown) {
          log.info(`[LOG] Traffic intelligence unavailable: ${(err as Error).message}`);
        }

        // Topical map — shared builder, chunk-aggregated
        let topicSection = '';
        try {
          const map = await buildTopicMapForSite(analysisSite, tools, TOPIC_CLUSTERS, (m) => log.warn(m));
          if (map) {
            topicSection = [
              ``,
              `## Topical Map`,
              `${map.docCount} posts in ${map.k} clusters`,
              ...map.clusters.slice(0, 8).map((c, i) => `  ${i + 1}. ${c.label} — ${c.count} posts`),
              map.clusters.length > 8 ? `  … ${map.clusters.length - 8} more — run build_topic_map for the full map` : '',
            ].filter(Boolean).join('\n');
          }
        } catch (e: unknown) {
          log.warn(`Topic map unavailable: ${(e as Error).message}`);
        }

        reportLines = [
          `# Site Content Report: ${siteName}`,
          ``,
          `**Posts analyzed:** ${posts.length}`,
          `**Orphaned (no inbound links):** ${orphans.length}${orphans.length > 0 ? ` — ${orphans.slice(0, 3).map(p => p.post_title).join(', ')}${orphans.length > 3 ? ` +${orphans.length - 3} more` : ''}` : ''}`,
          `**Stale (>365 days old):** ${stale.length}${stale.length > 0 ? ` — ${stale.slice(0, 3).map(p => p.post_title).join(', ')}${stale.length > 3 ? ` +${stale.length - 3} more` : ''}` : ''}`,
          truncated.length > 0 ? `**Degraded index entries:** ${truncated.length} (reindex to restore full fidelity)` : '',
          createdSandbox ? `**Analyzed via sandbox:** ${analysisSite}` : '',
          topicSection,
          logSection ?? '',
        ].filter(Boolean).join('\n');

        log.siteStatus(siteName, orphans.length + stale.length > 0 ? 'findings' : 'clean');
      } catch (e: unknown) {
        const msg = (e as Error).message;
        if (msg.includes('not running') || msg.includes('halted')) {
          log.warn(`Site "${analysisSite}" is not running — start it in Local to run analysis`);
          log.siteStatus(siteName, 'findings');
        } else {
          log.warn(`Analysis failed: ${msg}`);
          log.siteStatus(siteName, 'error');
        }
      }

      // ----------------------------------------------------------------
      // T1 — GSC demand layer. Runs regardless of whether content analysis
      // succeeded: demand data doesn't depend on the local index.
      // ----------------------------------------------------------------
      let gscLine = '';
      try {
        const gscStatus = await credentials.getStatus('google');
        const gscProperty = state.get<string>(gscPropertyKey(siteName));

        if (gscStatus === 'connected' && gscProperty) {
          log.phase('Demand Analysis (T1)', `GSC: ${gscProperty}`);
          // Individual T1 tools are invoked interactively; a scheduled run only
          // surfaces availability so runs stay inside the time budget.
          log.finding({
            id: 'gsc-connected',
            severity: 'info',
            title: 'Search Console connected — run detect_cannibalization and find_demand_gaps for demand analysis',
            site: siteName,
          });
          gscLine = `**Search Console:** connected (${gscProperty}) — run detect_cannibalization / find_demand_gaps for the demand layer`;
        } else if (gscStatus === 'connected') {
          gscLine = `**Search Console:** account connected, but no property is bound to this site — run connect_gsc siteId="${siteName}"`;
        } else if (gscStatus === 'revoked') {
          gscLine = `**Search Console:** access was revoked — reconnect to restore demand analysis`;
        } else {
          log.info('Search Console not connected — T1 demand analysis unavailable. Run connect_gsc to activate.');
          gscLine = `**Next:** Connect Google Search Console to unlock demand-weighted gap analysis (T1)`;
        }
      } catch (e: unknown) {
        log.info(`Search Console status unavailable: ${(e as Error).message}`);
      }

      if (reportLines) {
        reportLines = [reportLines, gscLine].filter(Boolean).join('\n');
        state.set('lastReport', reportLines);
        summaries.push(reportLines);
      } else {
        summaries.push([
          `# Site Content Report: ${siteName}`,
          ``,
          `⚠ Analysis did not complete — see the run log for details.`,
          gscLine,
        ].filter(Boolean).join('\n'));
      }

      // Bookkeeping on EVERY outcome so failures can't hot-loop either.
      state.set(cdKey, Date.now());
      try { await state.setCooldown(cdKey); } catch { /* SDK cooldown optional */ }
      state.set('lastRunAt', Date.now());
      state.set('lastSite', siteName);
      log.info(`seo-insights: run complete for "${siteName}"`);
    }

    if (summaries.length === 0) return;
    // Return summary so RunDrawer renders the Site Content Report inline
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { summary: summaries.join('\n\n---\n\n') } as any;
  },
});
