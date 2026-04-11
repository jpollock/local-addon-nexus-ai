# Dashboard Layout & Scroll Overhaul

**Branch:** `feature/dashboard-layout-scroll`  
**Status:** Planning

---

## Problem Statement

The Nexus AI Dashboard has three tabs (Overview, Activity, Operations), each with competing
scroll contexts and layout issues observed in the Local window (~480–500px tall).

**Root symptoms:**
1. **Double-scroll** — the outer content area scrolls AND inner components (EventTimeline,
   AIGatewayPanel) have their own fixed-height scrollbars. Users must manage two independent
   scroll zones simultaneously.
2. **TOKENS column gap** — Requests tab has a massive empty gap between MODEL and TOKENS
   because Tokens gets `flex: 1` in a ~1050px wide container, inheriting ~440px width.
3. **Activity right panel clipped** — StorageHealth panel is cut off at the bottom because
   the two-column grid doesn't stretch both columns to equal height.

---

## Measured Baseline (from code analysis)

### Root container — `NexusOverview.tsx`

```
// Outer wrapper (line 1975)
height: '100%', overflow: 'hidden'   ← correct, constrains to Local window

// Tab bar (line 1979)
flexShrink: 0, padding: '24px 32px 0'  ← fixed, ~100px

// Content area (line 1989)
flexGrow: 1, overflowY: 'auto'   ← THE OUTER SCROLL
padding: '24px 32px'
```

### Fixed heights inside the scrolling content area

| File | Component | Property | Current | Creates inner scroll? |
|---|---|---|---|---|
| `AIGatewayPanel.tsx:365` | Requests List | height | 360px | YES |
| `AIGatewayPanel.tsx:466` | Callers List | height | 360px | YES |
| `EventTimeline.tsx:361` | Timeline List | height | 400px | YES |
| `EventTimeline.tsx:171` | Detail expand | maxHeight | 120px | YES (acceptable) |

### Column widths — Requests tab (`AIGatewayPanel.tsx`)

| Column | Width | Problem? |
|---|---|---|
| Time | 110px fixed | — |
| Site | 120px fixed | — |
| Caller | 170px fixed | — |
| Model | 70px fixed | — |
| **Tokens** | **flex: 1** | **YES — inherits ~440px, creates gap** |
| Cost | 75px fixed | — |
| Duration | 65px fixed | — |

Total fixed: 610px. In ~1050px container, Tokens gets ~440px. Should be ~140px.

### Column widths — Callers tab (`AIGatewayPanel.tsx`)

| Column | Width | Problem? |
|---|---|---|
| Caller | 260px fixed | — |
| Requests | 90px fixed | — |
| Tokens | 110px fixed | — |
| Cost | 85px fixed | — |
| **Features** | **flex: 1** | Acceptable (tag content), but right-align gap visible |

### Activity tab two-column grid (`NexusOverview.tsx:1162`)

```
gridTemplateColumns: '2fr 1fr'   // EventTimeline | TopIssues+StorageHealth
gap: '16px'
marginBottom: '24px'
```

EventTimeline height is `400px` fixed. The right column grows taller than this, but the
grid row height is driven by whichever column is taller — so the left column (EventTimeline)
is always capped at 400px while the right can extend below, causing the visual clip.

---

## Design Decision: Tab-fills-viewport vs. Single-scroll

Two valid approaches:

**Option A — Single outer scroll (simpler)**  
Remove inner fixed heights. Everything renders at natural size and scrolls together via
the outer `overflowY: auto` container. Pro: simple. Con: very tall pages on small screens.

**Option B — Each tab fills viewport, scrolls independently (preferred)**  
The content area changes from `overflowY: auto` to `overflow: hidden`. Each tab panel
fills the remaining height with `height: 100%` and scrolls internally. Virtual lists fill
available height dynamically. No outer scroll at all — the window never moves.

**Decision: Option B.** Local's window is small (~480px usable below the tab bar).
A single outer scroll forces users to scroll past stat cards to reach the table on every
visit. With tab-fills-viewport, each tab is a complete view, no outer scroll needed.

---

## Execution Plan

### Phase 1 — Tokens column width (5 min, low risk)

**File:** `src/renderer/components/AIGatewayPanel.tsx`

Replace `flex: 1` on the Tokens header cell and every Tokens data cell:

```tsx
// BEFORE (header)
React.createElement('div', { style: { ...thStyle, flex: 1, textAlign: 'right' } }, 'Tokens'),

// AFTER
React.createElement('div', { style: { ...thStyle, width: '150px', flexShrink: 0, textAlign: 'right' } }, 'Tokens'),
```

Same change in the data row (renderRequestsTab, the `flex: 1` cell).

Add a `flex: 1` spacer div after Duration in both header and data rows — this absorbs any
remaining panel width cleanly rather than leaving orphaned pixels:

```tsx
// Trailing spacer — absorbs leftover panel width
React.createElement('div', { style: { flex: 1 } }),
```

**Lines affected:** header row ~line 359, data row ~line 407 in AIGatewayPanel.tsx.

### Phase 2 — Remove react-window from AIGatewayPanel (15 min, medium)

**File:** `src/renderer/components/AIGatewayPanel.tsx`

Current data volumes: < 50 rows typical. Virtual scrolling adds zero perf benefit and causes
the inner-scroll UX problem. Replace both `FixedSizeList` usages with a plain `div` that
fills available height via flex.

```tsx
// BEFORE — renderRequestsTab
React.createElement(List, {
  height: 360,
  itemCount: records.length,
  itemSize: 38,
  width: '100%',
  children: Row,
})

// AFTER
React.createElement(
  'div',
  { style: { overflowY: 'auto', flex: 1, minHeight: 0 } },
  ...records.map((r, i) => renderRequestRow(r, i)),
)
```

The outer tab panel (renderRequestsTab return value) becomes:
```tsx
// Flex column that fills whatever height the tab gives it
React.createElement('div', { style: { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 } },
  /* header row */,
  /* scrollable body div */,
)
```

Remove `import { FixedSizeList as List } from 'react-window'` from AIGatewayPanel.tsx
(keep import in AIGatewayUsagePanel.tsx and AIGatewayByCallerPanel.tsx — those are still
used though they're no longer rendered in NexusOverview).

### Phase 3 — Tab-fills-viewport layout in NexusOverview (20 min, high impact)

**File:** `src/renderer/components/NexusOverview.tsx`

**3a. Content area: stop outer scrolling**

```tsx
// BEFORE (line 1989)
style: { flexGrow: 1, overflowY: 'auto', padding: '24px 32px' }

// AFTER — no scroll here; individual tabs scroll
style: { flexGrow: 1, overflow: 'hidden', padding: 0, display: 'flex', flexDirection: 'column' }
```

**3b. Each tab panel gets its own scroll container**

Wrap each `renderXxxTab()` return value in:
```tsx
React.createElement('div', {
  style: {
    flex: 1,
    overflowY: 'auto',
    padding: '24px 32px',
    boxSizing: 'border-box',
  },
}, /* tab content */)
```

This is cleanly done by wrapping inside `renderTabContent()` — one place, affects all tabs.

**3c. AIGatewayPanel height**

The panel now lives inside a scrolling tab div. Its `containerStyle` stays as-is
(no fixed height). The inner list (Phase 2) uses `flex: 1` to fill. The panel as a whole
expands naturally and the tab div scrolls.

**3d. Overview tab stat cards → compact**

Current Overview tab content stack:
- `renderIndexCard` + `renderGraphCard` + `renderWpeSyncCard` in 3-column grid (~120px)
- `AIGatewayPanel` (~600px with list)

Total ~720px in a ~380px usable area (480px minus tab bar, padding). After Phase 3:
- Stat cards stay compact (they already are at ~120px)
- AI Gateway panel: its list fills remaining height (`flex: 1, minHeight: 0`)
- Result: stat cards visible, table takes remaining space — no outer scroll at all

### Phase 4 — Activity tab layout fix (15 min, medium)

**File:** `src/renderer/components/NexusOverview.tsx` `renderActivityTab()`  
**File:** `src/renderer/components/EventTimeline.tsx`

**4a. Make Activity tab fill height**

The two-column grid already works for the outer structure. The fix: make the grid itself
fill the available tab height so both columns stretch equally.

```tsx
// The grid wrapping EventTimeline + right panels
style: {
  display: 'grid',
  gridTemplateColumns: '2fr 1fr',
  gap: '16px',
  // ADD:
  flex: 1,
  minHeight: 0,
  alignItems: 'stretch',  // Both columns same height
}
```

**4b. EventTimeline — dynamic height**

EventTimeline's container needs `height: 100%` and `display: flex, flexDirection: column`.
The inner `FixedSizeList` height: 400px becomes:

```tsx
// Replace FixedSizeList with plain scrollable div (same as Phase 2)
// OR: keep react-window but calculate height from container ref

// Simple approach — plain div:
React.createElement('div', {
  style: { flex: 1, overflowY: 'auto', minHeight: 0 }
}, events.map(renderEventRow))
```

EventTimeline containerStyle adds `display: 'flex', flexDirection: 'column', height: '100%'`.

**4c. Right column — stretch to grid row height**

The flex column containing TopIssues + StorageHealth:
```tsx
style: {
  display: 'flex',
  flexDirection: 'column',
  gap: '16px',
  // ADD:
  minHeight: 0,
  overflow: 'auto',  // If combined content taller than left column, scroll
}
```

StorageHealth gets `flexShrink: 0` so it doesn't compress. TopIssues gets `flex: 1` to fill.

**4d. EventStatsCards — keep fixed height**

The three event stat cards stay at the top of the Activity tab (outside the grid, above it).
They're compact and don't need to change.

### Phase 5 — Operations tab (5 min, low)

Operations is a long-scrolling single-column layout. With Phase 3 applied (tab scrolls independently),
this already works correctly. The only cleanup: remove any hardcoded `marginBottom` on the last
section that adds unnecessary whitespace at the bottom.

---

## File Change Summary

| File | Phase | Change |
|---|---|---|
| `AIGatewayPanel.tsx` | 1 | Tokens width: flex→150px; trailing spacer |
| `AIGatewayPanel.tsx` | 2 | Remove react-window; plain scrollable div |
| `NexusOverview.tsx` | 3 | Content area no outer scroll; tab wrapper scrolls |
| `NexusOverview.tsx` | 4 | Activity grid fills height; alignItems: stretch |
| `EventTimeline.tsx` | 4 | height:100% container; remove FixedSizeList height |

**Not changing:**
- `AIGatewayUsagePanel.tsx` / `AIGatewayByCallerPanel.tsx` — still referenced but no longer
  rendered in NexusOverview (AIGatewayPanel replaced them). Leave intact.
- `TopIssuesPanel.tsx`, `StorageHealthPanel.tsx` — flexible by default, no changes needed.
- `EventStatsCards.tsx` — compact stat cards, no changes needed.

---

## Risk Assessment

| Phase | Risk | Mitigation |
|---|---|---|
| 1 — Tokens width | Low | Pure visual, no logic change |
| 2 — Remove react-window | Medium | Verify render performance with 50+ rows |
| 3 — Tab viewport fill | High | Test all three tabs; check padding/spacing |
| 4 — Activity grid | Medium | Both columns must stretch; test with few vs many events |
| 5 — Operations | Low | Already works, minor cleanup |

---

## Execution Order

1. Phase 1 (tokens) — quick win, proves changes work
2. Phase 2 (remove react-window from AIGatewayPanel)
3. Phase 3 (tab viewport model) — core structural change
4. Phase 4 (activity layout)
5. Phase 5 (operations cleanup)
6. Cross-tab visual QA: verify no outer scroll on any tab, verify inner scroll works
7. Verify on small window (resize Local window to ~400px height)
