# Nexus UX Foundation (specs 1+2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every fleet number come from one definition and make the health indicator incapable of reporting green when it does not know.

**Architecture:** Two new main-process modules, each split into a pure function (unit-testable with no Electron, no native modules, no database) plus a thin adapter that gathers real inputs from services. Existing computation sites stop computing and start reading. Renderer changes follow the established `React.createElement` class-component pattern.

**Tech Stack:** TypeScript, Jest (`npm test`), Electron main process, better-sqlite3 (graph), React 16 renderer with `React.createElement` and inline styles.

**Design doc:** `docs/planning/2026-08-09-nexus-ux-foundation-design.md`

## Global Constraints

- **The install is the canonical fleet unit.** Local installs come from Local's own site store (`siteData.getSites()`), WPE and external from the graph with `is_active = 1`. Never count local sites from the graph.
- **Every population count carries a scope string.** A number may never be rendered without the label that says what it is scoped to.
- **`unknown` is never swallowed.** An input that cannot be read reports `unknown`, and the overall health degrades to `unknown` rather than green.
- **Green requires every input to have actually answered.** A missing input can never produce green.
- **The `event_queue` signal may contribute red but can never produce green on its own** — its only writer is the MU-plugin webhook, which exists only on Local sites.
- **Never fabricate a version for a site whose real version was not read.** Pass `undefined` and let the consumer say "unknown". This binds every path that reads a *remote* row (WPE, external), where `php_version` is genuinely absent. It does **not** bind `src/main/ipc-handlers.ts:2623`, which is guarded by `if (site)` and therefore only ever fires for a local site found in Local's own store, where a real version is supplied — CLAUDE.md documents that one as deliberately kept. Task 6 states this explicitly.
- **The knowledge ladder has four rungs:** `nothing` → `basic` → `detailed` → `searchable`. External hosts cap at `detailed`.
- **No new numbers in string literals.** Every derived label reads from `computeFleetCounts`.
- **Naming deviation from the spec:** the spec called the health module `FleetHealth`. A `nexusFleetHealth` resolver already exists (`src/main/graphql/resolvers.ts:2601`) for *per-site* health scoring across the fleet. To avoid that collision the module is **`SystemHealth`** — it answers "is Nexus working?", not "is this site healthy?".

## File Structure

| File | Responsibility |
|---|---|
| `src/main/fleet/FleetCounts.ts` | Pure: fleet population arithmetic and scope labels |
| `src/main/fleet/collectFleetCounts.ts` | Adapter: gathers inputs from `siteData` + graph, calls the pure function |
| `src/main/fleet/knowledgeLadder.ts` | Pure: the four-rung vocabulary and its mapping |
| `src/main/fleet/localReconciliation.ts` | Pure: finds graph local rows with no matching Local site |
| `src/main/health/SystemHealth.ts` | Pure: rolls four signals into one state |
| `src/main/health/collectSystemHealth.ts` | Adapter: gathers the four signals |
| `tests/unit/fleet/fleet-counts.test.ts` | Tests for `FleetCounts` |
| `tests/unit/fleet/knowledge-ladder.test.ts` | Tests for the ladder |
| `tests/unit/fleet/local-reconciliation.test.ts` | Tests for reconciliation |
| `tests/unit/health/system-health.test.ts` | Tests for the rollup |

The pure/adapter split exists because `npm test` runs on system Node while Local runs on Electron, and the two need different better-sqlite3 binaries. Pure functions take plain arrays and objects, so the whole of the logic is testable without touching that seam.

---

## Phase A — One number, one vocabulary (spec 2)

### Task 1: FleetCounts pure module

**Files:**
- Create: `src/main/fleet/FleetCounts.ts`
- Test: `tests/unit/fleet/fleet-counts.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `computeFleetCounts(input: FleetCountsInput): FleetCounts`, types `FleetCountsInput`, `FleetCounts`, `PopulationCount`

- [ ] **Step 1: Write the failing test**

```typescript
import { computeFleetCounts } from '../../../src/main/fleet/FleetCounts';

describe('computeFleetCounts', () => {
  const input = {
    localSiteIds: ['l1', 'l2', 'l3'],
    graphRows: [
      { id: 'w1', source: 'wpe' as const, wpeSiteId: 'siteA' },
      { id: 'w2', source: 'wpe' as const, wpeSiteId: 'siteA' },
      { id: 'w3', source: 'wpe' as const, wpeSiteId: 'siteB' },
      { id: 'e1', source: 'external' as const, wpeSiteId: null },
    ],
  };

  test('the fleet total is the sum of the three populations', () => {
    const c = computeFleetCounts(input);
    expect(c.local.count).toBe(3);
    expect(c.wpe.count).toBe(3);
    expect(c.external.count).toBe(1);
    expect(c.installs.count).toBe(7);
  });

  test('wpeSites counts distinct parent sites, not installs', () => {
    expect(computeFleetCounts(input).wpeSites.count).toBe(2);
  });

  test('every population carries a non-empty scope label', () => {
    const c = computeFleetCounts(input);
    for (const key of ['installs', 'local', 'wpe', 'external', 'wpeSites'] as const) {
      expect(c[key].scope.length).toBeGreaterThan(0);
    }
  });

  test('an empty fleet is zeros with scopes intact', () => {
    const c = computeFleetCounts({ localSiteIds: [], graphRows: [] });
    expect(c.installs.count).toBe(0);
    expect(c.installs.scope.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/fleet/fleet-counts.test.ts`
Expected: FAIL — `Cannot find module '../../../src/main/fleet/FleetCounts'`

- [ ] **Step 3: Write minimal implementation**

```typescript
/**
 * The single definition of "how many sites are in this fleet".
 *
 * Local installs come from Local's own site store, never from the graph — the
 * graph accumulates rows for sites that have since been deleted (22 dead
 * sentinel-* sandbox rows measured 2026-08-09), so a graph-derived local count
 * over-reports badly. WPE and external come from the graph, is_active = 1.
 */

export interface FleetCountsInput {
  /** Keys of Local's own site store (`siteData.getSites()`). */
  localSiteIds: string[];
  /** Active graph rows for non-local sources. */
  graphRows: Array<{ id: string; source: 'wpe' | 'external'; wpeSiteId: string | null }>;
}

export interface PopulationCount {
  count: number;
  /** What this number is scoped to. Rendered wherever the number is; never omitted. */
  scope: string;
}

export interface FleetCounts {
  /** The canonical fleet total. Installs, not parent sites. */
  installs: PopulationCount;
  local: PopulationCount;
  wpe: PopulationCount;
  external: PopulationCount;
  /** Distinct WP Engine parent sites. Strictly smaller than `wpe`. */
  wpeSites: PopulationCount;
}

export function computeFleetCounts(input: FleetCountsInput): FleetCounts {
  const local = input.localSiteIds.length;
  const wpeRows = input.graphRows.filter((r) => r.source === 'wpe');
  const externalRows = input.graphRows.filter((r) => r.source === 'external');

  // A row with no parent id is its own site — never collapse them together.
  const parents = new Set<string>();
  let unparented = 0;
  for (const row of wpeRows) {
    if (row.wpeSiteId) parents.add(row.wpeSiteId);
    else unparented++;
  }

  return {
    installs: {
      count: local + wpeRows.length + externalRows.length,
      scope: 'installs on this Mac, WP Engine and other hosts',
    },
    local: { count: local, scope: 'sites on this Mac' },
    wpe: { count: wpeRows.length, scope: 'WP Engine installs' },
    external: { count: externalRows.length, scope: 'sites on other hosts' },
    wpeSites: { count: parents.size + unparented, scope: 'WP Engine sites' },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/fleet/fleet-counts.test.ts`
Expected: PASS, 4 tests

- [ ] **Step 5: Commit**

```bash
git add src/main/fleet/FleetCounts.ts tests/unit/fleet/fleet-counts.test.ts
git commit -m "feat(fleet): FleetCounts — one definition of the fleet total"
```

---

### Task 2: Knowledge ladder

**Files:**
- Create: `src/main/fleet/knowledgeLadder.ts`
- Test: `tests/unit/fleet/knowledge-ladder.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: type `KnowledgeRung`, `KNOWLEDGE_LABELS`, `toKnowledgeRung(completeness: string | null | undefined, source: 'local' | 'wpe' | 'external'): KnowledgeRung`

- [ ] **Step 1: Write the failing test**

```typescript
import { toKnowledgeRung, KNOWLEDGE_LABELS } from '../../../src/main/fleet/knowledgeLadder';

describe('toKnowledgeRung', () => {
  test('maps the stored completeness values onto the four rungs', () => {
    expect(toKnowledgeRung('none', 'local')).toBe('nothing');
    expect(toKnowledgeRung('filesystem', 'local')).toBe('basic');
    expect(toKnowledgeRung('metadata', 'local')).toBe('detailed');
    expect(toKnowledgeRung('indexed', 'local')).toBe('searchable');
  });

  test('an external host can never reach searchable', () => {
    expect(toKnowledgeRung('indexed', 'external')).toBe('detailed');
    expect(toKnowledgeRung('metadata', 'external')).toBe('detailed');
    expect(toKnowledgeRung('filesystem', 'external')).toBe('basic');
  });

  test('an unrecognised or missing value is "nothing", never a guess', () => {
    expect(toKnowledgeRung(null, 'wpe')).toBe('nothing');
    expect(toKnowledgeRung(undefined, 'wpe')).toBe('nothing');
    expect(toKnowledgeRung('banana', 'wpe')).toBe('nothing');
  });

  test('every rung has a user-facing label', () => {
    expect(KNOWLEDGE_LABELS.nothing).toBe('Nothing yet');
    expect(KNOWLEDGE_LABELS.basic).toBe('Basic');
    expect(KNOWLEDGE_LABELS.detailed).toBe('Detailed');
    expect(KNOWLEDGE_LABELS.searchable).toBe('Searchable');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/fleet/knowledge-ladder.test.ts`
Expected: FAIL — `Cannot find module '../../../src/main/fleet/knowledgeLadder'`

- [ ] **Step 3: Write minimal implementation**

```typescript
/**
 * The one vocabulary for "how much does Nexus know about this site?".
 *
 * Replaces six overlapping vocabularies: Scanned/Configured/Searchable,
 * none/filesystem/metadata/indexed, fresh/stale, synced/needs-SSH-sync, a
 * three-dot meter and a percentage bar.
 *
 * Four rungs, not three. `nothing` is a real and separately tracked state
 * (`neverScannedCount`) and is the most actionable one — it is what lets the UI
 * say "77 sites we haven't looked inside yet — Sync now". Freshness is NOT a
 * rung; it is a separate `last_sync_at` timestamp.
 */

export type KnowledgeRung = 'nothing' | 'basic' | 'detailed' | 'searchable';

export const KNOWLEDGE_LABELS: Record<KnowledgeRung, string> = {
  nothing: 'Nothing yet',
  basic: 'Basic',
  detailed: 'Detailed',
  searchable: 'Searchable',
};

const RUNG_ORDER: KnowledgeRung[] = ['nothing', 'basic', 'detailed', 'searchable'];

const FROM_COMPLETENESS: Record<string, KnowledgeRung> = {
  none: 'nothing',
  filesystem: 'basic',
  metadata: 'detailed',
  indexed: 'searchable',
};

/** A generic SSH connection cannot yield indexed content, so external caps here. */
const SOURCE_CEILING: Record<string, KnowledgeRung> = {
  local: 'searchable',
  wpe: 'searchable',
  external: 'detailed',
};

export function toKnowledgeRung(
  completeness: string | null | undefined,
  source: 'local' | 'wpe' | 'external',
): KnowledgeRung {
  const rung = (completeness && FROM_COMPLETENESS[completeness]) || 'nothing';
  // Fail closed. An unrecognised source must never receive the most permissive
  // ceiling — that silently overstates what Nexus knows about a site type the
  // ladder was never designed to score. Matches this module's treatment of an
  // unrecognised `completeness`, and the project's rule against queries that
  // silently absorb a future source (CLAUDE.md, source-semantics.test.ts).
  const ceiling = SOURCE_CEILING[source] ?? 'nothing';
  return RUNG_ORDER.indexOf(rung) > RUNG_ORDER.indexOf(ceiling) ? ceiling : rung;
}
```

Two further tests are required beyond the four above, because the four cannot fail on these branches:

```typescript
  test('a WP Engine install is not capped — it can reach searchable', () => {
    expect(toKnowledgeRung('indexed', 'wpe')).toBe('searchable');
    expect(toKnowledgeRung('metadata', 'wpe')).toBe('detailed');
  });

  test('an unrecognised source fails closed, never to the most permissive ceiling', () => {
    expect(toKnowledgeRung('indexed', 'staging-mirror' as never)).toBe('nothing');
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/fleet/knowledge-ladder.test.ts`
Expected: PASS, 4 tests

- [ ] **Step 5: Commit**

```bash
git add src/main/fleet/knowledgeLadder.ts tests/unit/fleet/knowledge-ladder.test.ts
git commit -m "feat(fleet): four-rung knowledge ladder replacing six vocabularies"
```

---

### Task 3: Local row reconciliation

**Files:**
- Create: `src/main/fleet/localReconciliation.ts`
- Test: `tests/unit/fleet/local-reconciliation.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `findOrphanedLocalRows(graphLocalIds: string[], localStoreIds: string[]): string[]`

- [ ] **Step 1: Write the failing test**

```typescript
import { findOrphanedLocalRows } from '../../../src/main/fleet/localReconciliation';

describe('findOrphanedLocalRows', () => {
  test('returns graph rows with no matching site in Local\'s store', () => {
    const orphans = findOrphanedLocalRows(['a', 'b', 'dead1', 'dead2'], ['a', 'b']);
    expect(orphans.sort()).toEqual(['dead1', 'dead2']);
  });

  test('returns nothing when every graph row still exists', () => {
    expect(findOrphanedLocalRows(['a', 'b'], ['a', 'b', 'c'])).toEqual([]);
  });

  test('a site in Local with no graph row is not an orphan', () => {
    expect(findOrphanedLocalRows(['a'], ['a', 'brand-new'])).toEqual([]);
  });

  test('an empty graph yields no orphans', () => {
    expect(findOrphanedLocalRows([], ['a', 'b'])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/fleet/local-reconciliation.test.ts`
Expected: FAIL — `Cannot find module '../../../src/main/fleet/localReconciliation'`

- [ ] **Step 3: Write minimal implementation**

```typescript
/**
 * Nothing deactivates a graph row when a local site is deleted from Local.
 * `nexus host remove` soft-deletes external hosts and the retention sweep
 * hard-deletes already-inactive rows, but a deleted *local* site leaves its row
 * at is_active = 1 forever. Measured 2026-08-09: 22 of 56 active source='local'
 * rows were sentinel-* sandbox sites that no longer existed.
 *
 * FleetCounts already avoids this by counting local from Local's own store, so
 * this exists for every *other* consumer of the graph.
 */
export function findOrphanedLocalRows(
  graphLocalIds: string[],
  localStoreIds: string[],
): string[] {
  const live = new Set(localStoreIds);
  return graphLocalIds.filter((id) => !live.has(id));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/fleet/local-reconciliation.test.ts`
Expected: PASS, 4 tests

- [ ] **Step 5: Commit**

```bash
git add src/main/fleet/localReconciliation.ts tests/unit/fleet/local-reconciliation.test.ts
git commit -m "feat(fleet): identify graph local rows orphaned by site deletion"
```

---

### Task 4: The collector adapter

**Files:**
- Create: `src/main/fleet/collectFleetCounts.ts`

**Interfaces:**
- Consumes: `computeFleetCounts`, `FleetCounts` (Task 1); `findOrphanedLocalRows` (Task 3)
- Produces: `collectFleetCounts(deps: FleetCountsDeps): FleetCounts`, `sweepOrphanedLocalRows(deps: FleetCountsDeps): number`

- [ ] **Step 1: Write the implementation**

There is no unit test for this task — it is the seam that touches the database, and the logic it wraps is already covered by Tasks 1 and 3. It is verified by Task 5's integration check.

```typescript
import { computeFleetCounts, FleetCounts } from './FleetCounts';
import { findOrphanedLocalRows } from './localReconciliation';

export interface FleetCountsDeps {
  /** Local's own site store, keyed by site id. */
  getSites: () => Record<string, unknown>;
  /** better-sqlite3 handle, or null when the graph is not ready. */
  getDb: () => { prepare: (sql: string) => { all: (...a: unknown[]) => unknown[]; run: (...a: unknown[]) => unknown } } | null;
}

export function collectFleetCounts(deps: FleetCountsDeps): FleetCounts {
  const localSiteIds = Object.keys(deps.getSites() ?? {});

  let graphRows: Array<{ id: string; source: 'wpe' | 'external'; wpeSiteId: string | null }> = [];
  try {
    const db = deps.getDb();
    if (db) {
      // The graph column is snake_case; FleetCounts takes camelCase. Map once,
      // on the way out of the database, so nothing downstream sees both shapes.
      const rows = db
        .prepare(
          "SELECT id, source, wpe_site_id FROM sites WHERE source IN ('wpe','external') AND is_active = 1",
        )
        .all() as Array<{ id: unknown; source: unknown; wpe_site_id: unknown }>;
      graphRows = rows.map((r) => ({
        id: String(r.id),
        source: r.source as 'wpe' | 'external',
        wpeSiteId: r.wpe_site_id == null ? null : String(r.wpe_site_id),
      }));
    }
  } catch {
    // Graph may not be ready. Local still counts; the remote populations report zero
    // with their scope labels intact rather than the whole call failing.
  }

  return computeFleetCounts({ localSiteIds, graphRows });
}

/** Deactivates graph local rows whose site no longer exists in Local. Returns the count. */
export function sweepOrphanedLocalRows(deps: FleetCountsDeps): number {
  const db = deps.getDb();
  if (!db) return 0;

  const rows = db
    .prepare("SELECT id FROM sites WHERE source = 'local' AND is_active = 1")
    .all() as Array<{ id: string }>;
  const orphans = findOrphanedLocalRows(
    rows.map((r) => String(r.id)),
    Object.keys(deps.getSites() ?? {}),
  );

  for (const id of orphans) {
    db.prepare('UPDATE sites SET is_active = 0, updated_at = ? WHERE id = ?').run(Date.now(), id);
  }
  return orphans.length;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors referencing `src/main/fleet/`

- [ ] **Step 3: Commit**

```bash
git add src/main/fleet/collectFleetCounts.ts
git commit -m "feat(fleet): collector adapter over Local's store and the graph"
```

---

### Task 5: Collapse `GET_FLEET_SUMMARY` onto FleetCounts

**Files:**
- Modify: `src/main/ipc-handlers.ts:737-762` (the `GET_FLEET_SUMMARY` handler)

**Interfaces:**
- Consumes: `collectFleetCounts` (Task 4), `toKnowledgeRung` (Task 2)
- Produces: a `counts` field on the fleet-summary IPC response

Today this handler counts local from `twinService.getAll()` — a third population that is neither Local's store nor the graph — and computes completeness over local twins only while setting `total` to local + WPE + external. That mismatched numerator and denominator is what renders "370/370" beside "367 sites".

- [ ] **Step 1: Add the import**

At the top of `src/main/ipc-handlers.ts`, alongside the existing imports:

```typescript
import { collectFleetCounts } from './fleet/collectFleetCounts';
```

- [ ] **Step 2: Replace the count derivation**

Find these lines in the `GET_FLEET_SUMMARY` handler:

```typescript
      const totalLocal = twins.length;
      const totalWpe = wpeSites.length;
      const totalExternal = externalSites.length;
      const total = totalLocal + totalWpe + totalExternal;
```

Replace with:

```typescript
      // One definition, one source. Local comes from Local's own store (not the
      // twin cache, not the graph), WPE and external from the graph.
      const counts = collectFleetCounts({
        getSites: () => siteData.getSites() as Record<string, unknown>,
        getDb: () => graphService.getDb() as never,
      });
      const totalLocal = counts.local.count;
      const totalWpe = counts.wpe.count;
      const totalExternal = counts.external.count;
      const total = counts.installs.count;
```

- [ ] **Step 3: Make the completeness denominator honest**

Find the completeness block:

```typescript
      // Completeness counts (local twins only)
      const completeness = { none: 0, filesystem: 0, metadata: 0, indexed: 0 };
```

Replace the comment and add an explicit denominator so a consumer cannot divide by the wrong total:

```typescript
      // Completeness is measured over local twins ONLY. Its denominator is
      // therefore twins.length, NOT `total` — a coverage metric's numerator and
      // denominator must span the same source set.
      const completeness = { none: 0, filesystem: 0, metadata: 0, indexed: 0 };
      const completenessScope = { measured: twins.length, label: 'sites on this Mac' };
```

- [ ] **Step 4: Return the new fields**

In the object this handler returns, add alongside the existing fields:

```typescript
        counts,
        completenessScope,
```

- [ ] **Step 5: Verify it compiles and the suite still passes**

Run: `npx tsc --noEmit -p tsconfig.json && npx jest tests/unit/fleet tests/unit/renderer`
Expected: no type errors; fleet tests pass; any renderer test asserting on the old shape fails loudly rather than silently — fix those assertions to read `counts.local.count` etc.

- [ ] **Step 6: Commit**

```bash
git add src/main/ipc-handlers.ts
git commit -m "fix(fleet): GET_FLEET_SUMMARY reads FleetCounts; completeness denominator matches its numerator"
```

---

### Task 6: Collapse `GET_DASHBOARD_STATS` and drop the fabricated PHP versions

**Files:**
- Modify: `src/main/ipc-handlers.ts:634-728` (the `GET_DASHBOARD_STATS` handler)
- Modify: `src/main/mcp/modules/fleet-intelligence/fleet-health-summary.ts`

**Interfaces:**
- Consumes: `collectFleetCounts` (Task 4)
- Produces: no new exports

`GET_DASHBOARD_STATS` takes `totalRemoteInstalls` from a **live CAPI call** (`capiGetInstalls()`), while `GET_FLEET_SUMMARY` takes it from the graph. That is the 333-versus-330 discrepancy. CAPI stays as the authority for *link* state; the fleet total comes from `FleetCounts`.

- [ ] **Step 1: Add the canonical counts to the handler**

Immediately after `const totalSites = siteList.length;` insert:

```typescript
      // The canonical fleet figures. `remoteSites.total` below stays CAPI-derived
      // because it is about link state, and is labelled as such.
      const counts = collectFleetCounts({
        getSites: () => allSites as Record<string, unknown>,
        getDb: () => graphService.getDb() as never,
      });
```

- [ ] **Step 2: Return them**

In the returned object, add as a sibling of `localSites`:

```typescript
        counts,
```

- [ ] **Step 3: Label the CAPI-scoped number**

Change:

```typescript
        remoteSites: { total: totalRemoteInstalls, unlinked: remoteInstalls, capiAvailable, wpeAuthenticated },
```

to:

```typescript
        remoteSites: {
          total: totalRemoteInstalls,
          unlinked: remoteInstalls,
          capiAvailable,
          wpeAuthenticated,
          // Live from WP Engine's API, so it can differ from counts.wpe (the graph).
          scope: 'installs reported by the WP Engine API',
        },
```

- [ ] **Step 4: Remove the two remote-facing fabricated PHP versions**

There are three `|| '8.0'` fallbacks. **Two are wrong and one is deliberate** — change only the two.

In `src/main/mcp/modules/fleet-intelligence/fleet-health-summary.ts:41`:

```typescript
        phpVersion: (site as any)?.phpVersion || '8.0',
```

becomes:

```typescript
        // Never invent a version to keep a score computable — the calculator
        // already has an honest path for undefined ("PHP version unknown").
        phpVersion: (site as any)?.phpVersion || undefined,
```

**`src/main/mcp/modules/fleet-intelligence/get-site-health.ts` needs no change** — an earlier draft of this plan said otherwise and was wrong. Its remote path was already fixed to `|| undefined` in commit `ef463e3e` (5 Aug), with the `// C3: no default` comment. The one `|| '8.0'` remaining in that file sits inside `if (localSite)` and is the same deliberately-preserved local case as `DASHBOARD_V2_STATS`, already carrying its own "Left alone deliberately" comment. Applying the change there would silently reverse a documented decision. So there are **two** fallbacks in scope, not three.

**Leave `src/main/ipc-handlers.ts:2623` alone.** It is guarded by `if (site)`, so it only ever fires for a *local* site found in Local's own store — the case CLAUDE.md documents as deliberately kept, because Local supplies a real version there. Add a comment above it so the next reader does not "fix" it:

```typescript
        if (site) {
          // Local-only path: `site` came from Local's own store, which supplies a
          // real PHP version. Deliberately NOT the fabricating fallback removed
          // from the fleet-intelligence modules — see CLAUDE.md, "Fleet counts".
          siteInfoMap[siteId] = { domain: site.domain || '', phpVersion: site.phpVersion || '8.0' };
        }
```

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit -p tsconfig.json && npx jest tests/unit/fleet tests/unit/mcp`
Expected: no type errors, tests pass

- [ ] **Step 6: Commit**

```bash
git add src/main/ipc-handlers.ts src/main/mcp/modules/fleet-intelligence/
git commit -m "fix(fleet): dashboard stats read FleetCounts; drop fabricated 8.0 PHP fallbacks"
```

---

### Task 6b: Collapse the MCP and GraphQL fleet surfaces, and fix the completeness widget

**Files:**
- Modify: `src/main/graphql/resolvers.ts` (the `nexusFleetSummary` resolver)
- Modify: `src/main/mcp/modules/fleet-intelligence/fleet-overview.ts` (the `fleet_overview` tool)
- Modify: `src/renderer/components/FleetCompletenessWidget.tsx:106`
- Test: `tests/unit/fleet/coverage-metric.test.ts`

**Interfaces:**
- Consumes: `collectFleetCounts` (Task 4)
- Produces: no new exports

The spec requires all four computation sites to collapse. Tasks 5 and 6 covered the two IPC handlers; this covers the GraphQL resolver and the MCP tool, which are what an agent sees. `fleet_overview` is the surface that printed "1 of 0" for a user with SSH hosts and no WP Engine account.

- [ ] **Step 1: Write the failing regression test**

This pins the rule that produced the bug, independent of any one call site.

This drives a real function. `completenessRatio` is what the widget and `fleet_overview` both need, and it is the thing that was wrong.

```typescript
import { computeFleetCounts } from '../../../src/main/fleet/FleetCounts';
import { completenessRatio } from '../../../src/main/fleet/coverageMetric';

describe('completenessRatio', () => {
  // A fleet where local and installs deliberately differ, so a wrong
  // denominator produces a different number rather than the same one.
  const counts = computeFleetCounts({
    localSiteIds: ['l1', 'l2'],
    graphRows: [
      { id: 'w1', source: 'wpe' as const, wpeSiteId: 'a' },
      { id: 'w2', source: 'wpe' as const, wpeSiteId: 'b' },
      { id: 'e1', source: 'external' as const, wpeSiteId: null },
    ],
  });

  test('a local-scoped numerator divides by the local denominator', () => {
    // 2 local sites, 5 installs. Measuring 1 local site is 50%, not 20%.
    const r = completenessRatio({ measured: 1, scope: 'local' }, counts);
    expect(r.denominator).toBe(2);
    expect(r.percent).toBe(50);
  });

  test('a fleet-scoped numerator divides by the fleet total', () => {
    const r = completenessRatio({ measured: 1, scope: 'installs' }, counts);
    expect(r.denominator).toBe(5);
    expect(r.percent).toBe(20);
  });

  test('throws when the numerator exceeds its own denominator', () => {
    // This is the "370/370 beside 367 sites" shape — a local-scoped count
    // larger than the local population means the scopes were mismatched.
    expect(() => completenessRatio({ measured: 4, scope: 'local' }, counts))
      .toThrow(/exceeds/i);
  });

  test('an empty population is 0%, not a division by zero', () => {
    const empty = computeFleetCounts({ localSiteIds: [], graphRows: [] });
    const r = completenessRatio({ measured: 0, scope: 'local' }, empty);
    expect(r.percent).toBe(0);
    expect(Number.isFinite(r.percent)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/fleet/coverage-metric.test.ts`
Expected: FAIL — `Cannot find module '../../../src/main/fleet/coverageMetric'`

- [ ] **Step 2b: Write the implementation**

Create `src/main/fleet/coverageMetric.ts`:

```typescript
import { FleetCounts } from './FleetCounts';

/** Which population a measurement was taken over. */
export type CoverageScope = 'local' | 'wpe' | 'external' | 'installs';

export interface CoverageInput {
  /** How many members of `scope` were measured. */
  measured: number;
  scope: CoverageScope;
}

export interface CoverageRatio {
  numerator: number;
  denominator: number;
  percent: number;
  /** The scope label, so the number can never be rendered bare. */
  label: string;
}

/**
 * A coverage metric's numerator and denominator must span the same source set.
 * Measuring completeness over local sites and dividing by the fleet total is
 * what rendered "370/370" beside "367 sites".
 */
export function completenessRatio(input: CoverageInput, counts: FleetCounts): CoverageRatio {
  const population = counts[input.scope];
  const denominator = population.count;

  if (input.measured > denominator) {
    throw new Error(
      `Coverage numerator (${input.measured}) exceeds its own population ` +
        `"${input.scope}" (${denominator}) — the scopes do not match.`,
    );
  }

  return {
    numerator: input.measured,
    denominator,
    percent: denominator === 0 ? 0 : Math.round((input.measured / denominator) * 100),
    label: population.scope,
  };
}
```

- [ ] **Step 2c: Run test to verify it passes**

Run: `npx jest tests/unit/fleet/coverage-metric.test.ts`
Expected: PASS, 4 tests

- [ ] **Step 3: Point `nexusFleetSummary` at FleetCounts**

In `src/main/graphql/resolvers.ts`, find the `nexusFleetSummary` resolver and replace its own site tallying with:

```typescript
        const counts = collectFleetCounts({
          getSites: () => services.siteData.getSites() as Record<string, unknown>,
          getDb: () => services.graphService.getDb() as never,
        });
```

then return `counts.installs.count`, `counts.local.count`, `counts.wpe.count` and `counts.external.count` in place of the locally-computed totals. Add the import:

```typescript
import { collectFleetCounts } from '../fleet/collectFleetCounts';
```

- [ ] **Step 4: Point `fleet_overview` at FleetCounts**

Make the same substitution in `src/main/mcp/modules/fleet-intelligence/fleet-overview.ts`. Where it prints a coverage line, the numerator and denominator must both come from the same `counts` field — a `wp_version` count taken across WPE + external must be divided by `counts.wpe.count + counts.external.count`, never by `counts.wpe.count` alone.

- [ ] **Step 5: Fix the completeness widget denominator**

In `src/renderer/components/FleetCompletenessWidget.tsx`, line 106 reads:

```typescript
    const total = data?.total ?? 0;
```

Completeness is measured over local sites only, so it must divide by the local denominator that Task 5 added to the IPC response:

```typescript
    // Completeness is measured over sites on this Mac only. Dividing by the
    // fleet total is what rendered "370/370" beside "367 sites".
    const total = data?.completenessScope?.measured ?? 0;
```

Also change the three bar labels from `Scanned` / `Configured` / `Searchable` to the ladder's words — `Basic`, `Detailed`, `Searchable` — and add the section label `Sites on this Mac` above them so the scope is visible.

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit -p tsconfig.json && npx jest tests/unit/fleet tests/unit/graphql tests/unit/mcp tests/unit/renderer`
Expected: no type errors; tests pass

- [ ] **Step 7: Commit**

```bash
git add src/main/graphql/resolvers.ts src/main/mcp/modules/fleet-intelligence/fleet-overview.ts src/renderer/components/FleetCompletenessWidget.tsx tests/unit/fleet/coverage-metric.test.ts
git commit -m "fix(fleet): GraphQL and MCP fleet surfaces read FleetCounts; completeness divides by its own scope"
```

---

### Task 7: Run the orphan sweep at startup

**Files:**
- Modify: `src/main/index.ts` (startup sequence, after graph service init)

**Interfaces:**
- Consumes: `sweepOrphanedLocalRows` (Task 4)
- Produces: no new exports

- [ ] **Step 1: Add the import**

```typescript
import { sweepOrphanedLocalRows } from './fleet/collectFleetCounts';
```

- [ ] **Step 2: Call it once the graph and site data are both available**

Place this after graph service initialisation, inside the existing startup try/catch:

```typescript
    // Deleted local sites leave their graph row at is_active = 1 forever — nothing
    // else reconciles them. Measured 2026-08-09: 22 of 56 active local rows were
    // sandbox sites that no longer existed.
    try {
      const swept = sweepOrphanedLocalRows({
        getSites: () => services.siteData.getSites() as Record<string, unknown>,
        getDb: () => graphService.getDb() as never,
      });
      if (swept > 0) {
        // `.info`, not `.log` — localLogger is Winston, whose `log()` signature is
        // (level, message), so a single-string call reads the message as the level
        // and emits nothing. The codebase uses `.info`/`.warn` exclusively.
        localLogger.info(`[NexusAI] Deactivated ${swept} graph rows for deleted local sites`);
      }
    } catch (err) {
      localLogger.warn('[NexusAI] Local row reconciliation failed:', (err as Error).message);
    }
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors

- [ ] **Step 4: Run the existing suites**

Run: `npx jest tests/unit/fleet tests/unit/ipc`
Expected: no new failures.

**Do NOT run `npm run rebuild` in this task.** It recompiles `better-sqlite3` for Electron's
ABI, after which `npx jest` — which runs on system Node — fails with a `NODE_MODULE_VERSION`
error for every remaining task. The against-the-real-database verification of this sweep belongs
in Task 14, which does the build/rebuild/reload once, at the end, after all testing is finished.
Task 14 already carries that check.

- [ ] **Step 5: Commit**

```bash
git add src/main/index.ts
git commit -m "fix(fleet): reconcile graph local rows against Local's store at startup"
```

---

## Phase B — Honest health and legible failures (spec 1)

Phase B has no dependency on Phase A and may be executed concurrently by a separate agent.

> **Every line number below is stale.** Phase A added ~120 lines to `src/main/ipc-handlers.ts`.
> Locate every edit site by its surrounding code, never by a quoted line number, and confirm you
> are in the right handler before editing. Verified anchors as of Phase A completion:
> `EVENTS_GET_TIMELINE` ≈ 1802 (was 1770), `EVENTS_GET_STATS` ≈ 1836 (was 1794).
> `EventStats.healthStatus` is declared at `src/common/types.ts:638`.
> `NexusOverview.tsx` was not touched by Phase A, so its anchors (169, 1558, 1779) still hold.

### Task 8: SystemHealth pure module

**Files:**
- Create: `src/main/health/SystemHealth.ts`
- Test: `tests/unit/health/system-health.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: types `HealthState`, `HealthSignal`, `SystemHealthInputs`, `SystemHealth`; `rollUpSystemHealth(inputs: SystemHealthInputs): SystemHealth`

- [ ] **Step 1: Write the failing test**

```typescript
import { rollUpSystemHealth, SystemHealthInputs } from '../../../src/main/health/SystemHealth';

const ok = { state: 'ok' as const, reason: null };
const allOk: SystemHealthInputs = {
  agentRuns: ok, syncStaleness: ok, credentials: ok, eventQueue: ok,
};

describe('rollUpSystemHealth', () => {
  test('green only when every input has actually answered', () => {
    expect(rollUpSystemHealth(allOk).overall).toBe('ok');
  });

  test('a single unknown input degrades the whole pill to unknown', () => {
    const r = rollUpSystemHealth({ ...allOk, credentials: { state: 'unknown', reason: 'Could not read credential status' } });
    expect(r.overall).toBe('unknown');
  });

  test('failing beats unknown, because it is more actionable', () => {
    const r = rollUpSystemHealth({
      ...allOk,
      agentRuns: { state: 'failing', reason: 'security-sentinel failed 5 times since 3:17 PM' },
      credentials: { state: 'unknown', reason: 'Could not read credential status' },
    });
    expect(r.overall).toBe('failing');
  });

  test('degraded when something is stale but nothing is failing or unknown', () => {
    const r = rollUpSystemHealth({ ...allOk, syncStaleness: { state: 'degraded', reason: '44 sites not checked in 9 days' } });
    expect(r.overall).toBe('degraded');
  });

  test('the event queue alone can never produce green', () => {
    const unknown = { state: 'unknown' as const, reason: 'not read' };
    const r = rollUpSystemHealth({
      agentRuns: unknown, syncStaleness: unknown, credentials: unknown, eventQueue: ok,
    });
    expect(r.overall).toBe('unknown');
  });

  test('reasons from every non-ok input are carried, in severity order', () => {
    const r = rollUpSystemHealth({
      ...allOk,
      agentRuns: { state: 'failing', reason: 'agent failed' },
      syncStaleness: { state: 'degraded', reason: 'sync stale' },
    });
    expect(r.reasons).toEqual(['agent failed', 'sync stale']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/health/system-health.test.ts`
Expected: FAIL — `Cannot find module '../../../src/main/health/SystemHealth'`

- [ ] **Step 3: Write minimal implementation**

```typescript
/**
 * "Is Nexus working?" — the header health pill.
 *
 * Distinct from HealthScoreCalculator / nexusFleetHealth, which score how healthy
 * an individual *site* is. This scores the addon itself.
 *
 * The rule that matters: a health indicator that can be confidently wrong is
 * worse than none. Today's implementation reads only `event_queue`, whose sole
 * writer is the MU-plugin webhook on Local sites, so "All Systems Healthy"
 * currently means "no failed WordPress webhook events on local sites" and is
 * structurally blind to a failing agent.
 */

export type HealthState = 'ok' | 'degraded' | 'failing' | 'unknown';

export interface HealthSignal {
  state: HealthState;
  /** Plain-language cause. Null only when state is 'ok'. */
  reason: string | null;
}

export interface SystemHealthInputs {
  agentRuns: HealthSignal;
  syncStaleness: HealthSignal;
  credentials: HealthSignal;
  eventQueue: HealthSignal;
}

export interface SystemHealth {
  overall: HealthState;
  inputs: SystemHealthInputs;
  /** Reasons from every non-ok input, most severe first. */
  reasons: string[];
}

/** Most severe first. Order is the precedence used for `overall`. */
const SEVERITY: HealthState[] = ['failing', 'unknown', 'degraded', 'ok'];

const INPUT_ORDER: (keyof SystemHealthInputs)[] = [
  'agentRuns', 'syncStaleness', 'credentials', 'eventQueue',
];

const KNOWN_STATES: ReadonlySet<string> = new Set<string>(SEVERITY);

/**
 * A state outside the four literals means the producer is broken or has drifted.
 * It must read as `unknown` — never be skipped.
 *
 * This is not defensive padding. Without it, `SEVERITY.find(s => states.includes(s))`
 * only fails safe when ALL FOUR states are unrecognised: one malformed state beside
 * three `ok`s falls through to `ok`, and the pill reports healthy while an input is
 * unreadable — the exact defect this module exists to eliminate. The collector in
 * Task 9 feeds this from IPC and service data, so an out-of-union value is a live
 * possibility, not a contrived cast.
 */
function normalizeState(state: HealthState): HealthState {
  return KNOWN_STATES.has(state) ? state : 'unknown';
}

export function rollUpSystemHealth(inputs: SystemHealthInputs): SystemHealth {
  const states = INPUT_ORDER.map((k) => normalizeState(inputs[k].state));

  // `ok` is last in SEVERITY, so it wins only when every input is ok. An input
  // that could not be read reports `unknown` and drags the pill off green — it
  // is never treated as "fine".
  const overall = SEVERITY.find((s) => states.includes(s)) ?? 'unknown';

  // Normalised here too, so a malformed signal's reason still surfaces rather
  // than vanishing along with its state.
  const reasons: string[] = [];
  for (const severity of SEVERITY) {
    if (severity === 'ok') continue;
    INPUT_ORDER.forEach((key, i) => {
      if (states[i] !== severity) return;
      const signal = inputs[key];
      reasons.push(signal.reason || `${key} reported an unreadable state`);
    });
  }

  return { overall, inputs, reasons };
}
```

Three tests beyond the six above are required, because the six cannot fail on these paths:
a malformed state beside three `ok`s must yield `unknown`; that signal's reason must appear in
`reasons`; and two inputs at the **same** severity must come back in `INPUT_ORDER` order.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/health/system-health.test.ts`
Expected: PASS, 6 tests

- [ ] **Step 5: Commit**

```bash
git add src/main/health/SystemHealth.ts tests/unit/health/system-health.test.ts
git commit -m "feat(health): SystemHealth rollup — unknown never reads as green"
```

---

### Task 9: The health collector adapter

**Files:**
- Create: `src/main/health/collectSystemHealth.ts`

**Interfaces:**
- Consumes: `rollUpSystemHealth`, `HealthSignal`, `SystemHealth` (Task 8)
- Produces: `collectSystemHealth(deps: SystemHealthDeps): Promise<SystemHealth>`

- [ ] **Step 1: Write the implementation**

Each gatherer is individually wrapped: a thrown error becomes `unknown` for that input alone, never a failed call or a false green.

```typescript
import { rollUpSystemHealth, HealthSignal, SystemHealth, SystemHealthInputs } from './SystemHealth';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface SystemHealthDeps {
  /** Agents with their last run outcome. */
  getAgents: () => Promise<Array<{ id: string; lastRunStatus: string | null; lastRunAt: number | null }>>;
  /**
   * Active sites with their last successful sync, and whether refresh is even
   * supposed to be running for them.
   *
   * `refreshEnabled` is explicit rather than inferred from the source, so the
   * caller must supply it consciously. Without it, `wpeSyncAutoEnabled` and
   * `externalRefreshAutoEnabled` — which BOTH DEFAULT FALSE — make every remote
   * site look permanently stale, and the pill sits at "needs attention" on a
   * clean install. That false red is as corrosive as a false green: both teach
   * users to ignore the pill.
   */
  getSyncAges: () => Array<{ id: string; lastSyncAt: number | null; refreshEnabled: boolean }>;
  /** Configured connections and whether their credential currently works. */
  getCredentialStates: () => Promise<Array<{ name: string; ok: boolean }>>;
  /** Event queue counts. */
  getEventStats: () => Promise<{ failed: number; pending: number }>;
  now?: () => number;
}

async function guard(fn: () => Promise<HealthSignal>, label: string): Promise<HealthSignal> {
  try {
    return await fn();
  } catch {
    return { state: 'unknown', reason: `Could not read ${label}` };
  }
}

export async function collectSystemHealth(deps: SystemHealthDeps): Promise<SystemHealth> {
  const now = (deps.now ?? Date.now)();

  const agentRuns = await guard(async () => {
    const agents = await deps.getAgents();
    if (agents.length === 0) return { state: 'unknown', reason: 'No agents reported a run' };
    const failed = agents.filter((a) => a.lastRunStatus === 'failed');
    if (failed.length > 0) {
      return {
        state: 'failing',
        reason: failed.length === 1
          ? `${failed[0].id} failed on its last run`
          : `${failed.length} agents failed on their last run`,
      };
    }
    return { state: 'ok', reason: null };
  }, 'agent run status');

  const syncStaleness = await guard(async () => {
    const rows = deps.getSyncAges();
    if (rows.length === 0) return { state: 'unknown', reason: 'No sites to check' };

    // A site whose refresh scheduler is switched off is not stale — nobody
    // promised to refresh it. Excluding these is what stops a clean install
    // (both auto-refresh settings default false) reading as permanently red.
    const enabled = rows.filter((r) => r.refreshEnabled);
    if (enabled.length === 0) {
      // Not `ok`: nothing is verifying this data, so claiming health would be a
      // false green. Not `degraded`: the user chose this, so it is not a fault.
      return { state: 'unknown', reason: 'Background refresh is switched off' };
    }

    const never = enabled.filter((r) => !r.lastSyncAt).length;
    const stale = enabled.filter((r) => r.lastSyncAt && now - r.lastSyncAt > DAY_MS).length;
    if (never > 0) return { state: 'degraded', reason: `${never} sites have never been checked` };
    if (stale > 0) return { state: 'degraded', reason: `${stale} sites not checked in over a day` };
    return { state: 'ok', reason: null };
  }, 'sync freshness');

  const credentials = await guard(async () => {
    const creds = await deps.getCredentialStates();
    const broken = creds.filter((c) => !c.ok);
    if (broken.length > 0) {
      return { state: 'failing', reason: `${broken.map((c) => c.name).join(', ')} needs reconnecting` };
    }
    return { state: 'ok', reason: null };
  }, 'credential status');

  const eventQueue = await guard(async () => {
    const stats = await deps.getEventStats();
    if (stats.failed > 0) return { state: 'failing', reason: `${stats.failed} site events failed` };
    if (stats.pending > 10) return { state: 'degraded', reason: `${stats.pending} site events waiting` };
    return { state: 'ok', reason: null };
  }, 'site event queue');

  const inputs: SystemHealthInputs = { agentRuns, syncStaleness, credentials, eventQueue };
  return rollUpSystemHealth(inputs);
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors referencing `src/main/health/`

- [ ] **Step 3: Commit**

```bash
git add src/main/health/collectSystemHealth.ts
git commit -m "feat(health): collector for the four health signals"
```

---

### Task 10: Replace the event-queue-only health status

**Files:**
- Modify: `src/main/ipc-handlers.ts:1794-1819` (the `EVENTS_GET_STATS` handler)
- Modify: `src/renderer/components/EventStatsCards.tsx:156-200`

**Interfaces:**
- Consumes: `collectSystemHealth` (Task 9)
- Produces: a `systemHealth` field on the event-stats IPC response

- [ ] **Step 1: Replace the three-line derivation**

In `EVENTS_GET_STATS`, replace:

```typescript
      // Determine health status
      let healthStatus: 'good' | 'warning' | 'error' = 'good';
      if (stats.failed > 0) {
        healthStatus = 'error';
      } else if (stats.pending > 10) {
        healthStatus = 'warning';
      }
```

with:

```typescript
      // The pill rolls up four signals. The event queue is one of them and can
      // contribute red, but can never produce green on its own — it only ever
      // covers Local sites.
      const systemHealth = await collectSystemHealth({
        // Same pair of services the `agentStatus` GraphQL resolver uses
        // (src/main/graphql/resolvers.ts:6042) — registry for the definitions,
        // state store for the last run.
        getAgents: async () => {
          const registry = deps.nexusServices?.agentRegistry;
          const store = deps.nexusServices?.agentStateStore;
          if (!registry) throw new Error('agent registry not available');
          return registry.list().map((def: any) => {
            const last = store?.getLastRun(def.name);
            return {
              id: def.name,
              lastRunStatus: last ? last.status : null,
              lastRunAt: last ? last.startedAt : null,
            };
          });
        },
        getSyncAges: () => {
          const db = graphService.getDb();
          if (!db) throw new Error('graph not ready');
          return (db.prepare('SELECT id, last_sync_at FROM sites WHERE is_active = 1').all() as any[])
            .map((r) => ({ id: String(r.id), lastSyncAt: r.last_sync_at ?? null }));
        },
        // OAuth connections carry 'active' | 'revoked' | 'error'; API-key
        // connections carry 'active' | 'revoked'. Anything not active is broken.
        getCredentialStates: async () => {
          const mgr = deps.nexusServices?.credentialManager;
          if (!mgr) throw new Error('credential manager not available');
          const oauth = mgr.listConnections().map((c: any) => ({
            name: c.provider, ok: c.status === 'active',
          }));
          const apiKeys = mgr.listApiKeyConnections().map((c: any) => ({
            name: c.label || c.provider, ok: c.status === 'active',
          }));
          return [...oauth, ...apiKeys];
        },
        getEventStats: async () => ({ failed: stats.failed, pending: stats.pending }),
      });
      const healthStatus = systemHealth.overall;
```

Add the import at the top of the file:

```typescript
import { collectSystemHealth } from './health/collectSystemHealth';
```

- [ ] **Step 2: Return it**

In the `eventStats` object, replace `healthStatus,` with:

```typescript
        healthStatus,
        systemHealth,
```

- [ ] **Step 3: Update the renderer labels**

In `src/renderer/components/EventStatsCards.tsx`, replace the bodies of `getHealthLabel`, `getHealthColor` and `getHealthIcon` so they speak the new four states. `getHealthLabel` becomes:

```typescript
  getHealthLabel(): string {
    const { stats } = this.state;
    if (!stats) return 'Unknown';

    switch (stats.healthStatus) {
      case 'ok':
        return 'Everything is running';
      case 'degraded':
        return 'Something needs attention';
      case 'failing':
        return 'Something is broken';
      default:
        // Never green on missing input — say so plainly.
        return "Can't tell right now";
    }
  }
```

`getHealthColor` maps `ok → UI_COLORS.STATUS_RUNNING`, `degraded → UI_COLORS.STATUS_WARNING`, `failing → UI_COLORS.STATUS_ERROR`, default `UI_COLORS.STATUS_HALTED`. `getHealthIcon` maps `ok → '✓'`, `degraded → '!'`, `failing → '✕'`, default `'?'`.

Update the `healthStatus` type on the `EventStats` interface — declared at `src/common/types.ts:638` as `'good' | 'warning' | 'error'` — to `'ok' | 'degraded' | 'failing' | 'unknown'`, and add `systemHealth`.

**This is a breaking type change with consumers.** Before editing, grep for every reader of
`healthStatus` and of the old string values `'good'`/`'warning'`/`'error'`; a consumer comparing
against `'good'` will silently stop matching rather than fail to compile. Update each, and list
them in your report.

- [ ] **Step 4: Update the existing test**

`tests/unit/renderer/EventStatsCards.test.tsx` asserts on the old labels. Update its expectations to the new four states, and add:

```typescript
  it('never reports green when an input could not be read', () => {
    const inst = makeInstance({ healthStatus: 'unknown' });
    expect(inst.getHealthLabel()).toBe("Can't tell right now");
    expect(inst.getHealthColor()).not.toBe(UI_COLORS.STATUS_RUNNING);
  });
```

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit -p tsconfig.json && npx jest tests/unit/health tests/unit/renderer/EventStatsCards.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/main/ipc-handlers.ts src/renderer/components/EventStatsCards.tsx src/common tests/unit/renderer/EventStatsCards.test.tsx
git commit -m "fix(health): pill rolls up agent, sync, credential and event signals"
```

---

### Task 11: Aggregate repeated agent failures and auto-pause

**Files:**
- Create: `src/main/agents/failureAggregation.ts`
- Test: `tests/unit/agents/failure-aggregation.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `aggregateFailures(runs: FailureRun[]): AggregatedFailure[]`, `shouldAutoPause(runs: FailureRun[]): boolean`, `AUTO_PAUSE_THRESHOLD`

- [ ] **Step 1: Write the failing test**

```typescript
import {
  aggregateFailures, shouldAutoPause, AUTO_PAUSE_THRESHOLD,
} from '../../../src/main/agents/failureAggregation';

const run = (at: number, message: string) => ({ agentId: 'security-sentinel', at, message });

describe('aggregateFailures', () => {
  test('collapses identical failures into one entry with a count and time range', () => {
    const out = aggregateFailures([
      run(1000, '(s.evidence || []).map is not a function'),
      run(2000, '(s.evidence || []).map is not a function'),
      run(3000, '(s.evidence || []).map is not a function'),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].count).toBe(3);
    expect(out[0].firstAt).toBe(1000);
    expect(out[0].lastAt).toBe(3000);
  });

  test('different messages stay separate entries', () => {
    const out = aggregateFailures([run(1000, 'boom'), run(2000, 'different')]);
    expect(out).toHaveLength(2);
  });

  test('an empty run list aggregates to nothing', () => {
    expect(aggregateFailures([])).toEqual([]);
  });
});

describe('shouldAutoPause', () => {
  test('pauses after three consecutive identical failures', () => {
    const runs = [run(1, 'boom'), run(2, 'boom'), run(3, 'boom')];
    expect(AUTO_PAUSE_THRESHOLD).toBe(3);
    expect(shouldAutoPause(runs)).toBe(true);
  });

  test('does not pause below the threshold', () => {
    expect(shouldAutoPause([run(1, 'boom'), run(2, 'boom')])).toBe(false);
  });

  test('a different recent failure resets the streak', () => {
    expect(shouldAutoPause([run(1, 'boom'), run(2, 'boom'), run(3, 'other')])).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/agents/failure-aggregation.test.ts`
Expected: FAIL — `Cannot find module '../../../src/main/agents/failureAggregation'`

- [ ] **Step 3: Write minimal implementation**

```typescript
/**
 * The activity log printed five identical "(s.evidence || []).map is not a
 * function" entries verbatim, with no aggregation, no cause and no action.
 * Collapse them, and stop an agent that is only producing noise.
 */

export interface FailureRun {
  agentId: string;
  at: number;
  message: string;
}

export interface AggregatedFailure {
  agentId: string;
  message: string;
  count: number;
  firstAt: number;
  lastAt: number;
}

/** Consecutive identical failures before an agent pauses itself. */
export const AUTO_PAUSE_THRESHOLD = 3;

export function aggregateFailures(runs: FailureRun[]): AggregatedFailure[] {
  const byKey = new Map<string, AggregatedFailure>();

  for (const r of runs) {
    const key = `${r.agentId} ${r.message}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.count++;
      existing.firstAt = Math.min(existing.firstAt, r.at);
      existing.lastAt = Math.max(existing.lastAt, r.at);
    } else {
      byKey.set(key, {
        agentId: r.agentId, message: r.message, count: 1, firstAt: r.at, lastAt: r.at,
      });
    }
  }

  return [...byKey.values()].sort((a, b) => b.lastAt - a.lastAt);
}

/** True when the most recent AUTO_PAUSE_THRESHOLD runs all failed the same way. */
export function shouldAutoPause(runs: FailureRun[]): boolean {
  if (runs.length < AUTO_PAUSE_THRESHOLD) return false;
  const recent = [...runs].sort((a, b) => a.at - b.at).slice(-AUTO_PAUSE_THRESHOLD);
  return recent.every((r) => r.message === recent[0].message);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/agents/failure-aggregation.test.ts`
Expected: PASS, 6 tests

- [ ] **Step 5: Commit**

```bash
git add src/main/agents/failureAggregation.ts tests/unit/agents/failure-aggregation.test.ts
git commit -m "feat(agents): aggregate identical failures, auto-pause after 3"
```

---

### Task 12: Clean the event timeline

**Files:**
- Create: `src/main/events/timelineFilter.ts`
- Test: `tests/unit/events/timeline-filter.test.ts`
- Modify: `src/main/ipc-handlers.ts` (the `EVENTS_GET_TIMELINE` handler, around line 1770)

**Interfaces:**
- Consumes: nothing
- Produces: `isNoiseEvent(event: { postType?: string | null; action?: string | null }): boolean`, `displayActor(actor: string | null | undefined): string | null`

- [ ] **Step 1: Write the failing test**

```typescript
import { isNoiseEvent, displayActor } from '../../../src/main/events/timelineFilter';

describe('isNoiseEvent', () => {
  test('auto-drafts and revisions are WordPress background churn', () => {
    expect(isNoiseEvent({ postType: 'revision', action: 'created' })).toBe(true);
    expect(isNoiseEvent({ postType: 'post', action: 'auto-draft' })).toBe(true);
  });

  test('real content changes are kept', () => {
    expect(isNoiseEvent({ postType: 'post', action: 'published' })).toBe(false);
    expect(isNoiseEvent({ postType: 'page', action: 'updated' })).toBe(false);
  });

  test('a missing post type is not assumed to be noise', () => {
    expect(isNoiseEvent({})).toBe(false);
  });
});

describe('displayActor', () => {
  test('an unresolvable actor is omitted, not printed as UNKNOWN', () => {
    expect(displayActor(null)).toBeNull();
    expect(displayActor(undefined)).toBeNull();
    expect(displayActor('UNKNOWN')).toBeNull();
    expect(displayActor('')).toBeNull();
  });

  test('a real actor is passed through', () => {
    expect(displayActor('jeremy')).toBe('jeremy');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/events/timeline-filter.test.ts`
Expected: FAIL — `Cannot find module '../../../src/main/events/timelineFilter'`

- [ ] **Step 3: Write minimal implementation**

```typescript
/**
 * Seven of eight visible timeline rows were auto-draft creation and deletion,
 * every one tagged UNKNOWN. That teaches users the timeline is not worth
 * reading. Filter the churn; omit the actor rather than printing a placeholder.
 */

const NOISE_POST_TYPES = new Set(['revision', 'auto-draft', 'nav_menu_item']);
const NOISE_ACTIONS = new Set(['auto-draft']);

export function isNoiseEvent(event: { postType?: string | null; action?: string | null }): boolean {
  if (event.postType && NOISE_POST_TYPES.has(event.postType)) return true;
  if (event.action && NOISE_ACTIONS.has(event.action)) return true;
  return false;
}

export function displayActor(actor: string | null | undefined): string | null {
  if (!actor) return null;
  if (actor.trim().toUpperCase() === 'UNKNOWN') return null;
  return actor;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/events/timeline-filter.test.ts`
Expected: PASS, 5 tests

- [ ] **Step 5: Apply it in the timeline handler**

In the `EVENTS_GET_TIMELINE` handler in `src/main/ipc-handlers.ts`, add the import:

```typescript
import { isNoiseEvent, displayActor } from './events/timelineFilter';
```

Then filter before mapping, and use `displayActor` for the actor field:

```typescript
      const timeline = events
        .filter((e: any) => !isNoiseEvent({ postType: e.post_type, action: e.action }))
        .map((e: any) => ({
          id: e.id,
          type: e.event_type,
          siteId: e.site_id,
          timestamp: e.created_at,
          status: e.status,
          summary: generateEventSummary(e),
          details: e.payload,
          actor: displayActor(e.actor),
        }));
```

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit -p tsconfig.json && npx jest tests/unit/events`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/main/events/timelineFilter.ts tests/unit/events/timeline-filter.test.ts src/main/ipc-handlers.ts
git commit -m "fix(events): filter auto-drafts and revisions, omit UNKNOWN actors"
```

---

### Task 13: Sort Operations by what is stale or failing, and delete Ask/Tell

**Files:**
- Create: `src/main/fleet/operationsSort.ts`
- Test: `tests/unit/fleet/operations-sort.test.ts`
- Modify: `src/renderer/components/NexusOverview.tsx:1777-1784` (tab list), `:169` (type), `:1558` (dashboard prompt handler)

**Interfaces:**
- Consumes: `KnowledgeRung` (Task 2)
- Produces: `sortByAttention<T extends AttentionRow>(rows: T[]): T[]`, interface `AttentionRow`

- [ ] **Step 1: Write the failing test**

```typescript
import { sortByAttention } from '../../../src/main/fleet/operationsSort';

describe('sortByAttention', () => {
  test('failing rows come before stale ones, stale before healthy', () => {
    const out = sortByAttention([
      { id: 'healthy', failing: false, lastSyncAt: Date.now() },
      { id: 'failing', failing: true, lastSyncAt: Date.now() },
      { id: 'stale', failing: false, lastSyncAt: 0 },
    ]);
    expect(out.map((r) => r.id)).toEqual(['failing', 'stale', 'healthy']);
  });

  test('among stale rows the oldest comes first', () => {
    const out = sortByAttention([
      { id: 'newer', failing: false, lastSyncAt: 5_000 },
      { id: 'older', failing: false, lastSyncAt: 1_000 },
    ]);
    expect(out.map((r) => r.id)).toEqual(['older', 'newer']);
  });

  test('a never-synced row sorts as the most stale', () => {
    const out = sortByAttention([
      { id: 'synced', failing: false, lastSyncAt: 1_000 },
      { id: 'never', failing: false, lastSyncAt: null },
    ]);
    expect(out.map((r) => r.id)).toEqual(['never', 'synced']);
  });

  test('does not mutate its input', () => {
    const input = [{ id: 'a', failing: false, lastSyncAt: 2 }, { id: 'b', failing: true, lastSyncAt: 1 }];
    sortByAttention(input);
    expect(input.map((r) => r.id)).toEqual(['a', 'b']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/fleet/operations-sort.test.ts`
Expected: FAIL — `Cannot find module '../../../src/main/fleet/operationsSort'`

- [ ] **Step 3: Write minimal implementation**

```typescript
/**
 * Operations rendered 37 rows in arrival order, every one reading
 * "halted · Searchable · 7h ago", so scanning was pointless. Sort by what
 * actually needs a human.
 */

export interface AttentionRow {
  failing: boolean;
  /** Epoch ms of the last successful sync, or null if never synced. */
  lastSyncAt: number | null;
}

export function sortByAttention<T extends AttentionRow>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    if (a.failing !== b.failing) return a.failing ? -1 : 1;
    // Never synced is the most stale thing there is.
    const aAge = a.lastSyncAt ?? -Infinity;
    const bAge = b.lastSyncAt ?? -Infinity;
    return aAge - bAge;
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/fleet/operations-sort.test.ts`
Expected: PASS, 4 tests

- [ ] **Step 5: Delete the Ask/Tell tab**

In `src/renderer/components/NexusOverview.tsx`:

Remove `'ask' | ` from the `activeTab` union on line 169, so it reads:

```typescript
  activeTab: 'overview' | 'activity' | 'operations' | 'settings' | 'agents';
```

Remove this entry from the `tabs` array:

```typescript
      { key: 'ask' as const, label: 'Ask/Tell' },
```

Remove the dashboard prompt box entirely. It spans four places in this file:

| Lines | What to remove |
|---|---|
| 229–230 | the `dashboardDraft: string;` and `dashboardPrompt: string | null;` state fields |
| 440–441 | their initialisers, `dashboardDraft: ''` and `dashboardPrompt: null` |
| ~1556–1558 | the submit handler, whose last line is `this.setState({ dashboardPrompt: dashboardDraft, dashboardDraft: '', activeTab: 'ask' });` |
| ~1562–1595 | the render method for the prompt box — the textarea bound to `dashboardDraft` and its submit button |

Then remove the `activeTab === 'ask'` branch in `render()` (around line 2939), and the call site that renders the prompt-box method from the overview tab.

Work bottom-up (highest line number first) so earlier edits do not shift the lines you have not reached yet.

Users reach chat through the docked panel, which is already globally mounted and is the higher-quality surface.

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit -p tsconfig.json && npx jest tests/unit/fleet tests/unit/renderer`
Expected: no type errors; any test referencing the `ask` tab fails and is deleted along with the tab

- [ ] **Step 7: Commit**

```bash
git add src/main/fleet/operationsSort.ts tests/unit/fleet/operations-sort.test.ts src/renderer/components/NexusOverview.tsx
git commit -m "feat(fleet): sort Operations by attention; delete the Ask/Tell tab"
```

---

### Task 14: Full verification

**Files:** none

- [ ] **Step 1: Run the whole suite**

Run: `npm test`
Expected: no new failures. CLAUDE.md notes pre-existing native-module suite failures unrelated to this work — record which ones fail *before* starting if you have not already, and compare.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: clean

- [ ] **Step 3: Build for Local and reload**

Run: `npm run build && npm run rebuild && ./dev-reload.sh`

- [ ] **Step 4: Confirm the numbers in the running app**

Open Nexus AI in Local and check:
- the fleet total reads 370, not 367 — external is included
- no screen shows a fleet number without a scope label
- the Ask/Tell tab is gone
- the health pill is not green while an agent shows a failed last run

- [ ] **Step 5: Confirm the orphan sweep ran**

```bash
node -e "
const D=require('better-sqlite3'),os=require('os');
const db=new D(os.homedir()+'/Library/Application Support/Local/nexus-ai/graph.db',{readonly:true});
console.log(db.prepare(\"SELECT is_active, COUNT(*) c FROM sites WHERE source='local' GROUP BY is_active\").all());
"
```

Expected: 34 active, 22 inactive.

- [ ] **Step 6: Commit any fixes**

```bash
git add -A
git commit -m "fix: address verification findings"
```

---

## Notes for the implementer

- **Native modules.** `npm test` needs the system-Node build of better-sqlite3; Local needs the Electron build. After `npm install`, run `npm run rebuild` before loading in Local, and `npm install` again before running tests. Never both at once. See `docs/NATIVE_MODULES.md`.
- **Restart Local with `./dev-reload.sh`**, not a hand-rolled kill-and-build. Main-process modules do not hot-reload, and stale in-memory code looks exactly like a bug.
- **Renderer style.** React 16, `React.createElement` only — no JSX, no hooks. Class components. Inline style objects. Follow `src/renderer/components/NexusOverview.tsx`.
- **Do not commit untested work.** Each task's test steps run before its commit step, in that order.
- **Do not push, tag, or release.** CLAUDE.md forbids it without an explicit instruction.

## Live verification checklist (outstanding)

Task 14's automated half is done: full suite shows the **same 13 pre-existing failing suites and
26 failing tests** as the pre-work baseline, with passing tests up 4451 → 4551, and
`npx tsc --noEmit` clean.

The live half was **not** run. Local's addon symlink points at a different worktree
(`.worktrees/sdk-and-agents`), so building here changes nothing that Local loads, and
`dev-reload.sh` does not repoint it. Run this when you are next on this branch:

```bash
# 1. Point Local at this worktree (note the current target first, to restore it later)
readlink ~/Library/Application\ Support/Local/addons/local-addon-nexus-ai
ln -sfn "$PWD" ~/Library/Application\ Support/Local/addons/local-addon-nexus-ai

# 2. Build for Electron and restart. NOTE: `npm run rebuild` compiles better-sqlite3 for
#    Electron's ABI — `npx jest` in this worktree will fail until you `npm install` again.
./dev-reload.sh
```

Then check, in order of what could actually surprise. **Items 1–2 cover behaviour no automated
test in either spec can see; 3–6 are cheaper confirmations.**

1. **Banner dismissal survives a tab switch.** This was a real regression found in spec 2.5's
   final review and fixed there, and it is the single most likely thing to still be wrong,
   because the fix depends on an async settings refresh landing before the tab remounts.
   With WPE connected, on Dashboard dismiss the "WP Engine connected — N installs" banner (×),
   immediately switch to Operations, switch back. **The banner must stay gone.** Repeat for the
   "☁ Have WP Engine sites?" banner on a machine with no WPE.

2. **All three polling timers survive a tab switch.** The extraction moved rendering out of the
   shell but left the timers in it; snapshots cannot test this. Start a WPE metadata sync on
   Operations, switch to Dashboard, wait past the 2s progress poll, switch back — progress must
   still be advancing. Leave the app idle 60s on Dashboard and confirm counts refresh
   (`pollTimer`). Confirm a sync started elsewhere is picked up within ~10s
   (`wpeSyncPassivePoll`).

3. **The orphan sweep ran.** The only item exercising startup wiring rather than pure logic, and
   it mutates data (soft-delete). Expect active local rows to drop 56 → 34:
   ```bash
   node -e "const D=require('better-sqlite3'),os=require('os');
   const db=new D(os.homedir()+'/Library/Application Support/Local/nexus-ai/graph.db',{readonly:true});
   console.log(db.prepare(\"SELECT is_active, COUNT(*) c FROM sites WHERE source='local' GROUP BY is_active\").all());"
   ```

4. **The health pill is honest in both directions.** Not green while an agent shows a failed last
   run; not red on a clean install with refresh settings off. Click through to confirm the badge
   underneath states a reason rather than "No issues detected" when the pill is not green.

5. **The two largest uncaptured render paths.** Roughly 230 lines of `OverviewTab` have no
   snapshot coverage because every fixture nulls their inputs. Confirm the **MCP panel** renders
   with real port / tool-count / version and both Copy buttons flip to "Copied!"; and the
   **Fleet Summary** card shows its four columns with real data rather than "Loading fleet data…".

6. **Navigation and the removed tab.** All four `onNavigate` paths — both banner buttons, and
   FleetCompletenessWidget's Schedule (→ Settings) and Index Sites (→ Operations). Confirm
   Ask/Tell is gone and nothing lands on a missing tab.

Restore the symlink to its previous target afterwards if you need `sdk-and-agents` back.

## Follow-up work discovered during execution

Found by task reviewers while this plan was being built. None were fixed here; all are recorded
so they survive the scratch ledger.

**The scope rule applied during this plan.** A finding was folded into the current task only when
it violated one of this plan's own Global Constraints *and* was producing a wrong number in a
live surface. Everything else was deferred to this list, even when it was the same bug class.
One finding met that bar and was fixed in Task 6b: `FLEET_COMPLETENESS` counted local sites from
the graph. Use the same test for future work rather than absorbing every adjacent defect.

### Same bug class, still open — "a population labelled X that isn't X"

- **`GET_DASHBOARD_STATS`'s `index` object** (`src/main/ipc-handlers.ts`): `localIndexed` comes
  from `indexRegistry.listAll()` filtered by state alone, with no local-only restriction, yet is
  paired with `localTotal`, which *is* genuinely local. CLAUDE.md measured 297 of 423
  `indexRegistry` entries as WPE-owned — so the field named "local" mostly is not.
- **Same object:** `wpeIndexedSites`/`wpeIndexedDocs` (graph `content`, `site_id LIKE 'wpe-%'`)
  paired with `wpeTotal` (CAPI-derived, includes linked local sites).
- **`wpeConnected: { count }`** carries no scope label, unlike every other count after this plan.
- **Three definitions of "how many WPE things"** now coexist in one `GET_DASHBOARD_STATS`
  response: `counts.wpe.count` (graph, labelled), `remoteSites.total` (CAPI, labelled), and
  `index.wpeTotal` (CAPI, unlabelled). The first two are deliberate and distinguishable; the
  third should join them or go.

### Root cause behind the timeline churn (PHP side, not fixed here)

- **`nexus_ai_handle_post_delete` has no revision guard, while the save path does.**
  `wp-plugins/nexus-ai-connector/nexus-ai-connector.php:100-116` skips autosaves, skips revisions
  and sends only `post_status === 'publish'`. The delete handler at `:133` does none of that, so
  **every revision deletion emits a `post_deleted` event with `post_type: 'revision'`.** Measured
  on the live database: 104 rows in `event_queue`, and 4 of the 12 most recent are revisions.
  Task 12 filters these out on read, which fixes what the user sees. The root cause is one guard
  in the PHP delete handler — cheaper, and it stops the rows being written at all. Deferred here
  because it is a plugin change requiring `npm run sync-wp-plugins` and redeployment to sites.
  Note the client-side filter is still worth keeping afterwards, for rows already in the queue.

### Drifting duplicate resolvers

- **`src/main/graphql/resolvers/twin.ts` holds a second, now-unsynced `nexusFleetSummary`.**
  CLAUDE.md documents that file (with `resolvers/wpe.ts` and `resolvers/sites.ts`) as exported
  only from a barrel with no production importers — dead code kept in sync so the in-progress
  resolver split does not silently lose work when it lands. This plan updated the live
  `resolvers.ts` copy and not that one, so the two have now diverged. Either sync it or delete
  it; leaving a stale duplicate is how the split loses the `counts`/`twinScope` fields later.

### Error visibility

- **`catch {}` cannot distinguish "graph not ready" from a real SQL or schema error** — both
  render as `0` with scope labels intact, and nothing is logged. Three sites share the idiom:
  `src/main/fleet/collectFleetCounts.ts`, `fleet-overview.ts:70`, `fleet-plugins.ts:113`. For a
  module whose purpose is honest counts, a real failure and "no data" should not be
  indistinguishable. Fix all three together or none.

### Log discoverability

- **The orphan-sweep circuit breaker warns via `console.warn`, not `localLogger`.**
  `sweepOrphanedLocalRows` has no logger on `FleetCountsDeps` (deliberately — its other callers
  have none), so a *refused* sweep misses the log files while `runOrphanSweep`'s own success and
  failure lines land in them. That inverts the trail: the rarest and most diagnostic message is
  the hardest to find. Cheapest correct fix, per the reviewer: have `sweepOrphanedLocalRows`
  return `{ swept, refused?: { storeCount, graphCount } }` and let `runOrphanSweep` — which
  already carries a logger — emit it. Do not thread a logger through `FleetCountsDeps`.
  Consequence of the gap is benign (a refusal deletes nothing), so this is discoverability, not
  data safety.

### Test coverage

- **No test exercises `NexusOverview.tsx`'s fleet summary card** or the `GET_FLEET_SUMMARY`
  response shape from the renderer side. Consumer safety was established by manual grep during
  Task 5, so nothing would fail on a future renderer regression.
- Minor: `FleetCountsInput.graphRows[].id` is never read by `computeFleetCounts`; `if
  (row.wpeSiteId)` treats `''` as unparented where `=== null` would be exact; no test
  distinguishes `completeness: ''` from `null`; stale name `mockLocalTwinCount` in
  `fleet-summary-ipc.test.ts`.

## Not in this plan

- The rail badge (`NavItemInjector.ts` has no badge mechanism — its own spec).
- `NexusOverview.tsx` decomposition (spec 2.5, the prerequisite for the specs 3–6 fan-out).
- Panel Insights tab, Inbox, Sites table, Settings merge, agent cards (specs 3–6).
