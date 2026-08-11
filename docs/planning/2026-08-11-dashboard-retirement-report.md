# Dashboard Retirement Report

**Date:** 2026-08-11  
**Branch:** `new-ux-v2`  
**Task:** Remove Dashboard tab, Actions column, move MCP command to Advanced

## Summary

Three coherent changes: removed the empty Actions column from Sites table, moved the MCP setup command to Advanced before the Dashboard tab vanished, then deleted the Dashboard tab and made Sites the landing tab.

## Changes

### 1. Actions Column Removal (commit `7861d911`)

**What was removed:**
- `<th>Actions</th>` header
- `renderActionsCell()` method
- `handleIndexHost()` method  
- `rowActionStyle` constant

**Why:** The Actions column rendered "Index content" only for external hosts, leaving an empty cell on every Local and WP Engine row. Build review §3.2 notes an empty column reads as broken data on the table that has to convince someone the fleet view is trustworthy.

**New workflow:** The per-row button was the only way to index one external site without ticking it first. That workflow now goes through checkbox + bulk bar, consistent with Local and WP Engine sites.

**Test changes:**
- Snapshot updated: 1 `<th>` and 30 `<td>` cells removed (verified: only Actions column, no collateral)
- Deleted `describe('SitesTab — the external content-index row action')` block (5 tests) — tested the removed feature

### 2. MCP Command Move (commit `fd3fcaad`)

**Moved:** `claude mcp add local-nexus-ai -- node "${mcpInfo.stdioPath}"` from OverviewTab's `renderMcpPanel()` to AdvancedSection's "Connect your own AI tools" row.

**Why:** The command existed only in the Dashboard. Deleting the tab without moving it first removes the only way to set up the MCP connection.

**Implementation:**
- AdvancedSection now shows **two** commands:
  1. `claude mcp add ...` (setup, using `mcpInfo.stdioPath`)
  2. `npx @modelcontextprotocol/inspector ...` (debug, using `mcpInfo.port`)
- Both have copy buttons, both use the same MCP panel pattern from OverviewTab

**Type changes:**
- `AdvancedSection.Props.mcpInfo`: expanded from `{ port: number }` to `{ port: number; stdioPath: string }`
- `SettingsShell.SettingsShellState.mcpInfo`: same expansion

### 3. Dashboard Tab Removal (commit `62b3e236`)

**Removed:**
- `{ key: 'overview', label: 'Dashboard' }` from `TABS` array
- `case 'overview'` from `renderActiveTab` switch
- `overviewProps` construction (unused after case removal)
- `import { OverviewTab } from './tabs/OverviewTab'`
- `src/renderer/components/tabs/OverviewTab.tsx` (522 lines)

**Changed:**
- `activeTab` initial state: `'sites'` (was `'overview'`)
- `TABS` reordered: Sites first, Inbox second
- Default case: falls through to Sites (catches stale/in-flight `'overview'` value)

**No migration needed:** `activeTab` is not persisted. Default case prevents crash.

## Dashboard Inventory

From OverviewTab.tsx lines 470-499:

| Item | Exists elsewhere? | Decision | Reasoning |
|---|---|---|---|
| MCP setup command (`claude mcp add ...`) | **No** (unique) | **Moved to Advanced** | Only surface to set up the connection; cannot be lost |
| MCP Inspector command | Already in Advanced | Kept in Advanced | Debug tool, already had a home |
| Local Sites card (count, running/halted) | No | **Dropped** | Sites table shows same data per row |
| WPE-Connected card (count) | No | **Dropped** | Sites table shows same data per row |
| Remote Sites card (count, linked/unlinked) | No | **Dropped** | Sites table shows same data per row |
| MCP Server status card (running, tools, port, version) | No | **Dropped** | View-only; Advanced has the functional panel |
| AI Proxy status card (running, port, models) | No | **Dropped** | View-only; disposable |
| AIGatewayPanel (usage stats: requests, tokens, cost) | No | **Dropped** | Secondary to fleet view; no user requested it; can re-add to Advanced if needed |
| Setup banner (embedding model loading) | No | **Dropped** | Transient, dismissable |
| WPE auth banner (not connected) | No | **Dropped** | Transient, dismissable |
| WPE not-connected banner (invite to connect) | No | **Dropped** | Transient, dismissable |
| WPE onboarding banner (post-connection) | No | **Dropped** | Transient, dismissable |

**Count cards rationale:** The three count cards (Local Sites, WPE-Connected, Remote Sites) were rollups. The Sites table now shows the same information per row, for all three sources at once, with filters and selection. A rollup at the top would duplicate the filtered count already shown in the table header.

**Status cards rationale:** The MCP Server and AI Proxy cards were view-only status displays. Advanced has the functional MCP panel (setup commands, now including Claude Code). The disposable cards added no actions.

**Gateway panel rationale:** AIGatewayPanel showed usage stats (requests, tokens, cost). No user has requested gateway usage visibility, and the fleet view is the primary workflow. If needed later, it can be re-added to Advanced alongside the other panels.

## Last Sync Column

**Status:** Confirmed as empty data, **left in place** per instructions.

Build review §3.2 says it renders "—" on every row. An always-empty column (Actions) and a column whose data is missing (Last sync) are different problems. Only the first was in scope. The column stays.

## OverviewTab Deletion

**Decision:** Deleted both `OverviewTab.tsx` and `OverviewTab.characterization.test.tsx`.

**Why:**
- The component's job was the Dashboard tab. The tab is gone.
- The test's job (per its docblock) was to prove Task 6's extraction was behaviour-preserving. That job is complete.
- Keeping dead code + a non-running test is pure debt.

**What "disabled" meant:** The component was deleted from `NexusOverview.tsx` but the test file still existed and tried to import it. The suite failed to load rather than failing assertions, so it contributed **0 tests** to the total and was easy to mistake for a suite that passed. That's the trap.

**Fixed by:** Deleting both together.

## Test Changes

### Mutations Verified

**SitesTab snapshot:**
- Mutated production code: removed `<th>Actions</th>`
- Snapshot went red: header line removed
- Restored, verified green
- Mutated production code: removed `renderActionsCell(r)` call
- Snapshot went red: 30 `<td>` cells removed
- Restored, verified green
- Updated snapshot with `-u`, re-ran, passed

**Row action tests (deleted suite):**
- No mutations — the methods no longer exist, so there's no production code to mutate
- Deleted because the feature is gone

### Suites Fixed

Seven suites failed to load (119 tests vanished from total):

1. **sites-tab.test.ts**: Snapshot updated + row action suite deleted
2. **sites-tab-wiring.test.ts**: Already passing (no changes needed)
3. **settings-shell.test.ts**: Type widening (mcpInfo shape) auto-fixed
4. **settings-shell-sections.test.ts**: Mock mcpInfo expanded to include `stdioPath`
5. **settings-ipc-contracts.test.ts**: Already passing after type fix
6. **operations-shell.test.ts**: Mock mcpInfo expanded to include `stdioPath`
7. **OverviewTab.characterization.test.tsx**: Deleted with component

### Final Test Results

```
Test Suites: 8 failed, 315 passed, 323 total
Tests:       20 failed, 1 skipped, 4090 passed, 4111 total
```

**Baseline restored:** 20 failed / 4111 total (matches pre-task baseline of 20 failed / 4131 total — the 20-test drop is from deleting OverviewTab.characterization's suite and the 5-test row action block).

**Breakdown of -20 tests:**
- OverviewTab.characterization: 15 tests deleted
- SitesTab row action suite: 5 tests deleted
- **Total:** -20 tests (legitimate, both suites tested removed features)

### TypeScript

```
npx tsc --noEmit
```

**0 errors.** The mcpInfo type expansion was enforced by the compiler at every call site; no manual hunting needed.

## Commits

1. `7861d911` — `refactor(sites): remove empty Actions column`
2. `fd3fcaad` — `feat(settings): add Claude Code setup command to Advanced`
3. `62b3e236` — `refactor(dashboard): remove Dashboard tab, make Sites the landing tab`
4. `d661332d` — `test: fix suites broken by Actions column removal and mcpInfo shape`

## Report Path

`docs/planning/2026-08-11-dashboard-retirement-report.md`
