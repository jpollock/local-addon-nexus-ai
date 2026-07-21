# SEO Insights T1 — GSC Demand Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire Google Search Console data into the SEO Insights agent — `detect_cannibalization`, `find_demand_gaps`, `classify_intent`, `detect_decay` — using the existing credential infrastructure (`ctx.credentials.getToken('google')`).

**Architecture:** The credential system is fully implemented. T1 adds: (1) a thin GSC API client utility, (2) a `connect_gsc` contributed tool for property selection, (3) four analysis contributed tools, (4) credential declaration and T1 gating in `run()`. All GSC tools are contributed tools in the SEO agent — no new MCP tools in the addon core.

**Tech Stack:** TypeScript, Google Search Console API v3 (REST), `ctx.credentials.getToken('google')`, `ctx.ai.generateObject()` for intent classification, existing `wp_eval` + `fleet_sql` for site metadata.

## Global Constraints

- Credential provider key: `'google'` — matches `ProviderRegistry.ts`
- GSC scope: `https://www.googleapis.com/auth/webmasters.readonly`
- All GSC tools are `optional: true` — agent runs at T0 when not connected
- GSC API base: `https://searchconsole.googleapis.com/webmasters/v3`
- Site URL for GSC: stored in agent state as `gscProperty` — set by `connect_gsc` tool
- Date ranges: rolling 28-day windows; `detect_decay` compares two consecutive 28-day periods
- Row limit: 25,000 per API call (GSC maximum)
- `ctx.ai.generateObject()` used for intent classification — batched, results cached in state
- All T1 tools throw helpful errors when `gscProperty` is not set in state
- Do NOT touch `src/main/credentials/` — it's already complete

---

## File Map

### New files (all in the SEO agent directory)

All changes to the agent are in:
`~/Library/Application Support/Local/nexus-ai/agents/seo-insights/agent.ts`

No new files in the addon repo except the GSC API utility used only by the agent.

### No addon repo changes needed

The credential infrastructure, `AgentContext.credentials`, and `ctx.ai` are already wired. T1 is purely agent-layer work.

---

## Task 1: GSC API client + `connect_gsc` tool

Add the GSC fetch utility and the `connect_gsc` tool that lets users verify their Google connection and select their Search Console property.

**Interfaces:**
- Produces: `fetchGsc(token, siteUrl, body)` helper; `listGscSites(token)` helper; `connect_gsc` contributed tool
- State written: `state.set('gscProperty', siteUrl)` — consumed by all other T1 tools

- [ ] **Step 1: Add the GSC API helpers to agent.ts**

Add these functions before `defineAgent()`:

```typescript
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
```

- [ ] **Step 2: Add credential declaration to `defineAgent()`**

Add to the agent definition (after `timeoutMs`):

```typescript
credentials: [
  {
    provider: 'google',
    scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
    optional: true,
    reason: 'Reads Search Console query data to find demand gaps and confirm cannibalization',
  },
],
```

Also add `'get_all_site_documents'` to the `tools` array if not already present.

- [ ] **Step 3: Add `connect_gsc` contributed tool**

```typescript
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
```

- [ ] **Step 4: Validate and rebuild manifest**

```bash
node lib/cli/index.js agent validate seo-insights 2>&1
node lib/cli/index.js agent tools build "/Users/jerry.pollock/Library/Application Support/Local/nexus-ai/agents/seo-insights" 2>&1 | head -3
```

Expected: ✓ TypeScript OK, manifest updated with increased tool count.

---

## Task 2: `detect_cannibalization`

GSC query→page pairs. Flag queries where ≥2 site pages share impressions, with impression/click split and position volatility.

- [ ] **Step 1: Add `detect_cannibalization` tool**

```typescript
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
```

---

## Task 3: `find_demand_gaps` + striking-distance view

GSC queries joined against indexed content. Queries with impressions but no strong-matching document become the opportunity list.

- [ ] **Step 1: Add `find_demand_gaps` tool**

```typescript
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
```

---

## Task 4: `classify_intent` + `detect_decay`

### `classify_intent` — batch LLM intent classification, cached

```typescript
classify_intent: {
  description: 'Classify Search Console queries by intent: informational, navigational, transactional, commercial. Cached — subsequent calls use stored results.',
  inputSchema: {
    type: 'object',
    properties: {
      minImpressions: { type: 'number', default: 20, description: 'Only classify queries with this many impressions' },
      refresh: { type: 'boolean', default: false, description: 'Re-classify even if cached results exist' },
    },
  },
  executionMode: 'run' as const,
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
          prompt: `Classify each search query by intent. Return JSON with "classifications" array.\n\nQueries:\n${queries.map((q, i) => `${i + 1}. ${q}`).join('\n')}`,
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
```

### `detect_decay` — compare two 28-day windows

```typescript
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

    let [currentRows, priorRows]: [GscRow[], GscRow[]] = [[], []];
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
```

---

## Task 5: T1 gating in `run()`

Update `run()` to check GSC connection status and route T0 vs T1:

- [ ] Add after the site analysis section in `run()`, before the final `state.set()` calls:

```typescript
// T1 — GSC demand layer (optional; degrades gracefully when not connected)
const gscStatus = await ctx.credentials.getStatus('google');
const gscProperty = ctx.state.get<string>('gscProperty');

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
```

- [ ] **Final validation + manifest rebuild**

```bash
node lib/cli/index.js agent validate seo-insights 2>&1
node lib/cli/index.js agent tools build "/Users/jeremy.pollock/Library/Application Support/Local/nexus-ai/agents/seo-insights" 2>&1 | head -3
```

---

## Testing the full T1 flow

```bash
# 1. Connect to GSC
node lib/cli/index.js agent tools invoke seo-insights connect_gsc 2>&1
# → shows available properties

# 2. Select property
node lib/cli/index.js agent tools invoke seo-insights connect_gsc \
  --arg propertyUrl="https://yoursite.com/" 2>&1

# 3. Run cannibalization check
node lib/cli/index.js agent tools invoke seo-insights detect_cannibalization \
  --arg siteId=jeremypollockblog 2>&1

# 4. Find demand gaps
node lib/cli/index.js agent tools invoke seo-insights find_demand_gaps \
  --arg siteId=jeremypollockblog 2>&1

# 5. Classify intent
node lib/cli/index.js agent tools invoke seo-insights classify_intent 2>&1

# 6. Check decay
node lib/cli/index.js agent tools invoke seo-insights detect_decay 2>&1
```
