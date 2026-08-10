# Nexus Sites Table Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `SystemTab`, `FleetCompletenessWidget` and the Fleet Summary card with one Sites table covering Local, WP Engine and External hosts, with selection-scoped bulk actions.

**Architecture:** A main-process row builder reads the three sources the way `collectFleetCounts` already reconciles them, derives a knowledge rung per row via the existing (currently unwired) `knowledgeLadder`, and serves them over one IPC channel. The renderer table adds selection; bulk work dispatches through the existing `BulkOperationManager`. Operations keeps only its Advanced zone until spec 6 rehomes it.

**Tech Stack:** TypeScript, better-sqlite3, Electron IPC, React 16 (`React.createElement`, class components, no JSX/hooks), Jest.

Design: `docs/planning/2026-08-10-nexus-sites-table-design.md`

## Global Constraints

- React 16, `React.createElement`, class components, inline style objects — **no JSX, no hooks**.
- No hardcoded colours. `--nxai-*` variables only, verified present in `src/renderer/utils/theme.ts`, working in light and dark.
- **Every population renders with its `scope` string, never a bare number.**
- Counts come from `collectFleetCounts`. **Never re-derive local counts from the graph** — it over-reports (22 dead `sentinel-*` rows measured).
- Bulk work goes through `BulkOperationManager`. No second path; do not lose its audit trail.
- **An empty selection disables bulk actions. It never means "all".**
- **No host type is capped at a knowledge rung.**
- Primary buttons use `#0a8189` via a new `--nxai-accent`, never `#0ECAD4` (2.96:1, fails WCAG AA).
- Never use bare `git stash` / `git stash pop` — the stash stack is shared across worktrees.
- Do **not** run `npm version`, `git tag`, `git push`, or trigger a release. Commit locally only.
- Do **not** run `npm install` or `npm run rebuild` — the native module is already correct here.

## Measured baseline — hold yourself to it

Before starting, run `npx jest tests/unit` and record the failure count. Report yours against it.
Per-directory runs miss regressions; only the full-suite number is evidence.

## File Structure

| File | Responsibility |
|---|---|
| `src/main/fleet/knowledgeLadder.ts` | Modify. Lift the External ceiling (Task 1). |
| `src/main/fleet/siteRows.ts` | Create. Build one row per site across all three sources. |
| `src/main/ipc-handlers.ts` | Modify. `GET_SITE_ROWS` handler; delete the stale external comment. |
| `src/common/constants.ts` | Modify. One new channel. |
| `src/renderer/utils/theme.ts` | Modify. Add `--nxai-accent` + on-accent text, both modes. |
| `src/renderer/components/tabs/SitesTab.tsx` | Create. The table, filters, selection, bulk bar. |
| `src/renderer/components/NexusOverview.tsx` | Modify. Register the tab; gut Operations to zone 3. |
| `src/renderer/components/tabs/OverviewTab.tsx` | Modify. Remove the two fleet cards. |
| `src/renderer/components/SettingsTab.tsx` | Modify. Add the `externalContentIndexAutoEnabled` row. |
| `src/main/mcp/schemas.ts` | Modify. Add `externalContentIndexAutoEnabled` to `UpdateSettingsSchema` — `.strict()` strips it otherwise. |
| `tests/unit/fleet/knowledge-ladder.test.ts` | Modify/create. The External regression test. |
| `tests/unit/fleet/site-rows.test.ts` | Create. Row building across sources. |
| `tests/unit/renderer/sites-tab.test.ts` | Create. `serializeTree` snapshots, selection, bulk gating. |

---

### Task 1: Lift the External knowledge ceiling

**Files:**
- Modify: `src/main/fleet/knowledgeLadder.ts`
- Test: `tests/unit/fleet/knowledge-ladder.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `toKnowledgeRung(completeness, source)` with External able to reach `'searchable'`. Tasks 2 and 4 depend on this.

**Why this is first, and why it is delicate.** `knowledgeLadder.ts` currently encodes:

```ts
/** A generic SSH connection cannot yield indexed content, so external caps here. */
const SOURCE_CEILING: Record<string, KnowledgeRung> = {
  local: 'searchable', wpe: 'searchable', external: 'detailed',
};
```

That comment is **false as of the external content-indexing work**. `ExternalContentIndexScheduler`
is instantiated (`src/main/index.ts:59`, `:471`), `ExternalContentIndexService` exists, and
`ipc-handlers.ts:2296` already counts `externalSearchable` from the index registry. The module has
**zero production consumers** today, so this has never been visible — but Task 2 is about to wire
it, and wiring it unchanged would make the table state something untrue about every indexed
external host.

**Do NOT remove `SOURCE_CEILING` or the `?? 'nothing'` fallback.** The fail-closed behaviour for an
*unrecognised* source is deliberate and correct — an unknown future source must not silently
receive the most permissive ceiling. Only the `external` entry changes.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/fleet/knowledge-ladder.test.ts
import { toKnowledgeRung, KNOWLEDGE_LABELS } from '../../../src/main/fleet/knowledgeLadder';

describe('toKnowledgeRung', () => {
  test('an indexed external host reaches searchable', () => {
    // External content indexing shipped (ExternalContentIndexScheduler). Capping
    // here would make the Sites table state something untrue about a host the
    // user has actually indexed. This is the regression test for that claim —
    // DECISIONS.md still says external caps at Detailed. It is wrong.
    expect(toKnowledgeRung('indexed', 'external')).toBe('searchable');
  });

  test('an unindexed external host still reports what it actually has', () => {
    expect(toKnowledgeRung('metadata', 'external')).toBe('detailed');
    expect(toKnowledgeRung('filesystem', 'external')).toBe('basic');
    expect(toKnowledgeRung(null, 'external')).toBe('nothing');
  });

  test('local and wpe are unchanged', () => {
    expect(toKnowledgeRung('indexed', 'local')).toBe('searchable');
    expect(toKnowledgeRung('indexed', 'wpe')).toBe('searchable');
    expect(toKnowledgeRung('metadata', 'wpe')).toBe('detailed');
  });

  test('an unrecognised source still fails closed', () => {
    // The ceiling exists for THIS reason and must survive. A source the ladder
    // was never designed to score must not inherit the most permissive rung.
    expect(toKnowledgeRung('indexed', 'martian' as any)).toBe('nothing');
  });

  test('an unrecognised completeness reads as nothing', () => {
    expect(toKnowledgeRung('quantum' as any, 'local')).toBe('nothing');
  });

  test('every rung has a label', () => {
    for (const rung of ['nothing', 'basic', 'detailed', 'searchable'] as const) {
      expect(KNOWLEDGE_LABELS[rung]).toBeTruthy();
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest tests/unit/fleet/knowledge-ladder.test.ts`
Expected: FAIL — the first test gets `'detailed'`.

- [ ] **Step 3: Lift the ceiling**

```ts
/**
 * Per-source ceiling on what Nexus can claim to know.
 *
 * External used to cap at `detailed`, on the reasoning that "a generic SSH
 * connection cannot yield indexed content". That stopped being true when
 * external content indexing shipped — `ExternalContentIndexScheduler` runs on
 * an opt-in timer and `nexus host index <alias>` runs one host on demand, and
 * `ipc-handlers` already counts those hosts as searchable. An indexed external
 * host is searchable, and saying otherwise on the Sites table would be a
 * statement we know to be false.
 *
 * The map itself stays, and so does the `?? 'nothing'` fallback below: an
 * unrecognised source must still fail closed rather than inherit the most
 * permissive rung.
 */
const SOURCE_CEILING: Record<string, KnowledgeRung> = {
  local: 'searchable',
  wpe: 'searchable',
  external: 'searchable',
};
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest tests/unit/fleet/knowledge-ladder.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Prove the fail-closed guard still bites**

Temporarily change `?? 'nothing'` to `?? 'searchable'`. The unrecognised-source test MUST fail.
Revert, confirm green, and report the failure message. Do not commit the probe.

- [ ] **Step 6: Commit**

```bash
git add src/main/fleet/knowledgeLadder.ts tests/unit/fleet/knowledge-ladder.test.ts
git commit -m "fix(fleet): external hosts can reach searchable

External content indexing shipped; the ceiling predates it. The module had no
consumers, so this was invisible until the Sites table came to wire it."
```

---

### Task 2: Build one row per site, across all three sources

**Files:**
- Create: `src/main/fleet/siteRows.ts`
- Test: `tests/unit/fleet/site-rows.test.ts`

**Interfaces:**
- Consumes: `toKnowledgeRung` (Task 1), `PopulationCount` from `./FleetCounts`.
- Produces: `buildSiteRows(input: SiteRowsInput): SiteRowsResult`, `interface SiteRow`. Tasks 3–5 consume both.

**Context the brief cannot know.** Local sites come from Local's own store, WPE and external from
the graph. `collectFleetCounts` (`src/main/fleet/collectFleetCounts.ts`) already encodes that
split and why: the graph accumulates rows for deleted local sites (22 dead `sentinel-*` rows
measured 2026-08-09), so a graph-derived local count over-reports badly. **Keep this function pure
and injectable** — take already-fetched arrays, do not reach for a database. The database plumbing
lives in Task 3.

**There is no `completeness` column.** I verified the live schema; `sites` has:

```
id name domain wp_version php_version account_id last_sync_at is_active created_at
updated_at source remote_install_id remote_domain site_url admin_email active_theme
post_count user_count last_post_at post_count_by_type last_active_session
user_count_by_role ssh_last_sync_at settings_json environment wpe_site_id platform
host content_indexed_at wp_path wp_cli_path
```

`toKnowledgeRung` takes a `completeness` string (`none`/`filesystem`/`metadata`/`indexed`), so
**`buildSiteRows` must derive that value from real columns** rather than reading one. Selecting a
`completeness` column would throw at runtime. Two other columns matter and are easy to miss:

- **`host`** already exists — use it for External rows rather than parsing `ssh:<alias>/<site>`.
  Fall back to parsing the id only when it is null.
- **`content_indexed_at`** is a direct record of indexing, independent of `IndexRegistry`. Treat
  either as evidence of searchable content.

`SiteRow.source` is `'local' | 'wpe' | 'external'`. Never use `source != 'local'` anywhere —
`tests/unit/.../source-semantics.test.ts` forbids it because it silently absorbs future sources.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/fleet/site-rows.test.ts
import { buildSiteRows } from '../../../src/main/fleet/siteRows';

const local = (id: string, name: string, status = 'running') => ({ id, name, status });
const graph = (over: any) => ({
  id: 'g1', source: 'wpe' as const, name: 'install-a', domain: 'a.example.com',
  wp_version: '6.5', php_version: '8.2', completeness: 'metadata',
  last_sync_at: 1000, account_id: null, ...over,
});

describe('buildSiteRows', () => {
  test('covers all three sources in one list', () => {
    const out = buildSiteRows({
      localSites: [local('L1', 'My Site')],
      graphRows: [graph({}), graph({ id: 'g2', source: 'external', name: 'hostinger/shop' })],
      indexedSiteIds: new Set<string>(),
    });

    expect(out.rows).toHaveLength(3);
    expect(out.rows.map(r => r.source).sort()).toEqual(['external', 'local', 'wpe']);
  });

  test('the total carries a scope string, never a bare number', () => {
    const out = buildSiteRows({
      localSites: [local('L1', 'My Site')], graphRows: [], indexedSiteIds: new Set(),
    });
    expect(out.total.count).toBe(1);
    expect(out.total.scope).toBeTruthy();
  });

  test('an indexed external host is searchable', () => {
    // The Task 1 correction, asserted at the layer the UI actually reads.
    const out = buildSiteRows({
      localSites: [],
      graphRows: [graph({ id: 'x1', source: 'external', completeness: 'indexed' })],
      indexedSiteIds: new Set(['x1']),
    });
    expect(out.rows[0].knowledge).toBe('searchable');
  });

  test('an index entry promotes a row to searchable even without completeness', () => {
    const out = buildSiteRows({
      localSites: [], graphRows: [graph({ id: 'w1', completeness: 'metadata' })],
      indexedSiteIds: new Set(['w1']),
    });
    expect(out.rows[0].knowledge).toBe('searchable');
  });

  test('a local site absent from the graph still appears', () => {
    // Local's store is authoritative for local sites; a site that has never
    // been indexed has no graph row and must not vanish from the table.
    const out = buildSiteRows({
      localSites: [local('L9', 'Never Indexed')], graphRows: [], indexedSiteIds: new Set(),
    });
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0].knowledge).toBe('nothing');
  });

  test('a graph row for a deleted local site is not resurrected', () => {
    // The 22 dead sentinel-* rows. Local rows come from Local's store, full stop.
    const out = buildSiteRows({
      localSites: [],
      graphRows: [graph({ id: 'sentinel-dead', source: 'local' as any })],
      indexedSiteIds: new Set(),
    });
    expect(out.rows).toHaveLength(0);
  });

  test('external rows carry the host name for display', () => {
    const out = buildSiteRows({
      localSites: [],
      graphRows: [graph({ id: 'ssh:hostinger/shop', source: 'external', name: 'shop' })],
      indexedSiteIds: new Set(),
    });
    expect(out.rows[0].host).toBe('hostinger');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest tests/unit/fleet/site-rows.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the row builder**

```ts
// src/main/fleet/siteRows.ts
import { toKnowledgeRung, KnowledgeRung } from './knowledgeLadder';
import type { PopulationCount } from './FleetCounts';

export interface SiteRow {
  id: string;
  name: string;
  source: 'local' | 'wpe' | 'external';
  /** For external rows, the ssh alias the site lives under. Null otherwise. */
  host: string | null;
  domain: string | null;
  status: string | null;
  wpVersion: string | null;
  phpVersion: string | null;
  knowledge: KnowledgeRung;
  lastSyncAt: number | null;
}

export interface SiteRowsInput {
  localSites: Array<{ id: string; name: string; status?: string }>;
  graphRows: Array<{
    id: string; source: string; name: string | null; domain: string | null;
    wp_version: string | null; php_version: string | null;
    host: string | null; content_indexed_at: number | null; last_sync_at: number | null;
  }>;
  /** Site ids with an IndexRegistry entry in `indexed` or `stale`. */
  indexedSiteIds: Set<string>;
}

export interface SiteRowsResult {
  rows: SiteRow[];
  total: PopulationCount;
}

/**
 * `ssh:<alias>/<site>` → `<alias>`. Returns null for anything else.
 * The alias is a connection, not a site — one alias can host several.
 */
function hostFromExternalId(id: string): string | null {
  const m = /^ssh:([^/]+)/.exec(id);
  return m ? m[1] : null;
}

/**
 * Derive the ladder's `completeness` value from the columns that actually
 * exist. There is no `completeness` column on `sites` — selecting one throws.
 *
 * Two independent records of indexing, and either is sufficient: an
 * `IndexRegistry` entry in `indexed`/`stale`, or a `content_indexed_at`
 * timestamp on the row. They can disagree — the registry is the live view and
 * the column is what the last sync wrote — so trusting only one would
 * under-report a genuinely indexed site.
 */
function completenessOf(
  g: { wp_version: string | null; content_indexed_at: number | null; id: string },
  indexedSiteIds: Set<string>,
): string {
  if (indexedSiteIds.has(g.id) || g.content_indexed_at) return 'indexed';
  if (g.wp_version) return 'metadata';
  return 'none';
}

export function buildSiteRows(input: SiteRowsInput): SiteRowsResult {
  const rows: SiteRow[] = [];

  // Local sites come from Local's own store, never the graph. The graph keeps
  // rows for sites that have since been deleted, so a graph-derived local list
  // resurrects them. Same reasoning as collectFleetCounts.
  for (const s of input.localSites) {
    rows.push({
      id: s.id,
      name: s.name,
      source: 'local',
      host: null,
      domain: null,
      status: s.status ?? null,
      wpVersion: null,
      phpVersion: null,
      knowledge: input.indexedSiteIds.has(s.id)
        ? toKnowledgeRung('indexed', 'local')
        : toKnowledgeRung(null, 'local'),
      lastSyncAt: null,
    });
  }

  for (const g of input.graphRows) {
    // Only the two remote sources. Never `!== 'local'` — that silently absorbs
    // any future source (see source-semantics.test.ts).
    if (g.source !== 'wpe' && g.source !== 'external') continue;
    const source = g.source as 'wpe' | 'external';

    rows.push({
      id: g.id,
      name: g.name ?? g.id,
      source,
      // `host` is a real column; only fall back to parsing the id when it is null.
      host: source === 'external' ? (g.host ?? hostFromExternalId(g.id)) : null,
      domain: g.domain,
      status: null,
      wpVersion: g.wp_version,
      phpVersion: g.php_version,
      knowledge: toKnowledgeRung(completenessOf(g, input.indexedSiteIds), source),
      lastSyncAt: g.last_sync_at,
    });
  }

  return {
    rows,
    total: {
      count: rows.length,
      scope: 'installs on this Mac, WP Engine and other hosts',
    },
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest tests/unit/fleet/site-rows.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Confirm the total agrees with `collectFleetCounts`**

Both count the same population. Add:

```ts
  test('the row count matches computeFleetCounts on the same input', () => {
    const { computeFleetCounts } = require('../../../src/main/fleet/FleetCounts');
    const graphRows = [
      graph({ id: 'w1' }), graph({ id: 'w2' }),
      graph({ id: 'x1', source: 'external' }),
    ];
    const rows = buildSiteRows({
      localSites: [local('L1', 'a'), local('L2', 'b')], graphRows, indexedSiteIds: new Set(),
    });
    const counts = computeFleetCounts({
      localSiteIds: ['L1', 'L2'],
      graphRows: graphRows.map((g: any) => ({ id: g.id, source: g.source, wpeSiteId: null })),
    });
    // Two definitions of "the fleet" that disagree is the bug the foundation
    // spec removed. They must not drift apart again.
    expect(rows.total.count).toBe(counts.installs.count);
  });
```

Run: `npx jest tests/unit/fleet/site-rows.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 6: Commit**

```bash
git add src/main/fleet/siteRows.ts tests/unit/fleet/site-rows.test.ts
git commit -m "feat(fleet): build one row per site across all three sources"
```

---

### Task 3: Serve the rows over IPC, and delete the stale comment

**Files:**
- Modify: `src/common/constants.ts`
- Modify: `src/main/ipc-handlers.ts`

**Interfaces:**
- Consumes: `buildSiteRows` (Task 2).
- Produces: `GET_SITE_ROWS` returning `{ success, rows, total, counts }`. Tasks 4–6 consume it.

**Context.** Follow the shape of the neighbouring handlers — `GET_DASHBOARD_STATS` (~line 637) is a
good model, and `safeHandle` + `localLogger` are already in scope. `indexRegistry.listAll()` gives
the index entries; `SiteNexusSection.tsx:723` defines searchable as `state === 'indexed' || state
=== 'stale'` — **reuse that definition**, `'stale'` counting is deliberate.

**The failure shape matters.** As with the Inbox, a failed read must be distinguishable from an
empty fleet. Return `success: false` with an empty list; the renderer renders "couldn't read your
sites", never "you have no sites".

- [ ] **Step 1: Add the channel**

```ts
  GET_SITE_ROWS: `${ADDON_PREFIX}:sites:rows`,
```

- [ ] **Step 2: Add the handler**

```ts
  safeHandle(IPC_CHANNELS.GET_SITE_ROWS, async () => {
    try {
      const db = graphService?.getDb?.();
      const allLocal = Object.values(siteData.getSites() ?? {}) as any[];
      const statuses = localServicesBridge.getAllSiteStatuses();

      // No `completeness` column exists — see Task 2. `host` and
      // `content_indexed_at` do, and buildSiteRows derives the rung from them.
      // `is_active = 1` is required: nexusHostRemove soft-deletes, and a removed
      // host must never reappear in a list (CLAUDE.md records this exact bug in
      // `sites list`, `sites get` and nexusFleetSiteHealth).
      const graphRows = db ? db.prepare(`
        SELECT id, source, name, domain, wp_version, php_version,
               host, content_indexed_at, last_sync_at
        FROM sites WHERE source IN ('wpe','external') AND is_active = 1
      `).all() as any[] : [];

      // 'stale' counts as searchable — the content is indexed, just ageing.
      // Same definition as SiteNexusSection.tsx:723; do not invent a second one.
      const indexedSiteIds = new Set(
        (indexRegistry.listAll() ?? [])
          .filter((e: any) => e.state === 'indexed' || e.state === 'stale')
          .map((e: any) => e.siteId),
      );

      const { rows, total } = buildSiteRows({
        localSites: allLocal.map((s: any) => ({ id: s.id, name: s.name, status: statuses[s.id] })),
        graphRows,
        indexedSiteIds,
      });

      return { success: true, rows, total };
    } catch (err) {
      localLogger.error('[NexusAI] get-site-rows failed:', (err as Error).message);
      // NOT an empty fleet. The renderer must say "couldn't read your sites".
      return { success: false, rows: [], total: { count: 0, scope: '' } };
    }
  });
```

- [ ] **Step 3: Delete the stale external comment**

At `src/main/ipc-handlers.ts:2286`, this comment is false and actively misleading:

```
      // Same shape as the WPE block: Configured means the graph has a
      // wp_version, Searchable means an IndexRegistry entry exists. Until
      // Spec 4b there is no external content indexing, so searchable will
      // read 0 — that is the true number, not a gap to hide.
```

Replace the last two sentences:

```
      // Same shape as the WPE block: Configured means the graph has a
      // wp_version, Searchable means an IndexRegistry entry exists. External
      // content indexing has since shipped (ExternalContentIndexScheduler,
      // `nexus host index <alias>`), so this can be non-zero — but it is
      // opt-in and off by default, so on most machines it will read 0.
```

Leave the code beneath it alone; it already counts correctly.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add src/common/constants.ts src/main/ipc-handlers.ts
git commit -m "feat(sites): serve site rows over IPC; drop the stale external comment"
```

---

### Task 4: The Sites table

**Files:**
- Modify: `src/renderer/utils/theme.ts`
- Create: `src/renderer/components/tabs/SitesTab.tsx`
- Modify: `src/renderer/components/NexusOverview.tsx`
- Test: `tests/unit/renderer/sites-tab.test.ts`

**Interfaces:**
- Consumes: `GET_SITE_ROWS` (Task 3), `SiteRow` / `KnowledgeRung` / `KNOWLEDGE_LABELS`.
- Produces: `SitesTab`. Task 5 adds selection to it.

**Context.** The tab registry is module-scoped with a derived union; adding an entry extends
`TabKey` automatically:

```ts
const TABS = [ { key: 'overview', label: 'Dashboard' }, ... ] as const;
type TabKey = typeof TABS[number]['key'];
```

Add `{ key: 'sites', label: 'Sites' }`. **`fetchAll` uses a positional `Promise.all`
destructuring — append `GET_SITE_ROWS` at the END of both the array and the destructuring.** Any
other position silently misaligns every later variable, which is not a compile error.

Import types with `import type` from `../../../main/fleet/siteRows` — precedented at
`src/renderer/components/credentials/ConnectionsPanel.tsx:3`. A value import would pull
main-process code into the renderer bundle.

- [ ] **Step 1: Add the accent variable**

`theme.ts` has no accent/primary variable, and `#0a8189`/`#0ECAD4` appear as literals 39 times
across `src/renderer/`. Add to **both** `:root` and `.Theme__Dark`:

```
  --nxai-accent: #0a8189;
  --nxai-accent-text: #ffffff;
```

`#0a8189` is 4.65:1 against white; the brand `#0ECAD4` is 2.96:1 and fails WCAG AA at button
sizes. **Do not migrate the other 39 literals** — that is a branch-wide sweep that collides with
spec 3's panel theme migration. Record it as follow-up; do not start it.

- [ ] **Step 2: Write the failing test**

```ts
// tests/unit/renderer/sites-tab.test.ts
import * as React from 'react';
import { SitesTab } from '../../../src/renderer/components/tabs/SitesTab';
import { serializeTree } from './helpers/serializeTree';

const row = (over: any = {}) => ({
  id: 'L1', name: 'My Site', source: 'local', host: null, domain: null,
  status: 'running', wpVersion: '6.5', phpVersion: '8.2',
  knowledge: 'searchable', lastSyncAt: 1000, ...over,
});

const props = (over: any = {}) => ({
  loaded: true, failed: false,
  rows: [row()],
  total: { count: 1, scope: 'installs on this Mac, WP Engine and other hosts' },
  selected: [], onToggle: jest.fn(), onToggleAll: jest.fn(),
  onBulk: jest.fn(), onIndexHost: jest.fn(), onRetry: jest.fn(),
  ...over,
});

describe('SitesTab', () => {
  test('renders all three host types in one table', () => {
    const tree = JSON.stringify(serializeTree(React.createElement(SitesTab, props({
      rows: [
        row({ id: 'L1', source: 'local',    name: 'Local One' }),
        row({ id: 'W1', source: 'wpe',      name: 'wpe-install' }),
        row({ id: 'X1', source: 'external', name: 'shop', host: 'hostinger' }),
      ],
      total: { count: 3, scope: 'installs on this Mac, WP Engine and other hosts' },
    }))));
    expect(tree).toContain('Local One');
    expect(tree).toContain('wpe-install');
    expect(tree).toContain('shop');
    expect(tree).toContain('hostinger');   // the host is named on the row
  });

  test('the total renders with its scope, never bare', () => {
    const tree = JSON.stringify(serializeTree(React.createElement(SitesTab, props())));
    expect(tree).toContain('installs on this Mac, WP Engine and other hosts');
  });

  test('an indexed external host shows Searchable, not a cap', () => {
    // Regression test for DECISIONS.md's stale "external caps at Detailed".
    const tree = JSON.stringify(serializeTree(React.createElement(SitesTab, props({
      rows: [row({ id: 'X1', source: 'external', host: 'hostinger', knowledge: 'searchable' })],
    }))));
    expect(tree).toContain('Searchable');
  });

  test('a failed read is not rendered as an empty fleet', () => {
    const tree = JSON.stringify(serializeTree(React.createElement(SitesTab, props({
      failed: true, rows: [], total: { count: 0, scope: '' },
    })))).toLowerCase();
    expect(tree).toContain("couldn't read");
    expect(tree).not.toContain('no sites yet');
  });

  test('a genuinely empty fleet says so', () => {
    const tree = JSON.stringify(serializeTree(React.createElement(SitesTab, props({
      rows: [], total: { count: 0, scope: 'installs on this Mac, WP Engine and other hosts' },
    })))).toLowerCase();
    expect(tree).toContain('no sites yet');
  });

  test('renders no hardcoded hex colours', () => {
    const tree = JSON.stringify(serializeTree(React.createElement(SitesTab, props())));
    expect(tree).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  test('snapshot', () => {
    expect(serializeTree(React.createElement(SitesTab, props()))).toMatchSnapshot();
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx jest tests/unit/renderer/sites-tab.test.ts`
Expected: FAIL — cannot find `SitesTab`.

- [ ] **Step 4: Write `SitesTab`**

A class component. Guard order in `render()` is the same rule as the Inbox and the tests enforce
it: `failed` → `!loaded` → empty → table. `failed` must never fall through to the empty state.

Columns: checkbox, Name, Type (`This Mac` / `WP Engine` / `External`, with `host` shown on
External rows), Knowledge (`KNOWLEDGE_LABELS[row.knowledge]`), WP version, PHP version, Last sync.
A host-type filter above the table. The total renders as `{count} {scope}`.

Colours from `--nxai-card-*` and the new `--nxai-accent` only. `React.createElement` throughout.

- [ ] **Step 5: Run to verify it passes**

Run: `npx jest tests/unit/renderer/sites-tab.test.ts`
Expected: PASS, 7 tests. **Open the snapshot and confirm it has real rows and column headers**, not
an empty shell. Say in your report what you saw.

- [ ] **Step 6: Register the tab and wire the fetch**

Add `{ key: 'sites', label: 'Sites' }` to `TABS`, render `SitesTab` for it, and append
`GET_SITE_ROWS` at the **end** of `fetchAll`'s array and destructuring.

- [ ] **Step 7: Full suite**

Run: `npx tsc --noEmit && npx jest tests/unit`
Expected: no new type errors; failure count equal to the baseline you recorded.

- [ ] **Step 8: Commit**

```bash
git add src/renderer tests/unit/renderer
git commit -m "feat(sites): the Sites table, all three host types in one list"
```

---

### Task 5: Selection and bulk actions

**Files:**
- Modify: `src/renderer/components/tabs/SitesTab.tsx`
- Modify: `src/renderer/components/NexusOverview.tsx`
- Test: `tests/unit/renderer/sites-tab.test.ts`

**Interfaces:**
- Consumes: `SitesTab` (Task 4), `BULK_EXECUTE` (existing).
- Produces: selection state and a bulk bar.

**Context.** `BulkOperationManager` exists (`src/main/bulk/BulkOperationManager.ts`) with
`BULK_EXECUTE` / `BULK_STATUS` / `BULK_CANCEL` / `BULK_LIST` / `BULK_PROGRESS` already wired, and
`BulkOpType = 'reindex' | 'plugin-update' | 'start' | 'stop' | 'health-refresh' | 'setup-ai' |
'sync-graph'` already covering everything Operations' zone 1 does. **Do not build a second bulk
path** — per-site plugin updates through this manager are audited, and a parallel path loses that.

Map zone 1's four buttons: `Refresh metadata` → `sync-graph`, `Index content` → `reindex`.

**The behaviour change:** zone 1's buttons act on *every* site of a type; these act on the
selection. That is intended, and the empty-selection guard is what makes it safe.

- [ ] **Step 1: Write the failing tests**

```ts
describe('SitesTab selection', () => {
  test('an empty selection disables every bulk action', () => {
    // A button that quietly fans out to 367 installs because nothing was ticked
    // is the worst version of this feature.
    const tree = JSON.stringify(serializeTree(React.createElement(SitesTab, props({
      rows: [row({ id: 'A' }), row({ id: 'B' })], selected: [],
    }))));
    expect(tree).toContain('"disabled":true');
  });

  test('a non-empty selection enables them', () => {
    const tree = JSON.stringify(serializeTree(React.createElement(SitesTab, props({
      rows: [row({ id: 'A' }), row({ id: 'B' })], selected: ['A'],
    }))));
    expect(tree).toContain('"disabled":false');
  });

  test('a bulk action dispatches ONLY the selected ids', () => {
    const onBulk = jest.fn();
    const inst = new (SitesTab as any)(props({
      rows: [row({ id: 'A' }), row({ id: 'B' }), row({ id: 'C' })],
      selected: ['A', 'C'], onBulk,
    }));
    inst.handleBulk('reindex');
    expect(onBulk).toHaveBeenCalledWith('reindex', ['A', 'C']);
    // Not all three, and not the visible page.
    expect(onBulk.mock.calls[0][1]).toHaveLength(2);
  });

  test('the selection count renders with what it is scoped to', () => {
    const tree = JSON.stringify(serializeTree(React.createElement(SitesTab, props({
      rows: [row({ id: 'A' }), row({ id: 'B' })], selected: ['A'],
    }))));
    expect(tree).toContain('1 of 2');
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest tests/unit/renderer/sites-tab.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement selection**

Row checkboxes call `onToggle(id)`; a header checkbox calls `onToggleAll()`. A bulk bar shows
`{selected.length} of {rows.length}` and the four actions, every one `disabled` when
`selected.length === 0`. `handleBulk(type)` calls `onBulk(type, this.props.selected)`.

In `NexusOverview`, `onBulk` invokes `BULK_EXECUTE` with the type and the site ids, and clears the
selection on success.

- [ ] **Step 4: Run to verify they pass**

Run: `npx jest tests/unit/renderer/sites-tab.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Prove the empty-selection guard bites**

Temporarily change the `disabled` expression to `false`. The empty-selection test MUST fail.
Revert, confirm green, report the failure message. Do not commit the probe.

- [ ] **Step 6: Commit**

```bash
git add src/renderer tests/unit/renderer
git commit -m "feat(sites): selection-scoped bulk actions via BulkOperationManager

An empty selection disables every action rather than meaning 'all'."
```

---

### Task 6: External's missing switch

**Files:**
- Modify: `src/renderer/components/tabs/SitesTab.tsx`
- Modify: `src/renderer/components/SettingsTab.tsx`
- Test: `tests/unit/renderer/sites-tab.test.ts`

**Interfaces:**
- Consumes: `SitesTab` (Tasks 4–5).
- Produces: a per-host `Index content` row action and a settings row.

**Why.** `externalContentIndexAutoEnabled` defaults to false and has **zero references in
`src/renderer/`** — the only ways to enable indexing are `nexus settings set
externalContentIndexAutoEnabled true` and `nexus host index <alias>`. So external hosts read 0
Searchable not because of a cap but because the switch is invisible.

`SettingsTab.tsx:531` already renders a checkbox for the sibling setting
`externalRefreshAutoEnabled` — **copy that row's exact shape**, including how it calls
`this.saveSetting(...)` (line 236).

**SCHEMA GATE — this one WILL bite you.** I checked: `externalContentIndexAutoEnabled` is declared
in `src/common/types.ts:353` but appears **zero times** in `src/main/mcp/schemas.ts`.
`UpdateSettingsSchema` is `.strict()`, so it silently strips any field not listed — the checkbox
would toggle, the save would report success, and the value would never persist. This is a
documented recurring trap in this codebase, not a hypothetical.

So Task 6 must **add `externalContentIndexAutoEnabled` to `UpdateSettingsSchema`** as well as to
the UI. Prove it round-trips rather than assuming:

```ts
// tests/unit/mcp/settings-schema.test.ts (add to the existing file if there is one)
test('externalContentIndexAutoEnabled survives the update schema', () => {
  // .strict() silently strips unlisted fields — the setting would appear to
  // save and never persist. This is the third time this trap has been hit.
  const parsed = UpdateSettingsSchema.parse({ externalContentIndexAutoEnabled: true });
  expect(parsed.externalContentIndexAutoEnabled).toBe(true);
});
```

Watch out: the CLI can set this today via `nexus settings set`, which suggests it must already be
allowed somewhere. Find out which path the CLI uses before concluding the schema is the only gate —
if the CLI bypasses `UpdateSettingsSchema`, say so in your report, because that is a second
inconsistency worth recording even though it is out of scope to fix.

- [ ] **Step 1: Write the failing test**

```ts
  test('an unindexed external row offers Index content', () => {
    const onIndexHost = jest.fn();
    const tree = JSON.stringify(serializeTree(React.createElement(SitesTab, props({
      rows: [row({ id: 'ssh:hostinger/shop', source: 'external', host: 'hostinger',
                   knowledge: 'detailed' })],
      onIndexHost,
    }))));
    expect(tree).toContain('Index content');
  });

  test('a local row does not offer it', () => {
    // The action exists because external indexing has no other UI entry point.
    const tree = JSON.stringify(serializeTree(React.createElement(SitesTab, props({
      rows: [row({ id: 'L1', source: 'local', knowledge: 'detailed' })],
    }))));
    expect(tree).not.toContain('Index content');
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest tests/unit/renderer/sites-tab.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add the row action and the settings row**

The action calls `onIndexHost(row.id)`; `NexusOverview` routes it to the same path
`nexus host index` uses. The settings row mirrors `externalRefreshAutoEnabled` exactly.

- [ ] **Step 4: Run to verify they pass**

Run: `npx jest tests/unit/renderer/sites-tab.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add src/renderer tests/unit/renderer
git commit -m "feat(sites): surface external content indexing in the UI

The setting had zero renderer references, so 0% Searchable was a hidden
switch rather than a limitation."
```

---

### Task 7: Retire zones 1 and 2; Operations becomes the zone-3 shell

**Files:**
- Modify: `src/renderer/components/NexusOverview.tsx`
- Modify: `src/renderer/components/tabs/OverviewTab.tsx`
- Test: `tests/unit/renderer/` (existing snapshots will change — intended)

**Interfaces:** consumes everything above.

**What goes:** `renderOperationsTab`'s zone 1 (the four buttons) and zone 2 (`SystemTab`), plus
`FleetCompletenessWidget` and the Fleet Summary card from `OverviewTab`.

**What stays, and this is the point of the task:** zone 3 — Factory Reset, Reset Content Index,
Database Health, Housekeeping — and the `Operations` tab shell around it. These are app-level
maintenance with no per-site meaning, so they cannot become bulk actions, and their destination is
the Advanced section **spec 6** builds. Deleting the tab now would make all four unreachable for
the whole gap between the specs.

Leave a comment at the top of the gutted `renderOperationsTab` saying exactly that, so the next
reader does not "finish the job".

- [ ] **Step 1: Write the guard test**

```ts
// tests/unit/renderer/operations-shell.test.ts
import * as fs from 'fs';
import * as path from 'path';

test('Operations still reaches every Advanced maintenance action', () => {
  // Spec 5 guts Operations but must not strand zone 3. Spec 6 rehomes these
  // into Settings' Advanced and deletes the tab; until then they live here.
  const src = fs.readFileSync(
    path.join(__dirname, '../../../src/renderer/components/NexusOverview.tsx'), 'utf8');
  for (const action of ['Factory Reset', 'Reset Content Index', 'Database Health', 'Housekeeping']) {
    expect(src).toContain(action);
  }
});

test('the retired zone-1 bulk buttons are gone from Operations', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../../../src/renderer/components/NexusOverview.tsx'), 'utf8');
  expect(src).not.toContain('Refresh metadata');
  expect(src).not.toContain('Sync metadata');
});
```

- [ ] **Step 2: Run — the second test should fail, the first should pass**

Run: `npx jest tests/unit/renderer/operations-shell.test.ts`

- [ ] **Step 3: Gut zones 1 and 2, remove the two dashboard cards**

- [ ] **Step 4: Run to verify both pass**

- [ ] **Step 5: Regenerate affected snapshots and INSPECT them**

Existing `OverviewTab` snapshots change because two cards are gone. That is intended. Read the
diff and confirm only the intended removals appear — a snapshot regenerated without reading is
worth nothing.

- [ ] **Step 6: Full suite and typecheck**

Run: `npx tsc --noEmit && npx jest tests/unit`
Expected: no new type errors; failure count equal to your recorded baseline.

- [ ] **Step 7: Commit**

```bash
git add src tests
git commit -m "refactor(sites): retire Operations zones 1-2; keep the Advanced shell

Zone 3 is app-level maintenance with no per-site meaning and no home until
spec 6 builds Settings' Advanced. Deleting the tab now would make four
capabilities unreachable for the whole gap between the specs."
```

---

## Live verification checklist (needs eyes)

- [ ] The table renders correctly in **both** light and dark mode.
- [ ] All three host types appear, and External rows name their host.
- [ ] An indexed external host reads `Searchable`.
- [ ] Selecting nothing leaves every bulk action visibly disabled.
- [ ] A bulk action affects only the ticked rows.
- [ ] Factory Reset, Reset Content Index, Database Health and Housekeeping are still reachable.
- [ ] Whether a 367-row table is actually usable. `DECISIONS.md` is candid that this is "agency
      furniture"; nothing automated can judge it.

## Known limitations to record, not fix here

- **39 hardcoded `#0a8189`/`#0ECAD4` literals remain** across `src/renderer/`. This spec adds
  `--nxai-accent` and uses it for the table only; the sweep collides with spec 3's panel migration.
- **Operations still exists** as a shell. Spec 6 deletes it.
- **`collectFleetCounts` has no unit test of its own** (its pure parts do). Unchanged here.
