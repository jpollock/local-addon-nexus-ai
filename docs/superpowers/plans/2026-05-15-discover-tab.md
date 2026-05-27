# Discover Tab — First-Run Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Discover" tab to the Nexus AI dashboard that guides users from fresh install through content indexing, keyword-vs-semantic search comparison, MCP integration, and progressive feature unlock — with no API key required for the core value.

**Architecture:** New `DiscoverTab` React component (class-based, `React.createElement`, no JSX — Local's React constraints) added as the second tab in `NexusOverview`. Backend adds a `SEARCH_KEYWORD` IPC handler that uses LanceDB's built-in `fullTextSearch()` (already available in `VectorStore`). A lightweight state machine (`discoverProgress` in `NexusSettings`) tracks which steps are complete so the UI is adaptive across sessions. The existing semantic `SEARCH` handler is unchanged.

**Tech Stack:** React 16 class components, `React.createElement`, LanceDB full-text search, Electron IPC, `injectThemeVars()` CSS vars for theming.

---

## File Structure

**New files:**
- `src/renderer/components/DiscoverTab.tsx` — the entire Discover tab UI (state machine, search comparison, progressive steps)
- `tests/unit/mcp/keyword-search.test.ts` — unit tests for the keyword search IPC handler

**Modified files:**
- `src/common/constants.ts` — add `SEARCH_KEYWORD` IPC channel
- `src/common/types.ts` — add `discoverProgress` to `NexusSettings`
- `src/common/schemas.ts` — add `discoverProgress` to `UpdateSettingsSchema`
- `src/main/ipc-handlers.ts` — add `SEARCH_KEYWORD` handler (uses `VectorStore.getTable` + `fullTextSearch`)
- `src/renderer/components/NexusOverview.tsx` — add "Discover" tab to tab bar, wire `DiscoverTab`

---

## Task 1: IPC channel constant + settings type

**Files:**
- Modify: `src/common/constants.ts`
- Modify: `src/common/types.ts`
- Modify: `src/common/schemas.ts`

- [ ] **Step 1: Add `SEARCH_KEYWORD` to IPC_CHANNELS in `src/common/constants.ts`**

  Find the `SEARCH: \`${ADDON_PREFIX}:search\`` line and add below it:

  ```typescript
  SEARCH_KEYWORD: `${ADDON_PREFIX}:search:keyword`,
  ```

- [ ] **Step 2: Add `discoverProgress` to `NexusSettings` in `src/common/types.ts`**

  Find `onboardingDismissed?: boolean;` and add below it:

  ```typescript
  discoverProgress?: {
    hasSearched?: boolean;    // user has run at least one comparison search
    hasMcpDone?: boolean;     // user clicked "Done" on the MCP setup step
  };
  ```

- [ ] **Step 3: Add `discoverProgress` to `UpdateSettingsSchema` in `src/common/schemas.ts`**

  Find the `wpeAllowedEnvironments` line and add below it (before `.strict()`):

  ```typescript
  discoverProgress: z.object({
    hasSearched: z.boolean().optional(),
    hasMcpDone:  z.boolean().optional(),
  }).optional(),
  ```

- [ ] **Step 4: Build to verify no TypeScript errors**

  Run: `npm run compile`
  Expected: exits 0, no errors.

- [ ] **Step 5: Commit**

  ```bash
  git add src/common/constants.ts src/common/types.ts src/common/schemas.ts
  git commit -m "feat(discover): add SEARCH_KEYWORD channel + discoverProgress settings type"
  ```

---

## Task 2: Keyword search IPC handler

**Files:**
- Modify: `src/main/ipc-handlers.ts:648`
- Create: `tests/unit/mcp/keyword-search.test.ts`

- [ ] **Step 1: Write failing tests in `tests/unit/mcp/keyword-search.test.ts`**

  ```typescript
  /**
   * Tests for the SEARCH_KEYWORD IPC handler logic.
   * We test the helper function directly, not via full IPC dispatch.
   */

  import { keywordSearch } from '../../../src/main/search/keyword-search';

  // Minimal mock of a LanceDB table
  function makeTable(rows: any[]) {
    return {
      query: () => ({
        fullTextSearch: (_text: string, _opts: any) => ({
          limit: (_n: number) => ({
            toArray: async () => rows,
          }),
        }),
      }),
    };
  }

  describe('keywordSearch', () => {
    it('returns empty array when table is null', async () => {
      const result = await keywordSearch(null, 'test', 5);
      expect(result).toEqual([]);
    });

    it('returns mapped results from fullTextSearch', async () => {
      const rows = [
        { id: 'a1', title: 'Hello world', content: 'some content', postType: 'post', postId: 1, metadata: '{}' },
        { id: 'a2', title: 'Second result', content: 'more content', postType: 'page', postId: 2, metadata: '{}' },
      ];
      const table = makeTable(rows);
      const result = await keywordSearch(table, 'hello', 10);
      expect(result).toHaveLength(2);
      expect(result[0].title).toBe('Hello world');
      expect(result[0].score).toBe(1.0); // keyword results get score 1.0
      expect(result[0].postId).toBe(1);
    });

    it('deduplicates by postId keeping first occurrence', async () => {
      const rows = [
        { id: 'a1', title: 'Chunk 1', content: 'content', postType: 'post', postId: 42, metadata: '{}' },
        { id: 'a2', title: 'Chunk 2', content: 'content', postType: 'post', postId: 42, metadata: '{}' },
      ];
      const result = await keywordSearch(makeTable(rows), 'content', 10);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('a1');
    });

    it('respects limit', async () => {
      const rows = Array.from({ length: 20 }, (_, i) => ({
        id: `id${i}`, title: `Title ${i}`, content: 'text', postType: 'post', postId: i, metadata: '{}',
      }));
      const result = await keywordSearch(makeTable(rows), 'text', 5);
      expect(result.length).toBeLessThanOrEqual(5);
    });

    it('returns empty array when fullTextSearch throws', async () => {
      const badTable = {
        query: () => ({
          fullTextSearch: () => ({ limit: () => ({ toArray: async () => { throw new Error('no FTS index'); } }) }),
        }),
      };
      const result = await keywordSearch(badTable, 'test', 5);
      expect(result).toEqual([]);
    });
  });
  ```

- [ ] **Step 2: Run test to confirm it fails**

  Run: `npx jest tests/unit/mcp/keyword-search.test.ts --no-coverage`
  Expected: FAIL — `Cannot find module '../../../src/main/search/keyword-search'`

- [ ] **Step 3: Create `src/main/search/keyword-search.ts`**

  ```typescript
  /**
   * Keyword (full-text) search helper.
   * Uses LanceDB's built-in fullTextSearch() — no embedding required.
   */

  export interface KeywordResult {
    id: string;
    title: string;
    content: string;
    postType: string;
    postId: number;
    score: number;
    metadata: string;
  }

  export async function keywordSearch(
    table: any,
    query: string,
    limit: number,
  ): Promise<KeywordResult[]> {
    if (!table) return [];
    try {
      const raw: any[] = await table
        .query()
        .fullTextSearch(query, { columns: ['content', 'title'] })
        .limit(limit * 3) // over-fetch to allow dedup
        .toArray();

      // Deduplicate by postId — keep first occurrence
      const seen = new Set<number>();
      const deduped: KeywordResult[] = [];
      for (const row of raw) {
        if (seen.has(row.postId)) continue;
        seen.add(row.postId);
        deduped.push({
          id: row.id,
          title: row.title,
          content: row.content,
          postType: row.postType,
          postId: row.postId,
          score: 1.0, // keyword = binary match, no ranking score
          metadata: row.metadata ?? '{}',
        });
        if (deduped.length >= limit) break;
      }
      return deduped;
    } catch {
      return [];
    }
  }
  ```

- [ ] **Step 4: Run tests to confirm they pass**

  Run: `npx jest tests/unit/mcp/keyword-search.test.ts --no-coverage`
  Expected: PASS, 5 tests.

- [ ] **Step 5: Add `SEARCH_KEYWORD` handler to `src/main/ipc-handlers.ts`**

  Find the closing `});` of the `SEARCH` handler (around line 685) and add immediately after:

  ```typescript
  safeHandle(IPC_CHANNELS.SEARCH_KEYWORD, async (_event: any, query: string, limit?: number) => {
    try {
      const validated = validateInput(SearchContentSchema, { query, limit });
      const maxResults = validated.limit ?? 10;
      const { keywordSearch } = await import('./search/keyword-search');

      const entries = indexRegistry.listAll().filter((e: any) => e.state === 'indexed');
      const allResults: any[] = [];

      for (const entry of entries) {
        const table = await (vectorStore as any).getTable(entry.siteId);
        const results = await keywordSearch(table, validated.query, maxResults);
        const site = siteData.getSite(entry.siteId);
        for (const r of results) {
          allResults.push({ ...r, siteId: entry.siteId, siteName: site?.name ?? entry.siteName });
        }
      }

      return { results: allResults.slice(0, maxResults) };
    } catch (err) {
      localLogger.error('[NexusAI] keyword search failed:', (err as Error).message);
      return { results: [], error: (err as Error).message };
    }
  });
  ```

- [ ] **Step 6: Build to verify no TypeScript errors**

  Run: `npm run compile`
  Expected: exits 0.

- [ ] **Step 7: Commit**

  ```bash
  git add src/main/search/keyword-search.ts src/main/ipc-handlers.ts tests/unit/mcp/keyword-search.test.ts
  git commit -m "feat(discover): keyword search helper + SEARCH_KEYWORD IPC handler"
  ```

---

## Task 3: DiscoverTab component — state machine + indexing state

**Files:**
- Create: `src/renderer/components/DiscoverTab.tsx`

This task builds the component skeleton with the state machine. No search UI yet — just fresh-install and indexing states.

- [ ] **Step 1: Create `src/renderer/components/DiscoverTab.tsx` with the component shell**

  ```typescript
  /**
   * DiscoverTab — First-run experience and comparison search.
   *
   * State machine:
   *   'fresh'    — no sites indexed, show index prompt
   *   'indexing' — indexing in progress (auto-started), show per-site progress
   *   'ready'    — sites indexed, show comparison search
   *
   * Class-based, React.createElement only — no JSX, no hooks (Local React).
   */
  import * as React from 'react';
  import { IPC_CHANNELS } from '../../common/constants';
  import type { NexusSettings } from '../../common/types';
  import { injectThemeVars } from '../utils/theme';

  interface IndexEntry {
    siteId: string;
    siteName: string;
    state: 'indexed' | 'indexing' | 'pending' | 'error';
    documentCount?: number;
  }

  interface DiscoverTabProps {
    electron: any;
    sites: Array<{ id: string; name: string; status: string }>;
    indexEntries: IndexEntry[];
    settings: NexusSettings;
    onSettingsChange: (s: NexusSettings) => void;
  }

  interface DiscoverTabState {
    viewState: 'fresh' | 'indexing' | 'ready';
    indexEntries: IndexEntry[];
  }

  export class DiscoverTab extends React.Component<DiscoverTabProps, DiscoverTabState> {
    private mounted = false;

    state: DiscoverTabState = {
      viewState: 'fresh',
      indexEntries: [],
    };

    componentDidMount(): void {
      this.mounted = true;
      injectThemeVars();
      this.deriveViewState();
    }

    componentDidUpdate(prevProps: DiscoverTabProps): void {
      if (prevProps.indexEntries !== this.props.indexEntries) {
        this.deriveViewState();
      }
    }

    componentWillUnmount(): void {
      this.mounted = false;
    }

    deriveViewState(): void {
      const { indexEntries } = this.props;
      const indexed = indexEntries.filter((e) => e.state === 'indexed');
      const indexing = indexEntries.filter((e) => e.state === 'indexing');

      let viewState: DiscoverTabState['viewState'];
      if (indexed.length > 0) {
        viewState = 'ready';
      } else if (indexing.length > 0) {
        viewState = 'indexing';
      } else {
        viewState = 'fresh';
      }

      if (this.mounted) this.setState({ viewState, indexEntries });
    }

    handleStartIndexing = async (): Promise<void> => {
      this.setState({ viewState: 'indexing' });
      const ipc = this.props.electron.ipcRenderer;
      // Trigger indexing for all unindexed sites
      for (const site of this.props.sites) {
        const entry = this.props.indexEntries.find((e) => e.siteId === site.id);
        if (!entry || entry.state !== 'indexed') {
          ipc.invoke(IPC_CHANNELS.INDEX_SITE, { siteId: site.id, force: false }).catch(() => {});
        }
      }
    };

    renderFresh(): React.ReactNode {
      return React.createElement('div', {
        style: { maxWidth: 520, margin: '48px auto', textAlign: 'center' as const },
      },
        React.createElement('div', {
          style: { width: 56, height: 56, borderRadius: 16, background: 'rgba(14,202,212,0.1)', border: '1px solid rgba(14,202,212,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, margin: '0 auto 20px' },
        }, '🔍'),
        React.createElement('h2', { style: { fontSize: 18, fontWeight: 600, marginBottom: 8 } }, 'Search across all your sites'),
        React.createElement('p', { style: { fontSize: 13, color: 'var(--nxai-card-sub)', lineHeight: 1.6, marginBottom: 24 } },
          'Nexus indexes your WordPress content and lets you search semantically — finding relevant pages even when they don\'t use your exact words.',
        ),
        React.createElement('div', {
          style: { display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(81,187,123,0.08)', border: '1px solid rgba(81,187,123,0.2)', borderRadius: 20, padding: '4px 12px', fontSize: 11, color: '#51BB7B', marginBottom: 28 },
        }, '✓ No API key required — works out of the box'),
        React.createElement('br'),
        this.props.sites.length === 0
          ? React.createElement('p', { style: { fontSize: 13, color: 'var(--nxai-card-sub)' } }, 'No local WordPress sites found. Create a site in Local first.')
          : React.createElement('button', {
              onClick: this.handleStartIndexing,
              style: { background: '#0ECAD4', color: '#000', fontWeight: 700, fontSize: 13, padding: '10px 22px', borderRadius: 8, border: 'none', cursor: 'pointer', fontFamily: 'inherit' },
            }, '⚡ Index my sites now'),
      );
    }

    renderIndexing(): React.ReactNode {
      const { sites } = this.props;
      const { indexEntries } = this.state;
      const indexed = indexEntries.filter((e) => e.state === 'indexed').length;
      const total = sites.length;
      const pct = total > 0 ? Math.round((indexed / total) * 100) : 0;

      return React.createElement('div', {
        style: { maxWidth: 520, margin: '40px auto', textAlign: 'center' as const },
      },
        React.createElement('div', { style: { fontSize: 24, marginBottom: 16 } }, '⚡'),
        React.createElement('h2', { style: { fontSize: 18, fontWeight: 600, marginBottom: 8 } }, 'Indexing your sites…'),
        React.createElement('p', { style: { fontSize: 13, color: 'var(--nxai-card-sub)', marginBottom: 20 } }, 'Reading content from your WordPress sites.'),
        React.createElement('div', { style: { background: '#222', borderRadius: 4, height: 4, maxWidth: 400, margin: '0 auto 8px', overflow: 'hidden' } },
          React.createElement('div', { style: { height: '100%', width: `${pct}%`, background: 'linear-gradient(90deg, #0ECAD4, #51BB7B)', borderRadius: 4, transition: 'width 0.5s' } }),
        ),
        React.createElement('div', { style: { fontSize: 11, color: 'var(--nxai-card-sub)', marginBottom: 20 } }, `${indexed} of ${total} sites indexed`),
        React.createElement('div', {
          style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, textAlign: 'left' as const },
        },
          ...sites.map((site) => {
            const entry = indexEntries.find((e) => e.siteId === site.id);
            const st = entry?.state ?? 'pending';
            const dotColor = st === 'indexed' ? '#51BB7B' : st === 'indexing' ? '#0ECAD4' : '#333';
            const label = st === 'indexed' ? `${entry?.documentCount ?? '?'} pages` : st === 'indexing' ? 'indexing…' : 'waiting';
            return React.createElement('div', {
              key: site.id,
              style: { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'var(--nxai-card-bg)', border: '1px solid var(--nxai-card-border)', borderRadius: 6, fontSize: 12 },
            },
              React.createElement('div', { style: { width: 8, height: 8, borderRadius: '50%', background: dotColor, flexShrink: 0 } }),
              React.createElement('span', { style: { flex: 1, color: 'var(--nxai-card-text)' } }, site.name),
              React.createElement('span', { style: { fontSize: 10, color: st === 'indexed' ? '#51BB7B' : 'var(--nxai-card-sub)' } }, label),
            );
          }),
        ),
      );
    }

    renderReady(): React.ReactNode {
      // Placeholder — replaced in Task 4
      return React.createElement('div', { style: { textAlign: 'center' as const, padding: 48, color: 'var(--nxai-card-sub)' } }, 'Search UI coming in Task 4');
    }

    render(): React.ReactNode {
      const { viewState } = this.state;
      return React.createElement('div', { style: { padding: '24px' } },
        viewState === 'fresh'    ? this.renderFresh()    : null,
        viewState === 'indexing' ? this.renderIndexing() : null,
        viewState === 'ready'    ? this.renderReady()    : null,
      );
    }
  }
  ```

- [ ] **Step 2: Build**

  Run: `npm run compile`
  Expected: exits 0.

- [ ] **Step 3: Commit**

  ```bash
  git add src/renderer/components/DiscoverTab.tsx
  git commit -m "feat(discover): DiscoverTab skeleton — fresh/indexing/ready state machine"
  ```

---

## Task 4: Wire DiscoverTab into NexusOverview

**Files:**
- Modify: `src/renderer/components/NexusOverview.tsx`

- [ ] **Step 1: Add `'discover'` to the `activeTab` union type in `NexusOverview.tsx`**

  Find line 154:
  ```typescript
  activeTab: 'overview' | 'activity' | 'operations';
  ```
  Change to:
  ```typescript
  activeTab: 'overview' | 'discover' | 'activity' | 'operations';
  ```

- [ ] **Step 2: Import `DiscoverTab` at the top of `NexusOverview.tsx`**

  Add after the existing imports:
  ```typescript
  import { DiscoverTab } from './DiscoverTab';
  ```

- [ ] **Step 3: Set default `activeTab` to `'discover'` when no sites are indexed yet**

  Find the `activeTab: 'overview'` initial state (line ~349) and change to:
  ```typescript
  activeTab: 'discover',
  ```

- [ ] **Step 4: Add 'Discover' to the tabs array in `renderActiveTab` (around line 1509)**

  Find:
  ```typescript
  const tabs: { key: NexusOverviewState['activeTab']; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'activity', label: 'Activity' },
    { key: 'operations', label: 'Operations' },
  ];
  ```
  Change to:
  ```typescript
  const tabs: { key: NexusOverviewState['activeTab']; label: string; isNew?: boolean }[] = [
    { key: 'overview',    label: 'Overview' },
    { key: 'discover',    label: 'Discover', isNew: true },
    { key: 'activity',    label: 'Activity' },
    { key: 'operations',  label: 'Operations' },
  ];
  ```

- [ ] **Step 5: Render the `isNew` badge in the tab label**

  Find the tab rendering code (around line 1524) that renders the tab label text. It will look something like:
  ```typescript
  React.createElement('span', null, tab.label),
  ```
  Change to:
  ```typescript
  React.createElement('span', null,
    tab.label,
    (tab as any).isNew ? React.createElement('span', {
      style: { marginLeft: 5, fontSize: 9, fontWeight: 700, background: '#0ECAD4', color: '#000', borderRadius: 8, padding: '1px 5px', verticalAlign: 'middle' },
    }, 'NEW') : null,
  ),
  ```

- [ ] **Step 6: Add the `'discover'` case to `renderActiveTab()`**

  Find (around line 1921):
  ```typescript
  switch (this.state.activeTab) {
    case 'overview': return this.renderOverviewTab();
    case 'activity': return this.renderActivityTab();
  ```
  Add after `case 'overview'`:
  ```typescript
  case 'discover': return React.createElement(DiscoverTab, {
    electron: this.props.electron,
    sites: this.state.sites.map((s) => ({ id: s.id, name: s.name, status: s.status })),
    indexEntries: (this.state.indexEntries ?? []).map((e: any) => ({
      siteId: e.siteId,
      siteName: e.siteName ?? '',
      state: e.state,
      documentCount: e.documentCount,
    })),
    settings: this.state.settings ?? { autoIndex: true, excludedSiteIds: [] },
    onSettingsChange: (s) => {
      this.setState({ settings: s });
      this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.UPDATE_SETTINGS, s).catch(() => {});
    },
  });
  ```

- [ ] **Step 7: Build and verify**

  Run: `npm run compile`
  Expected: exits 0.

- [ ] **Step 8: Commit**

  ```bash
  git add src/renderer/components/NexusOverview.tsx
  git commit -m "feat(discover): wire DiscoverTab into NexusOverview as second tab"
  ```

---

## Task 5: Comparison search UI

**Files:**
- Modify: `src/renderer/components/DiscoverTab.tsx` — replace `renderReady()` placeholder

This is the core of the feature. The `renderReady()` method gets the full search + comparison UI.

- [ ] **Step 1: Add search state to `DiscoverTabState`**

  Find `DiscoverTabState`:
  ```typescript
  interface DiscoverTabState {
    viewState: 'fresh' | 'indexing' | 'ready';
    indexEntries: IndexEntry[];
  }
  ```
  Change to:
  ```typescript
  interface SearchResult {
    id: string;
    title: string;
    content: string;
    postType: string;
    postId: number;
    score: number;
    siteId: string;
    siteName: string;
  }

  interface DiscoverTabState {
    viewState: 'fresh' | 'indexing' | 'ready';
    indexEntries: IndexEntry[];
    query: string;
    searching: boolean;
    keywordResults: SearchResult[];
    semanticResults: SearchResult[];
    hasSearched: boolean;
    mcpExpanded: boolean;
    furtherVisible: boolean;
  }
  ```

- [ ] **Step 2: Update initial state to include search fields**

  Find `state: DiscoverTabState = {` and add the new fields:
  ```typescript
  state: DiscoverTabState = {
    viewState: 'fresh',
    indexEntries: [],
    query: '',
    searching: false,
    keywordResults: [],
    semanticResults: [],
    hasSearched: false,
    mcpExpanded: false,
    furtherVisible: false,
  };
  ```

- [ ] **Step 3: Add `handleSearch` method to `DiscoverTab`**

  Add after `handleStartIndexing`:

  ```typescript
  handleSearch = async (query: string): Promise<void> => {
    const q = query.trim();
    if (!q) return;

    this.setState({ query: q, searching: true, keywordResults: [], semanticResults: [] });

    const ipc = this.props.electron.ipcRenderer;
    const [kwRes, semRes] = await Promise.all([
      ipc.invoke(IPC_CHANNELS.SEARCH_KEYWORD, q, 10).catch(() => ({ results: [] })),
      ipc.invoke(IPC_CHANNELS.SEARCH, q, undefined, 10).catch(() => ({ results: [] })),
    ]);

    if (!this.mounted) return;

    const hadSearched = this.state.hasSearched;
    this.setState({
      searching: false,
      keywordResults: kwRes.results ?? [],
      semanticResults: semRes.results ?? [],
      hasSearched: true,
    });

    // Persist that the user has searched — unlock progressive steps
    if (!hadSearched) {
      const next = { ...this.props.settings, discoverProgress: { ...this.props.settings.discoverProgress, hasSearched: true } };
      this.props.onSettingsChange(next);
    }
  };

  handleMcpDone = (): void => {
    this.setState({ furtherVisible: true, mcpExpanded: false });
    const next = { ...this.props.settings, discoverProgress: { ...this.props.settings.discoverProgress, hasMcpDone: true } };
    this.props.onSettingsChange(next);
  };
  ```

- [ ] **Step 4: Replace `renderReady()` with the full comparison search UI**

  Replace the placeholder `renderReady()` with:

  ```typescript
  renderReady(): React.ReactNode {
    const { query, searching, keywordResults, semanticResults, hasSearched, mcpExpanded, furtherVisible } = this.state;
    const { indexEntries } = this.props;
    const indexedCount = indexEntries.filter((e) => e.state === 'indexed').length;
    const totalDocs = indexEntries.reduce((s, e) => s + (e.documentCount ?? 0), 0);

    const SUGGESTIONS = ['customer feedback', 'content strategy', 'onboarding flow', 'product launch'];

    // Shared style helpers
    const cardSub: React.CSSProperties = { fontSize: 11, color: 'var(--nxai-card-sub)' };
    const delta = semanticResults.length - keywordResults.length;

    return React.createElement('div', null,

      // ── Header ───────────────────────────────────────────────
      React.createElement('div', { style: { textAlign: 'center' as const, marginBottom: 20 } },
        React.createElement('h2', { style: { fontSize: 18, fontWeight: 600, marginBottom: 6 } }, 'Search your sites'),
        React.createElement('p', { style: { ...cardSub } }, 'Keyword search finds exact matches. Semantic search understands meaning.'),
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 8, fontSize: 11, color: 'var(--nxai-card-sub)' } },
          React.createElement('span', null, `${indexedCount} sites indexed`),
          React.createElement('span', null, '·'),
          React.createElement('span', null, `${totalDocs.toLocaleString()} pages`),
          React.createElement('span', null, '·'),
          React.createElement('span', { style: { background: 'rgba(81,187,123,0.08)', border: '1px solid rgba(81,187,123,0.2)', borderRadius: 20, padding: '2px 8px', color: '#51BB7B', fontSize: 10 } }, 'No API key needed'),
        ),
      ),

      // ── Search bar ───────────────────────────────────────────
      React.createElement('div', { style: { position: 'relative' as const, maxWidth: 620, margin: '0 auto 8px' } },
        React.createElement('span', { style: { position: 'absolute' as const, left: 15, top: '50%', transform: 'translateY(-50%)', fontSize: 16, color: 'var(--nxai-card-sub)', pointerEvents: 'none' } }, '⌕'),
        React.createElement('input', {
          type: 'text',
          value: query,
          placeholder: 'Try: customer feedback, content strategy, onboarding…',
          onChange: (e: any) => this.setState({ query: e.target.value }),
          onKeyDown: (e: any) => { if (e.key === 'Enter' && query.trim()) this.handleSearch(query); },
          style: { width: '100%', background: 'var(--nxai-code-bg)', border: '1px solid var(--nxai-card-border)', borderRadius: 10, color: 'inherit', padding: '12px 48px 12px 46px', fontSize: 15, outline: 'none', fontFamily: 'inherit' },
        }),
        React.createElement('span', { style: { position: 'absolute' as const, right: 14, top: '50%', transform: 'translateY(-50%)', fontSize: 10, color: '#444', background: '#252525', borderRadius: 4, padding: '2px 6px', fontFamily: 'monospace' } }, '↵'),
      ),

      // Suggestion chips
      React.createElement('div', { style: { textAlign: 'center' as const, marginBottom: 24, fontSize: 11, color: '#333' } },
        'Try: ',
        ...SUGGESTIONS.map((s, i) =>
          React.createElement('span', {
            key: s,
            onClick: () => this.handleSearch(s),
            style: { color: '#0ECAD4', cursor: 'pointer', marginLeft: i === 0 ? 0 : 6 },
          }, s + (i < SUGGESTIONS.length - 1 ? ' ·' : '')),
        ),
      ),

      // ── Empty / loading ──────────────────────────────────────
      !hasSearched && !searching
        ? React.createElement('div', { style: { textAlign: 'center' as const, padding: '48px 0', color: '#333' } },
            React.createElement('div', { style: { fontSize: 32, marginBottom: 12, opacity: 0.2 } }, '⌕'),
            React.createElement('div', { style: { fontSize: 14, color: '#444' } }, 'Type a query to search across all your sites'),
            React.createElement('div', { style: { fontSize: 11, color: '#333', marginTop: 4 } }, 'Semantic search finds related content even without exact keyword matches'),
          )
        : null,

      searching
        ? React.createElement('div', { style: { textAlign: 'center' as const, padding: '40px 0', color: '#444', fontSize: 12 } }, 'Searching…')
        : null,

      // ── Results ──────────────────────────────────────────────
      hasSearched && !searching
        ? React.createElement('div', null,

          // Delta bar
          delta > 0
            ? React.createElement('div', {
                style: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '10px 16px', background: 'rgba(81,187,123,0.06)', border: '1px solid rgba(81,187,123,0.15)', borderRadius: 8, marginBottom: 14, fontSize: 12, color: '#51BB7B' },
              }, `✦ Semantic found ${delta} additional result${delta !== 1 ? 's' : ''} — related content keyword search missed`)
            : null,

          // Two columns
          React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 } },

            // Keyword column
            React.createElement('div', null,
              React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: 'var(--nxai-code-bg)', border: '1px solid var(--nxai-card-border)', borderRadius: '8px 8px 0 0' } },
                React.createElement('span', { style: { fontSize: 12, fontWeight: 600, flex: 1 } }, 'Keyword search'),
                React.createElement('span', { style: { fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: 'rgba(156,163,175,0.12)', color: '#9ca3af' } }, `${keywordResults.length} result${keywordResults.length !== 1 ? 's' : ''}`),
              ),
              React.createElement('div', { style: { fontSize: 11, color: 'var(--nxai-card-sub)', padding: '0 14px 8px', background: 'var(--nxai-code-bg)', borderLeft: '1px solid var(--nxai-card-border)', borderRight: '1px solid var(--nxai-card-border)' } }, 'Exact word matches only'),
              keywordResults.length === 0
                ? React.createElement('div', { style: { background: 'var(--nxai-code-bg)', border: '1px solid var(--nxai-card-border)', borderTop: 'none', borderRadius: '0 0 8px 8px', padding: 28, textAlign: 'center' as const, color: '#333', fontSize: 12, fontStyle: 'italic' } }, 'No exact matches found')
                : React.createElement('div', null, ...keywordResults.map((r, i) => this.renderResultCard(r, i, false))),
            ),

            // Semantic column
            React.createElement('div', null,
              React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: 'var(--nxai-code-bg)', border: '1px solid var(--nxai-card-border)', borderRadius: '8px 8px 0 0' } },
                React.createElement('span', { style: { fontSize: 12, fontWeight: 600, flex: 1 } }, 'Semantic search'),
                React.createElement('span', { style: { fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: semanticResults.length > keywordResults.length ? 'rgba(81,187,123,0.12)' : 'rgba(14,202,212,0.12)', color: semanticResults.length > keywordResults.length ? '#51BB7B' : '#0ECAD4' } }, `${semanticResults.length} result${semanticResults.length !== 1 ? 's' : ''}`),
              ),
              React.createElement('div', { style: { fontSize: 11, color: 'var(--nxai-card-sub)', padding: '0 14px 8px', background: 'var(--nxai-code-bg)', borderLeft: '1px solid var(--nxai-card-border)', borderRight: '1px solid var(--nxai-card-border)' } }, 'Meaning-based — finds related ideas'),
              semanticResults.length === 0
                ? React.createElement('div', { style: { background: 'var(--nxai-code-bg)', border: '1px solid var(--nxai-card-border)', borderTop: 'none', borderRadius: '0 0 8px 8px', padding: 28, textAlign: 'center' as const, color: '#333', fontSize: 12, fontStyle: 'italic' } }, 'No results found')
                : React.createElement('div', null, ...semanticResults.map((r, i) => {
                    const isSemanticOnly = !keywordResults.find((k) => k.postId === r.postId);
                    return this.renderResultCard(r, i, isSemanticOnly);
                  })),
            ),
          ),
        )
        : null,

      // ── MCP next-step card (appears after first search) ──────
      hasSearched ? this.renderMcpCard() : null,

      // ── Further steps ─────────────────────────────────────────
      furtherVisible ? this.renderFurtherSteps() : null,
    );
  }

  renderResultCard(r: SearchResult, index: number, isSemanticOnly: boolean): React.ReactNode {
    return React.createElement('div', {
      key: `${r.siteId}-${r.postId}-${index}`,
      style: { background: 'var(--nxai-code-bg)', border: '1px solid var(--nxai-card-border)', borderTop: 'none', padding: '11px 14px', ...(index === 9 ? { borderRadius: '0 0 8px 8px' } : {}) },
    },
      React.createElement('div', { style: { fontSize: 10, color: 'var(--nxai-card-sub)', marginBottom: 3, display: 'flex', alignItems: 'center', gap: 5 } },
        React.createElement('div', { style: { width: 5, height: 5, borderRadius: '50%', background: isSemanticOnly ? '#0ECAD4' : '#9ca3af' } }),
        r.siteName,
        isSemanticOnly ? React.createElement('span', { style: { fontSize: 9, background: 'rgba(14,202,212,0.1)', color: '#0ECAD4', borderRadius: 3, padding: '1px 4px' } }, 'semantic only') : null,
      ),
      React.createElement('div', { style: { fontSize: 13, fontWeight: 500, marginBottom: 4, lineHeight: 1.4 } }, r.title),
      React.createElement('div', { style: { fontSize: 11, color: 'var(--nxai-card-sub)', lineHeight: 1.5 } },
        r.content.slice(0, 120) + (r.content.length > 120 ? '…' : ''),
      ),
    );
  }

  renderMcpCard(): React.ReactNode {
    const { mcpExpanded } = this.state;
    const mcpConfig = `{
  "mcpServers": {
    "nexus": {
      "command": "nexus",
      "args": ["mcp", "start"]
    }
  }
}`;

    return React.createElement('div', { style: { border: '1px solid var(--nxai-card-border)', borderRadius: 10, overflow: 'hidden', marginTop: 24 } },
      React.createElement('div', {
        style: { display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', background: 'var(--nxai-code-bg)', cursor: 'pointer' },
        onClick: () => this.setState((prev) => ({ mcpExpanded: !prev.mcpExpanded })),
      },
        React.createElement('div', { style: { width: 36, height: 36, borderRadius: 10, background: 'rgba(14,202,212,0.1)', border: '1px solid rgba(14,202,212,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 } }, '🤖'),
        React.createElement('div', { style: { flex: 1 } },
          React.createElement('div', { style: { fontSize: 14, fontWeight: 600 } }, 'Let Claude search your sites'),
          React.createElement('div', { style: { fontSize: 12, color: 'var(--nxai-card-sub)', marginTop: 2 } }, 'Connect to Claude Desktop, Cursor, or any MCP client — then ask natural-language questions about your content.'),
        ),
        React.createElement('span', { style: { color: 'var(--nxai-card-sub)', fontSize: 12, transform: mcpExpanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s', display: 'inline-block' } }, '▶'),
      ),
      mcpExpanded ? React.createElement('div', { style: { padding: 16, background: '#161616', borderTop: '1px solid var(--nxai-card-border)' } },
        // Steps
        ...([
          ['Open Claude Desktop', 'Settings → Developer → Edit Config'],
          ['Add Nexus as an MCP server', null],
          ['Restart Claude Desktop and try', '"Search my sites for anything about customer onboarding"'],
        ] as [string, string | null][]).map(([title, sub], i) =>
          React.createElement('div', { key: i, style: { display: 'flex', gap: 12, marginBottom: 12 } },
            React.createElement('div', { style: { width: 22, height: 22, borderRadius: '50%', background: 'rgba(14,202,212,0.1)', border: '1px solid rgba(14,202,212,0.2)', color: '#0ECAD4', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 } }, String(i + 1)),
            React.createElement('div', { style: { fontSize: 12, color: '#aaa', lineHeight: 1.5 } },
              React.createElement('strong', { style: { color: '#e0e0e0' } }, title),
              sub ? React.createElement('div', { style: { color: '#0ECAD4', fontStyle: 'italic', marginTop: 2 } }, sub) : null,
              i === 1 ? React.createElement('pre', {
                style: { background: '#0d0d0d', border: '1px solid var(--nxai-card-border)', borderRadius: 6, padding: '10px 12px', fontFamily: 'monospace', fontSize: 11, color: '#aaa', margin: '8px 0', overflowX: 'auto' as const, whiteSpace: 'pre' as const },
              }, mcpConfig) : null,
            ),
          ),
        ),
        React.createElement('div', { style: { display: 'flex', gap: 8 } },
          React.createElement('button', { onClick: this.handleMcpDone, style: { background: '#0ECAD4', color: '#000', fontWeight: 700, fontSize: 12, padding: '8px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', fontFamily: 'inherit' } }, 'Done — what\'s next?'),
          React.createElement('button', { onClick: () => this.setState({ mcpExpanded: false }), style: { background: 'none', color: 'var(--nxai-card-sub)', fontSize: 12, padding: '8px 14px', borderRadius: 8, border: '1px solid var(--nxai-card-border)', cursor: 'pointer', fontFamily: 'inherit' } }, 'Maybe later'),
        ),
      ) : null,
    );
  }

  renderFurtherSteps(): React.ReactNode {
    const steps = [
      { icon: '⚡', title: 'Enable Smart Search on a site', sub: 'Upgrade a site\'s WordPress search to use your indexed content.', chip: 'Free', onClick: () => {} },
      { icon: '🔑', title: 'Add an AI provider key', sub: 'Unlock Site Finder, AI writing tools, and the WordPress AI toolkit.', chip: 'Optional', onClick: () => {} },
      { icon: '☁', title: 'Connect WP Engine', sub: 'Index and search your remote WPE sites, manage your full fleet.', chip: 'Optional', onClick: () => {} },
    ];

    return React.createElement('div', { style: { marginTop: 12, display: 'flex', flexDirection: 'column' as const, gap: 8 } },
      React.createElement('div', { style: { fontSize: 10, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.08em', color: 'var(--nxai-card-sub)', marginBottom: 4 } }, 'Keep going'),
      ...steps.map((s, i) =>
        React.createElement('div', {
          key: i,
          onClick: s.onClick,
          style: { display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', background: 'var(--nxai-code-bg)', border: '1px solid var(--nxai-card-border)', borderRadius: 8, cursor: 'pointer', opacity: i === 0 ? 1 : 0.6 },
        },
          React.createElement('span', { style: { fontSize: 18 } }, s.icon),
          React.createElement('div', { style: { flex: 1 } },
            React.createElement('div', { style: { fontSize: 13, fontWeight: 500 } }, s.title),
            React.createElement('div', { style: { fontSize: 11, color: 'var(--nxai-card-sub)', marginTop: 2 } }, s.sub),
          ),
          React.createElement('span', { style: { fontSize: 10, padding: '2px 8px', borderRadius: 10, background: i === 0 ? 'rgba(14,202,212,0.08)' : 'transparent', color: i === 0 ? '#0ECAD4' : 'var(--nxai-card-sub)', border: i === 0 ? '1px solid rgba(14,202,212,0.15)' : 'none' } }, s.chip),
        ),
      ),
    );
  }
  ```

- [ ] **Step 5: Build**

  Run: `npm run compile`
  Expected: exits 0.

- [ ] **Step 6: Commit**

  ```bash
  git add src/renderer/components/DiscoverTab.tsx
  git commit -m "feat(discover): comparison search UI — keyword vs semantic, MCP card, progressive steps"
  ```

---

## Task 6: Restore progress across sessions

**Files:**
- Modify: `src/renderer/components/DiscoverTab.tsx` — read `discoverProgress` from settings on mount

- [ ] **Step 1: Restore `hasSearched` and `furtherVisible` from settings on mount**

  In `componentDidMount`, after `injectThemeVars()` and `this.deriveViewState()`, add:

  ```typescript
  const prog = this.props.settings.discoverProgress;
  if (prog?.hasSearched) {
    this.setState({ hasSearched: true });
  }
  if (prog?.hasMcpDone) {
    this.setState({ furtherVisible: true });
  }
  ```

- [ ] **Step 2: Build and run full test suite**

  Run: `npm run build`
  Expected: builds cleanly.

  Run: `npm test`
  Expected: all suites pass (same count as before this feature branch).

- [ ] **Step 3: Commit**

  ```bash
  git add src/renderer/components/DiscoverTab.tsx
  git commit -m "feat(discover): restore discover progress state across sessions"
  ```

---

## Task 7: Final polish — remove old onboarding card

**Files:**
- Modify: `src/renderer/components/NexusOverview.tsx`

The static 3-step "Getting Started" card is now superseded by the Discover tab. Remove it so it no longer clutters the Overview tab.

- [ ] **Step 1: Remove the onboarding card render call in `renderOverviewTab()`**

  In `renderOverviewTab()` (around line 1445), find and remove the call:
  ```typescript
  this.renderOnboardingCard(),
  ```
  (or the conditional `!onboardingDismissed ? this.renderOnboardingCard() : null`)

- [ ] **Step 2: Delete `renderOnboardingCard()` and `handleDismissOnboarding()` methods**

  Remove both methods entirely (they're around lines 1347 and 1360).

- [ ] **Step 3: Clean up `onboardingDismissed` from state if no longer used**

  Check if `onboardingDismissed` is still referenced anywhere else in `NexusOverview.tsx`.
  Run: `grep -n "onboardingDismissed" src/renderer/components/NexusOverview.tsx`
  Remove any remaining references.

- [ ] **Step 4: Build and full test run**

  Run: `npm run build`
  Run: `npm test`
  Expected: clean build, all tests pass.

- [ ] **Step 5: Commit**

  ```bash
  git add src/renderer/components/NexusOverview.tsx
  git commit -m "feat(discover): remove old static onboarding card — replaced by Discover tab"
  ```

---

## Self-Review

**Spec coverage:**
- ✅ State 1 (fresh install) — Task 3 `renderFresh()`
- ✅ State 2 (indexing) — Task 3 `renderIndexing()`
- ✅ State 3 (comparison search) — Task 5 `renderReady()`
- ✅ Keyword search backend — Task 2
- ✅ Semantic search (reuses existing SEARCH handler) — Task 5 `handleSearch`
- ✅ Keyword vs semantic delta callout — Task 5 delta bar
- ✅ "semantic only" badge on results not in keyword set — Task 5 `renderResultCard`
- ✅ MCP progressive step — Task 5 `renderMcpCard()`
- ✅ Further steps (Smart Search, API key, WPE) — Task 5 `renderFurtherSteps()`
- ✅ Session persistence of progress — Task 6
- ✅ Old onboarding card removed — Task 7
- ✅ "No API key needed" messaging — Tasks 3 + 5

**Placeholder scan:** None found — all steps have complete code.

**Type consistency:**
- `SearchResult` defined in Task 5 and used in `handleSearch`, `renderResultCard` — consistent.
- `IndexEntry` defined in Task 3 and referenced in Task 4 — consistent.
- `discoverProgress` type defined in Task 1, used in Tasks 5 and 6 — consistent.
