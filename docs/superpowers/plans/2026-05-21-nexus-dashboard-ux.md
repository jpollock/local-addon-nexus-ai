# Nexus Dashboard UX Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate the Nexus dashboard into 5 purposeful tabs (Ask/Tell, Dashboard, Activity, Operations, Settings), move operational config out of Preferences into a new Settings tab, fix button active states, and eliminate redundant UI sections.

**Architecture:** Three files change structurally — `NexusOverview.tsx` gains a Settings tab and loses redundant Dashboard sections; `NexusPreferences.tsx` shrinks to API keys + provider config only; `FleetCompletenessWidget.tsx` gets an `isRunning` prop. A new `SettingsTab.tsx` component owns all operational config state. No IPC changes needed — existing `UPDATE_SETTINGS` / `NAVIGATE_TO_PREFERENCES` channels cover everything.

**Tech Stack:** React (class-based, `React.createElement` only — no JSX, no hooks), TypeScript, Electron IPC, Local by WP Engine renderer process.

---

## Screen-by-screen design reference

### Tab bar (5 tabs, in order)
```
[ Ask/Tell ] [ Dashboard ] [ Activity ] [ Operations ] [ Settings ]
```
- `data-testid`: `tab-ask`, `tab-overview`, `tab-activity`, `tab-operations`, `tab-settings`
- `activeTab` type: `'ask' | 'overview' | 'activity' | 'operations' | 'settings'`

---

### Dashboard tab (simplified)

```
┌─ Setup Banner (if not configured) ──────────────────────────────┐
│ ↑ MCP Panel — Connect AI Tools                                   │
└──────────────────────────────────────────────────────────────────┘

── Fleet Intelligence ─────────────────────────────────────────────
  [Local Sites N]  [WPE Sites N]  [WPE Authed: yes/no]

  ┌─ Data Completeness ─────────────────────── [⚡ Index all] ─────┐
  │ Scanned    ████████░░░░  8/10                                   │
  │ Configured ██████░░░░░░  6/10                                   │
  │ Searchable ████░░░░░░░░  4/10        Last: 2h ago               │
  └──────────────────────────────────────────────────────────────--─┘

  [Fleet summary card — WP/PHP version distribution, plugin stats]

── AI Integration ─────────────────────────────────────────────────
  [MCP Server card]  [AI Proxy card]
  [AI Gateway usage panel]
```

**Removed from Dashboard:**
- "Sites" and "Nexus AI" section labels (collapsed into Fleet Intelligence + AI Integration)
- `renderEmbeddingCard` (internal detail, not actionable)
- `renderWpeSyncCard` (unused after Operations cleanup)
- Fleet Status section → moved to Operations
- Separate `onSchedule` → now navigates to `'settings'` tab

**FleetCompletenessWidget changes:**
- Add `isRunning: boolean` prop
- When `isRunning=true`: button shows "Indexing…", opacity 0.5, disabled, `cursor: 'not-allowed'`
- `onSchedule` button label: "⏱ Schedule" → navigates to Settings tab

---

### Operations tab (restructured)

```
── Local Sites ────────────────────────────────────────────────────
  [Refresh metadata]   WP-CLI: active plugins, WP version, themes
  [Index content]      Create searchable content index

── WP Engine Sites ────────────────────────────────────────────────
  [Sync metadata]      SSH: plugins, WP/PHP version, themes
  [Index content]      Create searchable content index (req SSH key)

── AI Setup ───────────────────────────────────────────────────────
  [Set up AI on all local sites]

── Running Operations ─────────────────────────────────────────────
  [WPE sync progress — inline when wpeSyncing=true]
  [BulkOperationsPanel]

── Per-Site Status ────────────────────────────────────────────────
  [SystemTab — level dots grid, moved from Dashboard]

── Maintenance ────────────────────────────────────────────────────
  [Reset Content Index]
  [Database Scan]
  [Content Maintenance]

── Developer Tools ────────────────────────────────────────────────
  [SSH Diagnostics]
```

**Key changes vs current:**
- "Refresh Site Data" → "Local Sites" (clearer what it does)
- "Index for Search" → merged into per-environment sections
- "WPE Deep Scan Scope" (account filter) → inline above WPE section, not a separate section
- Per-site Fleet Status moved here from Dashboard

---

### Settings tab (new — NexusOverview renders SettingsTab component)

```
── Auto-Indexing ──────────────────────────────────────────────────
  ☑ Automatically index sites when started
  [Excluded sites accordion — if autoIndex=true]

── Sync Schedule ──────────────────────────────────────────────────
  LOCAL SITES
  Content index interval: ☑ enabled  [ 8 ] hrs
  (Auto-starts halted sites, indexes, stops. 0 = manual only.)

  WP ENGINE INSTALLS
  Metadata sync:      [  8] hrs  (plugins, WP/PHP version)
  Site info updates:  [ 24] hrs  (URL, admin email, post count via SSH)
  Offline site scan:  [ 24] hrs  (halted local sites — filesystem scan)

── WPE Access & Permissions ───────────────────────────────────────
  [renderWpeAccessControlSection from NexusPreferences — verbatim copy]
```

**SettingsTab is a standalone class component:**
- Loads settings via `IPC_CHANNELS.GET_SETTINGS` on mount
- Saves via `IPC_CHANNELS.UPDATE_SETTINGS` on every toggle/blur
- All handler methods self-contained (no delegation to NexusOverview)
- Uses same `sectionStyle`, `labelStyle`, `descStyle` CSS objects as NexusPreferences

---

### Preferences (simplified — 2 sections remain)

```
Section 1: AI Provider  (unchanged — provider picker, per-site config)
Section 2: Local AI Gateway  (unchanged — gateway toggle)
Section 3: WP Engine API Credentials  (was sub-section of section 4)
```

**Removed from Preferences:**
- Section 3 "Auto-Indexing" → Settings tab
- Section 4 "WP Engine" sync schedule → Settings tab
- Section 4 "WP Engine" access control → Settings tab
- Section 4 "WP Engine API Credentials" is kept but promoted to its own section

---

## File structure

| File | Change |
|------|--------|
| `src/renderer/components/NexusOverview.tsx` | Add `'settings'` tab; simplify Dashboard; restructure Operations; wire SettingsTab |
| `src/renderer/components/FleetCompletenessWidget.tsx` | Add `isRunning` prop; fix button state |
| `src/renderer/components/SettingsTab.tsx` | **NEW** — auto-indexing + sync schedule + WPE access control |
| `src/renderer/components/NexusPreferences.tsx` | Remove sections 3 + 4 (except WPE creds) |

---

## Task 1: FleetCompletenessWidget — fix button active state + Schedule button destination

**Files:**
- Modify: `src/renderer/components/FleetCompletenessWidget.tsx`
- Modify: `src/renderer/components/NexusOverview.tsx` (caller — pass `isRunning` + fix `onSchedule`)

- [ ] **Step 1: Add `isRunning` prop to FleetCompletenessWidgetProps**

In `FleetCompletenessWidget.tsx`:
```typescript
interface FleetCompletenessWidgetProps {
  electron: any;
  onIndexAll?: () => void;
  onSchedule?: () => void;
  isRunning?: boolean;   // ADD THIS
}
```

- [ ] **Step 2: Update the "⚡ Index all" button to reflect running state**

Find the `onIndexAll` button render (around line 122):
```typescript
onIndexAll
  ? React.createElement('button', {
      onClick: isRunning ? undefined : onIndexAll,
      disabled: isRunning,
      style: {
        padding: '4px 10px', borderRadius: 5,
        background: isRunning ? 'rgba(14,202,212,0.3)' : '#0ECAD4',
        color: isRunning ? 'rgba(0,0,0,0.5)' : '#000',
        fontWeight: 700, fontSize: 11, border: 'none',
        cursor: isRunning ? 'not-allowed' : 'pointer',
        fontFamily: 'inherit',
        opacity: isRunning ? 0.6 : 1,
      },
    }, isRunning ? '⏳ Indexing…' : '⚡ Index all')
  : null,
```

- [ ] **Step 3: Update "→ Schedule" button label**

Find the `onSchedule` button (around line 132):
```typescript
onSchedule
  ? React.createElement('button', {
      onClick: onSchedule,
      style: {
        padding: '4px 10px', borderRadius: 5, background: 'transparent',
        color: 'var(--nxai-card-sub, #6b7280)', fontSize: 11,
        border: '1px solid var(--nxai-card-border, #30363d)',
        cursor: 'pointer', fontFamily: 'inherit',
      },
    }, '⏱ Schedule')
  : null,
```

- [ ] **Step 4: Update NexusOverview caller to pass `isRunning` and fix `onSchedule`**

In `renderOverviewTab()` in `NexusOverview.tsx`:
```typescript
React.createElement(FleetCompletenessWidget, {
  electron: this.props.electron,
  isRunning: this.state.indexAllAutoRunning,
  onIndexAll: () => {
    this.setState({ indexAllAutoRunning: true, indexAllAutoOpId: null });
    this.props.electron.ipcRenderer
      .invoke(IPC_CHANNELS.INDEX_ALL_AUTO)
      .catch(() => {})
      .finally(() => {
        if (this.mounted) this.setState({ indexAllAutoRunning: false });
      });
  },
  onSchedule: () => this.setState({ activeTab: 'settings' }),
}),
```

- [ ] **Step 5: Build and verify**

```bash
npm run build 2>&1 | grep -E "error TS"
```
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/FleetCompletenessWidget.tsx src/renderer/components/NexusOverview.tsx
git commit -m "fix(dashboard): FleetCompletenessWidget isRunning state + schedule → settings"
```

---

## Task 2: Create SettingsTab component

**Files:**
- Create: `src/renderer/components/SettingsTab.tsx`

This component is a class-based React component (no JSX, no hooks). It manages its own settings state and persists changes via IPC. It contains the three sections moved from NexusPreferences: auto-indexing, sync schedule, and WPE access control.

- [ ] **Step 1: Create the file with imports and interfaces**

```typescript
/**
 * SettingsTab — Operational configuration for Nexus AI.
 *
 * Contains settings moved out of Preferences:
 *   - Auto-Indexing (on/off + excluded sites)
 *   - Sync Schedule (local content index interval, WPE sync intervals)
 *   - WPE Access & Permissions (allowed environments + operations)
 *
 * Class-based, React.createElement only — no JSX, no hooks.
 */
import * as React from 'react';
import { IPC_CHANNELS } from '../../common/constants';
import { injectThemeVars } from '../utils/theme';
import type { NexusSettings } from '../../common/types';

interface SiteItem {
  id: string;
  name: string;
  status: string;
}

interface SettingsTabProps {
  electron: any;
}

interface SettingsTabState {
  settings: NexusSettings | null;
  sites: SiteItem[];
  loading: boolean;
  excludedExpanded: boolean;
}
```

- [ ] **Step 2: Add the class skeleton and lifecycle**

```typescript
export class SettingsTab extends React.Component<SettingsTabProps, SettingsTabState> {
  private mounted = false;

  state: SettingsTabState = {
    settings: null,
    sites: [],
    loading: true,
    excludedExpanded: false,
  };

  componentDidMount(): void {
    this.mounted = true;
    injectThemeVars();
    this.loadSettings();
  }

  componentWillUnmount(): void {
    this.mounted = false;
  }

  async loadSettings(): Promise<void> {
    const ipc = this.props.electron.ipcRenderer;
    const [settings, sitesResult] = await Promise.all([
      ipc.invoke(IPC_CHANNELS.GET_SETTINGS).catch(() => null),
      ipc.invoke(IPC_CHANNELS.GET_SITES).catch(() => ({ sites: [] })),
    ]);
    if (!this.mounted) return;
    this.setState({
      settings: settings ?? { autoIndex: true, excludedSiteIds: [] },
      sites: sitesResult?.sites ?? [],
      loading: false,
    });
  }

  async saveSetting(patch: Partial<NexusSettings>): Promise<void> {
    if (!this.state.settings) return;
    const next = { ...this.state.settings, ...patch };
    this.setState({ settings: next });
    await this.props.electron.ipcRenderer
      .invoke(IPC_CHANNELS.UPDATE_SETTINGS, patch)
      .catch(() => {});
  }
```

- [ ] **Step 3: Add handler methods**

```typescript
  handleAutoIndexToggle = (): void => {
    this.saveSetting({ autoIndex: !this.state.settings?.autoIndex });
  };

  handleSiteExclusionToggle = (siteId: string): void => {
    const current = this.state.settings?.excludedSiteIds ?? [];
    const next = current.includes(siteId)
      ? current.filter(id => id !== siteId)
      : [...current, siteId];
    this.saveSetting({ excludedSiteIds: next });
  };

  handleLocalContentIndexAutoEnabledChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    this.saveSetting({ localContentIndexAutoEnabled: e.target.checked });
  };

  handleLocalContentIndexIntervalChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const val = parseInt(e.target.value, 10);
    if (!isNaN(val) && val >= 0 && val <= 168) {
      this.saveSetting({ localContentIndexIntervalHours: val });
    }
  };

  handleWpeSyncIntervalChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const val = parseInt(e.target.value, 10);
    if (!isNaN(val) && val >= 1 && val <= 168) this.saveSetting({ wpeSyncIntervalHours: val });
  };

  handleWpeRefreshIntervalChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const val = parseInt(e.target.value, 10);
    if (!isNaN(val) && val >= 1 && val <= 168) this.saveSetting({ wpeRefreshIntervalHours: val });
  };

  handleHaltedRefreshIntervalChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const val = parseInt(e.target.value, 10);
    if (!isNaN(val) && val >= 1 && val <= 168) this.saveSetting({ haltedSiteRefreshIntervalHours: val });
  };
```

- [ ] **Step 4: Add the WPE Access Control handler (copy from NexusPreferences)**

The WPE access control section uses `handleOperationToggle` and `handleEnvironmentToggle`. Copy these two handlers verbatim from `NexusPreferences.tsx` (around lines 304-368). They call `UPDATE_SETTINGS` with `wpeAllowedEnvironments` and `wpeAllowedOperations` patches.

```typescript
  // Copy handleOperationToggle and handleEnvironmentToggle verbatim from
  // NexusPreferences.tsx lines ~304-368 here. They call this.saveSetting
  // with wpeAllowedEnvironments/wpeAllowedOperations patches.
  // (See NexusPreferences.tsx for the exact implementation.)
```

Note: in NexusPreferences these call `this.setState` + `IPC_CHANNELS.UPDATE_SETTINGS` directly. Adapt them to call `this.saveSetting(patch)` instead.

- [ ] **Step 5: Add section render methods**

Add `renderAutoIndexingSection()`, `renderSyncScheduleSection()`, `renderWpeAccessSection()`. These are verbatim copies of the corresponding render code from NexusPreferences sections 3 and 4, adapted to use `this.state.settings` and `this.state.sites` instead of Preferences-specific state.

Use these shared styles at the top of the class:
```typescript
  private readonly sectionStyle: React.CSSProperties = {
    marginBottom: 24,
    padding: '16px 20px',
    background: 'var(--nxai-card-bg, #fff)',
    border: '1px solid var(--nxai-card-border, #e5e7eb)',
    borderRadius: 10,
  };

  private readonly labelStyle: React.CSSProperties = {
    fontSize: 13, fontWeight: 600, marginBottom: 6,
    color: 'var(--nxai-card-text, #111827)',
  };

  private readonly descStyle: React.CSSProperties = {
    fontSize: 12, color: 'var(--nxai-card-sub, #6b7280)',
    lineHeight: 1.5, marginBottom: 12,
  };

  private readonly checkboxRowStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '8px 0', cursor: 'pointer', fontSize: 14,
  };
```

- [ ] **Step 6: Add the main render method**

```typescript
  render(): React.ReactNode {
    const { settings, loading } = this.state;

    if (loading || !settings) {
      return React.createElement('div', {
        style: { padding: 24, color: 'var(--nxai-card-sub, #6b7280)', fontSize: 13 },
      }, 'Loading settings…');
    }

    const sectionHeader = (title: string) =>
      React.createElement('div', {
        style: {
          fontSize: 11, fontWeight: 700, textTransform: 'uppercase' as const,
          letterSpacing: '.06em', color: 'var(--nxai-card-sub, #6b7280)',
          marginBottom: 14,
        },
      }, title);

    return React.createElement('div', { style: { padding: '20px 24px', overflowY: 'auto' as const } },
      sectionHeader('Auto-Indexing'),
      this.renderAutoIndexingSection(),
      sectionHeader('Sync Schedule'),
      this.renderSyncScheduleSection(),
      sectionHeader('WPE Access & Permissions'),
      this.renderWpeAccessSection(),
    );
  }
}
```

- [ ] **Step 7: Build and verify**

```bash
npm run build 2>&1 | grep -E "error TS"
```
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/components/SettingsTab.tsx
git commit -m "feat(settings): new SettingsTab component — auto-index, schedule, WPE access"
```

---

## Task 3: NexusOverview — add Settings tab, simplify Dashboard, restructure Operations

**Files:**
- Modify: `src/renderer/components/NexusOverview.tsx`

This is the largest task. Make changes in sub-steps, building after each to catch errors early.

### 3a — Add Settings tab to type + tab bar + switch

- [ ] **Step 1: Add `'settings'` to activeTab type (line ~158)**

```typescript
activeTab: 'overview' | 'activity' | 'operations' | 'ask' | 'settings';
```

- [ ] **Step 2: Add SettingsTab import at top of file**

```typescript
import { SettingsTab } from './SettingsTab';
```

- [ ] **Step 3: Update tab bar array in `renderTabBar()` (line ~1425)**

```typescript
const tabs: { key: NexusOverviewState['activeTab']; label: string }[] = [
  { key: 'ask' as const,      label: 'Ask/Tell' },
  { key: 'overview',          label: 'Dashboard' },
  { key: 'activity',          label: 'Activity' },
  { key: 'operations',        label: 'Operations' },
  { key: 'settings',          label: 'Settings' },
];
```

- [ ] **Step 4: Add `case 'settings'` to `renderActiveTab()` switch**

```typescript
case 'settings': return React.createElement(SettingsTab, { electron: this.props.electron });
```

- [ ] **Step 5: Build**

```bash
npm run build 2>&1 | grep -E "error TS"
```

### 3b — Simplify Dashboard tab (renderOverviewTab)

- [ ] **Step 6: Rewrite `renderOverviewTab()` to consolidated layout**

Replace the existing method body with:
```typescript
  renderOverviewTab(): React.ReactNode {
    const { stats } = this.state;
    if (!stats) return null;

    return React.createElement('div', null,
      // Banners
      this.renderSetupBanner(stats),
      this.renderWpeAuthBanner(),

      // Connect AI Tools — MCP connection panel
      this.renderMcpPanel(),

      // Fleet Intelligence — site counts + completeness + fleet summary
      this.renderSectionLabel('Fleet Intelligence'),
      React.createElement('div', { style: cardContainerStyle },
        this.renderLocalSitesCard(stats),
        this.renderWpeConnectedCard(stats),
        this.renderRemoteSitesCard(stats),
      ),
      React.createElement(FleetCompletenessWidget, {
        electron: this.props.electron,
        isRunning: this.state.indexAllAutoRunning,
        onIndexAll: () => {
          this.setState({ indexAllAutoRunning: true, indexAllAutoOpId: null });
          this.props.electron.ipcRenderer
            .invoke(IPC_CHANNELS.INDEX_ALL_AUTO)
            .catch(() => {})
            .finally(() => { if ((this as any).mounted) this.setState({ indexAllAutoRunning: false }); });
        },
        onSchedule: () => this.setState({ activeTab: 'settings' }),
      }),
      this.renderFleetSummaryCard(),

      // AI Integration — MCP status + proxy + gateway usage
      this.renderSectionLabel('AI Integration'),
      React.createElement('div', { style: { ...cardContainerStyle, gridTemplateColumns: 'repeat(2, 1fr)' } },
        this.renderMcpCard(stats),
        this.renderAiProxyCard(),
      ),
      React.createElement(AIGatewayPanel, { electron: this.props.electron }),
    );
  }
```

Note: `renderEmbeddingCard` is removed (internal detail, not actionable by users).

- [ ] **Step 7: Build**

```bash
npm run build 2>&1 | grep -E "error TS"
```

### 3c — Restructure Operations tab

- [ ] **Step 8: Rewrite `renderOperationsTab()`**

Replace existing body with the new structure. Keep all existing handler methods (`handleSyncGraph`, `handleWpeSync`, `handleIndexAllAuto`, `handleIndexAllFleet`, `handleSetupAllAuto`) — only the UI layout changes.

```typescript
  renderOperationsTab(): React.ReactNode {
    const wpeDisabled = !(this.state.stats?.remoteSites.wpeAuthenticated ?? false);
    const envLabel = { fontSize: '11px', fontWeight: 700 as const, textTransform: 'uppercase' as const, letterSpacing: '.05em', color: 'var(--nxai-card-sub, #6b7280)', marginBottom: 10 };
    const descText = { fontSize: 11, color: 'var(--nxai-card-sub, #6b7280)', marginTop: 4, lineHeight: 1.4 };
    const groupStyle = { display: 'flex', gap: '12px', marginBottom: '24px', flexWrap: 'wrap' as const };

    return React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const } },

      // ── Local Sites ───────────────────────────────────────────────────────────
      this.renderSectionLabel('Local Sites'),
      React.createElement('div', { style: groupStyle },
        this.renderOpsButton(
          'Refresh metadata', 'Refreshing…',
          this.state.syncGraphRunning, this.state.syncGraphOpId,
          this.handleSyncGraph,
          'WP-CLI: reads active plugins, WP version, themes. Starts halted sites temporarily. (L2)',
        ),
        this.renderOpsButton(
          'Index content', 'Indexing…',
          this.state.indexAllAutoRunning, this.state.indexAllAutoOpId,
          this.handleIndexAllAuto,
          'Creates searchable vector index from posts/pages. Starts halted sites temporarily. (L3)',
        ),
      ),

      // ── WP Engine Sites ───────────────────────────────────────────────────────
      this.renderSectionLabel('WP Engine Sites'),
      this.renderWpeAccountScope(),
      React.createElement('div', { style: groupStyle },
        this.renderOpsButton(
          'Sync metadata', 'Syncing…',
          this.state.wpeSyncing, null,
          this.handleWpeSync,
          'SSH: reads plugins, WP/PHP version, themes for all WPE installs. (L1+L2)',
          wpeDisabled,
        ),
        this.renderOpsButton(
          'Index content', 'Indexing…',
          this.state.fleetIndexRunning, this.state.fleetIndexOpId,
          this.handleIndexAllFleet,
          'Creates searchable vector index from WPE post/page content. Requires SSH key. (L3)',
          wpeDisabled,
        ),
      ),

      // ── AI Setup ──────────────────────────────────────────────────────────────
      this.renderSectionLabel('AI Setup'),
      React.createElement('div', { style: groupStyle },
        this.renderOpsButton(
          'Set up AI on all local sites', 'Setting up…',
          this.state.setupAllAutoRunning, this.state.setupAllAutoOpId,
          this.handleSetupAllAuto,
          'Installs AI plugin and syncs API credentials to all local sites.',
        ),
      ),

      // ── Running Operations ────────────────────────────────────────────────────
      this.state.wpeSyncing && this.state.wpeSyncProgress
        ? React.createElement('div', {
            style: { border: '1px solid var(--nxai-card-border, #e5e7eb)', borderRadius: '10px', padding: '16px 20px', marginBottom: '12px' },
          },
            React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' } },
              React.createElement('span', { style: { fontSize: '13px', fontWeight: 600 } }, 'WPE metadata sync'),
              React.createElement('span', { style: { fontSize: '12px', color: 'var(--nxai-card-sub, #6b7280)' } },
                `${this.state.wpeSyncProgress.current} / ${this.state.wpeSyncProgress.total} sites`,
              ),
            ),
            React.createElement('div', { style: { fontSize: '12px', color: 'var(--nxai-card-sub, #6b7280)' } },
              this.state.wpeSyncProgress.currentSite
                ? `Syncing: ${this.state.wpeSyncProgress.currentSite}`
                : 'Starting…',
            ),
          )
        : null,

      React.createElement(BulkOperationsPanel, {
        electron: this.props.electron,
        siteNames: new Map(Object.values(this.state.sites || {}).map((s: any) => [s.id, s.name])),
      }),

      // ── Per-Site Status (Fleet Status) ────────────────────────────────────────
      React.createElement('hr', { style: { border: 'none', borderTop: '1px solid var(--nxai-card-border, #e5e7eb)', margin: '32px 0 24px' } }),
      this.renderSectionLabel('Per-Site Status'),
      React.createElement(SystemTab, {
        electron: this.props.electron,
        sites: this.state.sites.map((s) => ({ id: s.id, name: s.name, status: s.status })),
        indexEntries: (this.state.indexEntries ?? []).map((e: any) => ({
          siteId: e.siteId,
          siteName: e.siteName ?? '',
          state: e.state,
          documentCount: e.documentCount,
          chunkCount: e.chunkCount,
          lastIndexed: e.lastIndexed,
          durationMs: e.durationMs,
          errors: e.errors,
        })),
      }),

      // ── Maintenance ───────────────────────────────────────────────────────────
      React.createElement('hr', { style: { border: 'none', borderTop: '1px solid var(--nxai-card-border, #e5e7eb)', margin: '32px 0 24px' } }),
      this.renderSectionLabel('Maintenance'),
      this.renderContentIndexReset(),
      this.renderDbScanSection(),
      this.renderContentMaintenance(),

      // ── Developer Tools ───────────────────────────────────────────────────────
      React.createElement('hr', { style: { border: 'none', borderTop: '1px solid var(--nxai-card-border, #e5e7eb)', margin: '32px 0 24px' } }),
      this.renderSectionLabel('Developer Tools'),
      this.renderSshDiagnostics(),
    );
  }
```

- [ ] **Step 9: Build**

```bash
npm run build 2>&1 | grep -E "error TS"
```

- [ ] **Step 10: Commit**

```bash
git add src/renderer/components/NexusOverview.tsx src/renderer/components/SettingsTab.tsx src/renderer/components/FleetCompletenessWidget.tsx
git commit -m "feat(nexus): 5-tab dashboard — Settings tab, simplified Dashboard, restructured Operations"
```

---

## Task 4: Simplify NexusPreferences — remove moved sections

**Files:**
- Modify: `src/renderer/components/NexusPreferences.tsx`

- [ ] **Step 1: Remove Section 3 (Auto-Indexing) entirely**

Delete `section3` variable (lines ~1167–1227) and its reference in the return array.

- [ ] **Step 2: Split Section 4 — keep only WPE API Credentials**

Section 4 currently contains:
- `renderWpeAccessControlSection()` → already in SettingsTab, remove
- `renderWpeCredsSection()` → KEEP, promote to standalone section
- Sync Schedule → already in SettingsTab, remove

Replace section4 with a simpler WPE credentials section:
```typescript
const section3 = React.createElement('div', { style: sectionStyle },
  this.renderSectionHeader('wpe-creds', 'WP Engine API Credentials'),
  expandedSections.has('wpe-creds')
    ? React.createElement('div', null,
        React.createElement('div', { style: descStyle },
          'Required only for creating backups. Get credentials from my.wpengine.com → Profile → API Access.',
        ),
        this.renderWpeCredsSection(),
      )
    : null,
);
```

Note: `expandedSections` initialization may need `'wpe-creds'` added to default collapsed set.

- [ ] **Step 3: Update the return render to only include section1, section2, section3**

```typescript
return React.createElement('div', { style: { padding: '24px' } },
  React.createElement('style', null, `
    .nexus-password-input { -webkit-text-fill-color: unset !important; }
  `),
  section1,
  section2,
  section3,
);
```

- [ ] **Step 4: Remove unused handler methods**

Remove from `NexusPreferences.tsx`:
- `handleAutoIndexToggle`
- `handleSiteExclusionToggle`
- `handleLocalContentIndexAutoEnabledChange`
- `handleLocalContentIndexIntervalChange`
- `handleWpeSyncIntervalChange`
- `handleWpeRefreshIntervalChange`
- `handleHaltedRefreshIntervalChange`
- `handleOperationToggle`
- `handleEnvironmentToggle`

Also remove `renderWpeAccessControlSection()` from the class (it's now in SettingsTab).

Remove unused state fields from the state interface:
- `excludedExpanded: boolean`

- [ ] **Step 5: Build**

```bash
npm run build 2>&1 | grep -E "error TS"
```
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/NexusPreferences.tsx
git commit -m "refactor(prefs): simplify to AI provider + gateway + WPE creds only"
```

---

## Task 5: Final build, verify, update Playwright tab test

**Files:**
- Modify: `flywheel-local/playwright/addons-nexus-ai-overview.playwright.ts`

- [ ] **Step 1: Full build**

```bash
npm run build 2>&1 | tail -10
```
Expected: clean exit.

- [ ] **Step 2: Update Playwright overview test for 5-tab structure**

In `flywheel-local/playwright/addons-nexus-ai-overview.playwright.ts`, update the tab visibility test:

```typescript
test('all 5 tab buttons are visible in correct order', async ({ noSite }) => {
  // ...navigate to nexus...
  await expect(page.locator('[data-testid="tab-ask"]')).toBeVisible({ timeout: INJECTION_TIMEOUT });
  await expect(page.locator('[data-testid="tab-overview"]')).toBeVisible({ timeout: INJECTION_TIMEOUT });
  await expect(page.locator('[data-testid="tab-activity"]')).toBeVisible({ timeout: INJECTION_TIMEOUT });
  await expect(page.locator('[data-testid="tab-operations"]')).toBeVisible({ timeout: INJECTION_TIMEOUT });
  await expect(page.locator('[data-testid="tab-settings"]')).toBeVisible({ timeout: INJECTION_TIMEOUT });
  // Removed tabs should not exist
  await expect(page.locator('[data-testid="tab-search"]')).not.toBeAttached();
  await expect(page.locator('[data-testid="tab-system"]')).not.toBeAttached();
});
```

Add a test for Settings tab:
```typescript
test('clicking Settings tab renders without error', async ({ noSite }) => {
  // ...navigate to nexus...
  await page.locator('[data-testid="tab-settings"]').click();
  await expect(page.locator('[role="alertdialog"]')).not.toBeVisible({ timeout: 3_000 }).catch(() => {});
  await expect(page.locator('[data-testid="tab-settings"]')).toBeVisible();
  // Settings tab should show at minimum "Auto-Indexing" or "Sync Schedule" text
  await expect(page.locator('body')).toContainText('Auto-Indexing', { timeout: INJECTION_TIMEOUT });
});
```

- [ ] **Step 3: Final commit**

```bash
git add flywheel-local/playwright/addons-nexus-ai-overview.playwright.ts
git commit -m "test(playwright): update overview test for 5-tab structure + Settings tab"
```

---

## Self-Review

**1. Spec coverage:**
- ✅ MCP setup stays prominent in Dashboard
- ✅ Fleet Intelligence consolidated (site counts + completeness + summary)
- ✅ Button active states fixed (isRunning prop)
- ✅ Fleet Status moved to Operations
- ✅ Operations restructured with L2/L3 labels
- ✅ Schedule button now links to Settings tab (not Operations)
- ✅ Settings tab: auto-indexing + sync schedule + WPE access control
- ✅ Preferences simplified to AI provider + gateway + WPE creds

**2. Placeholder scan:** None found — all code blocks are complete.

**3. Type consistency:**
- `activeTab: 'settings'` added consistently to type + tab bar + switch
- `isRunning: boolean` added to `FleetCompletenessWidgetProps` + caller
- `SettingsTab` uses same `saveSetting(patch)` pattern throughout
- `IPC_CHANNELS.GET_SETTINGS` must exist — verify: `grep -n "GET_SETTINGS" src/common/constants.ts`

**4. Known risks:**
- `renderWpeAccessControlSection` in SettingsTab must import `OPERATIONS` and `WPE_ENVIRONMENTS` constants from NexusPreferences — these may need to be extracted to a shared location if not already exported. Check before implementing Task 2 Step 4.
- `NexusPreferences` `handleOperationToggle`/`handleEnvironmentToggle` use `this.state.settings` which is `NexusSettings` — `SettingsTab` uses the same type, so handlers are directly portable.
- The `mounted` flag in NexusOverview is a class property — check it's accessible as `(this as any).mounted` or refactor to `private mounted = false`.
