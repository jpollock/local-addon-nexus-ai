# Spec 2.5 — NexusOverview decomposition

Date: 2026-08-10
Branch: `new-ux-v2` (worktree)
Predecessor: `docs/planning/2026-08-09-nexus-ux-foundation-design.md` (specs 1+2, complete)

## Why this exists

`src/renderer/components/NexusOverview.tsx` is 2,876 lines with ~70 state fields in one bag.
Specs 3–6 (panel, Inbox, Sites table, Settings/agents) all edit it, so they cannot run in
parallel without colliding. This spec makes that file small enough for them to own disjoint
pieces.

**It delivers no user-visible change.** It is scaffolding for the UX specs, not UX. That is
worth stating plainly so it is not mistaken for progress on the redesign itself.

## Scope, and what was deliberately cut

An earlier draft decomposed all three tabs. That was wrong: **two of the three are scheduled for
deletion by the specs this work is meant to unblock.**

| Tab | Fate | Decompose? |
|---|---|---|
| Overview | survives; becomes the fleet summary header | **yes** |
| Activity | absorbed by the Inbox in spec 4 | no |
| Operations | replaced by the Sites table in spec 5 | no |

Specs 4 and 5 will build `InboxTab` and `SitesTab` as new files and delete the old render
methods as they land. That achieves the same parallelism for roughly a third of the work, and
keeps the characterization effort on code that is staying.

## Phase 1 — delete before you move

Six render methods have **zero call sites** and are referenced nowhere in `src/` or `tests/`
(verified: each appears exactly once in the file, at its own definition):

- `renderGraphCard`
- `renderWpeSyncCard`
- `renderFleetPluginsCard`
- `renderSetupAICell`
- `renderCredentialSyncSection`
- `renderWpeSyncSection`

Together roughly 350+ lines before counting what they alone depend on. Two siblings —
`renderIndexCard` and `renderEmbeddingCard` — were already deleted in the foundation spec's
final fix wave for the same reason.

Also dead, as a consequence of the foundation spec deleting the Ask/Tell tab:

- the `ChatTab` import (line 26) — the tab was its only consumer
- `chatMessages` and `chatSessionId` state

**After removing the methods, sweep for newly-orphaned state and handlers.** Candidates on
current evidence, each to be **confirmed by grep rather than assumed**: `fleetPlugins`;
`syncStatus` / `syncing` / `syncResults`; `setupResults` / `setupId`; `wpeSyncStats` /
`wpeSyncThresholdHours`. A field still read by a surviving method stays.

Note `tsc` does not flag unused private methods or state fields by default, so the sweep is a
grep pass per removed symbol, not something the compiler will do for you.

**No characterization tests for this phase.** Deleting unreferenced code has no behaviour to
preserve; `tsc` plus the existing suite is the check. This phase lands and is verified before
Phase 2 begins, so the snapshots taken later do not encode dead structure.

## Phase 2 — extract what survives

### Files

| File | Responsibility |
|---|---|
| `src/renderer/components/tabs/shared/cards.tsx` | `cardContainerStyle`, `cardStyle`, `cardTitleStyle`, `renderSectionLabel` |
| `src/renderer/components/tabs/OverviewTab.tsx` | four banners, `renderMcpPanel`, three fleet cards, `renderFleetSummaryCard`, `renderMcpCard`, `renderAiProxyCard`, and their composition |
| `src/renderer/components/NexusOverview.tsx` | shell — see below |

`AgentsHub` and `SettingsTab` are already separate and are not touched.

### What the shell keeps, and why

1. **Data fetching** — `fetchAll()`, the 60s `pollTimer`, and the shared data every tab reads
   (`stats`, `settings`, `sites`, `wpeSites`, `fleetSummary`).
2. **Long-running operation state and its polling** — `wpeSyncing` / `wpeSyncProgress`,
   `wpeSyncPassivePoll`, `wpeSyncPollInterval`, the `*OpId` / `*Running` pairs,
   `factoryResetRunning`.
   **This is the load-bearing constraint.** Start a WPE sync on Operations, switch tabs, and the
   polling must keep running. A tab component unmounts on tab switch and takes its timers with
   it, so none of this can move down.
3. **Chrome** — header, tab bar, tab dispatch.
4. Activity and Operations render methods, until specs 4 and 5 replace them.

### What moves down

`OverviewTab` owns only view state that is safe to lose on unmount: the banner dismissal flags
(`wpeBannerDismissed`, `wpeNotConnectedDismissed`) and `copiedField` (the MCP panel's copy
affordance). Everything else it needs arrives as props.

### The one interface detail that matters

`renderOverviewTab` currently navigates by calling `this.setState({ activeTab: 'settings' })`
and `{ activeTab: 'operations' }` (via `FleetCompletenessWidget`'s `onSchedule` / `onIndexSites`).
Extracted, it takes an **`onNavigate(tab)`** prop. The tab component must not know how the shell
stores its active tab — that coupling is what makes a component un-relocatable, and specs 3–6
will be relocating things.

## Testing

**Nothing in the repo tests `NexusOverview` today** — zero test files reference it. The project
has been burned by this exact shape before (`feedback_test_before_refactor`: the MCP refactor
broke `nexus wp` commands). So Phase 2 is characterization-first.

### Why snapshots, and how

`React.createElement` returns a plain, serializable object tree, so the tree can be captured
without rendering. This matters: `react` and `react-dom` are declared only as
**`peerDependencies` with `"*"`** — resolved from Local's runtime, not version-pinned by this
project — `@testing-library/react` (^16.3.2) is installed but unused anywhere in the suite, and
`@types/react` is ^19.2.14 against a React 16 runtime. Building tests on a rendering stack whose
version this project does not control would mean untangling that first. Serializing the element
tree sidesteps it entirely, and matches the pattern the existing renderer tests already use
(construct the class, call methods, assert on return values — see
`tests/unit/renderer/EventStatsCards.test.tsx`).

A helper recurses `props.children`, keeps `type`, `key` and all props including `style`, drops
`$$typeof`, `_owner` and `ref`, and replaces functions with the marker `[fn]` — so a handler
appearing or disappearing still fails the snapshot.

Brittleness is the point. For a behaviour-preserving refactor, any structural, style, prop or
text change should fail.

### State matrix

Snapshots are only as good as their inputs, so this list is the actual coverage:

| Variant | What it protects |
|---|---|
| loading | the earliest render path, easily broken by moving fetch |
| error | the branch that most often regresses silently |
| empty fleet | zero sites, no WPE — the empty-list and zero-count paths |
| populated | representative stats, sites, settings, fleet summary |
| operation in flight | `wpeSyncing: true` with progress — the state that must survive the move |
| WPE not connected | the banner variants |

### Explicit assertions alongside the snapshots

Where a readable failure beats a snapshot diff:

- the shell dispatches each `activeTab` value to the right component
- long-running operation state lives on the shell, not on `OverviewTab`
- `OverviewTab` calls `onNavigate` rather than reaching for `activeTab`

### Sequencing

Snapshots are written and committed **against the post-Phase-1, pre-extraction code**. Every
extraction step must leave them byte-identical. A step that needs `jest -u` has changed
behaviour and must justify it in its report rather than silently updating.

### The honest limit

Snapshots pin what the tree looks like, not what it does. They will not catch a lost IPC call, a
timer that stops firing, or state resetting on tab switch. The explicit assertions cover the
third. The first two are why one manual pass through the tabs is worth doing when Local is next
pointed at this worktree — see the live checklist in the foundation plan, which is still
outstanding for the same reason.

## Out of scope

- Wiring the four unwired modules from the foundation spec (`operationsSort`,
  `failureAggregation`, `knowledgeLadder`, `coverageMetric`). `operationsSort` and
  `knowledgeLadder` belong to the surfaces specs 4 and 5 rebuild; `failureAggregation`'s
  auto-pause mutates agent runtime behaviour and deserves its own design pass.
- The deferred follow-ups in the foundation plan's "Follow-up work discovered during execution"
  section.
- Any user-visible change. If this spec changes what a user sees, something has gone wrong.
