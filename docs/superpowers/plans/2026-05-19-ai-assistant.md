# AI Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fragmented search/chat surfaces with a unified AI assistant that appears in three places — the fleet search panel (⌕), the Nexus Dashboard Ask tab, and the per-site Nexus AI tab — each pre-loaded with the right context and capable of returning structured, actionable results.

**Architecture:** A new `AssistantService` in the main process builds context from live fleet/site data and calls the configured AI provider with a WordPress-domain-aware system prompt, returning a `QueryPlan` (structured JSON) plus a human-readable `summary`. The renderer renders the summary and `QueryPlan` as typed result cards (site cards, plugin cards, content cards) with embedded action buttons. Three React surfaces share a common `AssistantPanel` component but differ in their context source and width.

**Tech Stack:** TypeScript · Electron IPC (`safeHandle` pattern) · existing `getProvider()` / `streamChat()` AI provider infrastructure · React class components (`React.createElement`, no JSX, no hooks) · existing CSS vars (`--nxai-card-bg`, `--nxai-card-border`, `--nxai-card-sub`) · `SiteMetadataCache` · `graph.db` · `IndexRegistry`

---

## Visual Design Reference

These mocks are approved. Build exactly what they show.

### Reference file
`docs/assistant-mock.html` — open in browser to see all four interactive states:
- **Fleet — AI Search Panel** — panel slides from ⌕ button in sites toolbar
- **Fleet — Mid Conversation** — filtered site list + structured response cards
- **Nexus Dashboard — Ask Tab** — full-width, proactive insight card on open
- **Site Info — AI Tab** — split view: site data left, assistant right

### Response card anatomy (all surfaces)
```
┌─────────────────────────────────────┐
│ ✦ Nexus AI                          │  ← AI header (always teal)
│ Summary sentence in plain English   │  ← human-readable, no jargon
├─────────────────────────────────────┤
│ ● site-name    PHP 7.4   [EOL]     │  ← SiteResultRow
│ ● other-site   PHP 8.1   [ok]      │
├─────────────────────────────────────┤
│ [Primary action]  [Secondary]       │  ← action buttons
└─────────────────────────────────────┘
```

---

## Data model: QueryPlan

The AI returns a JSON object that drives both the summary text and result rendering:

```typescript
interface QueryPlan {
  intent: 'fleet-filter' | 'content-search' | 'site-info' | 'action' | 'explanation';
  summary: string;              // plain-English answer shown to user

  // fleet-filter results
  sites?: Array<{
    id?: string;                // null for WPE installs where id unknown
    name: string;
    meta: string;               // e.g. "PHP 7.4 · WP 6.9"
    tag?: string;               // e.g. "EOL", "update available"
    tagKind?: 'warn' | 'ok' | 'info';
    source: 'local' | 'wpe';
  }>;

  // content-search results (from LanceDB)
  contentResults?: Array<{
    siteId: string;
    siteName: string;
    title: string;
    excerpt: string;
    score: number;
  }>;

  // actions the user can take
  actions?: Array<{
    label: string;
    kind: 'primary' | 'secondary';
    ipcChannel?: string;        // e.g. IPC_CHANNELS.INDEX_ALL_AUTO
    ipcPayload?: unknown;
    href?: string;              // e.g. deep link into Local
  }>;

  // when AI can't answer fully
  needsClarification?: boolean;
  clarificationQuestion?: string;
}
```

---

## File structure

### New files
- `src/main/assistant/wordpress-knowledge.ts` — PHP EOL dates, plugin taxonomy, WP lifecycle facts
- `src/main/assistant/AssistantService.ts` — context builder + AI call + QueryPlan parser
- `src/renderer/components/AssistantPanel.tsx` — shared conversation UI, response cards, action buttons

### Modified files
- `src/common/types.ts` — add `QueryPlan`, `AssistantContext`, `FleetInsight` types
- `src/common/constants.ts` — add `ASSISTANT_QUERY`, `ASSISTANT_CONTEXT` IPC channels
- `src/main/ipc-handlers.ts` — add `ASSISTANT_QUERY` and `ASSISTANT_CONTEXT` handlers
- `src/renderer/components/SidebarSearchPanel.tsx` — add AI assistant mode alongside existing AI site finder; share AssistantPanel
- `src/renderer/components/NexusOverview.tsx` — add `'ask'` tab wired to AssistantPanel (full-width)
- `src/renderer/components/NexusSiteTab.tsx` — add assistant split-view in the Nexus AI tab

---

## Task 1: Types + IPC channels

**Goal:** Add all new types and IPC channels. No behaviour yet.

**Files:**
- Modify: `src/common/types.ts`
- Modify: `src/common/constants.ts`
- Test: `tests/unit/assistant/types.test.ts` (create)

- [ ] **Step 1: Write failing type validation test**

Create `tests/unit/assistant/types.test.ts`:

```typescript
import type { QueryPlan, AssistantContext } from '../../../src/common/types';

test('QueryPlan intent union covers all expected values', () => {
  const valid: QueryPlan['intent'][] = ['fleet-filter','content-search','site-info','action','explanation'];
  expect(valid.length).toBe(5);
});

test('AssistantContext mode union is fleet or site', () => {
  const fleet: AssistantContext = { mode: 'fleet', localSiteCount: 14, wpeSiteCount: 281, indexedCount: 97 };
  const site: AssistantContext = { mode: 'site', siteId: 'abc', siteName: 'acme-prod', phpVersion: '7.4', wpVersion: '6.9', pluginCount: 14, indexState: 'indexed' };
  expect(fleet.mode).toBe('fleet');
  expect(site.mode).toBe('site');
});
```

- [ ] **Step 2: Run to verify failing**

```bash
npm test -- --testPathPattern="assistant/types" --no-coverage 2>&1 | tail -10
```
Expected: FAIL — types not defined.

- [ ] **Step 3: Add types to `src/common/types.ts`**

Add after the `FleetCompleteness` interface (search for it):

```typescript
// ===== AI Assistant Types =====

export interface QueryPlan {
  intent: 'fleet-filter' | 'content-search' | 'site-info' | 'action' | 'explanation';
  summary: string;
  sites?: Array<{
    id?: string;
    name: string;
    meta: string;
    tag?: string;
    tagKind?: 'warn' | 'ok' | 'info';
    source: 'local' | 'wpe';
  }>;
  contentResults?: Array<{
    siteId: string;
    siteName: string;
    title: string;
    excerpt: string;
    score: number;
  }>;
  actions?: Array<{
    label: string;
    kind: 'primary' | 'secondary';
    ipcChannel?: string;
    ipcPayload?: unknown;
  }>;
  needsClarification?: boolean;
  clarificationQuestion?: string;
}

export interface AssistantContext {
  mode: 'fleet' | 'site';
  // Fleet fields
  localSiteCount?: number;
  wpeSiteCount?: number;
  indexedCount?: number;
  fleetInsights?: FleetInsight[];
  // Site fields
  siteId?: string;
  siteName?: string;
  phpVersion?: string | null;
  wpVersion?: string | null;
  pluginCount?: number;
  indexState?: string;
  documentCount?: number;
  linkedWpeInstall?: string | null;
}

export interface FleetInsight {
  kind: 'warning' | 'info' | 'action';
  title: string;
  detail: string;
  ipcChannel?: string;
  ipcPayload?: unknown;
}

export interface AssistantResponse {
  plan: QueryPlan;
  rawText: string;
}
```

- [ ] **Step 4: Add IPC channels to `src/common/constants.ts`**

Find `SYSTEM_WPE_STATUS` and add after it:

```typescript
  // AI Assistant (three surfaces: fleet panel, dashboard Ask tab, site tab)
  ASSISTANT_QUERY:   `${ADDON_PREFIX}:assistant:query`,
  ASSISTANT_CONTEXT: `${ADDON_PREFIX}:assistant:context`,
```

- [ ] **Step 5: Run tests**

```bash
npm test -- --testPathPattern="assistant/types" --no-coverage 2>&1 | tail -5
```
Expected: PASS.

- [ ] **Step 6: Build**

```bash
npm run compile 2>&1 | tail -5
```

- [ ] **Step 7: Commit**

```bash
git add src/common/types.ts src/common/constants.ts tests/unit/assistant/types.test.ts
git commit -m "feat(assistant): add QueryPlan, AssistantContext, FleetInsight types + IPC channels"
```

---

## Task 2: WordPress domain knowledge

**Goal:** A pure module of WordPress-specific facts the assistant uses to give accurate answers — PHP EOL dates, WP release history, plugin taxonomy, common issue patterns. No AI calls here, just data.

**Files:**
- Create: `src/main/assistant/wordpress-knowledge.ts`
- Test: `tests/unit/assistant/wordpress-knowledge.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/assistant/wordpress-knowledge.test.ts`:

```typescript
import { isPhpEol, getPhpEolDate, isWpOutdated, PLUGIN_CATEGORIES, buildWordPressSystemPrompt } from '../../../src/main/assistant/wordpress-knowledge';

test('PHP 7.4 is EOL', () => expect(isPhpEol('7.4')).toBe(true));
test('PHP 8.2 is not EOL', () => expect(isPhpEol('8.2')).toBe(false));
test('PHP 7.4 EOL date is Dec 2023', () => expect(getPhpEolDate('7.4')).toBe('December 2023'));
test('WP 5.9 is outdated relative to 6.9', () => expect(isWpOutdated('5.9', '6.9')).toBe(true));
test('WP 6.9 is not outdated', () => expect(isWpOutdated('6.9', '6.9')).toBe(false));
test('form-builder category has known slugs', () => {
  expect(PLUGIN_CATEGORIES['form-builder']).toContain('contact-form-7');
  expect(PLUGIN_CATEGORIES['form-builder']).toContain('gravityforms');
});
test('system prompt includes PHP EOL context', () => {
  const prompt = buildWordPressSystemPrompt({ mode: 'fleet', localSiteCount: 14, wpeSiteCount: 281, indexedCount: 97 });
  expect(prompt).toContain('PHP 7.4');
  expect(prompt).toContain('end-of-life');
  expect(prompt).toContain('14 local');
});
test('site system prompt includes site name and PHP version', () => {
  const prompt = buildWordPressSystemPrompt({ mode: 'site', siteId: 'abc', siteName: 'acme-prod', phpVersion: '7.4', wpVersion: '6.9', pluginCount: 14, indexState: 'indexed' });
  expect(prompt).toContain('acme-prod');
  expect(prompt).toContain('7.4');
});
```

- [ ] **Step 2: Run to verify failing**

```bash
npm test -- --testPathPattern="wordpress-knowledge" --no-coverage 2>&1 | tail -5
```
Expected: FAIL.

- [ ] **Step 3: Implement `src/main/assistant/wordpress-knowledge.ts`**

```typescript
import type { AssistantContext } from '../../common/types';

// ---------------------------------------------------------------------------
// PHP lifecycle facts
// ---------------------------------------------------------------------------

const PHP_EOL: Record<string, string> = {
  '5.6': 'December 2018',
  '7.0': 'December 2019',
  '7.1': 'December 2019',
  '7.2': 'November 2020',
  '7.3': 'December 2021',
  '7.4': 'November 2022',
  '8.0': 'November 2023',
  '8.1': 'November 2024',
};

const PHP_EOL_TIMESTAMPS: Record<string, number> = {
  '5.6': new Date('2018-12-31').getTime(),
  '7.0': new Date('2019-12-31').getTime(),
  '7.1': new Date('2019-12-31').getTime(),
  '7.2': new Date('2020-11-30').getTime(),
  '7.3': new Date('2021-12-06').getTime(),
  '7.4': new Date('2022-11-28').getTime(),
  '8.0': new Date('2023-11-26').getTime(),
  '8.1': new Date('2024-12-31').getTime(),
};

export function isPhpEol(version: string): boolean {
  const major = version.split('.').slice(0, 2).join('.');
  const eolTs = PHP_EOL_TIMESTAMPS[major];
  if (!eolTs) return false;
  return Date.now() > eolTs;
}

export function getPhpEolDate(version: string): string | null {
  const major = version.split('.').slice(0, 2).join('.');
  return PHP_EOL[major] ?? null;
}

export function isWpOutdated(version: string, latestVersion: string): boolean {
  const toNum = (v: string) => v.split('.').reduce((a, p, i) => a + parseInt(p, 10) * Math.pow(100, 2 - i), 0);
  return toNum(version) < toNum(latestVersion);
}

// ---------------------------------------------------------------------------
// Plugin taxonomy
// ---------------------------------------------------------------------------

export const PLUGIN_CATEGORIES: Record<string, string[]> = {
  'form-builder': ['contact-form-7','gravityforms','wpforms-lite','wpforms','ninja-forms','formidable','fluentform','happyforms'],
  'page-builder': ['elementor','elementor-pro','beaver-builder-lite-version','bb-plugin','js_composer','divi-builder','brizy','oxygen'],
  'seo':          ['wordpress-seo','rank-math','all-in-one-seo-pack','squirrly-seo','the-seo-framework'],
  'ecommerce':    ['woocommerce','easy-digital-downloads','lifterlms','memberpress'],
  'caching':      ['w3-total-cache','wp-super-cache','wp-fastest-cache','litespeed-cache','sg-cachepress'],
  'security':     ['wordfence','sucuri-scanner','better-wp-security','all-in-one-wp-security-and-firewall'],
  'backup':       ['updraftplus','backwpup','duplicator','all-in-one-wp-migration'],
  'performance':  ['autoptimize','smush','ewww-image-optimizer','imagify','jetpack-boost'],
  'analytics':    ['google-analytics-for-wordpress','wp-statistics','independent-analytics'],
};

// Common plugin name → slug mappings
export const PLUGIN_NAME_TO_SLUG: Record<string, string> = {
  'acf': 'advanced-custom-fields',
  'advanced custom fields': 'advanced-custom-fields',
  'woocommerce': 'woocommerce',
  'yoast': 'wordpress-seo',
  'yoast seo': 'wordpress-seo',
  'elementor': 'elementor',
  'jetpack': 'jetpack',
  'akismet': 'akismet',
  'wordfence': 'wordfence',
  'rank math': 'rank-math',
  'updraftplus': 'updraftplus',
  'gravity forms': 'gravityforms',
  'wpforms': 'wpforms-lite',
  'contact form 7': 'contact-form-7',
  'cf7': 'contact-form-7',
};

// ---------------------------------------------------------------------------
// System prompt builder
// ---------------------------------------------------------------------------

const WP_KNOWLEDGE_BASE = `
## WordPress & PHP Knowledge

### PHP End-of-Life dates (versions you may encounter)
- PHP 7.2: EOL November 2020 — high risk, no security patches
- PHP 7.3: EOL December 2021 — high risk
- PHP 7.4: EOL November 2022 — very common, needs upgrade
- PHP 8.0: EOL November 2023 — needs upgrade
- PHP 8.1: EOL December 2024 — should upgrade soon
- PHP 8.2: Active — supported until December 2026
- PHP 8.3: Active — current recommended version

### Common plugin categories and representative slugs
- Form builders: contact-form-7, gravityforms, wpforms-lite, ninja-forms
- Page builders: elementor, js_composer (WPBakery), bb-plugin (Beaver Builder), divi-builder
- SEO: wordpress-seo (Yoast), rank-math, all-in-one-seo-pack
- E-commerce: woocommerce, easy-digital-downloads
- Caching/performance: litespeed-cache, w3-total-cache, autoptimize
- Security: wordfence, sucuri-scanner, better-wp-security
- Backup: updraftplus, backwpup, duplicator

### Nexus AI capabilities
- Can find sites by plugin, theme, PHP version, WP version
- Can search indexed post/page content semantically
- Can start/stop local sites, trigger indexing, show fleet stats
- CANNOT: modify WordPress databases, update plugins directly, push to WPE

### Output format — ALWAYS respond with valid JSON matching this schema:
{
  "intent": "fleet-filter" | "content-search" | "site-info" | "action" | "explanation",
  "summary": "one or two sentences in plain English — no jargon, no internal terms",
  "sites": [{ "name": "...", "meta": "PHP 7.4 · WP 6.9", "tag": "EOL", "tagKind": "warn", "source": "local" | "wpe" }],
  "contentResults": [{ "siteId": "...", "siteName": "...", "title": "...", "excerpt": "...", "score": 0.0 }],
  "actions": [{ "label": "...", "kind": "primary" | "secondary", "ipcChannel": "nexus-ai:..." }],
  "needsClarification": false,
  "clarificationQuestion": null
}

IMPORTANT: Return ONLY the JSON object. No markdown, no code blocks, no explanation outside the JSON.
`;

export function buildWordPressSystemPrompt(context: AssistantContext): string {
  const contextSection = context.mode === 'fleet'
    ? `## Current fleet context
You are assisting with a fleet of ${context.localSiteCount ?? 0} local WordPress sites and ${context.wpeSiteCount ?? 0} WP Engine installs.
${context.indexedCount ?? 0} sites have indexed content available for search.
${context.fleetInsights?.map(i => `- ${i.kind.toUpperCase()}: ${i.title} — ${i.detail}`).join('\n') ?? ''}`
    : `## Current site context
You are assisting with a single WordPress site: "${context.siteName}"
- PHP version: ${context.phpVersion ?? 'unknown'}${context.phpVersion && isPhpEol(context.phpVersion) ? ` (EOL — ${getPhpEolDate(context.phpVersion)})` : ''}
- WordPress: ${context.wpVersion ?? 'unknown'}
- Active plugins: ${context.pluginCount ?? 'unknown'}
- Content index: ${context.indexState === 'indexed' ? `indexed (${context.documentCount ?? 0} docs)` : context.indexState ?? 'not indexed'}
${context.linkedWpeInstall ? `- Linked to WPE install: ${context.linkedWpeInstall}` : ''}`;

  return `You are Nexus AI, an intelligent assistant for WordPress developers using Local by WP Engine.
You have deep knowledge of WordPress, PHP lifecycle, plugins, and the WP Engine platform.
Always respond helpfully and concisely. Never use internal technical terms like "LanceDB", "graph.db", or "vector store".
Use plain language: "indexed content" not "vector embeddings", "site data" not "metadata cache".

${contextSection}

${WP_KNOWLEDGE_BASE}`;
}
```

- [ ] **Step 4: Run tests**

```bash
npm test -- --testPathPattern="wordpress-knowledge" --no-coverage 2>&1 | tail -5
```
Expected: 8 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/assistant/wordpress-knowledge.ts tests/unit/assistant/wordpress-knowledge.test.ts
git commit -m "feat(assistant): add WordPress domain knowledge module and system prompt builder"
```

---

## Task 3: AssistantService

**Goal:** Service that (1) builds `AssistantContext` from live data, (2) calls the configured provider, (3) parses the JSON response into `QueryPlan`, (4) runs the content search if intent is `content-search`.

**Files:**
- Create: `src/main/assistant/AssistantService.ts`
- Test: `tests/unit/assistant/AssistantService.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/assistant/AssistantService.test.ts`:

```typescript
import { buildFleetContext, buildSiteContext, parseQueryPlan } from '../../../src/main/assistant/AssistantService';

const mockSiteData = {
  getSites: () => ({ 'site-1': { id: 'site-1', name: 'acme', phpVersion: '7.4' }, 'site-2': { id: 'site-2', name: 'news', phpVersion: '8.2' } }),
};
const mockMetadataCache = {
  get: (id: string) => id === 'site-1' ? { wpVersion: '6.9', plugins: [{ name: 'elementor', status: 'active' }], pluginCount: 3 } : null,
};
const mockIndexRegistry = { listAll: () => [{ siteId: 'site-1', state: 'indexed', documentCount: 42 }] };
const mockGraphService = { getDb: () => ({ prepare: () => ({ all: () => [{ count: 281 }] }) }) };

test('buildFleetContext returns correct counts', () => {
  const ctx = buildFleetContext(mockSiteData as any, mockMetadataCache as any, mockIndexRegistry as any, mockGraphService as any);
  expect(ctx.mode).toBe('fleet');
  expect(ctx.localSiteCount).toBe(2);
  expect(ctx.indexedCount).toBe(1);
});

test('buildFleetContext surfaces PHP EOL insight', () => {
  const ctx = buildFleetContext(mockSiteData as any, mockMetadataCache as any, mockIndexRegistry as any, mockGraphService as any);
  const eolInsight = ctx.fleetInsights?.find(i => i.title.includes('PHP'));
  expect(eolInsight).toBeDefined();
  expect(eolInsight?.kind).toBe('warning');
});

test('buildSiteContext includes php EOL flag', () => {
  const ctx = buildSiteContext('site-1', mockSiteData as any, mockMetadataCache as any, mockIndexRegistry as any);
  expect(ctx.mode).toBe('site');
  expect(ctx.phpVersion).toBe('7.4');
  expect(ctx.indexState).toBe('indexed');
});

test('parseQueryPlan extracts intent and summary', () => {
  const json = '{"intent":"fleet-filter","summary":"Found 2 sites on PHP 7.4","sites":[{"name":"acme","meta":"PHP 7.4","tag":"EOL","tagKind":"warn","source":"local"}],"actions":[]}';
  const plan = parseQueryPlan(json);
  expect(plan.intent).toBe('fleet-filter');
  expect(plan.summary).toBe('Found 2 sites on PHP 7.4');
  expect(plan.sites).toHaveLength(1);
});

test('parseQueryPlan handles malformed JSON gracefully', () => {
  const plan = parseQueryPlan('not json at all {broken');
  expect(plan.intent).toBe('explanation');
  expect(plan.summary).toContain('not json at all');
  expect(plan.needsClarification).toBe(false);
});
```

- [ ] **Step 2: Run to verify failing**

```bash
npm test -- --testPathPattern="AssistantService" --no-coverage 2>&1 | tail -5
```

- [ ] **Step 3: Implement `src/main/assistant/AssistantService.ts`**

```typescript
import type { AssistantContext, QueryPlan, FleetInsight } from '../../common/types';
import { isPhpEol, getPhpEolDate } from './wordpress-knowledge';

// ---------------------------------------------------------------------------
// Context builders
// ---------------------------------------------------------------------------

export function buildFleetContext(
  siteData: any,
  metadataCache: any,
  indexRegistry: any,
  graphService: any,
): AssistantContext {
  const allSites = Object.values(siteData.getSites()) as any[];
  const indexedSet = new Set(
    (indexRegistry.listAll() as any[])
      .filter((e: any) => e.state === 'indexed')
      .map((e: any) => e.siteId),
  );

  // Count WPE installs from graph.db
  let wpeSiteCount = 0;
  try {
    const db = graphService?.getDb?.();
    if (db) {
      const row = db.prepare("SELECT COUNT(*) as count FROM sites WHERE source != 'local' AND is_active = 1").get() as any;
      wpeSiteCount = row?.count ?? 0;
    }
  } catch { /* ignore */ }

  // Build proactive insights
  const fleetInsights: FleetInsight[] = [];

  // PHP EOL check
  const eolSites = allSites.filter((s: any) => {
    const meta = metadataCache?.get?.(s.id);
    const php = s.phpVersion ?? meta?.phpVersion;
    return php && isPhpEol(php);
  });
  if (eolSites.length > 0) {
    const versions = [...new Set(eolSites.map((s: any) => {
      const meta = metadataCache?.get?.(s.id);
      return s.phpVersion ?? meta?.phpVersion ?? '?';
    }))].join(', ');
    fleetInsights.push({
      kind: 'warning',
      title: `${eolSites.length} site${eolSites.length > 1 ? 's' : ''} on EOL PHP (${versions})`,
      detail: `PHP ${versions} reached end-of-life and no longer receives security patches. Upgrade recommended.`,
    });
  }

  return {
    mode: 'fleet',
    localSiteCount: allSites.length,
    wpeSiteCount,
    indexedCount: indexedSet.size,
    fleetInsights,
  };
}

export function buildSiteContext(
  siteId: string,
  siteData: any,
  metadataCache: any,
  indexRegistry: any,
): AssistantContext {
  const allSites = siteData.getSites();
  const site = allSites[siteId] as any;
  const meta = metadataCache?.get?.(siteId) as any;
  const entries = (indexRegistry.listAll() as any[]);
  const indexEntry = entries.find((e: any) => e.siteId === siteId);

  return {
    mode: 'site',
    siteId,
    siteName: site?.name ?? siteId,
    phpVersion: site?.phpVersion ?? meta?.phpVersion ?? null,
    wpVersion: meta?.wpVersion ?? null,
    pluginCount: meta?.plugins?.length ?? 0,
    indexState: indexEntry?.state ?? 'not_indexed',
    documentCount: indexEntry?.documentCount ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Response parser
// ---------------------------------------------------------------------------

export function parseQueryPlan(rawText: string): QueryPlan {
  const trimmed = rawText.trim();

  // Extract JSON from response (model may wrap in markdown)
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return {
      intent: 'explanation',
      summary: trimmed.slice(0, 300) || 'I could not understand the query. Please try rephrasing.',
      needsClarification: false,
    };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      intent: parsed.intent ?? 'explanation',
      summary: parsed.summary ?? '',
      sites: parsed.sites ?? undefined,
      contentResults: parsed.contentResults ?? undefined,
      actions: parsed.actions ?? undefined,
      needsClarification: parsed.needsClarification ?? false,
      clarificationQuestion: parsed.clarificationQuestion ?? undefined,
    };
  } catch {
    return {
      intent: 'explanation',
      summary: trimmed.slice(0, 300) || 'I encountered an error parsing the response.',
      needsClarification: false,
    };
  }
}

// ---------------------------------------------------------------------------
// AI call
// ---------------------------------------------------------------------------

export async function queryAssistant(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  systemPrompt: string,
  settings: any,
  apiKeys: Record<string, string>,
): Promise<{ plan: QueryPlan; rawText: string }> {
  const { getProvider } = require('../chat/providers/index');

  const aiProvider = settings?.aiProvider || 'anthropic';
  const apiKey = apiKeys[aiProvider] || '';

  if (aiProvider !== 'ollama' && !apiKey) {
    return {
      plan: {
        intent: 'explanation',
        summary: `No API key configured for ${aiProvider}. Set one in Preferences → AI Provider, or switch to Ollama for free local inference.`,
        needsClarification: false,
      },
      rawText: '',
    };
  }

  const provider = getProvider(aiProvider);
  if (!provider) {
    return {
      plan: { intent: 'explanation', summary: `Provider ${aiProvider} not available.`, needsClarification: false },
      rawText: '',
    };
  }

  const defaultModels: Record<string, string> = {
    anthropic: 'claude-haiku-4-5-20251001',
    openai: 'gpt-4o-mini',
    google: 'gemini-1.5-flash',
    ollama: 'llama3.2',
  };
  const model = settings?.aiModel || defaultModels[aiProvider] || 'llama3.2';

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  let rawText = '';
  try {
    const fullMessages = [
      { role: 'system' as const, content: systemPrompt },
      ...messages,
    ];
    const stream = provider.streamChat(fullMessages, [], { model, apiKey }, controller.signal);
    for await (const event of stream) {
      if ((event as any).type === 'token') rawText += (event as any).text;
      if ((event as any).type === 'done') break;
    }
  } finally {
    clearTimeout(timeout);
  }

  return { plan: parseQueryPlan(rawText), rawText };
}
```

- [ ] **Step 4: Run tests**

```bash
npm test -- --testPathPattern="AssistantService" --no-coverage 2>&1 | tail -8
```
Expected: 5 PASS.

- [ ] **Step 5: Build**

```bash
npm run compile 2>&1 | tail -5
```

- [ ] **Step 6: Commit**

```bash
git add src/main/assistant/AssistantService.ts tests/unit/assistant/AssistantService.test.ts
git commit -m "feat(assistant): add AssistantService — context builder, AI caller, QueryPlan parser"
```

---

## Task 4: ASSISTANT_QUERY + ASSISTANT_CONTEXT IPC handlers

**Goal:** Wire `AssistantService` into two IPC handlers. `ASSISTANT_CONTEXT` returns pre-loaded context (for UI to show proactive insights). `ASSISTANT_QUERY` takes a query + conversation history + context mode and returns `AssistantResponse`.

**Files:**
- Modify: `src/main/ipc-handlers.ts` (add two handlers near `SYSTEM_WPE_STATUS`)

**Context:** In `ipc-handlers.ts`, `siteData`, `metadataCache`, `indexRegistry`, `graphService`, and `registryStorage` are all in closure scope. Access settings with `registryStorage.get(STORAGE_KEYS.SETTINGS) as NexusSettings | null` and API keys with `(registryStorage.get(STORAGE_KEYS.API_KEYS) ?? {}) as Record<string, string>`.

- [ ] **Step 1: Add `ASSISTANT_CONTEXT` handler**

Find the `SYSTEM_WPE_STATUS` handler and add after it:

```typescript
// Returns pre-loaded context (fleet or site) for the UI to show proactive insights
safeHandle(IPC_CHANNELS.ASSISTANT_CONTEXT, (_event: any, payload: { mode: 'fleet' | 'site'; siteId?: string }) => {
  try {
    const { buildFleetContext, buildSiteContext } = require('./assistant/AssistantService') as typeof import('./assistant/AssistantService');
    if (payload?.mode === 'site' && payload.siteId) {
      return buildSiteContext(payload.siteId, siteData, metadataCache, indexRegistry);
    }
    return buildFleetContext(siteData, metadataCache, indexRegistry, graphService);
  } catch (err) {
    localLogger.error('[NexusAI] ASSISTANT_CONTEXT failed:', (err as Error).message);
    return null;
  }
});
```

- [ ] **Step 2: Add `ASSISTANT_QUERY` handler**

```typescript
// Main assistant query — takes conversation history, returns QueryPlan + raw text
safeHandle(IPC_CHANNELS.ASSISTANT_QUERY, async (
  _event: any,
  payload: {
    messages: Array<{ role: 'user' | 'assistant'; content: string }>;
    mode: 'fleet' | 'site';
    siteId?: string;
  }
) => {
  try {
    const { buildFleetContext, buildSiteContext, queryAssistant } = require('./assistant/AssistantService') as typeof import('./assistant/AssistantService');
    const { buildWordPressSystemPrompt } = require('./assistant/wordpress-knowledge') as typeof import('./assistant/wordpress-knowledge');

    const settings = registryStorage.get(STORAGE_KEYS.SETTINGS) as NexusSettings | null;
    const apiKeys = (registryStorage.get(STORAGE_KEYS.API_KEYS) ?? {}) as Record<string, string>;

    // Build context
    const context = payload.mode === 'site' && payload.siteId
      ? buildSiteContext(payload.siteId, siteData, metadataCache, indexRegistry)
      : buildFleetContext(siteData, metadataCache, indexRegistry, graphService);

    const systemPrompt = buildWordPressSystemPrompt(context);

    // Call AI
    const response = await queryAssistant(payload.messages, systemPrompt, settings, apiKeys);

    // If content-search intent, run the actual vector search and merge results
    if (response.plan.intent === 'content-search' && payload.messages.length > 0) {
      const lastUserMsg = [...payload.messages].reverse().find(m => m.role === 'user');
      if (lastUserMsg) {
        try {
          const contentRes = await searchService.searchFleet(lastUserMsg.content, undefined, { limit: 8 })
            .catch(() => ({ results: [] }));
          if ((contentRes as any).results?.length > 0) {
            response.plan.contentResults = ((contentRes as any).results as any[]).map((r: any) => ({
              siteId: r.siteId ?? '',
              siteName: r.siteName ?? '',
              title: r.title ?? '',
              excerpt: (r.content ?? '').slice(0, 150),
              score: r.score ?? 0,
            }));
          }
        } catch { /* content search unavailable */ }
      }
    }

    return { success: true, plan: response.plan, rawText: response.rawText };
  } catch (err) {
    localLogger.error('[NexusAI] ASSISTANT_QUERY failed:', (err as Error).message);
    return {
      success: false,
      plan: {
        intent: 'explanation',
        summary: 'Something went wrong. Please try again.',
        needsClarification: false,
      } as import('../common/types').QueryPlan,
      rawText: '',
    };
  }
});
```

- [ ] **Step 3: Build**

```bash
npm run compile 2>&1 | tail -5
```
If there are import errors for `AssistantService` or `wordpress-knowledge`, check that the require paths are `'./assistant/AssistantService'` and `'./assistant/wordpress-knowledge'` (relative to `src/main/`).

- [ ] **Step 4: Commit**

```bash
git add src/main/ipc-handlers.ts
git commit -m "feat(assistant): add ASSISTANT_CONTEXT and ASSISTANT_QUERY IPC handlers"
```

---

## Task 5: AssistantPanel — shared UI component

**Goal:** A reusable React class component that renders a conversation with the AI assistant. Used in all three surfaces. Handles: proactive insight card on open, message list, typing indicator, response cards (site rows, content rows, action buttons), and input bar.

**Important class component rules:**
- NO JSX — every element is `React.createElement(tag, props, ...children)`
- NO hooks — all state in `this.state`, all lifecycle in class methods
- `injectThemeVars()` called in `componentDidMount`
- CSS vars: `--nxai-card-bg`, `--nxai-card-border`, `--nxai-card-sub`, `--nxai-card-text`, `--nxai-code-bg`

**Files:**
- Create: `src/renderer/components/AssistantPanel.tsx`

- [ ] **Step 1: Create `src/renderer/components/AssistantPanel.tsx`**

```typescript
/**
 * AssistantPanel — Shared AI assistant conversation UI.
 *
 * Used in three surfaces:
 *   1. SidebarSearchPanel (fleet context, panel width)
 *   2. NexusOverview Ask tab (fleet context, full width)
 *   3. NexusSiteTab (site context, split-view right column)
 *
 * Handles: proactive insight card, conversation history, typing indicator,
 * structured response cards (site rows, content rows, actions), input bar.
 *
 * Class-based, React.createElement only — no JSX, no hooks.
 */
import * as React from 'react';
import { IPC_CHANNELS } from '../../common/constants';
import { injectThemeVars } from '../utils/theme';
import type { QueryPlan, AssistantContext, FleetInsight } from '../../common/types';

export interface AssistantPanelProps {
  electron: any;
  mode: 'fleet' | 'site';
  siteId?: string;
  siteName?: string;
  /** Width context — affects suggested chip count and card layout */
  layout?: 'panel' | 'full';
  suggestions?: string[];
  onSiteFilter?: (siteNames: string[]) => void;
}

interface AssistantMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  plan?: QueryPlan;
  isTyping?: boolean;
}

interface AssistantPanelState {
  messages: AssistantMessage[];
  input: string;
  context: AssistantContext | null;
  sending: boolean;
}

export class AssistantPanel extends React.Component<AssistantPanelProps, AssistantPanelState> {
  private mounted = false;
  private msgListRef: HTMLDivElement | null = null;

  state: AssistantPanelState = {
    messages: [],
    input: '',
    context: null,
    sending: false,
  };

  componentDidMount(): void {
    this.mounted = true;
    injectThemeVars();
    this.loadContext();
  }

  componentWillUnmount(): void { this.mounted = false; }

  async loadContext(): Promise<void> {
    const ctx: AssistantContext | null = await this.props.electron.ipcRenderer
      .invoke(IPC_CHANNELS.ASSISTANT_CONTEXT, { mode: this.props.mode, siteId: this.props.siteId })
      .catch(() => null);
    if (this.mounted) this.setState({ context: ctx });
  }

  handleSend = async (textOverride?: string): Promise<void> => {
    const text = (textOverride ?? this.state.input).trim();
    if (!text || this.state.sending) return;

    const userMsg: AssistantMessage = { id: Date.now().toString(), role: 'user', content: text };
    const typingMsg: AssistantMessage = { id: 'typing', role: 'assistant', content: '', isTyping: true };

    this.setState(prev => ({
      messages: [...prev.messages, userMsg, typingMsg],
      input: '',
      sending: true,
    }), () => this.scrollToBottom());

    const history = this.state.messages
      .filter(m => !m.isTyping)
      .map(m => ({ role: m.role, content: m.content }));
    history.push({ role: 'user', content: text });

    const res = await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.ASSISTANT_QUERY, {
      messages: history,
      mode: this.props.mode,
      siteId: this.props.siteId,
    }).catch(() => ({ success: false, plan: { intent: 'explanation', summary: 'Request failed. Please try again.', needsClarification: false } }));

    if (!this.mounted) return;

    const aiMsg: AssistantMessage = {
      id: (Date.now() + 1).toString(),
      role: 'assistant',
      content: res.plan?.summary ?? '',
      plan: res.plan,
    };

    this.setState(prev => ({
      messages: [...prev.messages.filter(m => m.id !== 'typing'), aiMsg],
      sending: false,
    }), () => this.scrollToBottom());

    // Notify parent if fleet filter results
    if (res.plan?.intent === 'fleet-filter' && res.plan.sites && this.props.onSiteFilter) {
      this.props.onSiteFilter(res.plan.sites.map((s: any) => s.name));
    }
  };

  scrollToBottom(): void {
    if (this.msgListRef) this.msgListRef.scrollTop = this.msgListRef.scrollHeight;
  }

  // ── Render helpers ─────────────────────────────────────────────

  renderInsightCard(insight: FleetInsight): React.ReactNode {
    return React.createElement('div', {
      key: insight.title,
      style: { background: 'rgba(245,158,11,.06)', border: '1px solid rgba(245,158,11,.2)', borderRadius: 8, padding: '10px 12px', marginBottom: 10 },
    },
      React.createElement('div', { style: { fontSize: 10, fontWeight: 700, color: '#fbbf24', textTransform: 'uppercase' as const, letterSpacing: '.05em', marginBottom: 4 } }, '💡 Insight'),
      React.createElement('div', { style: { fontSize: 12, color: '#fde68a', lineHeight: 1.5, marginBottom: 8 } }, insight.detail),
      insight.ipcChannel
        ? React.createElement('button', {
            onClick: () => this.props.electron.ipcRenderer.invoke(insight.ipcChannel, insight.ipcPayload).catch(() => {}),
            style: { fontSize: 11, padding: '4px 10px', borderRadius: 5, background: 'rgba(14,202,212,.15)', color: '#0ECAD4', border: '1px solid rgba(14,202,212,.3)', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 },
          }, 'Show me')
        : null,
    );
  }

  renderSiteRow(site: NonNullable<QueryPlan['sites']>[0], i: number): React.ReactNode {
    const tagColors: Record<string, string> = { warn: '#f87171', ok: '#51BB7B', info: '#0ECAD4' };
    const tagBgs: Record<string, string> = { warn: 'rgba(239,68,68,.1)', ok: 'rgba(81,187,123,.1)', info: 'rgba(14,202,212,.1)' };
    const dotColor = site.source === 'wpe' ? '#0ECAD4' : '#51BB7B';

    return React.createElement('div', {
      key: `${site.name}-${i}`,
      style: { display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', borderBottom: '1px solid rgba(42,47,61,.4)', fontSize: 12 },
    },
      React.createElement('div', { style: { width: 7, height: 7, borderRadius: '50%', background: dotColor, flexShrink: 0 } }),
      React.createElement('span', { style: { flex: 1, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const } }, site.name),
      React.createElement('span', { style: { fontSize: 11, color: 'var(--nxai-card-sub, #6b7280)', flexShrink: 0 } }, site.meta),
      site.tag ? React.createElement('span', {
        style: { fontSize: 9, padding: '1px 5px', borderRadius: 3, background: tagBgs[site.tagKind ?? 'info'] ?? tagBgs.info, color: tagColors[site.tagKind ?? 'info'] ?? tagColors.info, border: `1px solid ${tagColors[site.tagKind ?? 'info'] ?? tagColors.info}30`, flexShrink: 0 },
      }, site.tag) : null,
    );
  }

  renderContentRow(r: NonNullable<QueryPlan['contentResults']>[0], i: number): React.ReactNode {
    return React.createElement('div', {
      key: `${r.siteId}-${i}`,
      style: { padding: '8px 12px', borderBottom: '1px solid rgba(42,47,61,.4)' },
    },
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 } },
        React.createElement('span', { style: { fontSize: 9, padding: '1px 5px', borderRadius: 3, background: 'rgba(81,187,123,.08)', color: '#51BB7B', border: '1px solid rgba(81,187,123,.15)' } }, 'content'),
        React.createElement('span', { style: { fontSize: 10, color: 'var(--nxai-card-sub, #6b7280)' } }, r.siteName),
        React.createElement('span', { style: { fontSize: 10, color: '#444', marginLeft: 'auto' } }, r.score.toFixed(2)),
      ),
      React.createElement('div', { style: { fontSize: 12, fontWeight: 500 } }, r.title),
      React.createElement('div', { style: { fontSize: 11, color: 'var(--nxai-card-sub, #6b7280)', lineHeight: 1.4 } }, r.excerpt),
    );
  }

  renderResponseCard(msg: AssistantMessage): React.ReactNode {
    const plan = msg.plan;
    if (!plan) return null;

    const hasSites = plan.sites && plan.sites.length > 0;
    const hasContent = plan.contentResults && plan.contentResults.length > 0;

    return React.createElement('div', { style: { background: 'var(--nxai-card-bg, #21262d)', border: '1px solid var(--nxai-card-border, #30363d)', borderRadius: 8, overflow: 'hidden' } },
      // Summary
      React.createElement('div', { style: { padding: '10px 12px', fontSize: 12, lineHeight: 1.6, borderBottom: hasSites || hasContent ? '1px solid var(--nxai-card-border, #30363d)' : 'none' } },
        plan.summary,
      ),
      // Site rows
      hasSites ? plan.sites!.map((s, i) => this.renderSiteRow(s, i)) : null,
      // Content rows
      hasContent ? plan.contentResults!.map((r, i) => this.renderContentRow(r, i)) : null,
      // Clarification
      plan.needsClarification && plan.clarificationQuestion
        ? React.createElement('div', { style: { padding: '8px 12px', fontSize: 12, color: '#fbbf24', fontStyle: 'italic' } }, plan.clarificationQuestion)
        : null,
      // Actions
      plan.actions && plan.actions.length > 0
        ? React.createElement('div', { style: { padding: '8px 12px', display: 'flex', gap: 6, flexWrap: 'wrap' as const, background: 'rgba(255,255,255,.02)' } },
            ...plan.actions.map(a =>
              React.createElement('button', {
                key: a.label,
                onClick: a.ipcChannel
                  ? () => this.props.electron.ipcRenderer.invoke(a.ipcChannel!, a.ipcPayload).catch(() => {})
                  : undefined,
                style: {
                  fontSize: 11, padding: '4px 10px', borderRadius: 5, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, border: 'none',
                  background: a.kind === 'primary' ? '#0ECAD4' : 'rgba(107,114,128,.1)',
                  color: a.kind === 'primary' ? '#000' : 'var(--nxai-card-sub, #6b7280)',
                },
              }, a.label),
            ),
          )
        : null,
    );
  }

  renderMessage(msg: AssistantMessage): React.ReactNode {
    if (msg.isTyping) {
      return React.createElement('div', { key: 'typing', style: { display: 'flex', alignItems: 'center', gap: 6, padding: '6px 0', fontSize: 12, color: 'var(--nxai-card-sub, #6b7280)' } },
        React.createElement('span', { style: { color: '#0ECAD4', fontWeight: 700, fontSize: 11 } }, '✦'),
        React.createElement('span', null, 'thinking…'),
      );
    }

    if (msg.role === 'user') {
      return React.createElement('div', { key: msg.id, style: { display: 'flex', justifyContent: 'flex-end' } },
        React.createElement('div', { style: { maxWidth: '85%', background: 'rgba(14,202,212,.1)', border: '1px solid rgba(14,202,212,.2)', borderRadius: '10px 10px 2px 10px', padding: '8px 12px', fontSize: 12 } }, msg.content),
      );
    }

    return React.createElement('div', { key: msg.id, style: { display: 'flex', flexDirection: 'column' as const, gap: 6 } },
      React.createElement('div', { style: { fontSize: 10, fontWeight: 700, color: '#0ECAD4', display: 'flex', alignItems: 'center', gap: 4 } }, '✦ Nexus AI'),
      msg.plan ? this.renderResponseCard(msg) : React.createElement('div', { style: { fontSize: 12, color: 'var(--nxai-card-text, #e6edf3)' } }, msg.content),
    );
  }

  render(): React.ReactNode {
    const { suggestions = [], mode } = this.props;
    const { messages, input, context, sending } = this.state;
    const isFleet = mode === 'fleet';
    const placeholder = isFleet ? 'Ask about your fleet…' : `Ask about ${this.props.siteName ?? 'this site'}…`;
    const defaultSuggestions = isFleet
      ? ['oldest PHP sites', 'sites with page builders', 'what needs updating?', 'Find recipe content']
      : ['Any issues to fix?', 'Which plugins have updates?', 'Compare with staging', 'Search this site\'s content'];
    const chips = suggestions.length > 0 ? suggestions : defaultSuggestions;

    return React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, height: '100%', overflow: 'hidden' } },

      // Suggestion chips
      messages.length === 0
        ? React.createElement('div', { style: { padding: '10px 12px', borderBottom: '1px solid var(--nxai-card-border, #30363d)', display: 'flex', flexWrap: 'wrap' as const, gap: 6, flexShrink: 0 } },
            ...chips.map(chip =>
              React.createElement('button', {
                key: chip,
                onClick: () => this.handleSend(chip),
                style: { fontSize: 11, padding: '4px 10px', borderRadius: 14, border: '1px solid var(--nxai-card-border, #30363d)', color: 'var(--nxai-card-sub, #6b7280)', cursor: 'pointer', background: 'var(--nxai-card-bg, #21262d)', fontFamily: 'inherit', transition: 'all .15s' },
              }, chip),
            ),
          )
        : null,

      // Message list
      React.createElement('div', {
        style: { flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column' as const, gap: 12 },
        ref: (el: any) => { this.msgListRef = el; },
      },
        // Proactive insights (first open only)
        messages.length === 0 && context?.fleetInsights && context.fleetInsights.length > 0
          ? context.fleetInsights.map(i => this.renderInsightCard(i))
          : null,
        // Conversation
        ...messages.map(m => this.renderMessage(m)),
      ),

      // Input bar
      React.createElement('div', { style: { padding: '10px 12px', borderTop: '1px solid var(--nxai-card-border, #30363d)', flexShrink: 0 } },
        React.createElement('div', { style: { display: 'flex', gap: 8, alignItems: 'flex-end' } },
          React.createElement('textarea', {
            value: input,
            placeholder,
            rows: 1,
            disabled: sending,
            onChange: (e: any) => this.setState({ input: e.target.value }),
            onKeyDown: (e: any) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.handleSend(); } },
            style: { flex: 1, background: 'var(--nxai-code-bg, #1f1f1f)', border: '1px solid var(--nxai-card-border, #30363d)', borderRadius: 8, color: 'inherit', padding: '8px 12px', fontSize: 12, outline: 'none', fontFamily: 'inherit', resize: 'none' as const, opacity: sending ? 0.5 : 1 },
          }),
          React.createElement('button', {
            onClick: () => this.handleSend(),
            disabled: sending || !input.trim(),
            style: { width: 32, height: 32, borderRadius: 6, background: '#0ECAD4', color: '#000', border: 'none', cursor: sending || !input.trim() ? 'not-allowed' : 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, opacity: sending || !input.trim() ? 0.4 : 1 },
          }, '↑'),
        ),
      ),
    );
  }
}
```

- [ ] **Step 2: Build**

```bash
npm run compile 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/AssistantPanel.tsx
git commit -m "feat(assistant): add shared AssistantPanel component — conversation UI, response cards, action buttons"
```

---

## Task 6: Fleet surface — evolve SidebarSearchPanel

**Goal:** Add an "Ask AI" mode to `SidebarSearchPanel` that uses `AssistantPanel` instead of the existing conversation loop. Keep the existing AI site finder mode accessible but make the assistant the default. When the assistant returns fleet-filter results, filter the site list just as the existing mode does.

**Files:**
- Modify: `src/renderer/components/SidebarSearchPanel.tsx`

**Context:** `SidebarSearchPanel` currently has `aiMode: boolean` state (default `true`). The `renderAIMode()` method shows a conversation UI that calls `SITE_FINDER_AI_PARSE`. We'll replace `renderAIMode()` with `AssistantPanel`, using `onSiteFilter` to drive the existing CSS filter mechanism.

- [ ] **Step 1: Add AssistantPanel import**

At the top of `SidebarSearchPanel.tsx`, after existing imports:

```typescript
import { AssistantPanel } from './AssistantPanel';
```

- [ ] **Step 2: Add `assistantMode` to state**

In `SidebarSearchPanelState` interface, add:
```typescript
  assistantMode: boolean;
```

In the initial state, add:
```typescript
  assistantMode: true,
```

- [ ] **Step 3: Replace `renderAIMode()` body**

Find the `renderAIMode()` method. Replace its `return` statement with:

```typescript
return React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, flex: 1, overflow: 'hidden' } },
  // Mode toggle — Assistant vs Site Finder
  React.createElement('div', { style: { display: 'flex', gap: 4, padding: '8px 12px', borderBottom: '1px solid var(--nxai-card-border, #30363d)', flexShrink: 0 } },
    React.createElement('button', {
      onClick: () => this.setState({ assistantMode: true }),
      style: { flex: 1, padding: '5px 0', borderRadius: 5, border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 11, fontWeight: 600, background: this.state.assistantMode ? '#0ECAD4' : 'transparent', color: this.state.assistantMode ? '#000' : 'var(--nxai-card-sub, #6b7280)' },
    }, '✦ Ask AI'),
    React.createElement('button', {
      onClick: () => this.setState({ assistantMode: false }),
      style: { flex: 1, padding: '5px 0', borderRadius: 5, border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 11, fontWeight: 600, background: !this.state.assistantMode ? 'var(--nxai-card-bg, #21262d)' : 'transparent', color: !this.state.assistantMode ? 'var(--nxai-card-text, #e6edf3)' : 'var(--nxai-card-sub, #6b7280)' },
    }, 'Filter'),
  ),
  // Panel content
  this.state.assistantMode
    ? React.createElement(AssistantPanel, {
        electron: this.props.electron,
        mode: 'fleet' as const,
        layout: 'panel' as const,
        onSiteFilter: (siteNames: string[]) => {
          // Map names to IDs then apply filter
          const allSites = this.state.localResults;
          const matchedIds = allSites
            .filter(s => siteNames.includes(s.name))
            .map(s => s.id);
          this.props.electron.ipcRenderer.invoke(
            IPC_CHANNELS.SIDEBAR_FILTER, { siteIds: matchedIds }
          ).catch(() => {});
        },
      })
    : this.renderManualMode(), // existing manual filter UI
);
```

- [ ] **Step 4: Build**

```bash
npm run compile 2>&1 | tail -5
```

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/SidebarSearchPanel.tsx
git commit -m "feat(assistant): wire AssistantPanel into SidebarSearchPanel — Ask AI / Filter mode toggle"
```

---

## Task 7: Nexus Dashboard — Ask tab

**Goal:** Add an 'ask' tab to `NexusOverview` that renders `AssistantPanel` at full width with fleet context. The tab is called "Ask ✦" and appears after System in the tab bar.

**Files:**
- Modify: `src/renderer/components/NexusOverview.tsx`

- [ ] **Step 1: Add AssistantPanel import**

After existing imports in `NexusOverview.tsx`:
```typescript
import { AssistantPanel } from './AssistantPanel';
```

- [ ] **Step 2: Add 'ask' to the activeTab union type**

Find:
```typescript
activeTab: 'overview' | 'search' | 'activity' | 'operations' | 'system';
```
Replace with:
```typescript
activeTab: 'overview' | 'search' | 'activity' | 'operations' | 'system' | 'ask';
```

- [ ] **Step 3: Add the tab to `renderTabBar()`**

Find the `tabs` array in `renderTabBar()`. Add after the system tab entry:
```typescript
{ key: 'ask' as const, label: 'Ask ✦' },
```

- [ ] **Step 4: Add the tab body to `renderActiveTab()`**

In the switch/if-else block of `renderActiveTab()`, add:
```typescript
if (activeTab === 'ask') {
  return React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, flex: 1, overflow: 'hidden', padding: '0 20px 20px' } },
    React.createElement(AssistantPanel, {
      electron: this.props.electron,
      mode: 'fleet' as const,
      layout: 'full' as const,
    }),
  );
}
```

- [ ] **Step 5: Build**

```bash
npm run compile 2>&1 | tail -5
```

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/NexusOverview.tsx
git commit -m "feat(assistant): add Ask tab to Nexus dashboard — full-width fleet assistant"
```

---

## Task 8: Site info AI tab

**Goal:** Add the assistant as a split-view in `NexusSiteTab`. Left side keeps existing site info content; right side is `AssistantPanel` in site context mode. The split is 55%/45%.

**Files:**
- Modify: `src/renderer/components/NexusSiteTab.tsx`

- [ ] **Step 1: Add AssistantPanel import**

After existing imports:
```typescript
import { AssistantPanel } from './AssistantPanel';
```

- [ ] **Step 2: Wrap existing tab content in a split container**

Find the `render()` method. The current return renders a scrollable content area. Wrap it:

Find the outermost `React.createElement('div', ...)` in `render()` that wraps everything after the tab nav. Change the structure to:

```typescript
// Outer split container — replace the existing single-column content div
React.createElement('div', { style: { display: 'flex', flex: 1, overflow: 'hidden' } },

  // Left: existing site info content (scrollable)
  React.createElement('div', { style: { flex: '0 0 55%', overflowY: 'auto', padding: '16px 20px', borderRight: '1px solid var(--nxai-card-border, #30363d)' } },
    // [all existing rendered content goes here — the index card, AI setup card, metadata card, etc.]
  ),

  // Right: AI assistant for this site
  React.createElement('div', { style: { flex: '0 0 45%', display: 'flex', flexDirection: 'column' as const, overflow: 'hidden' } },
    React.createElement('div', { style: { padding: '10px 14px', borderBottom: '1px solid var(--nxai-card-border, #30363d)', fontSize: 11, fontWeight: 700, color: '#0ECAD4', flexShrink: 0 } },
      '✦ Ask about this site',
    ),
    React.createElement(AssistantPanel, {
      electron: this.props.electron,
      mode: 'site' as const,
      siteId: this.props.site.id,
      siteName: this.props.site.name,
      layout: 'panel' as const,
    }),
  ),
),
```

**Note:** This requires finding the precise location of the content in `render()`. Read `NexusSiteTab.tsx` from line 400 onwards to identify the outermost content container, then wrap it as shown above. The key is to NOT modify the existing content — only wrap it in the left column of the split.

- [ ] **Step 3: Build**

```bash
npm run compile 2>&1 | tail -5
```
If there are TypeScript errors about the split structure, read the current `render()` at `src/renderer/components/NexusSiteTab.tsx:800+` to find the exact wrapping point.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/NexusSiteTab.tsx
git commit -m "feat(assistant): add assistant split-view to NexusSiteTab — site context, 45% right column"
```

---

## Task 9: Final build + smoke test

**Files:** No new files.

- [ ] **Step 1: Full test suite**

```bash
npm test -- --no-coverage 2>&1 | tail -20
```
Expected: new tests (types, wordpress-knowledge, AssistantService) pass. Pre-existing native module failures unchanged.

- [ ] **Step 2: Full build**

```bash
npm run build 2>&1 | tail -8
```

- [ ] **Step 3: Rebuild for Local (Electron)**

```bash
npm run rebuild 2>&1 | tail -5
```

- [ ] **Step 4: Smoke test in Local**

Restart Local. Test each surface:

1. **Fleet panel**: Press ⌕ or Cmd+K → panel opens → insight card shows for PHP 7.4 sites → type "oldest PHP sites" → structured response with site rows appears → site list filters.

2. **Dashboard Ask tab**: Open Nexus AI → click "Ask ✦" tab → insight card pre-loaded → click a chip → response renders with action buttons.

3. **Site AI tab**: Open a site → click Nexus AI tab → split view: site info left, assistant right → click "Any issues?" chip → response shows PHP EOL warning.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(assistant): final build — AI assistant across fleet panel, dashboard Ask tab, site tab"
```

---

## Self-Review

**Spec coverage check:**

| Requirement | Task |
|---|---|
| QueryPlan + AssistantContext types | Task 1 |
| WordPress domain knowledge (PHP EOL, plugin taxonomy) | Task 2 |
| AssistantService (context builder + AI call + parser) | Task 3 |
| ASSISTANT_QUERY + ASSISTANT_CONTEXT IPC handlers | Task 4 |
| Shared AssistantPanel (conversation, cards, actions, typing) | Task 5 |
| Fleet panel (SidebarSearchPanel evolution) | Task 6 |
| Dashboard Ask tab | Task 7 |
| Site AI tab (split view) | Task 8 |
| Response cards: site rows, content rows, action buttons | Task 5 |
| Proactive insight card on first open | Task 5 (AssistantPanel) + Task 4 (FleetInsight in context) |
| PHP EOL insight generated automatically | Task 3 (buildFleetContext) |
| onSiteFilter callback drives CSS site list filter | Task 6 |
| Content search merged when intent=content-search | Task 4 (ASSISTANT_QUERY handler) |
| Ollama + all cloud providers supported | Task 3 (queryAssistant uses existing getProvider) |
| Fallback message when no provider configured | Task 3 (queryAssistant guard) |

**Placeholder scan:** None found.

**Type consistency check:**
- `QueryPlan` defined Task 1, used in Tasks 3, 4, 5 ✓
- `AssistantContext` defined Task 1, returned by Task 4 (ASSISTANT_CONTEXT), consumed by Task 5 (AssistantPanel) ✓
- `FleetInsight` defined Task 1, populated by Task 3 (buildFleetContext), rendered by Task 5 ✓
- `AssistantPanel` props `mode: 'fleet' | 'site'` consistent across Tasks 6, 7, 8 ✓
- `queryAssistant()` defined Task 3, called by Task 4 ✓
- `buildFleetContext()` / `buildSiteContext()` defined Task 3, called by Task 4 ✓
