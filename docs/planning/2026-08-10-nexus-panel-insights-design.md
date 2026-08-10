# Spec 3 — Panel: Insights tab, wide size, and Local's theme

Date: 2026-08-10
Branch: `spec-3-panel` (worktree, branched from `new-ux-v2` at `0b2bed3e`)
Predecessors: `2026-08-09-nexus-ux-foundation-design.md`, `2026-08-10-nexus-overview-decomposition-design.md`

## Why this exists

The handoff calls the docked panel the highest-value piece of the rework, and says most of its
infrastructure already exists. That is accurate: `DockedPanelContainer` is already mounted on
`document.body` at z-index 8999 from `src/renderer/index.tsx`, gated by `dockedPanelEnabled`, so
it already floats over every screen in Local.

What it lacks is a reason to look at it when you are not chatting. This spec adds one.

It also closes review finding 15 — "the chat panel should follow the app's light/dark setting,
not impose its own" — because the new surface should be written theme-aware rather than
converted twice.

## Scope

**In:**
- The panel adopts Local's theme (light and dark) instead of its own dark palette.
- A third size, `wide`, alongside `docked` and `full`.
- An **Insights** tab beside Chat, showing fleet-level information.

**Out, deliberately:**
- **Site-scoped Insights.** The handoff has Insights adapt when you are on a Local site screen.
  That needs Local's routing read from inside a globally-mounted panel, and it is the part of the
  design least grounded in data that already exists. Fleet context only.
- **Linking to the Inbox.** Spec 4 builds it. Until then the waiting-items card links to the
  Agents tab, which is where reviews actually live today. Repointing it later is one line.

## Architecture — three deliverables, in dependency order

### A. Theme migration (first, so new markup is written theme-aware)

The panel carries **88 hardcoded hex values** and zero theme variables:

| File | hex |
|---|---|
| `PanelChat.tsx` | 28 |
| `SessionsSidebar.tsx` | 20 |
| `DockedPanel.tsx` | 19 |
| `ActionCard.tsx` | 12 |
| `ContextSelector.tsx` | 9 |
| `DockedPanelContainer.tsx` | 0 |

Dark support already exists — `src/renderer/utils/theme.ts` defines the `--nxai-*` variables for
light under `:root` and for dark under `.Theme__Dark`, and Local applies that class before addon
code runs (`src/renderer/index.tsx:30-37` already reads it). So this is substitution onto existing
infrastructure, not new infrastructure.

**Two things this must include:**

1. **`DockedPanelContainer` must call `injectThemeVars()` on mount.** Eight components call it
   today; the container is not one of them. The panel is globally mounted and renders on plain
   Local screens where none of those eight exist — the handoff's own "panel outside Nexus" case.
   Convert to variables without this and the panel loses its colours there entirely.
2. **This changes the panel's dark appearance, not just adding a light one.** Its current palette
   is a distinct deep teal (`#05262e`, `#2c313a`, `#868d98`); `.Theme__Dark` is neutral grey
   (`#2a2a2a`, `#404040`, `#9ca3af`). That is the intent of finding 15 — one accent, Local's
   chrome — but it is a visible change to something that currently looks deliberate.

### B. The `wide` size

`PanelSize` becomes `'docked' | 'wide' | 'full'`. `PANEL_WIDTH = 384` is joined by
`WIDE_WIDTH = 620`.

`DockedPanelContainer` already persists `size` to `localStorage` and rehydrates it, but its
validation coerces anything that is not `'full'` to `'docked'`
(`DockedPanelContainer.tsx:39`) — that must accept the new value, or `wide` silently
resets on every reload.

### C. The Insights tab

A segmented control in the panel header switches Insights / Chat. **Chat remains the default**,
so nothing regresses for existing users.

Insights shows three blocks:

| Block | Data source |
|---|---|
| Waiting items — "N things need you" | `activityEvents` filtered to `status === 'review'`, the same derivation `AgentsHub.getTotalPending()` uses. Links to the Agents tab. |
| Four fleet stats — **installs (the canonical total), on this Mac, WP Engine, other hosts** | `GET_DASHBOARD_STATS` → `counts.installs`, `counts.local`, `counts.wpe`, `counts.external`. Each renders with its `scope` string, never a bare number — that is the foundation spec's first non-negotiable and this is its first render site. |
| "Running on its own" | `GET_SETTINGS` — the background-job intervals, read live rather than restated |

This makes Insights the **first renderer consumer of the `counts` field** the foundation spec
added and deliberately left unwired. Its scope labels finally have somewhere to display, which
also closes part of that spec's deferred "counts have no consumer on any surface" finding.

## Testing

The panel's existing coverage is two files: `docked-panel-container.test.ts` (localStorage
round-trip) and `panel-chat-markdown.test.ts`. Nothing tests `DockedPanel.tsx`'s rendering.
`serializeTree` is available at `tests/unit/renderer/helpers/serializeTree.ts`, inherited from
spec 2.5.

### The theme migration's failure mode is invisible, and that drives the approach

A mistyped variable — `var(--nxai-crd-bg)` — does not fail to compile, does not throw, and does
not show up in a snapshot as anything other than a missing colour. It renders as transparent text
or an invisible border. Three structural tests catch what nothing else will:

1. **No hardcoded hex remains** in the five panel files — catches an incomplete migration.
2. **Every `--nxai-*` the panel references exists in `theme.ts`** — catches the typo. This is the
   one that matters; it is the only automated check that can see the silent failure.
3. **`DockedPanelContainer` calls `injectThemeVars()` on mount** — catches the
   colourless-on-plain-Local-screens bug.

### Characterization, sequenced after the migration

Snapshots are taken **after** the theme migration, not before. Colours change by design, so a
pre-migration baseline would fail on purpose and teach nothing.

With that baseline in place, adding `wide` and Insights must leave the **Chat view
byte-identical**. That is the property that matters: an existing user should not see their panel
change because a new tab appeared next to it.

### What no test covers

Whether the themed panel actually *looks* right — in either mode. Nothing automated can judge
that, and the migration changes dark mode as well as adding light. It needs eyes, on the same
manual pass as the outstanding foundation checklist.

## Build order

| Step | Delivers | Verified by |
|---|---|---|
| 1 | Theme migration, `injectThemeVars`, the three structural tests | tests 1–3, `tsc`, existing panel tests |
| 2 | Panel characterization baseline | snapshots written and inspected for substance |
| 3 | `wide` size — constant, persistence validation, header control | Chat view snapshot unchanged |
| 4 | Insights tab — segmented control, three blocks | Chat view snapshot unchanged |

## Global constraints

- **Chat remains the default tab.** Opening the panel must land where it lands today.
- **One conversation across all three sizes.** Resizing is a size change, not a different surface.
- React 16, `React.createElement`, class components, inline style objects — no JSX, no hooks.
- The panel is globally mounted and renders on screens with no other Nexus component present.
  Anything it depends on must be self-sufficient.
- No hardcoded colour may survive in the panel after step 1.

## Notes for whoever picks this up

- The shell's `fetchAll` uses a **positional** `Promise.all` destructuring. This spec does not
  touch it, but specs 4 and 5 do, and a careless merge there silently misaligns every variable
  after the insertion point.
- This spec does not touch `NexusOverview.tsx`, so it should merge cleanly alongside specs 4–6.
