# Panel Insights Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the docked panel a reason to look at it when you are not chatting — an Insights tab — and put it on Local's theme instead of its own.

**Architecture:** Three deliverables in dependency order. The theme migration lands first so the new Insights markup is written theme-aware rather than converted twice. Then a third panel size. Then the Insights tab itself, measured against a characterization baseline that must leave the Chat view byte-identical.

**Tech Stack:** TypeScript, React 16 via `React.createElement` (no JSX, no hooks, class components), Jest.

**Spec:** `docs/planning/2026-08-10-nexus-panel-insights-design.md`

## Global Constraints

- **Chat remains the default tab.** Opening the panel must land exactly where it lands today.
- **One conversation across all three sizes.** Resizing is a size change, not a different surface.
- **No raw hex literals in the five panel files** after Task 2. Colours that must flip with the theme become `var(--nxai-*)`; colours that pair with the fixed brand become named constants in `src/common/constants.ts`.
- **Do not add variables to `theme.ts`.** The ruling is to collapse onto what exists — three background levels become two, three cyan shades become the single brand accent — per review finding 15, "adopt Local's chrome everywhere and keep exactly one accent." If it reads flat on screen, that is a follow-up, not this plan.
- **The panel renders on plain Local screens** where no other Nexus component is mounted. Anything it depends on must be self-sufficient.
- React 16, `React.createElement`, class components, inline style objects. No JSX, no hooks, no `react-dom`.
- Test baseline is 13 failing suites / 26 failing tests, all pre-existing: chat-providers, embedding-service, error-recovery, mcp-tools, AgentRegistry, log-processor/agent, log-processor/db, ai-gateway/routing, cli/agent-commands, common/iw-types, content/site-readiness, credentials/ProviderRegistry, mcp/wpe-deep-refresh. Anything else failing is yours.
- Do NOT run `npm run rebuild`, `npm run build`, `./dev-reload.sh`, `git push`, `npm version`, or `git tag`.

## The colour mapping

19 distinct values produce all 88 usages. This table is the contract for Tasks 1 and 2.

| Hex | Uses | Role | Becomes |
|---|---|---|---|
| `#868d98` | 15 | muted/secondary text | `var(--nxai-card-sub)` |
| `#2c313a` | 14 | borders and dividers | `var(--nxai-card-border)` |
| `#29b6cf` | 10 | accent fill | `UI_COLORS.WPE_BRAND` |
| `#e4e7ec` | 9 | body text | `var(--nxai-card-text)` |
| `#5fd2e5` | 8 | accent text | `UI_COLORS.WPE_BRAND` |
| `#23272f` | 6 | **mixed — see Task 2** | per-use |
| `#1a1e24` | 6 | panel body background | `var(--nxai-card-bg)` |
| `#05262e` | 5 | foreground on the accent, and the Nexus glyph fill | `UI_COLORS.NEXUS_MARK` (new constant) |
| `#22697a` | 2 | teal border | `var(--nxai-card-border)` |
| `#10262b` | 2 | tinted panel background | `var(--nxai-section-bg)` |
| `#1fc0d8` | 2 | gradient partner to `#29b6cf` | `UI_COLORS.WPE_BRAND` (gradient collapses to flat) |
| `#e0a94b` | 2 | warning text | `var(--nxai-warn-text)` |
| `#132a30` | 1 | tinted panel background | `var(--nxai-section-bg)` |
| `#22303a` | 1 | hover background | `var(--nxai-table-hover)` |
| `#f2f4f6` | 1 | brightest text | `var(--nxai-card-text)` |
| `#c9d1d9` | 1 | light text | `var(--nxai-card-text)` |
| `#22c55e` | 1 | success | `UI_COLORS.STATUS_RUNNING` |
| `#e05252` | 1 | danger text | `var(--nxai-danger-text)` |
| `#29b6cf22` | 1 | accent at ~13% alpha | `rgba(14, 202, 212, 0.13)` with a comment naming it as the brand tint |

**Why two colours become constants rather than variables.** `#05262e` and (some uses of)
`#23272f` are foregrounds sitting *on* the brand cyan. The brand is identical in light and dark,
so its contrast pair must not flip — making it a theme variable would break contrast in one mode.
They live in `constants.ts` beside `WPE_BRAND`, which is also where the handoff says the Nexus
mark fill belongs.

## File Structure

| File | Change |
|---|---|
| `src/common/constants.ts` | add `NEXUS_MARK` and `ON_BRAND_DISABLED` to `UI_COLORS` |
| `src/renderer/components/DockedPanel/DockedPanel.tsx` | 19 colours; `wide` size; Insights/Chat segmented control |
| `src/renderer/components/DockedPanel/PanelChat.tsx` | 28 colours |
| `src/renderer/components/DockedPanel/SessionsSidebar.tsx` | 20 colours |
| `src/renderer/components/DockedPanel/ActionCard.tsx` | 12 colours |
| `src/renderer/components/DockedPanel/ContextSelector.tsx` | 9 colours |
| `src/renderer/components/DockedPanel/DockedPanelContainer.tsx` | `injectThemeVars()`; `wide` in size validation; Insights tab state |
| `src/renderer/components/DockedPanel/PanelInsights.tsx` | **new** — the Insights tab |
| `tests/unit/renderer/panel-theme.test.ts` | **new** — the three structural tests |
| `tests/unit/renderer/PanelChrome.characterization.test.tsx` | **new** — snapshots |

---

### Task 1: The unambiguous colours

**Files:**
- Modify: `src/common/constants.ts`
- Modify: all five panel `.tsx` files

**Interfaces:**
- Consumes: nothing
- Produces: `UI_COLORS.NEXUS_MARK`, `UI_COLORS.ON_BRAND_DISABLED`

This task does the 13 rows of the mapping table whose role is unambiguous, leaving `#23272f`,
`#05262e`, `#1a1e24`, `#10262b`, `#132a30`, `#22303a` for Task 2. Splitting them means a reviewer
can accept the mechanical two-thirds while rejecting a judgement call in the rest.

- [ ] **Step 1: Add the two brand-pair constants**

In `src/common/constants.ts`, inside `UI_COLORS`:

```typescript
  /** Nexus mark fill. Pairs with WPE_BRAND, so it is fixed in both themes — see docs/planning/2026-08-10-nexus-panel-insights-design.md */
  NEXUS_MARK: '#05262e',
  /** Disabled foreground on a brand-filled control. Fixed for the same reason. */
  ON_BRAND_DISABLED: '#23272f',
```

- [ ] **Step 2: Substitute the 13 unambiguous colours**

Apply these, in all five panel files:

| From | To |
|---|---|
| `#868d98` | `var(--nxai-card-sub)` |
| `#2c313a` | `var(--nxai-card-border)` |
| `#29b6cf` | `UI_COLORS.WPE_BRAND` |
| `#e4e7ec` | `var(--nxai-card-text)` |
| `#5fd2e5` | `UI_COLORS.WPE_BRAND` |
| `#22697a` | `var(--nxai-card-border)` |
| `#1fc0d8` | `UI_COLORS.WPE_BRAND` |
| `#e0a94b` | `var(--nxai-warn-text)` |
| `#f2f4f6` | `var(--nxai-card-text)` |
| `#c9d1d9` | `var(--nxai-card-text)` |
| `#22c55e` | `UI_COLORS.STATUS_RUNNING` |
| `#e05252` | `var(--nxai-danger-text)` |
| `#29b6cf22` | `rgba(14, 202, 212, 0.13)` |

Where `#29b6cf` and `#1fc0d8` form a `linear-gradient`, collapse it to a flat
`UI_COLORS.WPE_BRAND` fill — one accent, per the constraint.

Import `UI_COLORS` in any file that does not already.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: clean.

Run: `npx jest tests/unit/renderer`
Expected: no new failures. Note the panel has no rendering tests yet, so this only proves nothing
else broke.

- [ ] **Step 4: Commit**

```bash
git add src/common/constants.ts src/renderer/components/DockedPanel/
git commit -m "refactor(panel): move the unambiguous panel colours onto theme variables"
```

---

### Task 2: The remaining colours, the container, and the structural tests

**Files:**
- Modify: the five panel `.tsx` files
- Modify: `src/renderer/components/DockedPanel/DockedPanelContainer.tsx`
- Test: `tests/unit/renderer/panel-theme.test.ts`

**Interfaces:**
- Consumes: `UI_COLORS.NEXUS_MARK`, `UI_COLORS.ON_BRAND_DISABLED` (Task 1)
- Produces: nothing

- [ ] **Step 1: Map the six remaining colours**

| From | To | Note |
|---|---|---|
| `#1a1e24` | `var(--nxai-card-bg)` | panel body |
| `#10262b` | `var(--nxai-section-bg)` | tinted background |
| `#132a30` | `var(--nxai-section-bg)` | tinted background — collapses with the above |
| `#22303a` | `var(--nxai-table-hover)` | hover state |
| `#05262e` | `UI_COLORS.NEXUS_MARK` | glyph fill and on-brand foreground |
| `#23272f` | **inspect each of its 6 uses** | see below |

`#23272f` is used in more than one role. For **each** of its six occurrences, decide from
context: a foreground sitting on a brand-filled control becomes `UI_COLORS.ON_BRAND_DISABLED`; a
background becomes `var(--nxai-card-bg)` or `var(--nxai-section-bg)` to match its neighbours.
**List all six in your report with the mapping you chose and why.** If one fits neither, stop and
ask rather than guessing.

- [ ] **Step 2: Make the container inject the theme variables**

`DockedPanelContainer` does not call `injectThemeVars()`; eight other components do. The panel is
globally mounted and renders on Local screens where none of those eight exist, so without this
every variable resolves to nothing and the panel renders colourless.

Add the import and call it in `componentDidMount`. It is idempotent by design.

- [ ] **Step 3: Write the three structural tests**

The failure mode here is invisible — a mistyped variable compiles, throws nothing, and renders
transparent. These are the only automated checks that can see it.

```typescript
import * as fs from 'fs';
import * as path from 'path';

const PANEL_DIR = path.join(__dirname, '../../../src/renderer/components/DockedPanel');
const THEME_FILE = path.join(__dirname, '../../../src/renderer/utils/theme.ts');

function panelSources(): Array<[string, string]> {
  return fs.readdirSync(PANEL_DIR)
    .filter((f) => f.endsWith('.tsx'))
    .map((f) => [f, fs.readFileSync(path.join(PANEL_DIR, f), 'utf8')] as [string, string]);
}

describe('panel theming', () => {
  test('no raw hex literal survives in any panel file', () => {
    const offenders: string[] = [];
    for (const [file, src] of panelSources()) {
      for (const hex of src.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []) {
        offenders.push(`${file}: ${hex}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test('every --nxai- variable the panel references exists in theme.ts', () => {
    const theme = fs.readFileSync(THEME_FILE, 'utf8');
    const missing: string[] = [];
    for (const [file, src] of panelSources()) {
      for (const ref of src.match(/--nxai-[a-z-]+/g) ?? []) {
        // A typo compiles and renders transparent — this is the only thing that catches it.
        if (!theme.includes(`${ref}:`)) missing.push(`${file}: ${ref}`);
      }
    }
    expect(missing).toEqual([]);
  });

  test('the container injects the theme variables itself', () => {
    const src = fs.readFileSync(path.join(PANEL_DIR, 'DockedPanelContainer.tsx'), 'utf8');
    // The panel renders on Local screens where no other Nexus component is mounted,
    // so it cannot rely on someone else having injected them.
    expect(src).toMatch(/injectThemeVars\s*\(/);
  });
});
```

- [ ] **Step 4: Run and falsify**

Run: `npx jest tests/unit/renderer/panel-theme.test.ts`
Expected: PASS, 3 tests.

Then prove each can fail: reintroduce one hex literal (test 1 fails); change one variable
reference to `--nxai-nonexistent` (test 2 fails); comment out the `injectThemeVars` call (test 3
fails). Revert each and report all three failure messages.

- [ ] **Step 5: Verify and commit**

Run: `npx tsc --noEmit -p tsconfig.json && npx jest tests/unit/renderer`

```bash
git add src/renderer/components/DockedPanel/ tests/unit/renderer/panel-theme.test.ts
git commit -m "refactor(panel): finish the theme migration and pin it with structural tests"
```

---

### Task 3: Characterization baseline for the panel chrome

**Files:**
- Test: `tests/unit/renderer/PanelChrome.characterization.test.tsx`

**Interfaces:**
- Consumes: `serializeTree` from `tests/unit/renderer/helpers/serializeTree.ts`
- Produces: snapshots that Tasks 4 and 5 must leave unchanged

Taken **after** the theme migration — colours changed by design, so a pre-migration baseline
would fail on purpose and teach nothing.

- [ ] **Step 1: Write the characterization test**

`DockedPanel`'s props include `open`, `size`, `onOpen`, `onClose`, `onSetSize`, `onNewChat`,
`children`, `sessionsSidebar`, `onToggleSessions`, `showSessions`, `streamingStatus`. Construct it
directly and call `render()` — never mount. The pattern is
`tests/unit/renderer/EventStatsCards.test.tsx`.

```tsx
import * as React from 'react';
import { DockedPanel } from '../../../src/renderer/components/DockedPanel/DockedPanel';
import { serializeTree } from './helpers/serializeTree';

function makePanel(overrides: Record<string, any> = {}): any {
  return new (DockedPanel as any)({
    open: true,
    size: 'docked',
    onOpen: jest.fn(),
    onClose: jest.fn(),
    onSetSize: jest.fn(),
    onNewChat: jest.fn(),
    onToggleSessions: jest.fn(),
    showSessions: false,
    streamingStatus: null,
    children: React.createElement('div', { 'data-test': 'chat-body' }, 'chat'),
    sessionsSidebar: null,
    ...overrides,
  });
}

const VARIANTS: Array<[string, Record<string, any>]> = [
  ['collapsed bubble', { open: false }],
  ['docked', {}],
  ['full', { size: 'full' }],
  ['streaming', { streamingStatus: 'Thinking…' }],
  ['sessions open', { showSessions: true, sessionsSidebar: React.createElement('div', null, 'sessions') }],
];

describe('panel chrome — characterization', () => {
  test.each(VARIANTS)('renders %s', (_name, props) => {
    expect(serializeTree(makePanel(props).render())).toMatchSnapshot();
  });
});
```

- [ ] **Step 2: Generate and inspect**

Run: `npx jest tests/unit/renderer/PanelChrome.characterization.test.tsx`
Expected: PASS, 5 snapshots.

**Read the snapshot file before committing.** Confirm the `docked` variant contains the header,
the brand block and the control cluster. A thin or `null` snapshot protects nothing — if one
looks hollow, the props fixture is insufficient; fix it and say what you changed.

- [ ] **Step 3: Prove they can fail**

Change one string in the header (e.g. `'Follows you across tabs'`), confirm snapshots fail,
revert. Report the message.

- [ ] **Step 4: Commit**

```bash
git add tests/unit/renderer/PanelChrome.characterization.test.tsx tests/unit/renderer/__snapshots__/
git commit -m "test(panel): characterization baseline for the panel chrome"
```

---

### Task 4: The `wide` size

**Files:**
- Modify: `src/renderer/components/DockedPanel/DockedPanel.tsx`
- Modify: `src/renderer/components/DockedPanel/DockedPanelContainer.tsx`
- Test: `tests/unit/renderer/docked-panel-container.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `PanelSize` widened to `'docked' | 'wide' | 'full'`

- [ ] **Step 1: Widen the type and add the constant**

In `DockedPanel.tsx`, `export type PanelSize = 'docked' | 'wide' | 'full';` and add
`const WIDE_WIDTH = 620;` beside `PANEL_WIDTH = 384`. The width expression currently reads
`width: full ? undefined : PANEL_WIDTH` — it must now yield `undefined` for `full`, `WIDE_WIDTH`
for `wide`, and `PANEL_WIDTH` for `docked`.

- [ ] **Step 2: Fix the persistence validation**

`DockedPanelContainer`'s `readState` coerces any stored size that is not `'full'` to `'docked'`,
so `wide` would silently reset on every reload. Accept all three, and keep coercing anything
unrecognised to `'docked'`.

- [ ] **Step 3: Add the header control**

Add a control that cycles or selects `wide`, alongside the existing maximize/restore controls.
Match the existing control cluster's markup and hover treatment — the surrounding buttons are the
reference.

- [ ] **Step 4: Test the round-trip**

Add to `tests/unit/renderer/docked-panel-container.test.ts`:

```typescript
  it('round-trips the wide size through localStorage', () => {
    localStorage.setItem('nexus-panel-state', JSON.stringify({ open: true, size: 'wide', activeSessionId: null }));
    const { DockedPanelContainer } = require('../../../src/renderer/components/DockedPanel/DockedPanelContainer');
    expect(new DockedPanelContainer({}).state.size).toBe('wide');
  });

  it('still coerces an unrecognised size to docked', () => {
    localStorage.setItem('nexus-panel-state', JSON.stringify({ open: true, size: 'enormous', activeSessionId: null }));
    const { DockedPanelContainer } = require('../../../src/renderer/components/DockedPanel/DockedPanelContainer');
    expect(new DockedPanelContainer({}).state.size).toBe('docked');
  });
```

- [ ] **Step 5: Add a wide snapshot and verify the others are untouched**

Add `['wide', { size: 'wide' }]` to the characterization VARIANTS. The other five snapshots must
pass **unchanged** — if `docked` or `full` moved, the width expression is wrong.

Run: `npx tsc --noEmit -p tsconfig.json && npx jest tests/unit/renderer`

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/DockedPanel/ tests/unit/renderer/
git commit -m "feat(panel): add a wide size between docked and full"
```

---

### Task 5: The Insights tab

**Files:**
- Create: `src/renderer/components/DockedPanel/PanelInsights.tsx`
- Modify: `src/renderer/components/DockedPanel/DockedPanel.tsx`
- Modify: `src/renderer/components/DockedPanel/DockedPanelContainer.tsx`
- Test: `tests/unit/renderer/PanelInsights.test.tsx`

**Interfaces:**
- Consumes: `UI_COLORS`, the theme variables
- Produces: `PanelInsights` with props `{ electron: any; onOpenAgents: () => void }`

- [ ] **Step 1: Build `PanelInsights`**

Three blocks, each reading live data. It fetches on mount via `electron.ipcRenderer.invoke`:

| Block | Source | Renders |
|---|---|---|
| Waiting items | the same derivation `AgentsHub.getTotalPending()` uses — activity events filtered to `status === 'review'` | "N things need you", clicking calls `onOpenAgents` |
| Fleet stats | `IPC_CHANNELS.GET_DASHBOARD_STATS` → `counts` | four figures: `counts.installs`, `counts.local`, `counts.wpe`, `counts.external` |
| Running on its own | `IPC_CHANNELS.GET_SETTINGS` | the background-job intervals, read live |

**Every fleet figure renders with its `scope` string, never bare.** `counts.installs.scope` reads
"installs on this Mac, WP Engine and other hosts" and exists precisely so a number is never shown
without saying what it counts. This is the first render site for those labels.

Handle the not-yet-loaded and failed states explicitly — the panel opens on screens where these
IPC calls may not resolve.

- [ ] **Step 2: Add the segmented control**

In `DockedPanel`'s header, a two-way Insights / Chat control. **Chat is the default** — the
container's initial tab state must be `'chat'`, and an existing user's panel must open exactly as
it does today.

Store the active tab in `DockedPanelContainer` alongside `size`, and persist it the same way.

- [ ] **Step 3: Test `PanelInsights`**

```tsx
  it('renders each fleet figure with its scope label, never bare', () => {
    const inst: any = new (PanelInsights as any)({ electron: mockElectron, onOpenAgents: jest.fn() });
    inst.state.counts = {
      installs: { count: 370, scope: 'installs on this Mac, WP Engine and other hosts' },
      local: { count: 37, scope: 'sites on this Mac' },
      wpe: { count: 330, scope: 'WP Engine installs' },
      external: { count: 3, scope: 'sites on other hosts' },
    };
    const tree = JSON.stringify(serializeTree(inst.render()));
    expect(tree).toContain('installs on this Mac, WP Engine and other hosts');
    expect(tree).toContain('sites on this Mac');
  });

  it('invokes onOpenAgents when the waiting-items card is activated', () => {
    const onOpenAgents = jest.fn();
    const inst: any = new (PanelInsights as any)({ electron: mockElectron, onOpenAgents });
    inst.state.pendingCount = 4;

    const card = findByTestId(inst.render(), 'waiting-items');
    expect(card).not.toBeNull();
    card.props.onClick();
    expect(onOpenAgents).toHaveBeenCalledTimes(1);
  });
```

with this helper at the top of the file — the tree is plain `createElement` output, so walking it
needs no renderer:

```tsx
function findByTestId(node: any, id: string): any {
  if (!node || typeof node !== 'object') return null;
  if (node.props && node.props['data-test'] === id) return node;
  const kids = node.props ? node.props.children : undefined;
  const arr = Array.isArray(kids) ? kids : [kids];
  for (const k of arr) {
    const hit = findByTestId(k, id);
    if (hit) return hit;
  }
  return null;
}
```

Give the waiting-items card `'data-test': 'waiting-items'` in Step 1 so this can find it.

- [ ] **Step 4: The Chat view must not change**

Run: `npx jest tests/unit/renderer`
Expected: the panel chrome snapshots pass **unchanged** for every variant whose tab is Chat. A
diff here means adding Insights altered the existing surface — fix the code, do not run `-u`.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/DockedPanel/ tests/unit/renderer/
git commit -m "feat(panel): add the Insights tab beside Chat"
```

---

### Task 6: Full verification

- [ ] **Step 1:** `npx tsc --noEmit -p tsconfig.json` — clean.
- [ ] **Step 2:** `npm test` — exactly the 13 baseline failing suites, nothing more.
- [ ] **Step 3:** Confirm no raw hex survives: `npx jest tests/unit/renderer/panel-theme.test.ts`.
- [ ] **Step 4:** Confirm the snapshot directory has one commit per intentional baseline change
  (Task 3 creating it, Task 4 adding the `wide` variant) and no others:
  `git log --oneline -- tests/unit/renderer/__snapshots__/`.
- [ ] **Step 5:** Commit any fixes.

## Notes for the implementer

- **Test construction:** never mount. Build the class with `new`, assign state or pass props, call
  `render()`, assert on the return value. `tests/unit/renderer/EventStatsCards.test.tsx` is the
  worked example.
- **The panel is globally mounted** and renders on screens with no other Nexus component present.
  Do not add a dependency that assumes otherwise.
- **Do not add variables to `theme.ts`.** If the collapsed palette reads flat, that is a follow-up
  decision, not a fix to make here.
- Do not push, tag, or release.

## Not in this plan

- Site-scoped Insights — needs Local's routing read from a globally-mounted panel.
- Linking to the Inbox — spec 4 builds it; the waiting-items card links to Agents until then.
- Adding panel-specific theme variables if the collapse reads flat.
