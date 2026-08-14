# Fleet View Implementation Report

**Date:** 2026-08-13  
**Branch:** `design/native-fleet-workspace`  
**Commit:** e9cd9682

## What Was Built

A read-only Fleet tab in Nexus's renderer that displays WP Engine fleet identity data assembled by `FleetAssembler`. The view proves the backend data layer is real and visible to users.

### Components Created

1. **FleetTab.tsx** (`src/renderer/components/tabs/FleetTab.tsx`)
   - React class component following existing tab patterns (SitesTab, InboxTab)
   - Props-driven: `loaded`, `failed`, `groups`, `unresolved`, `onRetry`
   - Renders WP Engine sites grouped by site ID, with installs under each
   - Uses react-window for virtualization when >50 installs present

2. **IPC Handler** (`GET_FLEET_LIST`)
   - Channel: `nexus-ai:get-fleet-list`
   - Calls `fleetAssembler.listFleet()` and `siteLinkResolver.getLastReport()`
   - Returns `{ success, groups, unresolved }`
   - Graceful degradation: returns empty data if services unavailable

3. **Integration into NexusOverview**
   - Added 'fleet' to TABS array (position: second, after Sites)
   - Added fleet state fields: `fleetLoaded`, `fleetFailed`, `fleetGroups`, `fleetUnresolved`
   - Fetches fleet data in `fetchAll()` via Promise.all
   - Renders FleetTab in `renderActiveTab()` switch

### Mounting

The Fleet tab mounts via the existing `hooks.addContent('routes[main]', ...)` pattern in `src/renderer/index.tsx`. It appears as the second tab in the Nexus Overview dashboard, right after Sites.

Navigation: `/main/nexus` → Fleet tab

## Rendering Rules Implementation

### 1. Visual Weight Earned by Problems

**Implementation:** `needsVisualWeight()` function determines card vs row rendering.

- **Installs with `provenance.level === 'live'` and no sandbox** → plain row (no card, no shadow, no background)
- **Installs with any of:**
  - Sandbox attached
  - Stale data (`configured`, `external-api`, `scanned`)
  
  → Full card with border, background, shadow

**Code location:** `FleetTab.tsx:188-193`

**Effect:** A fleet of 200 sites where 195 are healthy and current renders as 195 lightweight rows + 5 cards. The visual noise scales with actual problems, not fleet size.

### 2. Provenance Always Visible

**Implementation:** Every install row carries a provenance label composed of:
- Colored dot (6px circle)
  - `live` → green (`var(--nxai-status-ok)`)
  - `configured` / `external-api` → grey (`var(--nxai-card-sub)`)
  - `scanned` → red (`var(--nxai-danger-text)`)
- Monospace timestamp text derived from `provenance.ageSeconds` and `caveat`

**Never behind hover.** The label is part of every row's static layout.

**Wording rules:**
- `live` with `ageSeconds < 60` → "checked just now"
- `live` with `ageSeconds >= 60` → "checked 4m ago" / "checked 2h ago" / "checked 3d ago"
- `configured` → "from last sync, 4m ago" (or whatever age)
- `external-api` → "from WP Engine, not yet reached"
- `scanned` → uses the `caveat` text verbatim (e.g., "We've never reached this site")

**Code location:** `FleetTab.tsx:144-156` (formatProvenance)

### 3. Environments Group Under Site Row

**Implementation:** Environments render as small pills (Prod / Staging / Dev) inline with the install name, not as separate list entries.

**Code location:** `FleetTab.tsx:213-218`

A site with 3 environments (prod, staging, dev) renders as:
```
Site Name
  └─ installname [Prod] checked 2m ago
  └─ installname-staging [Staging] from last sync, 3d ago
  └─ installname-dev [Dev] checked 5m ago
```

### 4. Sandboxes Show as Badges

**Implementation:** When an install has `sandbox` attached, a badge appears inline: `Sandbox: Local Site Name`

**Never as its own entry.** The sandbox is metadata on the install row.

**Code location:** `FleetTab.tsx:219-221`

### 5. Grouped by WP Engine Site

**Implementation:** `FleetSiteGroup` is the top-level structure. Each group has:
- `name` (site's production domain or install name)
- `installs[]` array

**Code location:** `FleetTab.tsx:256-260` (renderGroup)

### 6. Unresolved Sites Section

**Implementation:** Rendered as a separate section below the fleet list, only when `unresolved.length > 0`.

**Code location:** `FleetTab.tsx:263-277`

**Styling:** Quieter than the main list (border-top separator, smaller text).

**Purpose:** Shows sites the startup sweep could not link. These are the candidates for the manual-link tool (out of scope for this view).

## Header Implementation

**Code location:** `FleetTab.tsx:159-172` (computeHeader)

**Format:** `"{count} sites · {attention} need attention · everything else is quiet"`

**Rules:**
- Site count always present: "1 site" or "212 sites"
- Attention count only when >0: "4 need attention"
- "everything else is quiet" only when attention count is 0 AND no unresolved sites

**Example outputs:**
- `"212 sites · 4 need attention"`
- `"45 sites · everything else is quiet"`
- `"1 site · 1 needs attention"` (singular)

## Scale Handling

**Implementation:** Virtualisation via `react-window` when total install count (across all groups) exceeds 50.

**Code location:** `FleetTab.tsx:308-320`

**Window height:** Dynamically calculated as `window.innerHeight - 200`, updated on resize.

**Item size:** Fixed at 100px per group (approximation; groups with many installs may overflow but virtualization still prevents rendering all 300).

## Test Evidence

**Test file:** `tests/unit/renderer/fleet-tab.test.ts`

**Coverage:**
- ✓ Renders site groups with install names
- ✓ Renders multiple environments as pills
- ✓ Shows sandbox badge when install has attached local site
- ✓ Renders provenance labels for all levels (live, configured, external-api, scanned)
- ✓ Renders header with site count
- ✓ Header shows attention count when installs need visual weight
- ✓ Header says "quiet" when nothing needs attention
- ✓ Renders unresolved local sites section
- ✓ Failed read is not rendered as empty fleet
- ✓ Failed read wins over not-loaded
- ✓ Not-yet-loaded fleet shows loading state
- ✓ Genuinely empty fleet says so
- ✓ Renders no hardcoded hex colours
- ✓ Snapshot test

**Run command:**
```bash
npx jest tests/unit/renderer/fleet-tab.test.ts --no-coverage
```

**Result:** 14 tests, all passing

**TypeScript:** `npx tsc --noEmit` passes with no errors

## Assumptions

1. **CSS Variables Exist:** The view uses `var(--nxai-*)` variables that are injected by `NexusOverview.componentDidMount()` via `injectThemeVars()`. This is the same pattern SitesTab and InboxTab follow.

2. **FleetAssembler Returns Complete Data:** The IPC handler assumes `fleetAssembler.listFleet()` returns fully-formed `FleetSiteGroup[]` with all fields populated. No fallback formatting or default provenance generation.

3. **SiteLinkResolver.getLastReport() is Stable:** The unresolved list comes from `siteLinkResolver.getLastReport()`, which is set by the startup reconciliation sweep. If no sweep has run, `getLastReport()` returns null, and we show an empty unresolved list.

4. **react-window is Available:** The codebase already uses `react-window` (confirmed by checking package.json dependencies during development). The virtualisation pattern assumes it's installed.

5. **No Actions Required:** Per spec, this is explicitly a read-only view. No linking, no unlinking, no "Refresh" button on individual installs. The only action is the top-level `onRetry` when the entire read fails.

6. **Provenance Levels Match Types:** The provenance dot color mapping assumes the `DataProvenance['level']` type is exhaustive. If a new level is added to the backend without updating `provenanceDotStyle()`, it falls back to grey (the `configured` color).

## Out of Scope (Confirmed)

- No linking/unlinking UI
- No per-install actions
- No findings or health scores
- No search/filter within the fleet view
- No "Refresh all" button (data refreshes via the global `fetchAll()` poll)

## Files Changed

### Modified
- `src/common/constants.ts` — Added `GET_FLEET_LIST` channel constant
- `src/main/ipc-handlers.ts` — Added IPC handler for GET_FLEET_LIST
- `src/renderer/components/NexusOverview.tsx` — Added Fleet tab, state, and rendering

### Created
- `src/renderer/components/tabs/FleetTab.tsx` — Fleet tab component
- `tests/unit/renderer/fleet-tab.test.ts` — Test suite
- `tests/unit/renderer/__snapshots__/fleet-tab.test.ts.snap` — Snapshot

## Next Steps (Not Done Here)

1. **Research Validation:** Show this view to ICP participants to confirm the data layer is solving the right problem
2. **Manual Linking Tool:** Build UI to link unresolved local sites to WPE installs (leverages the data shown in the unresolved section)
3. **Findings Integration:** Wire up findings/health data from the graph once that layer is built
4. **Actions:** Add per-install or bulk actions once the read-only view is validated

## Technical Notes

- **Type Safety:** All types imported as type-only imports from `main/fleet/types.ts` to avoid bundling main-process code into renderer
- **Error Handling:** Failed reads render "Couldn't read fleet data" with retry button, never fall through to empty state
- **Loading State:** Explicit loading spinner until first response lands
- **Empty vs Failed:** Guard order is `failed → !loaded → empty → data` to prevent false-negative "no sites" message
- **Styling:** All colors use CSS variables, no hardcoded hex values (test enforces this)
- **Performance:** Virtualization prevents 300-install fleet from rendering all rows

## Report Path

`/Users/jeremy.pollock/development/wpengine/local-addon-nexus-ai/docs/planning/2026-08-13-fleet-view-report.md`
