import { defineAgent, cron, on } from '@nexus-ai/agent-sdk';

// Buffer is a Node.js global — not in lib.es2020 typings but always present at agent runtime.
// eslint-disable-next-line no-var
declare var Buffer: { from(str: string, encoding: string): { buffer: ArrayBufferLike } };

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
): Promise<{ posts: PostRecord[]; orphans: PostRecord[]; stale: PostRecord[] }> {
  // Use the Nexus content index instead of wp_eval to avoid stdout maxBuffer issues on large sites.
  // The index stores chunked content (≤500 words per chunk) — no PHP execution, no size limit.
  const rawResult = await tools.invoke('get_all_site_documents', {
    site: siteId,
    include_embeddings: false,
    full_content: true,  // need full chunk text for internal link detection
  });
  const parsed = (typeof rawResult === 'string' ? JSON.parse(rawResult) : rawResult) as {
    documentCount: number;
    documents: IndexedDoc[];
  };

  if (!parsed.documentCount || !parsed.documents?.length) {
    return { posts: [], orphans: [], stale: [] };
  }

  // Derive slug from doc.id: format is "wp_{siteId}_{postId}" or "wp_{siteId}_{postId}_chunk_{n}"
  const extractSlug = (doc: IndexedDoc): string => {
    // Use title as slug approximation — actual slug not stored in index metadata
    // Falls back to generating from title
    try {
      const meta = JSON.parse(doc.metadata) as Record<string, unknown>;
      return (meta.slug as string) ?? doc.title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    } catch {
      return doc.title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    }
  };

  // Build PostRecord-compatible objects from indexed docs
  const posts: PostRecord[] = parsed.documents.map(doc => {
    let modifiedDate = '';
    try {
      const meta = JSON.parse(doc.metadata) as Record<string, unknown>;
      modifiedDate = (meta.date as string) ?? '';
    } catch { /* use empty */ }
    return {
      ID: doc.postId,
      post_title: doc.title,
      post_name: extractSlug(doc),
      post_date: modifiedDate,
      post_modified: modifiedDate,
      post_type: doc.postType,
      post_content: doc.content,  // first chunk — enough for link detection
    };
  });

  // Build inbound link counts from indexed content
  const staleMs = staleThresholdDays * 86400 * 1000;
  const now = Date.now();
  const inbound = new Map<string, number>();
  for (const p of posts) inbound.set(p.post_name, 0);
  for (const p of posts) {
    for (const other of posts) {
      if (other.ID === p.ID) continue;
      if ((p.post_content ?? '').includes(`/${other.post_name}`)) {
        inbound.set(other.post_name, (inbound.get(other.post_name) ?? 0) + 1);
      }
    }
  }

  const orphans = posts.filter(p => (inbound.get(p.post_name) ?? 0) === 0);
  // Stale detection: index dates are often empty (Gap 2) — only flag when date is available
  const stale = posts.filter(p => {
    if (!p.post_modified) return false;
    const ms = new Date(p.post_modified).getTime();
    return ms > 0 && now - ms > staleMs;
  });
  return { posts, orphans, stale };
}

// ---------------------------------------------------------------------------
// Sandbox setup for WPE sites (sentinel pattern)
// ---------------------------------------------------------------------------

async function createAndPullSandbox(
  siteName: string,
  tools: { invoke(name: string, args: unknown): Promise<unknown> },
  log: { info(msg: string, meta?: Record<string, unknown>): void; warn(msg: string, meta?: Record<string, unknown>): void; error(msg: string, meta?: Record<string, unknown>): void },
): Promise<string | null> {
  const sandboxName = `seo-${siteName}-${Date.now()}`;
  log.info(`Creating sandbox: ${sandboxName}`);

  try {
    await tools.invoke('local_create_site', { name: sandboxName });
    log.info(`Sandbox created`);
  } catch (e: unknown) {
    log.warn(`Could not create sandbox: ${(e as Error).message}`);
    return null;
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

// 28-day date range helpers
function dateRange(daysAgo: number, windowDays = 28): { startDate: string; endDate: string } {
  const end = new Date(Date.now() - daysAgo * 86400_000);
  const start = new Date(Date.now() - (daysAgo + windowDays) * 86400_000);
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
  version: '0.3.0',
  description: 'Content strategy agent — topical map, gap analysis, and overlap detection from your WordPress install',

  timeoutMs: 20 * 60 * 1000,   // 20 min — WPE pull + analysis can take 10+ min (same as sentinel)

  credentials: [
    {
      provider: 'google',
      scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
      optional: true,
      reason: 'Reads Search Console query data to find demand gaps and confirm cannibalization',
    },
  ],

  triggers: [
    cron('0 7 * * 1'),           // Weekly scheduled report
    on('wpe:sync.completed'),    // UI site selector + nexus agent run --install <site>
    // NOTE: on('wpe:sync.completed') also fires for background WPE syncs (every site, every
    // N hours). The 6-hour per-site cooldown in run() prevents re-analyzing the same site
    // more than once per cooldown window, even if the event fires repeatedly.
  ],

  tools: [
    'local_list_sites',
    'search_site_content',
    'get_all_site_documents',
    'wp_eval',
    'get_index_status',
    'fleet_sql',
    'wpe_site_deep_refresh',
    'local_create_site',
    'local_wpe_pull',
    'local_start_site',
    'local_clone_site',
    'local_operation_status',
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
          const postTypes = args.postTypes ?? ['post', 'page'];
          const limit = args.limit ?? 500;

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

          // NexusToolProvider auto-parses JSON — result is already an object, not a string (F7)
          const rawResult = await ctx.tools.invoke('get_all_site_documents', {
            site: args.siteId,
            include_embeddings: true,
          });
          const parsed = (typeof rawResult === 'string' ? JSON.parse(rawResult) : rawResult) as {
            documentCount: number;
            documents: Array<{ id: string; postId: number; postType: string; title: string; embedding: string }>;
          };

          if (parsed.documentCount === 0) {
            return ok(`⚠ No indexed documents found for "${args.siteId}". Start the site in Local to trigger indexing.`);
          }

          ctx.log.info(`Clustering ${parsed.documentCount} documents into ~${targetClusters} topics`);

          const docs = parsed.documents.map(doc => ({
            ...doc,
            vec: new Float32Array(Buffer.from(doc.embedding, 'base64').buffer),
          }));

          const k = Math.min(targetClusters, docs.length);
          const clusterAssignments = kMeans(docs.map(d => d.vec), k);

          const clusterLabels = clusterAssignments.map((memberIndices, i) => {
            const members = memberIndices.map(idx => docs[idx]);
            const titles = members.map(m => m.title);
            return {
              clusterId: i + 1,
              label: titles[0] ?? `Topic ${i + 1}`,
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
              c.posts.map(t => `  • ${t}`).join('\n'),
            ),
          ].join('\n');

          ctx.log.info(`Topic map built: ${k} clusters from ${parsed.documentCount} documents`);
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

          // NexusToolProvider auto-parses JSON — result is already an object (F7)
          const rawResult = await ctx.tools.invoke('get_all_site_documents', {
            site: args.siteId,
            include_embeddings: true,
          });
          const parsed = (typeof rawResult === 'string' ? JSON.parse(rawResult) : rawResult) as {
            documentCount: number;
            documents: Array<{ postId: number; title: string; embedding: string }>;
          };

          if (parsed.documentCount < 2) {
            return ok('Need at least 2 indexed posts to find overlap candidates.');
          }

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
              `  ${(p.similarity * 100).toFixed(1)}% similar: "${p.a}" ↔ "${p.b}"`,
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
            propertyUrl: {
              type: 'string',
              description: 'Your Search Console property URL (e.g. "https://example.com/" or "sc-domain:example.com"). Leave empty to list available properties.',
            },
          },
        },
        executionMode: 'function' as const,
        handler: async (args: { propertyUrl?: string }, ctx) => {
          ctx.log.phase('connect_gsc');

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
            ctx.state.set('gscProperty', match);
            ctx.log.info(`GSC property set: ${match}`);
            return ok(`✓ Connected to Search Console property: ${match}\n\nT1 tools are now active:\n  • detect_cannibalization\n  • find_demand_gaps\n  • classify_intent\n  • detect_decay`);
          }

          // No propertyUrl — show available properties and ask user to specify
          const existing = ctx.state.get<string>('gscProperty');
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

          const gscProperty = ctx.state.get<string>('gscProperty');
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

          const gscProperty = ctx.state.get<string>('gscProperty');
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

          const gaps: Array<{ query: string; impressions: number; position: number; hasContent: boolean }> = [];

          for (const row of top) {
            const query = row.keys[0];
            let hasContent = false;
            try {
              const searchResult = await ctx.tools.invoke('search_site_content', {
                site: args.siteId,
                query,
                limit: 1,
                min_score: 0.5,
              }) as string;
              // search_site_content returns text — check if it found anything
              hasContent = !searchResult.includes('No results') && !searchResult.includes('0 results');
            } catch { /* assume no content */ }

            gaps.push({ query, impressions: row.impressions, position: row.position, hasContent });
          }

          const trueGaps = gaps.filter(g => !g.hasContent);
          const strikingDistance = gaps.filter(g =>
            g.position >= strikeMin && g.position <= strikeMax && !g.hasContent
          );

          const lines = [
            `# Demand Gaps: ${gscProperty}`,
            `Period: ${startDate} → ${endDate} | Min impressions: ${minImp}`,
            `Analyzed: ${top.length} top queries`,
            '',
            `## Striking Distance (pos ${strikeMin}-${strikeMax}, no content): ${strikingDistance.length}`,
            strikingDistance.length > 0
              ? strikingDistance.map(g => `  pos ${g.position.toFixed(1)} | ${g.impressions}imp — "${g.query}"`).join('\n')
              : '  None found — you rank everything in this zone.',
            '',
            `## True Gaps (impressions, no content): ${trueGaps.length}`,
            ...trueGaps.slice(0, 15).map(g => `  ${g.impressions}imp — "${g.query}"`),
            trueGaps.length > 15 ? `  … and ${trueGaps.length - 15} more` : '',
          ].filter(Boolean).join('\n');

          if (trueGaps.length > 0) {
            ctx.log.finding({
              id: 'demand-gaps',
              severity: trueGaps.length > 10 ? 'high' : 'medium',
              title: `${trueGaps.length} queries with demand but no matching content`,
              description: `${strikingDistance.length} in striking distance (pos ${strikeMin}-${strikeMax})`,
            });
          }

          return ok(lines);
        },
      },

      // ------------------------------------------------------------------
      // classify_intent — T1: batch LLM intent classification, cached
      // ------------------------------------------------------------------
      classify_intent: {
        description: 'Classify Search Console queries by intent: informational, navigational, transactional, commercial. Cached — subsequent calls use stored results.',
        inputSchema: {
          type: 'object',
          properties: {
            minImpressions: { type: 'number', default: 20, description: 'Only classify queries with this many impressions' },
            refresh: { type: 'boolean', default: false, description: 'Re-classify even if cached results exist' },
          },
        },
        executionMode: 'function' as const,
        handler: async (args: { minImpressions?: number; refresh?: boolean }, ctx) => {
          ctx.log.phase('classify_intent');

          const gscProperty = ctx.state.get<string>('gscProperty');
          if (!gscProperty) return ok('⚠ Run connect_gsc first.');

          // Use cached results unless refresh requested
          const cached = ctx.state.get<string>('intentClassification');
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

          // Batch classify using ctx.ai.generateObject — 20 queries per call
          const BATCH = 20;
          const classified: Array<{ query: string; intent: string; impressions: number }> = [];

          for (let i = 0; i < significant.length; i += BATCH) {
            const batch = significant.slice(i, i + BATCH);
            const queries = batch.map(r => r.keys[0]);

            try {
              const result = await ctx.ai.generateObject<{ classifications: Array<{ query: string; intent: 'informational' | 'navigational' | 'transactional' | 'commercial' }> }>({
                prompt: `Classify each search query by intent. Return JSON with "classifications" array.\n\nQueries:\n${queries.map((q, idx) => `${idx + 1}. ${q}`).join('\n')}`,
                schema: {
                  type: 'object',
                  properties: {
                    classifications: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          query: { type: 'string' },
                          intent: { type: 'string', enum: ['informational', 'navigational', 'transactional', 'commercial'] },
                        },
                        required: ['query', 'intent'],
                      },
                    },
                  },
                  required: ['classifications'],
                },
                noTools: true,
              });

              for (const c of result.classifications) {
                const row = batch.find(r => r.keys[0] === c.query);
                classified.push({ query: c.query, intent: c.intent, impressions: row?.impressions ?? 0 });
              }
            } catch {
              // Fall back to heuristic classification for this batch
              for (const q of queries) {
                const intent = /buy|shop|price|cheap|order|purchase/i.test(q) ? 'transactional'
                  : /best|vs|review|compare|top/i.test(q) ? 'commercial'
                  : /how|what|why|when|guide|tutorial/i.test(q) ? 'informational'
                  : 'navigational';
                const row = batch.find(r => r.keys[0] === q);
                classified.push({ query: q, intent, impressions: row?.impressions ?? 0 });
              }
            }
          }

          // Summarize by intent
          const byIntent = new Map<string, Array<{ query: string; impressions: number }>>();
          for (const c of classified) {
            if (!byIntent.has(c.intent)) byIntent.set(c.intent, []);
            byIntent.get(c.intent)!.push({ query: c.query, impressions: c.impressions });
          }

          const lines = [
            `# Intent Classification: ${gscProperty}`,
            `${classified.length} queries classified (min ${minImp} impressions)`,
            '',
            ...['informational', 'commercial', 'transactional', 'navigational'].map(intent => {
              const items = byIntent.get(intent) ?? [];
              const totalImp = items.reduce((s, i) => s + i.impressions, 0);
              return [
                `## ${intent.charAt(0).toUpperCase() + intent.slice(1)}: ${items.length} queries (${totalImp.toLocaleString()} impressions)`,
                ...items.slice(0, 5).map(i => `  ${i.impressions}imp — "${i.query}"`),
                items.length > 5 ? `  … and ${items.length - 5} more` : '',
              ].filter(Boolean).join('\n');
            }),
          ].join('\n');

          ctx.state.set('intentClassification', lines);
          return ok(lines);
        },
      },

      // ------------------------------------------------------------------
      // detect_decay — T1: compare two 28-day windows
      // ------------------------------------------------------------------
      detect_decay: {
        description: 'Detect pages with declining clicks or impressions over the past 28 days vs. the prior 28-day period.',
        inputSchema: {
          type: 'object',
          properties: {
            minImpressionsPrior: { type: 'number', default: 50, description: 'Minimum impressions in prior period to be considered' },
            declineThresholdPct: { type: 'number', default: 20, description: 'Flag pages that lost ≥this % of clicks or impressions' },
          },
        },
        executionMode: 'function' as const,
        handler: async (args: { minImpressionsPrior?: number; declineThresholdPct?: number }, ctx) => {
          ctx.log.phase('detect_decay');

          const gscProperty = ctx.state.get<string>('gscProperty');
          if (!gscProperty) return ok('⚠ Run connect_gsc first.');

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

          const decayed: Array<{ page: string; priorClicks: number; currentClicks: number; priorImp: number; currentImp: number; clickDelta: number }> = [];

          for (const [page, priorRow] of priorByPage) {
            if (priorRow.impressions < minImp) continue;
            const currentRow = currentByPage.get(page);
            const currentClicks = currentRow?.clicks ?? 0;
            const clickDelta = priorRow.clicks > 0
              ? (currentClicks - priorRow.clicks) / priorRow.clicks
              : 0;

            if (clickDelta <= -threshold) {
              decayed.push({
                page,
                priorClicks: priorRow.clicks,
                currentClicks,
                priorImp: priorRow.impressions,
                currentImp: currentRow?.impressions ?? 0,
                clickDelta,
              });
            }
          }

          decayed.sort((a, b) => a.clickDelta - b.clickDelta); // worst first

          if (decayed.length === 0) {
            return ok(`✓ No significant decay detected (≥${args.declineThresholdPct ?? 20}% click drop, min ${minImp} prior impressions)`);
          }

          const lines = [
            `# Content Decay: ${gscProperty}`,
            `${decayed.length} pages lost ≥${args.declineThresholdPct ?? 20}% of clicks`,
            `Comparing: ${prior.startDate}–${prior.endDate} → ${current.startDate}–${current.endDate}`,
            '',
            ...decayed.slice(0, 15).map(d => [
              `  ${Math.round(d.clickDelta * 100)}% | ${d.priorClicks}→${d.currentClicks} clicks`,
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
            const raw = await ctx.tools.invoke('get_log_aggregates', { siteId: args.siteId, from, to }) as { content: Array<{ text: string }> };
            const parsed = JSON.parse(raw.content[0].text) as {
              aggregates: Record<string, unknown>;
              missingDaysNote?: string;
            };
            aggregates = Object.values(parsed.aggregates) as DayAggregate[];
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
            const raw = await ctx.tools.invoke('get_log_aggregates', { siteId: args.siteId, from, to }) as { content: Array<{ text: string }> };
            const parsed = JSON.parse(raw.content[0].text) as {
              aggregates: Record<string, unknown>;
              missingDaysNote?: string;
            };
            aggregates = Object.values(parsed.aggregates) as DayAggregate[];
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
            const raw = await ctx.tools.invoke('get_log_aggregates', { siteId: args.siteId, from, to }) as { content: Array<{ text: string }> };
            const parsed = JSON.parse(raw.content[0].text) as {
              aggregates: Record<string, unknown>;
              missingDaysNote?: string;
            };
            aggregates = Object.values(parsed.aggregates) as DayAggregate[];
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
  async run({ event, tools, state, log, credentials }) {
    const targetSite = (event?.payload as Record<string, unknown> | undefined)
      ?.installName as string | undefined;

    if (!targetSite) {
      log.info('seo-insights: no site selected — use UI site selector or: nexus agent run seo-insights --install <site>');
      return;
    }

    // Cooldown removed for now — re-add when ready to prevent background WPE sync spam
    const cooldownKey = `analyzed:${targetSite}`;

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
    let analysisSite: string | null = siteName;
    let createdSandbox = false;

    if (isWpe) {
      const sandbox = await createAndPullSandbox(siteName, tools, log);
      if (!sandbox) {
        log.siteStatus(siteName, 'error');
        log.warn(`Could not create sandbox for ${siteName} — skipping analysis`);
        return;
      }
      analysisSite = sandbox;
      createdSandbox = true;
      state.set('lastSandbox', sandbox);
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
        if (indexText.includes('has not been indexed')) {
          log.finding({
            id: 'stale-index',
            severity: 'medium',
            title: `Index is stale or missing for "${siteName}"`,
            description: 'Content map will be unavailable until the site is reindexed.',
            site: siteName,
          });
        } else {
          log.info(`Index: ${indexText.split('\n').slice(0, 3).join(' | ')}`);
        }
      } catch { /* not yet indexed */ }
    }

    // ----------------------------------------------------------------
    // Run the actual analysis and produce the Site Content Report
    // ----------------------------------------------------------------
    log.phase('Content Analysis', analysisSite ?? siteName);

    try {
      const { posts, orphans, stale } = await analyzeContent(analysisSite!, tools, 365);

      log.info(`Analyzed ${posts.length} published posts on "${analysisSite}"`);

      // Orphaned content finding
      if (orphans.length > 0) {
        log.finding({
          id: 'orphaned-content',
          severity: orphans.length > posts.length * 0.3 ? 'high' : 'medium',
          title: `${orphans.length} of ${posts.length} posts have no inbound internal links`,
          description: orphans.slice(0, 5).map(p => `/${p.post_name}`).join(', ') + (orphans.length > 5 ? ` + ${orphans.length - 5} more` : ''),
          site: siteName,
        });
      }

      // Stale content finding
      if (stale.length > 0) {
        log.finding({
          id: 'stale-content',
          severity: 'low',
          title: `${stale.length} posts not updated in over a year`,
          description: stale.slice(0, 3).map(p => p.post_title).join(', ') + (stale.length > 3 ? ` + ${stale.length - 3} more` : ''),
          site: siteName,
        });
      }

      // Corpus size finding
      if (posts.length < 10) {
        log.finding({
          id: 'thin-corpus',
          severity: 'low',
          title: `Small content corpus: only ${posts.length} published posts/pages`,
          description: 'Topical map analysis works best with 20+ posts.',
          site: siteName,
        });
      }

      const reportLines = [
        `# Site Content Report: ${siteName}`,
        ``,
        `**Posts analyzed:** ${posts.length}`,
        `**Orphaned (no inbound links):** ${orphans.length}${orphans.length > 0 ? ` — ${orphans.slice(0, 3).map(p => p.post_title).join(', ')}${orphans.length > 3 ? ` +${orphans.length - 3} more` : ''}` : ''}`,
        `**Stale (>365 days old):** ${stale.length}${stale.length > 0 ? ` — ${stale.slice(0, 3).map(p => p.post_title).join(', ')}${stale.length > 3 ? ` +${stale.length - 3} more` : ''}` : ''}`,
        createdSandbox ? `**Analyzed via sandbox:** ${analysisSite}` : '',
        ``,
        `**Topical map:** Not available — platform dependency pending (IVectorStore.getAllDocuments)`,
        `**Next:** Connect Google Search Console to unlock demand-weighted gap analysis (T1)`,
      ].filter(Boolean).join('\n');

      log.info(reportLines);
      log.siteStatus(siteName, orphans.length + stale.length > 0 ? 'findings' : 'clean');
      state.set('lastReport', reportLines);
      // Return summary so RunDrawer renders the Site Content Report inline
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return { summary: reportLines } as any;
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

    // T1 — GSC demand layer (optional; degrades gracefully when not connected)
    const gscStatus = await credentials.getStatus('google');
    const gscProperty = state.get<string>('gscProperty');

    if (gscStatus === 'connected' && gscProperty) {
      log.phase('Demand Analysis (T1)', `GSC: ${gscProperty}`);
      log.info('Search Console connected — running T1 demand analysis');
      // Individual T1 tools are invoked interactively; scheduled run surfaces a summary
      // finding that T1 data is available, not the full analysis (avoid 10-min runs)
      log.finding({
        id: 'gsc-connected',
        severity: 'info',
        title: 'Search Console connected — run detect_cannibalization and find_demand_gaps for demand analysis',
        site: siteName,
      });
    } else if (gscStatus === 'not_connected') {
      log.info('Search Console not connected — T1 demand analysis unavailable. Run connect_gsc to activate.');
    }

    // Set 6-hour cooldown so background WPE syncs don't re-trigger analysis
    await state.setCooldown(cooldownKey);

    state.set('lastRunAt', Date.now());
    state.set('lastSite', siteName);
    log.info(`seo-insights: run complete for "${siteName}"`);
  },
});
