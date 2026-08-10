# NexusOverview Decomposition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Shrink `NexusOverview.tsx` enough that specs 3–6 can be built in parallel, by deleting provably dead code and extracting the one tab that survives the redesign.

**Architecture:** Two phases. Phase 1 deletes six render methods with zero call sites and the handler, IPC calls and state they alone fed — no tests needed, because unreferenced code has no behaviour to preserve. Phase 2 captures the surviving Overview tab's rendered element tree as snapshots, then extracts it behind a props interface, requiring every snapshot to stay byte-identical.

**Tech Stack:** TypeScript, React 16 via `React.createElement` (no JSX, no hooks, class components), Jest.

**Spec:** `docs/planning/2026-08-10-nexus-overview-decomposition-design.md`

## Global Constraints

- **No user-visible change.** If a user would see a difference, something has gone wrong.
- **React 16, `React.createElement`, class components, inline style objects.** No JSX, no hooks, no `react-dom` — `react`/`react-dom` are `peerDependencies: "*"`, resolved from Local's runtime and not version-pinned here.
- **Long-running operation state and its polling stay in the shell.** `wpeSyncing`/`wpeSyncProgress`, `wpeSyncPassivePoll`, `wpeSyncPollInterval`, the `*OpId`/`*Running` pairs, `factoryResetRunning`. A tab unmounts on tab switch and takes its timers with it.
- **A tab component must not know how the shell stores its active tab.** Navigation goes through an `onNavigate(tab)` prop, never `setState({ activeTab })`.
- **Snapshots are the contract.** Any step needing `jest -u` has changed behaviour and must justify it in its report.
- **Activity and Operations are NOT decomposed.** Specs 4 and 5 delete them; extracting them now is work thrown away.
- Test baseline is **13 failing suites / 26 failing tests**: chat-providers, embedding-service, error-recovery, mcp-tools, AgentRegistry, log-processor/agent, log-processor/db, ai-gateway/routing, cli/agent-commands, common/iw-types, content/site-readiness, credentials/ProviderRegistry, mcp/wpe-deep-refresh. Anything else failing is yours.
- Do NOT run `npm run rebuild`, `npm run build`, `./dev-reload.sh`, `git push`, `npm version`, or `git tag`.

## File Structure

| File | Responsibility |
|---|---|
| `src/renderer/components/NexusOverview.tsx` | shell — fetching, operation state, polling, chrome, tab dispatch, and (for now) Activity + Operations |
| `src/renderer/components/tabs/shared/cards.tsx` | `cardContainerStyle`, `cardStyle`, `cardTitleStyle`, `renderSectionLabel` |
| `src/renderer/components/tabs/OverviewTab.tsx` | banners, MCP panel, fleet cards, fleet summary, AI integration cards |
| `tests/unit/renderer/helpers/serializeTree.ts` | element-tree serializer for characterization |
| `tests/unit/renderer/OverviewTab.characterization.test.tsx` | six-variant snapshots + structural assertions |

---

## Phase 1 — Delete before you move

### Task 1: Delete the six dead render methods

**Files:**
- Modify: `src/renderer/components/NexusOverview.tsx`

**Interfaces:**
- Consumes: nothing
- Produces: nothing (pure deletion)

Each of these appears exactly once in the file — at its own definition — and nowhere else in `src/` or `tests/`. Verified by counting total mentions per name.

- [ ] **Step 1: Re-verify each is dead before deleting**

Run:
```bash
node -e "
const fs=require('fs');
const t=fs.readFileSync('src/renderer/components/NexusOverview.tsx','utf8');
for (const n of ['renderGraphCard','renderWpeSyncCard','renderFleetPluginsCard','renderSetupAICell','renderCredentialSyncSection','renderWpeSyncSection']) {
  console.log(n+': '+(t.match(new RegExp(n,'g'))||[]).length+' mention(s)');
}"
```
Expected: every name reports exactly `1 mention(s)`. **If any reports more, stop and report it** — the method is not dead and must not be deleted.

- [ ] **Step 2: Delete the six methods**

Delete these methods in their entirety, **working bottom-up so earlier deletions do not shift later line numbers**:

| Method | Lines (before any deletion) |
|---|---|
| `renderWpeSyncSection` | 2697–2818 |
| `renderCredentialSyncSection` | 2614–2696 |
| `renderFleetPluginsCard` | 1468–1508 |
| `renderSetupAICell` | 1259–1323 |
| `renderWpeSyncCard` | 993–1040 |
| `renderGraphCard` | 958–992 |

Locate each by its `renderXxx(` signature rather than trusting the line number, and delete from the signature line through the closing brace immediately before the next method.

- [ ] **Step 3: Verify nothing broke**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: clean. A reference error here means a method was not actually dead — report it rather than restoring blindly.

Run: `npx jest tests/unit/renderer`
Expected: no new failures.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/NexusOverview.tsx
git commit -m "refactor(renderer): delete six NexusOverview render methods with no call sites"
```

---

### Task 2: Sweep the orphan cascade

**Files:**
- Modify: `src/renderer/components/NexusOverview.tsx`

**Interfaces:**
- Consumes: Task 1's deletions
- Produces: nothing

Task 1 removed the only consumers of a handler, two IPC calls and several state fields. This task removes those. **Confirm each by grep before deleting — do not assume this list is complete or correct.**

- [ ] **Step 1: Delete `handleSyncAll`**

`handleSyncAll` was defined around line 2421 and called only from `renderCredentialSyncSection`, which Task 1 deleted. Confirm it now has zero call sites:

```bash
grep -c "this.handleSyncAll" src/renderer/components/NexusOverview.tsx
```
Expected: `0`. Then delete the whole method.

- [ ] **Step 2: Remove the two dead IPC calls from `fetchAll`**

Inside `fetchAll`, two invocations populate state that nothing renders any more:
- `IPC_CHANNELS.WPE_SYNC_STATS` (was around line 609) → fed `wpeSyncStats` / `wpeSyncThresholdHours`, read only by the deleted `renderWpeSyncSection`
- `IPC_CHANNELS.GET_CREDENTIAL_SYNC_STATUS` (was around line 608) → fed `syncStatus`, read only by the deleted `renderCredentialSyncSection`

Remove both invocations, the variables holding their results (`wpeSyncStatsResult`, `syncStatus`), and the corresponding keys in the `setState` object (`syncStatus`, `wpeSyncStats`, `wpeSyncThresholdHours`).

This removes two IPC round-trips from every dashboard load.

- [ ] **Step 3: Remove the orphaned state fields**

Delete from both the `NexusOverviewState` interface and the state initializer:

`fleetPlugins`, `syncStatus`, `syncing`, `syncResults`, `wpeSyncStats`, `wpeSyncThresholdHours`, `chatMessages`, `chatSessionId`

For each, confirm zero remaining references first:
```bash
node -e "
const fs=require('fs');
const t=fs.readFileSync('src/renderer/components/NexusOverview.tsx','utf8');
for (const f of ['fleetPlugins','syncStatus','syncing','syncResults','wpeSyncStats','wpeSyncThresholdHours','chatMessages','chatSessionId']) {
  console.log(f+': '+(t.match(new RegExp('\\\\b'+f+'\\\\b','g'))||[]).length+' mention(s)');
}"
```
A field showing more than 2 (its declaration and its initializer) still has a live reader — **leave it and say so in your report.** `setupResults` and `setupId` are deliberately NOT on this list: `handleSetupAI` is still called from a live site.

- [ ] **Step 4: Remove the dead `ChatTab` import**

`import { ChatTab } from './ChatTab';` (around line 26) is unused — the Ask/Tell tab was its only consumer and the foundation spec deleted it. Confirm and remove:
```bash
grep -c "ChatTab" src/renderer/components/NexusOverview.tsx
```
Expected before removal: `1` (the import alone). Do **not** delete `src/renderer/components/ChatTab.tsx` itself — the docked panel uses it.

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: clean.

Run: `npm test`
Expected: exactly the 13 baseline failing suites, no more.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/NexusOverview.tsx
git commit -m "refactor(renderer): remove handler, IPC calls and state orphaned by the dead-method deletion"
```

---

## Phase 2 — Extract what survives

### Task 3: The element-tree serializer

**Files:**
- Create: `tests/unit/renderer/helpers/serializeTree.ts`
- Test: `tests/unit/renderer/helpers/serialize-tree.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `serializeTree(node: unknown): unknown`

- [ ] **Step 1: Write the failing test**

```typescript
import * as React from 'react';
import { serializeTree } from './serializeTree';

describe('serializeTree', () => {
  test('captures type, props, style and text children', () => {
    const el = React.createElement('div', { style: { color: 'red' }, id: 'x' }, 'hello');
    expect(serializeTree(el)).toEqual({
      type: 'div',
      key: null,
      props: { style: { color: 'red' }, id: 'x' },
      children: 'hello',
    });
  });

  test('recurses into nested children and preserves order', () => {
    const el = React.createElement('div', null,
      React.createElement('span', { key: 'a' }, 'one'),
      React.createElement('span', { key: 'b' }, 'two'),
    );
    const out = serializeTree(el) as any;
    expect(out.children.map((c: any) => c.children)).toEqual(['one', 'two']);
    expect(out.children.map((c: any) => c.key)).toEqual(['a', 'b']);
  });

  test('replaces functions with a stable marker so a handler appearing or vanishing fails', () => {
    const withHandler = React.createElement('button', { onClick: () => undefined }, 'go');
    const without = React.createElement('button', {}, 'go');
    expect((serializeTree(withHandler) as any).props.onClick).toBe('[fn]');
    expect(serializeTree(withHandler)).not.toEqual(serializeTree(without));
  });

  test('names component types rather than emitting an unstable function reference', () => {
    class Widget extends React.Component { render() { return null; } }
    const el = React.createElement(Widget, null);
    expect((serializeTree(el) as any).type).toBe('Widget');
  });

  test('drops null, undefined and boolean children', () => {
    const el = React.createElement('div', null, null, undefined, false, 'kept');
    expect((serializeTree(el) as any).children).toEqual([null, null, null, 'kept']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/renderer/helpers/serialize-tree.test.ts`
Expected: FAIL — `Cannot find module './serializeTree'`

- [ ] **Step 3: Write the implementation**

```typescript
/**
 * Serializes a React.createElement tree into a plain, stable, diffable object.
 *
 * Used for characterization snapshots during refactors: the tree is captured
 * without rendering, so no `react-dom` is needed — `react`/`react-dom` are only
 * `peerDependencies: "*"` in this project, resolved from Local's runtime.
 *
 * Deliberately brittle. During a behaviour-preserving refactor ANY structural,
 * prop, style or text change should fail the snapshot.
 */

function serializeProps(props: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(props).sort()) {
    if (key === 'children') continue;
    const value = props[key];
    if (typeof value === 'function') {
      // Keep the fact that a handler exists, drop its identity.
      out[key] = '[fn]';
    } else if (value && typeof value === 'object' && (value as any).$$typeof) {
      out[key] = serializeTree(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

export function serializeTree(node: unknown): unknown {
  if (node === null || node === undefined || typeof node === 'boolean') return null;
  if (typeof node === 'string' || typeof node === 'number') return node;
  if (Array.isArray(node)) return node.map(serializeTree);
  if (typeof node === 'function') return '[fn]';

  if (typeof node === 'object') {
    const el = node as {
      $$typeof?: symbol;
      type?: unknown;
      key?: string | null;
      props?: Record<string, unknown>;
    };

    if (!el.$$typeof) return node;

    const t = el.type;
    const typeName =
      typeof t === 'string'
        ? t
        : ((t as { displayName?: string; name?: string })?.displayName ??
           (t as { name?: string })?.name ??
           'Unknown');

    const props = el.props ?? {};
    const children = (props as { children?: unknown }).children;

    return {
      type: typeName,
      key: el.key ?? null,
      props: serializeProps(props),
      children: children === undefined ? null : serializeTree(children),
    };
  }

  return String(node);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/renderer/helpers/serialize-tree.test.ts`
Expected: PASS, 5 tests

- [ ] **Step 5: Prove the marker actually guards handlers**

Temporarily change `out[key] = '[fn]'` to `continue` (dropping functions entirely), re-run, and confirm the "handler appearing or vanishing" test fails. Restore. Report the failure message.

- [ ] **Step 6: Commit**

```bash
git add tests/unit/renderer/helpers/
git commit -m "test(renderer): element-tree serializer for refactor characterization"
```

---

### Task 4: Characterization snapshots for the Overview tab

**Files:**
- Create: `tests/unit/renderer/OverviewTab.characterization.test.tsx`

**Interfaces:**
- Consumes: `serializeTree` (Task 3)
- Produces: committed snapshots that Tasks 5 and 6 must not change

These are taken against the **current, unextracted** `NexusOverview.renderOverviewTab()`. They are the baseline the extraction must preserve.

- [ ] **Step 1: Write the characterization test**

`NexusOverview`'s props are `{ NavLink: any; electron: any }`. Follow the construction pattern already used in `tests/unit/renderer/EventStatsCards.test.tsx`: build the instance, assign state directly, call the render method — never mount.

```tsx
/**
 * Characterization snapshots for the Overview tab.
 *
 * These exist to make the extraction in Task 5 provably behaviour-preserving.
 * They are intentionally brittle: if the extraction changes the rendered tree
 * in any way, they fail. A change here needs justifying, not `-u`.
 */
import { NexusOverview } from '../../../src/renderer/components/NexusOverview';
import { serializeTree } from './helpers/serializeTree';

function makeInstance(stateOverrides: Record<string, unknown>): any {
  const electron = {
    ipcRenderer: {
      invoke: jest.fn(async () => ({ success: false })),
      on: jest.fn(),
      removeListener: jest.fn(),
    },
  };
  const inst: any = new NexusOverview({ NavLink: () => null, electron });
  Object.assign(inst.state, stateOverrides);
  return inst;
}

const POPULATED_STATS = {
  localSites: { total: 37, running: 4, halted: 33 },
  wpeConnected: { count: 19 },
  remoteSites: {
    total: 330, unlinked: 301, capiAvailable: true, wpeAuthenticated: true,
    scope: 'installs reported by the WP Engine API',
  },
  mcpServer: { running: true, toolCount: 201, port: 10801, version: '0.2.3' },
  embedding: { ready: true, model: 'all-MiniLM-L6-v2', quantized: true, dimensions: 384, maxSequenceLength: 256 },
};

// Only variants that produce a DIFFERENT tree are snapshotted.
//
// `renderOverviewTab` early-returns `null` when `stats` is null, so `loading`
// and `error` would both snapshot as literal `null` — a passing snapshot that
// protects nothing. They are covered by an explicit assertion below instead.
// `wpeSyncing` is not read anywhere in the Overview tree (it belongs to
// Operations), so that variant would be byte-identical to `populated`; it is
// asserted structurally in Task 6 rather than snapshotted here.
const VARIANTS: Array<[string, Record<string, unknown>]> = [
  ['empty fleet', {
    loading: false,
    stats: {
      ...POPULATED_STATS,
      localSites: { total: 0, running: 0, halted: 0 },
      wpeConnected: { count: 0 },
      remoteSites: { total: 0, unlinked: 0, capiAvailable: false, wpeAuthenticated: false, scope: 'installs reported by the WP Engine API' },
    },
    fleetSummary: null,
  }],
  ['populated', { loading: false, stats: POPULATED_STATS }],
  ['wpe not connected', {
    loading: false,
    stats: {
      ...POPULATED_STATS,
      remoteSites: { total: 0, unlinked: 0, capiAvailable: false, wpeAuthenticated: false, scope: 'installs reported by the WP Engine API' },
    },
    wpeAuthError: true,
  }],
];

describe('Overview tab — characterization', () => {
  test.each(VARIANTS)('renders %s identically before and after extraction', (_name, state) => {
    const inst = makeInstance(state);
    expect(serializeTree(inst.renderOverviewTab())).toMatchSnapshot();
  });

  // Covers the two variants deliberately excluded from the snapshot set:
  // both produce a literal `null`, which a snapshot would record as a pass
  // while protecting nothing.
  test('renders nothing until stats have loaded', () => {
    expect(makeInstance({ loading: true, stats: null }).renderOverviewTab()).toBeNull();
    expect(makeInstance({ loading: false, stats: null, error: 'Failed to load stats' }).renderOverviewTab()).toBeNull();
  });
});
```

- [ ] **Step 2: Generate and inspect the snapshots**

Run: `npx jest tests/unit/renderer/OverviewTab.characterization.test.tsx`
Expected: PASS, **3 snapshots** written plus the null-state test.

**Read the generated snapshot file before committing.** Confirm the populated variant actually contains the fleet cards and the MCP panel — an all-`null` snapshot would pass and protect nothing. If a variant serializes to `null`, the state fixture is insufficient; fix the fixture and say what you changed.

- [ ] **Step 3: Prove the snapshots can fail**

Temporarily change any literal string inside `renderOverviewTab` (for example the `'Fleet Intelligence'` section label), re-run, confirm the snapshot fails, then restore. Report the failure message.

- [ ] **Step 4: Commit**

```bash
git add tests/unit/renderer/OverviewTab.characterization.test.tsx tests/unit/renderer/__snapshots__/
git commit -m "test(renderer): characterization snapshots for the Overview tab"
```

---

### Task 5: Extract the shared card styles

**Files:**
- Create: `src/renderer/components/tabs/shared/cards.tsx`
- Modify: `src/renderer/components/NexusOverview.tsx`

**Interfaces:**
- Consumes: nothing
- Produces: `cardContainerStyle`, `cardStyle`, `cardTitleStyle`, `renderSectionLabel(text: string): React.ReactNode`

- [ ] **Step 1: Create the shared module**

Move the four symbols out of `NexusOverview.tsx` verbatim — same values, same shapes. `renderSectionLabel` is currently a method but uses no instance state, so it becomes a plain exported function.

```tsx
import * as React from 'react';

export const cardContainerStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, 1fr)',
  gap: '16px',
  marginBottom: '24px',
};

export const cardStyle: React.CSSProperties = {
  borderRadius: '10px',
  padding: '20px',
  border: '1px solid var(--nxai-card-border, #e5e7eb)',
  backgroundColor: 'var(--nxai-card-bg, #fff)',
};
```

Copy `cardTitleStyle` and the body of `renderSectionLabel` from `NexusOverview.tsx` exactly as they stand — do not retype them from memory, and do not adjust any value.

- [ ] **Step 2: Point NexusOverview at the shared module**

Replace the local definitions with an import, and change `this.renderSectionLabel(...)` call sites to the imported function.

- [ ] **Step 3: Verify the tree is unchanged**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: clean.

Run: `npx jest tests/unit/renderer`
Expected: PASS, **snapshots unchanged**. A snapshot failure here means a style value drifted during the move — fix the value, do not update the snapshot.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/tabs/shared/cards.tsx src/renderer/components/NexusOverview.tsx
git commit -m "refactor(renderer): extract shared card styles to tabs/shared/cards"
```

---

### Task 6: Extract OverviewTab

**Files:**
- Create: `src/renderer/components/tabs/OverviewTab.tsx`
- Modify: `src/renderer/components/NexusOverview.tsx`
- Modify: `tests/unit/renderer/OverviewTab.characterization.test.tsx`

**Interfaces:**
- Consumes: `serializeTree` (Task 3); `cardContainerStyle`, `cardStyle`, `cardTitleStyle`, `renderSectionLabel` (Task 5)
- Produces: `OverviewTab` class component with props `{ electron: any; stats: DashboardStats | null; fleetSummary: FleetSummaryData | null; settings: NexusSettings | null; wpeAuthError: boolean; onNavigate: (tab: 'overview' | 'activity' | 'operations' | 'settings' | 'agents') => void; onRefresh: () => void }`

- [ ] **Step 1: Create OverviewTab with its own view state**

Move these methods into the new component, unchanged in body: `renderSetupBanner`, `renderWpeAuthBanner`, `renderWpeNotConnectedBanner`, `renderWpeBanner`, `renderMcpPanel`, `renderLocalSitesCard`, `renderWpeConnectedCard`, `renderRemoteSitesCard`, `renderFleetSummaryCard`, `renderMcpCard`, `renderAiProxyCard`, and the body of `renderOverviewTab` as its `render()`.

`OverviewTab` owns only view state safe to lose on unmount:

```tsx
interface OverviewTabState {
  wpeBannerDismissed: boolean;
  wpeNotConnectedDismissed: boolean;
  copiedField: string | null;
}
```

**Navigation must go through the prop.** The two existing `this.setState({ activeTab: ... })` calls sit in `FleetCompletenessWidget`'s props and become:

```tsx
onSchedule: () => this.props.onNavigate('settings'),
onIndexSites: () => this.props.onNavigate('operations'),
```

Everything else the moved methods read — `stats`, `fleetSummary`, `settings`, `wpeAuthError`, `aiProxy` — arrives as props. Where a moved method reads a state field not in `OverviewTabState` and not in the props list above, add it to the props and note the addition in your report.

- [ ] **Step 2: Render it from the shell**

In `NexusOverview.renderActiveTab()`, replace `case 'overview': return this.renderOverviewTab();` with:

```tsx
      case 'overview': return React.createElement(OverviewTab, {
        electron: this.props.electron,
        stats: this.state.stats,
        fleetSummary: this.state.fleetSummary,
        settings: this.state.settings,
        wpeAuthError: this.state.wpeAuthError,
        onNavigate: (tab) => this.setState({ activeTab: tab }),
        onRefresh: () => { void this.fetchAll(); },
      });
```

Delete the moved methods and the three moved state fields from the shell.

- [ ] **Step 3: Repoint the characterization test**

The snapshots must not change. Update `makeInstance` to construct `OverviewTab` with props instead of `NexusOverview` with state, keeping every fixture value identical:

```tsx
function makeInstance(stateOverrides: Record<string, any>): any {
  const electron = {
    ipcRenderer: {
      invoke: jest.fn(async () => ({ success: false })),
      on: jest.fn(),
      removeListener: jest.fn(),
    },
  };
  const inst: any = new OverviewTab({
    electron,
    stats: (stateOverrides.stats ?? null),
    fleetSummary: (stateOverrides.fleetSummary ?? null),
    settings: (stateOverrides.settings ?? null),
    wpeAuthError: !!stateOverrides.wpeAuthError,
    onNavigate: jest.fn(),
    onRefresh: jest.fn(),
  });
  return inst;
}
```

and call `inst.render()` in place of `inst.renderOverviewTab()`.

The three snapshotted variants map cleanly onto props, so **their snapshots must not change**. The null-state test changes shape only: `stats: null` is now a prop rather than state, so it becomes `new OverviewTab({ ...props, stats: null }).render()` — still expecting `null`. Say in your report what each of the four tests looks like after the repoint.

- [ ] **Step 4: Add the structural assertions**

```tsx
describe('Overview extraction — structural invariants', () => {
  test('the shell routes each tab value to its own surface', () => {
    const shell = makeShell({ activeTab: 'overview', stats: POPULATED_STATS, loading: false });
    const tree: any = serializeTree(shell.renderActiveTab());
    expect(tree.type).toBe('OverviewTab');
  });

  test('long-running operation state stays on the shell, not the tab', () => {
    const shell = makeShell({});
    expect(Object.keys(shell.state)).toEqual(expect.arrayContaining(['wpeSyncing', 'wpeSyncProgress']));

    const tab = makeInstance({});
    expect(Object.keys(tab.state)).not.toEqual(expect.arrayContaining(['wpeSyncing', 'wpeSyncProgress']));
  });

  test('the tab navigates through onNavigate, never by setting activeTab', () => {
    const onNavigate = jest.fn();
    const tab: any = new OverviewTab({
      electron: { ipcRenderer: { invoke: jest.fn(), on: jest.fn(), removeListener: jest.fn() } },
      stats: POPULATED_STATS, fleetSummary: null, settings: null, wpeAuthError: false,
      onNavigate, onRefresh: jest.fn(),
    });
    const tree = JSON.stringify(serializeTree(tab.render()));
    expect(tree).not.toContain('activeTab');
  });
});
```

Add a `makeShell` helper alongside `makeInstance`, constructing `NexusOverview` the way `makeInstance` did in Task 4.

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: clean.

Run: `npx jest tests/unit/renderer`
Expected: PASS with **snapshots unchanged**. If a snapshot differs, the extraction changed behaviour — fix the code, do not run `-u`. If you believe the diff is correct and unavoidable, stop and report it with the diff rather than updating.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/tabs/OverviewTab.tsx src/renderer/components/NexusOverview.tsx tests/unit/renderer/OverviewTab.characterization.test.tsx
git commit -m "refactor(renderer): extract OverviewTab behind a props interface"
```

---

### Task 7: Full verification

**Files:** none

- [ ] **Step 1: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: clean.

- [ ] **Step 2: Full suite**

Run: `npm test`
Expected: exactly the 13 baseline failing suites and 26 failing tests listed in Global Constraints. Anything else is a regression introduced by this plan.

- [ ] **Step 3: Confirm the file actually shrank**

Run: `wc -l src/renderer/components/NexusOverview.tsx`
Expected: substantially below the starting 2,876 — roughly 2,000 or fewer after ~394 lines of dead methods, the orphan cascade, and the Overview extraction. Report the actual number; a number close to 2,876 means something was not removed.

- [ ] **Step 4: Confirm no snapshot was updated**

Run: `git log --oneline -- tests/unit/renderer/__snapshots__/`
Expected: exactly one commit — the one from Task 4 that created them. A second commit touching snapshots means an extraction step changed behaviour; report which.

- [ ] **Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix: address verification findings"
```

---

## Notes for the implementer

- **Renderer style:** React 16, `React.createElement` only, class components, inline style objects. No JSX, no hooks. Follow the existing `NexusOverview.tsx` and `EventStatsCards.tsx` patterns.
- **Test construction pattern:** never mount. Build the class with `new`, assign state or pass props, call the render method, assert on the return value. `tests/unit/renderer/EventStatsCards.test.tsx` is the worked example.
- **Do not commit untested work.** Each task's verify steps run before its commit step.
- **Do not push, tag, or release.** CLAUDE.md forbids it without an explicit instruction.
- **If a "dead" symbol turns out to have a live reference, stop and report it.** The dead-code analysis was done by counting mentions; a dynamic or string-based reference would not have shown up.

## Not in this plan

- Decomposing Activity or Operations — specs 4 and 5 delete them.
- Wiring `operationsSort`, `failureAggregation`, `knowledgeLadder` or `coverageMetric`.
- The deferred follow-ups in `docs/planning/2026-08-09-nexus-ux-foundation-plan.md`.
- The outstanding live verification checklist in that same document.
