/**
 * Nexus Overview Dashboard
 *
 * Addon dashboard with five tabs: Now, Sites, Record, Agents, Settings (see
 * TABS below — the fleet collapse made Properties the sites list; Overview,
 * Inbox, Installs, Fleet, Activity and Operations are retired).
 * Class-based — Local uses older React, no hooks allowed.
 */
import * as React from 'react';
import { IPC_CHANNELS, UI_COLORS, POLL_INTERVALS } from '../../common/constants';
import { injectThemeVars } from '../utils/theme';
import type { NexusSettings, SiteSource } from '../../common/types';
import { nexusStore } from '../store/NexusStateManager';
import type { NexusState } from '../store/NexusStateManager';
import { EventStatsCards } from './EventStatsCards';
import { EventTimeline } from './EventTimeline';
import { StorageHealthPanel } from './StorageHealthPanel';
import { TopIssuesPanel } from './TopIssuesPanel';
import { BulkOperationsPanel } from './BulkOperationsPanel';
import { SiteGroupsPanel } from './SiteGroupsPanel';
// The other three imports that arrived with this one — AIGatewayPanel, LoadingSpinner,
// SystemTab — belong to the Dashboard/Operations surfaces spec 6a retired, and are gone with
// them. localDay stays: the run-complete handler below still needs its ICU guard.
import { localDay } from './localDay';
import { SettingsTab } from './SettingsTab';
import type { Section as SettingsSection } from './settings/SettingsShell';
import type { GovernDoorTarget } from '../../main/intelligence-host/sequenceGuard';
import type { SessionRow } from '../../main/intelligence-host/sessionRegistry';
import { Arrival } from './return/Arrival';
import { SessionReEntry } from './return/SessionReEntry';
import { AssistantPanel } from './AssistantPanel';
import { AgentConsoleTab } from './agents/AgentConsoleTab';
import { agentStore } from './agents/AgentStore';
import { runStore } from './agents/RunStore';
import { RunToast } from './agents/RunToast';
import { RunPill } from './agents/RunPill';
import { RunDrawer } from './agents/RunDrawer';
import { CredentialConsentModal } from './credentials/CredentialConsentModal';
import { cardContainerStyle, cardStyle, cardTitleStyle, renderSectionLabel } from './tabs/shared/cards';
import { BULK_CONFIRM_THRESHOLD, type BulkJobView } from './tabs/SitesTab';
import { PropertiesTab } from './tabs/PropertiesTab';
import type { FleetCollapse } from '../../main/fleet/fleetCollapse';
// Types only — a value import would pull main-process code into the renderer
// bundle. Precedent: credentials/ConnectionsPanel.tsx:3.
import type { SiteRow } from '../../main/fleet/siteRows';
import type { PopulationCount } from '../../main/fleet/FleetCounts';
import type { FleetSiteGroup, UnresolvedSite } from '../../main/fleet/types';
import type { DashboardStats, McpInfo, StartupStatus, AiProxyInfo, FleetVersionEntry, FleetSummaryData } from './tabs/shared/types';
import type { InboxItem } from '../../main/inbox/types';
// Local's native notification components
let toast: any = null;
try {
  const localComponents = require('@getflywheel/local-components');
  toast = localComponents.toast;
} catch (err) {
  console.warn('[Nexus AI] Could not load Local toast:', err);
}

interface NexusOverviewProps {
  NavLink: any;
  electron: any;
}

interface SiteListItem {
  id: string;
  name: string;
  domain: string;
  port: number | null;
  status: string;
  isWpe: boolean;
  indexed: boolean;
  source?: SiteSource;
  wpVersion?: string;
  linkedLocalSite?: { id: string; name: string }; // For WPE sites: which local site is linked
  wpeInstallId?: string; // For WPE sites: the install ID
}

interface IndexEntry {
  siteId: string;
  siteName: string;
  state: string;
  documentCount: number;
  chunkCount: number;
  lastIndexed: number;
}

interface UISearchResult {
  id: string;
  title: string;
  content: string;
  postType: string;
  postId: number;
  score: number;
  siteId: string;
  siteName: string;
}

interface SetupAIResult {
  success: boolean;
  aiPlugin: 'installed' | 'activated' | 'already_active' | 'failed';
  providerPlugins: 'installed' | 'already_active' | 'skipped' | 'failed';
  aiFeatures: 'enabled' | 'already_enabled' | 'skipped' | 'failed';
  credentials: 'synced' | 'skipped' | 'failed';
  acfAbilities: 'enabled' | 'already_enabled' | 'skipped' | 'failed';
  message: string;
}

/**
 * The tab registry. This array is the single source of truth for which tabs
 * exist — `TabKey` is derived from it, so adding or removing a tab is one edit
 * here rather than one here plus one in a hand-maintained union.
 *
 * Note the dispatch is deliberately NOT folded in: `renderActiveTab`'s arms need
 * instance context (`this.renderActivityTab()`, the built `overviewProps`), and
 * `agents` bypasses that switch entirely because it has no stats dependency.
 * Moving them here would cost more in binding than the duplication saves.
 */
const TABS = [
  // XD-27 AMENDED (2026-08-20) — **NOW IS THE FIRST TAB**, selected on arrival,
  // with a hairline divider after it, so the strip reads home-then-destinations
  // rather than one-of-N peers.
  //
  // The not-a-tab clause was WITHDRAWN BY ITS AUTHOR on the owner's live
  // evidence (field finding 5: "There's no Now tab though. Or nothing that says
  // that"). The ruling was working exactly as written and its MECHANICS WERE
  // INVISIBLE — nothing named the screen, nothing marked the title as the way
  // back, and a strip with no active underline reads as "nothing selected"
  // rather than as "you are home." The designer's own words: "the worry it was
  // protecting against — a fifth feature claiming a peer slot — is a rule about
  // what earns a destination, and it cannot be enforced by hiding the
  // destination people need most."
  //
  // **THE GOVERNANCE HALF SURVIVES AS LAW**: a future feature must argue for
  // being a destination through the design loop before it enters this array.
  // That is what the withdrawn geometry was trying to enforce, and it is the
  // half that can actually be enforced.
  { key: 'now',        label: 'Now', divider: true },
  { key: 'sites',      label: 'Sites' },
  // ITEM 6, NOT WP-49's: Fleet folds into Sites on the web-property unit once
  // the owner rules on it. It stays a strip entry until then, because the
  // alternative is content nobody can reach — which the collapse's own third
  // rider forbids outright.
  // XD-27 names the strip Sites / Record / Settings. Record is the surface that
  // already exists: the fleet's own event history, which is where a FINISHED run
  // belongs and where the finished-run door lands. The tab is renamed, not
  // rebuilt — "no new surface, no duplication of it in Now".
  { key: 'record',     label: 'Record' },
  { key: 'agents',     label: 'Agents' },
  { key: 'settings',   label: 'Settings' },
] as const;

/**
 * WP-50 · XD-27 AMENDED — the union is the strip, and `'now'` is IN it.
 *
 * It used to be the strip PLUS `'now'`, because Now was ruled out of the strip.
 * That ruling was withdrawn (see `TABS`), so the union needs no extra member and
 * the type says what the strip says. The addon still opens on Now and the title
 * bar still returns to it the way a logo does — those halves of XD-27 are
 * untouched; what changed is that the destination is now visible and marked.
 * `nowScreen.test.tsx` pins the amendment's three properties: FIRST POSITION,
 * SELECTED ON ARRIVAL, and the DIVIDER.
 */
type TabKey = typeof TABS[number]['key'];

interface NexusOverviewState {
  stats: DashboardStats | null;
  mcpInfo: McpInfo | null;
  startupStatus: StartupStatus | null;
  sites: SiteListItem[];
  indexEntries: IndexEntry[];
  searchQuery: string;
  searchResults: UISearchResult[];
  searching: boolean;
  indexingId: string | null;
  togglingId: string | null;
  loading: boolean;
  error: string | null;
  activeTab: TabKey;
  /** WP-44 · the refusal door this dashboard is currently honouring. */
  governDoor: GovernDoorTarget | null;
  /**
   * A Settings section another tab asked us to open, held until the shell honours it.
   *
   * Settings is a tab of this component, and the section is state inside the shell — neither is
   * addressable by a route. That is why an agent's "Connect AWS account" button could not simply
   * navigate: `goToRoute('/main/nexus')` is the page it was already on, so it did nothing.
   */
  settingsSection: SettingsSection | null;
  /**
   * WP-46 · the session a waiting row promoted, and the row the registry folded
   * for it. Both null means the arrival itself is on screen.
   *
   * THE ROW IS HELD, NOT COPIED. Promotion identity — same session id, same
   * cursor, same pending approvals — holds because this is the registry's own
   * `SessionRow` travelling unchanged from `RETURN_SESSION` into the re-entry's
   * props. Nothing between the two reads a field out and puts it back, so there
   * is nothing for a promotion to lose.
   */
  returnSessionId: string | null;
  returnSession: SessionRow | null;
  /** Sites table. `siteRowsFailed` is distinct from an empty list — see SitesTab. */
  siteRows: SiteRow[];
  siteRowsTotal: PopulationCount;
  siteRowsLoaded: boolean;
  siteRowsFailed: boolean;
  /** The Sites tab's view: the install-grain table or the property collapse. */
  sitesView: 'installs' | 'properties';
  collapse: FleetCollapse | null;
  collapseLoaded: boolean;
  collapseFailed: boolean;
  /** Sheet 19: the enumerable facet values with counts, for the filter menu. */
  filterOptions: any | null;
  selectedSiteIds: string[];
  /** The bulk job started from the Sites bar, or null. Replaces the selection bar. */
  bulkJob: BulkJobView | null;
  aiProxy: AiProxyInfo | null;
  fleetSetupOpId: string | null;
  fleetSetupRunning: boolean;
  fleetIndexOpId: string | null;
  fleetIndexRunning: boolean;
  settings: NexusSettings | null;
  setupAllAutoOpId: string | null;
  setupAllAutoRunning: boolean;
  indexAllAutoOpId: string | null;
  indexAllAutoRunning: boolean;
  syncGraphOpId: string | null;
  syncGraphRunning: boolean;
  filteredSiteIds: string[] | null;
  aiSearchMode: boolean;
  hasLLM: boolean;
  showLocalSites: boolean;
  showWpeSites: boolean;
  wpeSites: SiteListItem[];
  pullingInstall: string | null;
  wpeSyncing: boolean;
  wpeSyncProgress: { total: number; current: number; skipped: number; currentSite: string; status: string } | null;
  wpeSyncedCount: number;
  wpeSyncError: string | null;
  diagInstall: string;
  diagRunning: boolean;
  diagResults: Array<{ cmd: string; success: boolean; stdout: string; durationMs: number; error?: string }>;
  dbScanRunning: boolean;
  dbScanResults: Array<{ siteId: string; siteName: string; healthScore?: number; issues?: any[]; error?: string }> | null;
  indexResetConfirming: boolean;
  indexResetRunning: boolean;
  indexResetResult: { siteCount: number; docCount: number } | null;
  _resetConfirmChecked: boolean;
  // Fleet Intelligence panels
  fleetSummary: FleetSummaryData | null;
  wpeAuthError: boolean;
  // WPE action buttons
  wpeBackupRunning: boolean;
  wpeBackupInstallId: string | null;
  wpeBackupInstallName: string | null;
  wpeSyncNowRunning: boolean;
  // WPE account filter
  wpeAccounts: Array<{ id: string; name: string; nickname?: string }>;
  wpeAccountFilter: string[] | null;
  opsAdvancedExpanded: boolean;
  factoryResetConfirming: boolean;
  factoryResetRunning: boolean;
  factoryResetDone: boolean;
  factoryResetChecked: boolean;
  credentialRequest: NexusState['credentialConnectRequest'];
  // Inbox
  inboxLoaded: boolean;
  inboxFailed: boolean;
  inboxItems: InboxItem[];
  inboxTotal: number;
  inboxPausedSources: string[];
  inboxRecentlyDecided: InboxItem[];
  // Fleet
  fleetLoaded: boolean;
  fleetFailed: boolean;
  fleetGroups: FleetSiteGroup[];
  fleetUnresolved: UnresolvedSite[];
}

// -- Shared styles --

const tagStyle = (bg: string, fg: string): React.CSSProperties => ({
  display: 'inline-block',
  padding: '2px 8px',
  borderRadius: '4px',
  fontSize: '11px',
  fontWeight: 600,
  backgroundColor: bg,
  color: fg,
  marginLeft: '8px',
  verticalAlign: 'middle',
});

const btnPrimaryStyle: React.CSSProperties = {
  padding: '6px 14px',
  borderRadius: '6px',
  backgroundColor: UI_COLORS.WPE_BRAND,
  color: '#fff',
  border: 'none',
  fontSize: '12px',
  fontWeight: 500,
  cursor: 'pointer',
};

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '...';
}

function navigateToPreferences(electron: any): void {
  // Round-trip through our main process which calls serviceContainer.sendIPCEvent('goToRoute', ...)
  // This is the correct mechanism — goToRoute is a main→renderer event that Local's App.tsx handles.
  electron?.ipcRenderer?.invoke(IPC_CHANNELS.NAVIGATE_TO_PREFERENCES);
}

export class NexusOverview extends React.Component<NexusOverviewProps, NexusOverviewState> {
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  /** Id of the job the Sites bar is showing, and its own poll. Separate from the fleet poll. */
  private bulkOpId: string | null = null;
  private bulkPollTimer: ReturnType<typeof setInterval> | null = null;
  private contentScrollEl: HTMLDivElement | null = null;
  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private wpeSyncPassivePoll: ReturnType<typeof setInterval> | null = null;
  private indexProgressHandler: ((_: any, data: any) => void) | null = null;
  private mounted = false;
  private unsub?: () => void;
  private credentialRequestUnsub?: () => void;
  private runStartedHandler!: (...args: any[]) => void;
  private runCompleteHandler!: (...args: any[]) => void;

  state: NexusOverviewState = {
    stats: null,
    mcpInfo: null,
    startupStatus: null,
    sites: [],
    indexEntries: [],
    searchQuery: '',
    searchResults: [],
    searching: false,
    indexingId: null,
    togglingId: null,
    loading: true,
    error: null,
    activeTab: 'now',
    returnSessionId: null,
    returnSession: null,
    governDoor: null,
    settingsSection: null,
    siteRows: [],
    // Not zero-with-a-scope: nothing has been read yet, and the empty scope
    // string is what `loaded: false` renders behind anyway.
    siteRowsTotal: { count: 0, scope: '' },
    siteRowsLoaded: false,
    siteRowsFailed: false,
    sitesView: 'properties',  // finding 2: the product decided the unit — installs are the secondary view
    collapse: null,
    collapseLoaded: false,
    collapseFailed: false,
    filterOptions: null,
    selectedSiteIds: [],
    bulkJob: null,
    aiProxy: null,
    fleetSetupOpId: null,
    fleetSetupRunning: false,
    fleetIndexOpId: null,
    fleetIndexRunning: false,
    setupAllAutoOpId: null,
    setupAllAutoRunning: false,
    indexAllAutoOpId: null,
    indexAllAutoRunning: false,
    syncGraphOpId: null,
    syncGraphRunning: false,
    filteredSiteIds: null,
    aiSearchMode: false,
    hasLLM: false,
    settings: null,
    showLocalSites: true,
    showWpeSites: true,
    wpeSites: [],
    pullingInstall: null,
    wpeSyncing: false,
    wpeSyncProgress: null,
    wpeSyncedCount: 0,
    wpeSyncError: null,
    diagInstall: '',
    diagRunning: false,
    diagResults: [],
    dbScanRunning: false,
    dbScanResults: null,
    indexResetConfirming: false,
    indexResetRunning: false,
    indexResetResult: null,
    _resetConfirmChecked: false,
    wpeAuthError: false,
    fleetSummary: null,
    wpeBackupRunning: false,
    wpeBackupInstallId: null,
    wpeBackupInstallName: null,
    wpeSyncNowRunning: false,
    wpeAccounts: [],
    wpeAccountFilter: null,
    opsAdvancedExpanded: false,
    factoryResetConfirming: false,
    factoryResetRunning: false,
    factoryResetDone: false,
    factoryResetChecked: false,
    credentialRequest: null,
    inboxLoaded: false,
    inboxFailed: false,
    inboxItems: [],
    inboxTotal: 0,
    inboxPausedSources: [],
    inboxRecentlyDecided: [],
    fleetLoaded: false,
    fleetFailed: false,
    fleetGroups: [],
    fleetUnresolved: [],
  };

  componentDidMount(): void {
    this.mounted = true;
    injectThemeVars();
    this.fetchAll();
    // 60s safety fallback — store push from CAPI/WPE sync delivers fresh stats without waiting
    this.pollTimer = setInterval(() => this.fetchAll(), 60_000);

    // Subscribe to store so stats update immediately when main process pushes new data
    this.unsub = nexusStore.subscribe(() => {
      if (!this.mounted) return;
      const s = nexusStore.get();
      if (s.dashboardStats) {
        this.setState({ stats: s.dashboardStats as any });
      }
      // Mirror WPE sync progress from store — every per-site push updates the
      // Operations tab banner directly, no polling gap.
      const prog = s.wpeSyncProgress;
      if (prog?.active && !this.state.wpeSyncing) {
        // Transition: not syncing → syncing
        this.setState({ wpeSyncing: true, wpeSyncProgress: { total: prog.total, current: prog.current, skipped: 0, currentSite: prog.currentSite, status: 'running' } });
        this.startWpeSyncProgressPolling();
      } else if (prog?.active && this.state.wpeSyncing) {
        // Already syncing — update progress from each per-site store push
        this.setState({ wpeSyncProgress: { total: prog.total, current: prog.current, skipped: 0, currentSite: prog.currentSite, status: 'running' } });
      } else if (!prog && this.state.wpeSyncing && !this.state.wpeSyncNowRunning) {
        // Store cleared — sync ended
        this.stopWpeSyncProgressPolling();
        this.setState({ wpeSyncing: false, wpeSyncProgress: null });
      }
    });

    // Mirror credential consent requests from the main process so agents calling
    // ctx.credentials.requestConnection() surface the CredentialConsentModal.
    this.credentialRequestUnsub = nexusStore.subscribe(() => {
      if (!this.mounted) return;
      const req = nexusStore.get().credentialConnectRequest;
      this.setState({ credentialRequest: req ?? null });

      // WP-44 · a door a refusal opened in the docked panel. Switching to the
      // Settings tab is only half of honouring it — the target travels down to
      // the Govern matrix, which lands it on the capability's own row. The tab
      // switch alone would be "the top of Settings", which is the failure
      // J-Refusal's criterion names by name.
      const door = nexusStore.get().governDoorRequest;
      if (door && door.section === 'capabilities') {
        this.setState({ activeTab: 'settings', governDoor: door });
      }

      // The header's ambient needs-you door ("Open Now"). Cleared whether or
      // not the tab changed, for the same reason every door request is: a
      // request left in the store re-fires on every unrelated store change.
      const tabReq = nexusStore.get().overlayTabRequest;
      if (tabReq) {
        nexusStore.update({ overlayTabRequest: null });
        this.setState({ activeTab: tabReq.tab });
      }
    });

    // Refresh indexEntries immediately when any site finishes indexing — don't
    // wait for the next poll interval (which can be 30s+). Without this,
    // Site Status shows "Configured" for sites that successfully indexed.
    const ipc = this.props.electron.ipcRenderer;
    this.indexProgressHandler = (_: any, data: any) => {
      if (!this.mounted) return;
      if (data.state === 'indexed' || data.state === 'error') {
        setTimeout(() => this.refreshIndexEntries(), 500);
      }
    };
    ipc.on(IPC_CHANNELS.INDEX_PROGRESS, this.indexProgressHandler);

    // Check if WPE sync is already running (catches auto-syncs started before mount)
    this.checkWpeSyncStatus();

    // Passive poll: pick up auto-syncs that start after mount (every 10s when not already syncing)
    this.wpeSyncPassivePoll = setInterval(() => {
      if (!this.state.wpeSyncing) {
        this.checkWpeSyncStatus();
      }
    }, 10000);

    // Wire agent run lifecycle IPC events → RunStore
    // These live here (not in AgentConsoleTab) so they persist across tab switches
    this.runStartedHandler = (_: any, payload: any) => {
      runStore.startRun(payload);
    };
    this.runCompleteHandler = (_: any, payload: any) => {
      runStore.completeRun(payload);
      // Add a completed-run row to Fleet activity ledger so the report stays retrievable
      if (!payload.cancelled) {
        const run = runStore.getState().currentRun;
        const agentName = run?.agentName || payload.agentId || 'Agent';
        const now = new Date();
        const hh = now.getHours().toString().padStart(2, '0');
        const mm = now.getMinutes().toString().padStart(2, '0');
        // Local time, not UTC — the time is local (getHours), so the date must be too.
        // Mixing them made the date and time disagree for seven hours a day in PDT.
        // Use localDay() with its ICU guard, not raw toLocaleDateString().
        const day = localDay(now);
        const cleanCount = payload.doneCount - (payload.failedCount || 0);
        const findingsCount = payload.findingsSites?.length || 0;
        const sub = findingsCount > 0
          ? `${findingsCount} site${findingsCount !== 1 ? 's' : ''} need${findingsCount === 1 ? 's' : ''} review · ${cleanCount} clean`
          : `${cleanCount} site${cleanCount !== 1 ? 's' : ''} clean`;
        const hasFindings = findingsCount > 0;
        agentStore.setState({
          activityEvents: [
            { id: payload.runId, agentId: payload.agentId || 'security-sentinel', day, time: `${hh}:${mm}`,
              type: 'Report', status: hasFindings ? 'review' : 'done',
              text: `${agentName} sweep complete`, sub,
              ref: hasFindings ? payload.runId : undefined,
              siteName: payload.findingsSites?.[0] ?? (payload.siteNames?.[0] ?? undefined),
              plan: payload.plan,
              findings: payload.findings,
              summary: payload.summary },
            ...agentStore.getState().activityEvents,
          ],
        });
        // Expose latest plan/findings for AgentConsoleTab overlay
        if (payload.plan || payload.findings) {
          (this as any)._lastPlan = payload.plan;
          (this as any)._lastPlanSite = payload.plan?.site ?? payload.findingsSites?.[0];
          (window as any).__nexusSentinelPlan = {
            plan:     payload.plan,
            findings: payload.findings ?? [],
            site:     payload.plan?.site ?? payload.findingsSites?.[0],
          };
        }
      }
      if (document.visibilityState === 'hidden') {
        try {
          new Notification('Run complete', { body: `${runStore.getState().currentRun?.agentName || 'Agent'} finished` });
        } catch {}
      }
    };
    ipc.on(IPC_CHANNELS.AGENT_RUN_STARTED, this.runStartedHandler);
    ipc.on(IPC_CHANNELS.AGENT_RUN_COMPLETE, this.runCompleteHandler);
  }

  componentDidUpdate(_prevProps: NexusOverviewProps, prevState: NexusOverviewState): void {
    if (
      this.state.activeTab === 'sites' &&
      this.state.sitesView === 'properties' &&
      !this.state.collapseLoaded &&
      this.state.activeTab !== prevState.activeTab
    ) {
      void this.fetchCollapse();
    }
    if (this.state.activeTab !== prevState.activeTab && this.contentScrollEl) {
      this.contentScrollEl.scrollTop = 0;
    }
  }

  componentWillUnmount(): void {
    this.mounted = false;
    this.stopBulkPolling();
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    if (this.wpeSyncPassivePoll) clearInterval(this.wpeSyncPassivePoll);
    if (this.indexProgressHandler) {
      this.props.electron.ipcRenderer.removeListener(IPC_CHANNELS.INDEX_PROGRESS, this.indexProgressHandler);
    }
    this.stopWpeSyncProgressPolling();
    if (this.runStartedHandler) {
      this.props.electron.ipcRenderer.removeListener(IPC_CHANNELS.AGENT_RUN_STARTED, this.runStartedHandler);
    }
    if (this.runCompleteHandler) {
      this.props.electron.ipcRenderer.removeListener(IPC_CHANNELS.AGENT_RUN_COMPLETE, this.runCompleteHandler);
    }
    this.unsub?.();
    this.credentialRequestUnsub?.();
  }

  getLatestPlan(): { site: string; plan: any } | null {
    const plan = (this as any)._lastPlan;
    const site = (this as any)._lastPlanSite;
    return plan ? { site, plan } : null;
  }

  refreshIndexEntries = async (): Promise<void> => {
    const indexEntries = await this.props.electron.ipcRenderer
      .invoke(IPC_CHANNELS.GET_FLEET_STATUS)
      .catch(() => []);
    if (this.mounted) this.setState({ indexEntries: indexEntries ?? [] });
  };

  /**
   * The property collapse, fetched lazily on first switch to the Properties
   * view. `collapseFailed` is a read failure, never an empty fleet.
   */
  fetchCollapse = async (): Promise<void> => {
    const ipc = this.props.electron?.ipcRenderer;
    if (!ipc) return;
    try {
      const res = await ipc.invoke(IPC_CHANNELS.GET_FLEET_COLLAPSE);
      if (!this.mounted) return;
      if (res?.success && res.collapse) {
        this.setState({ collapse: res.collapse as FleetCollapse, collapseLoaded: true, collapseFailed: false });
        // The facet menu's values ride along; absence just hides the menu.
        void ipc.invoke(IPC_CHANNELS.SITE_FINDER_GET_OPTIONS)
          .then((o: any) => { if (this.mounted && o?.success) this.setState({ filterOptions: o }); })
          .catch(() => { /* menu hidden */ });
      } else {
        this.setState({ collapseLoaded: true, collapseFailed: true });
      }
    } catch {
      if (this.mounted) this.setState({ collapseLoaded: true, collapseFailed: true });
    }
  };

  fetchAll = async (): Promise<void> => {
    const ipc = this.props.electron.ipcRenderer;
    try {
      // This destructuring is POSITIONAL. Append new channels at the END of both
      // the array and the pattern — inserting anywhere else silently shifts every
      // later variable onto the wrong response, which is not a compile error.
      //
      // Specs 4 and 5 both appended here and conflicted on the same slot. The
      // resolution keeps both, and the two trailing entries below are in the
      // SAME order as the two trailing names here. Do not reorder one alone.
      const [stats, mcpInfo, sites, indexEntries, proxyResult, settings, wpeSitesResult, fleetSummaryResult, wpeAccounts, startupStatus, inboxResult, siteRowsResult, fleetListResult] = await Promise.all([
        ipc.invoke(IPC_CHANNELS.GET_DASHBOARD_STATS),
        ipc.invoke(IPC_CHANNELS.GET_MCP_INFO),
        ipc.invoke(IPC_CHANNELS.GET_SITES),
        ipc.invoke(IPC_CHANNELS.GET_FLEET_STATUS),
        ipc.invoke(IPC_CHANNELS.GET_AI_PROXY_INFO),
        ipc.invoke(IPC_CHANNELS.GET_SETTINGS),
        ipc.invoke(IPC_CHANNELS.WPE_GET_SYNCED_SITES),
        ipc.invoke(IPC_CHANNELS.GET_FLEET_SUMMARY),
        ipc.invoke(IPC_CHANNELS.GET_WPE_ACCOUNTS).catch(() => []),
        ipc.invoke(IPC_CHANNELS.GET_STARTUP_STATUS),
        // These three are positionally bound to `inboxResult`, `siteRowsResult`,
        // and `fleetListResult` above, in this order. A rejected invoke would
        // reject the whole Promise.all and blank every other panel, so each
        // resolves to the same failure shape its handler returns.
        ipc.invoke(IPC_CHANNELS.GET_INBOX).catch(() => ({ success: false })),
        ipc.invoke(IPC_CHANNELS.GET_SITE_ROWS).catch(() => ({ success: false, rows: [], total: { count: 0, scope: '' } })),
        ipc.invoke(IPC_CHANNELS.GET_FLEET_LIST).catch(() => ({ success: false, groups: [], unresolved: [] })),
      ]);
      if (!this.mounted) return;

      // Push dashboard stats to store so subscribers get immediate updates
      if (stats) {
        nexusStore.update({ dashboardStats: stats });
      }

      // Check if LLM is configured (any chat provider selected means LLM available)
      const hasLLM = !!settings?.aiProvider;

      // Build a map of WPE install IDs to local sites (for linkage detection)
      const wpeInstallIdToLocalSite = new Map<string, { id: string; name: string }>();
      if (sites && Array.isArray(sites)) {
        for (const site of sites) {
          const connections = (site as any).hostConnections;
          const connList = connections
            ? (Array.isArray(connections) ? connections : Object.values(connections))
            : [];

          for (const conn of connList) {
            if (conn.host === 'wpe' && conn.id) {
              wpeInstallIdToLocalSite.set(conn.id, { id: site.id, name: site.name });
            }
          }
        }
      }

      // Transform WPE sites to SiteListItem format with linkage info
      const wpeSites: SiteListItem[] = wpeSitesResult?.success && wpeSitesResult.sites
        ? wpeSitesResult.sites.map((site: any) => {
            const installId = site.remote_install_id;
            const linkedLocal = installId ? wpeInstallIdToLocalSite.get(installId) : undefined;

            return {
              id: site.id,
              name: site.name,
              domain: site.domain,
              port: null,
              status: 'remote',
              isWpe: true,
              indexed: true, // WPE sites are indexed when synced
              source: 'wpe' as const,
              wpVersion: site.wp_version,
              linkedLocalSite: linkedLocal,
              wpeInstallId: installId,
            };
          })
        : [];

      this.setState({
        stats,
        mcpInfo: mcpInfo ?? null,
        startupStatus: startupStatus ?? null,
        sites: sites ?? [],
        siteRows: siteRowsResult?.rows ?? [],
        siteRowsTotal: siteRowsResult?.total ?? { count: 0, scope: '' },
        // Loaded means "a response came back", true even when that response was
        // a failure — otherwise the error state never renders behind the spinner.
        siteRowsLoaded: true,
        siteRowsFailed: !siteRowsResult?.success,
        wpeSites,
        indexEntries: indexEntries ?? [],
        aiProxy: proxyResult?.proxy ?? null,
        settings: settings ?? null,
        hasLLM,
        loading: false,
        error: stats ? null : 'Failed to load stats',
        wpeAuthError: wpeSitesResult?.wpeAuthError ?? false,
        fleetSummary: fleetSummaryResult ?? null,
        wpeAccounts: Array.isArray(wpeAccounts) ? wpeAccounts : [],
        wpeAccountFilter: settings?.wpeAccountFilter ?? null,
        inboxLoaded: true,
        inboxFailed: !inboxResult?.success,
        inboxItems: inboxResult?.items ?? [],
        inboxTotal: inboxResult?.total ?? 0,
        inboxPausedSources: inboxResult?.pausedSources ?? [],
        inboxRecentlyDecided: inboxResult?.recentlyDecided ?? [],
        fleetLoaded: true,
        fleetFailed: !fleetListResult?.success,
        fleetGroups: fleetListResult?.groups ?? [],
        fleetUnresolved: fleetListResult?.unresolved ?? [],
      });

      // Push pending counts to agentStore only when successfully read.
      // On failure, leave the previous value in place — a false all-clear is worse than stale data.
      if (inboxResult?.success) {
        agentStore.setState({ pendingBySource: inboxResult.pendingBySource, pendingLoaded: true });
      }
    } catch (err: any) {
      if (!this.mounted) return;
      this.setState({ error: err.message || 'Failed to load', loading: false });
    }
  };

  handleSearch = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const query = e.target.value;
    this.setState({ searchQuery: query });

    if (this.searchTimer) clearTimeout(this.searchTimer);

    if (!query.trim()) {
      this.setState({ searchResults: [], searching: false });
      return;
    }

    this.setState({ searching: true });
    this.searchTimer = setTimeout(async () => {
      try {
        const result = await this.props.electron.ipcRenderer.invoke(
          IPC_CHANNELS.SEARCH, query, undefined, 10,
        );
        if (!this.mounted) return;
        this.setState({ searchResults: result?.results ?? [], searching: false });
      } catch {
        if (!this.mounted) return;
        this.setState({ searchResults: [], searching: false });
      }
    }, 300);
  };

  handleIndex = async (siteId: string): Promise<void> => {
    this.setState({ indexingId: siteId });
    try {
      await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.INDEX_SITE, siteId);
      if (!this.mounted) return;
      await this.fetchAll();
    } catch {
      // Error handled by fetchAll refresh
    }
    if (this.mounted) this.setState({ indexingId: null });
  };

  handleToggleSite = async (siteId: string, currentStatus: string): Promise<void> => {
    this.setState({ togglingId: siteId });
    try {
      const channel = currentStatus === 'running' ? IPC_CHANNELS.STOP_SITE : IPC_CHANNELS.START_SITE;
      await this.props.electron.ipcRenderer.invoke(channel, siteId);
      if (!this.mounted) return;
      await this.fetchAll();
    } catch {
      // Error handled by fetchAll refresh
    }
    if (this.mounted) this.setState({ togglingId: null });
  };

  handleSetupAIFleet = async (): Promise<void> => {
    this.setState({ fleetSetupRunning: true });
    try {
      const result = await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.SETUP_AI_FLEET);
      if (!this.mounted) return;
      this.setState({ fleetSetupOpId: result?.opId ?? null, fleetSetupRunning: false });
    } catch {
      if (!this.mounted) return;
      this.setState({ fleetSetupRunning: false });
    }
  };

  handleSetupAllAuto = async (): Promise<void> => {
    this.setState({ setupAllAutoRunning: true });
    try {
      const result = await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.SETUP_AI_ALL_AUTO);
      if (!this.mounted) return;
      this.setState({ setupAllAutoOpId: result?.opId ?? null, setupAllAutoRunning: false });
    } catch {
      if (!this.mounted) return;
      this.setState({ setupAllAutoRunning: false });
    }
  };

  handlePullToLocal = async (site: SiteListItem): Promise<void> => {
    if (!site.wpeInstallId) {
      alert('Unable to pull: WPE install ID not found');
      return;
    }

    // Confirm with user
    const siteName = site.name;
    const confirmed = confirm(
      `Pull "${siteName}" to Local?\n\n` +
      `This will:\n` +
      `1. Create a new local site named "${siteName}"\n` +
      `2. Start the site\n` +
      `3. Prepare it for linking to WP Engine\n\n` +
      `Continue?`
    );

    if (!confirmed) return;

    this.setState({ pullingInstall: site.id });

    try {
      const result = await this.props.electron.ipcRenderer.invoke(
        IPC_CHANNELS.WPE_PULL_TO_LOCAL,
        {
          wpeSiteId: site.id,
          installName: site.name,
          installId: site.wpeInstallId,
        }
      );

      if (result.success) {
        const message = result.pulled
          ? `✓ Pull operation started!\n\n` +
            `Site: ${result.siteName}\n` +
            `From: ${result.installName}\n\n` +
            `The site is now pulling database and files from WP Engine.\n` +
            `Check the Local app for progress (this may take a few minutes).`
          : `✓ Site created and linked!\n\n` +
            `${result.message}`;
        
        alert(message);

        // Refresh fleet overview to show new site
        await this.fetchAll();
      } else {
        alert(`Failed to create local site:\n\n${result.error}`);
      }
    } catch (error: any) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      alert(`Error: ${errorMsg}`);
    } finally {
      this.setState({ pullingInstall: null });
    }
  };

  // -- Card renders (unchanged from original) --


  /**
   * XD-27's RECORD — the fleet's own history, renamed rather than rebuilt.
   *
   * This is the surface the audit means by "a finished run belongs to Record,
   * which already exists": the event stats, the timeline, the open issues and
   * the storage health, every one of them dated. Nothing about it changed here
   * except the word above it, because the collapse's rule is that no old
   * screen's content becomes unreachable and no new place is invented for it.
   */
  renderRecordTab(): React.ReactNode {
    return React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, flex: 1, minHeight: 0 } },
      // Event Stats Cards (fixed height)
      React.createElement('div', { style: { flexShrink: 0 } },
        React.createElement(EventStatsCards, { electron: this.props.electron }),
      ),

      // Timeline + Side Panels (fill remaining height)
      React.createElement('div', {
        style: { display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '16px', flex: 1, minHeight: 0, alignItems: 'stretch' },
      },
        React.createElement(EventTimeline, { electron: this.props.electron }),
        React.createElement('div', {
          style: { display: 'flex', flexDirection: 'column' as const, gap: '16px', minHeight: 0, overflow: 'auto' },
        },
          React.createElement(TopIssuesPanel, { electron: this.props.electron }),
          React.createElement(StorageHealthPanel, { electron: this.props.electron }),
        ),
      ),
    );
  }

renderTabBar(): React.ReactNode {
    const { activeTab } = this.state;
    const tabs = TABS;

    return React.createElement('div', {
      style: {
        display: 'flex',
        gap: '0',
        borderBottom: '1px solid var(--nxai-card-border, #e5e7eb)',
        marginBottom: '0',
      },
    },
      ...tabs.flatMap((tab) => {
        const isActive = activeTab === tab.key;
        const entry = React.createElement('div', {
          key: tab.key,
          'data-testid': `tab-${tab.key}`,
          style: {
            padding: '10px 16px',
            fontSize: '13px',
            fontWeight: 600,
            cursor: 'pointer',
            borderBottom: isActive ? `3px solid ${UI_COLORS.WPE_BRAND}` : '3px solid transparent',
            color: isActive ? 'var(--nxai-card-text)' : 'var(--nxai-card-sub)',
          },
          onClick: () => this.setState({ activeTab: tab.key }),
        }, tab.label);
        // XD-27 amended: the hairline after Now. It is what makes the strip read
        // home-then-destinations instead of a row of peers, and it is the
        // divider the designer's revised sheet draws — a rule, not a gap.
        return (tab as { divider?: boolean }).divider
          ? [
              entry,
              React.createElement('div', {
                key: `${tab.key}-divider`,
                // NOT `tab-*`: the divider is a rule, not a destination, and a
                // strip scan that counted it as a tab would be counting a line.
                'data-testid': `strip-divider-${tab.key}`,
                style: {
                  width: '1px',
                  alignSelf: 'stretch',
                  margin: '8px 8px 10px',
                  backgroundColor: 'var(--nxai-card-border, #e5e7eb)',
                },
              }),
            ]
          : [entry];
      }),
    );
  }


  renderWpeAccountScope(): React.ReactNode {
    const { wpeAccounts, wpeAccountFilter } = this.state;
    if (wpeAccounts.length === 0) return null;

    const selectedIds = wpeAccountFilter ?? wpeAccounts.map((a) => a.id);
    const isAll = wpeAccountFilter === null || selectedIds.length === wpeAccounts.length;
    const scopeLabel = isAll
      ? `All ${wpeAccounts.length} account${wpeAccounts.length !== 1 ? 's' : ''}`
      : `${selectedIds.length} of ${wpeAccounts.length} accounts`;

    return React.createElement('div', {
      style: { display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 14px', border: '1px solid var(--nxai-card-border, #e5e7eb)', borderRadius: '8px', backgroundColor: 'var(--nxai-card-bg, #fff)', marginBottom: '20px', fontSize: '12px' },
    },
      React.createElement('span', { style: { color: 'var(--nxai-card-sub, #6b7280)', fontWeight: 600 } }, 'Deep Scan Scope:'),
      React.createElement('span', { style: { color: 'var(--nxai-card-text, #111827)', flex: 1 } }, scopeLabel),
      React.createElement('span', { style: { color: 'var(--nxai-status-neutral, #9ca3af)' } }, '· Manage in Settings → Connections'),
    );
  }

  /**
   * Inline progress for a WP Engine metadata sync.
   *
   * Survived the gutting of Operations' zone 1 because it is not driven by the
   * button that lived there: `checkWpeSyncStatus` runs on mount and starts
   * polling whenever a sync is already in flight, which is the normal case for
   * one the scheduler began. Renders nothing when no sync is running.
   */
  renderWpeSyncProgress(): React.ReactNode {
    if (!this.state.wpeSyncing || !this.state.wpeSyncProgress) return null;
    return React.createElement('div', {
      'data-testid': 'wpe-sync-progress',
      style: { border: '1px solid var(--nxai-card-border, #e5e7eb)', borderRadius: 8, padding: '12px 16px', marginTop: 12 },
    },
      React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 } },
        React.createElement('span', { style: { fontSize: 13, fontWeight: 600 } }, 'WPE metadata sync'),
        React.createElement('span', { style: { fontSize: 12, color: 'var(--nxai-card-sub, #6b7280)' } },
          `${this.state.wpeSyncProgress.current} / ${this.state.wpeSyncProgress.total} sites`,
        ),
      ),
      React.createElement('div', { style: { fontSize: 12, color: 'var(--nxai-card-sub, #6b7280)' } },
        this.state.wpeSyncProgress.currentSite ? `Syncing: ${this.state.wpeSyncProgress.currentSite}` : 'Starting…',
      ),
    );
  }

  toggleSiteSelection = (id: string): void => {
    this.setState(prev => ({
      selectedSiteIds: prev.selectedSiteIds.indexOf(id) === -1
        ? prev.selectedSiteIds.concat(id)
        : prev.selectedSiteIds.filter(x => x !== id),
    }));
  };

  /**
   * Select-all is scoped to the ids handed in — the rows currently visible under
   * the host-type filter — never to the whole fleet. Ticking "all" while filtered
   * to External must not silently arm an action against 331 WP Engine installs.
   */
  toggleAllSiteSelection = (ids: string[]): void => {
    this.setState(prev => {
      const allSelected = ids.length > 0 && ids.every(id => prev.selectedSiteIds.indexOf(id) !== -1);
      if (allSelected) {
        return { selectedSiteIds: prev.selectedSiteIds.filter(id => ids.indexOf(id) === -1) };
      }
      const next = prev.selectedSiteIds.slice();
      for (const id of ids) if (next.indexOf(id) === -1) next.push(id);
      return { selectedSiteIds: next };
    });
  };

  /**
   * Runs a bulk operation over exactly the ticked rows.
   *
   * Goes through BULK_EXECUTE — the one audited bulk path — never a second one.
   * The empty guard is duplicated from SitesTab's `handleBulk` on purpose: an
   * empty selection must never be re-interpreted as "the whole fleet", and this
   * is the last place that could happen before 369 sites are dispatched.
   */
  renderPropertiesTab(): React.ReactNode {
    return React.createElement(PropertiesTab, {
      loaded: this.state.collapseLoaded,
      failed: this.state.collapseFailed,
      collapse: this.state.collapse,
      onRetry: () => { void this.fetchCollapse(); },
      onAddSite: () => this.setState({ activeTab: 'settings' }),
      onBulkIndex: (ids: string[], names: Record<string, string>, autoStart: boolean) => {
        void this.handleSiteBulk('index', ids, { siteNames: names, autoStartStop: autoStart, skipConfirm: true });
      },
      job: this.state.bulkJob,
      onCancelJob: this.cancelBulkJob,
      onDismissJob: this.dismissBulkJob,
      onOpenNow: () => this.setState({ activeTab: 'now' }),
      // Sheet 19: the interpreter and the id resolver — the same IPC the
      // Site Finder uses, so the two surfaces cannot drift.
      onInterpret: async (text: string) => {
        const res = await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.SITE_FINDER_AI_PARSE, {
          conversation: [{ role: 'user', content: text }],
        });
        if (!res?.success) return { kind: 'error' as const, message: res?.error ?? 'The description could not be read.' };
        if (res.needsClarification) return { kind: 'clarify' as const, question: res.question, facet: res.facet ?? null };
        return { kind: 'filters' as const, filters: res.filters ?? {} };
      },
      onResolveFilterIds: async (filters: Record<string, unknown>) => {
        const res = await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.SITE_FINDER_APPLY, filters);
        return res?.success && Array.isArray(res.siteIds) ? res.siteIds : null;
      },
      filterOptions: this.state.filterOptions,
    });
  }

  handleSiteBulk = async (
    type: string,
    siteIds: string[],
    opts?: { autoStartStop?: boolean; siteNames?: Record<string, string>; skipConfirm?: boolean },
  ): Promise<void> => {
    if (siteIds.length === 0) return;

    // The Properties scope block IS the declaration (sheet 18: declaration
    // and a stop, no consent gate) — a second native confirm would be a
    // consent gate on a read.
    if (!opts?.skipConfirm && siteIds.length > BULK_CONFIRM_THRESHOLD && !this.confirmLargeBulk(type, siteIds)) return;

    // Set the job bar BEFORE awaiting, so the selection bar becomes the job bar in the
    // same paint as the click. Awaiting first leaves a frame in which the button has been
    // pressed and nothing on screen says anything happened.
    this.setState({
      bulkJob: {
        phase: 'starting',
        type,
        siteIds,
        startedAt: Date.now(),
        completed: 0,
        total: siteIds.length,
        failed: 0,
        failedIds: [],
      },
    });

    try {
      const result = await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.BULK_EXECUTE, {
        type,
        siteIds,
        // DISPLAY ONLY. The manager labels rows and errors with this and never
        // passes it to a transport — the remote adapters take the graph id and
        // resolve the install name themselves. Do not reintroduce a name
        // parameter on the strength of this map being here.
        siteNames: opts?.siteNames ?? this.state.siteRows.reduce((acc: Record<string, string>, r) => {
          if (siteIds.indexOf(r.id) !== -1) acc[r.id] = r.name;
          return acc;
        }, {}),
        // A bulk operation that reaches a halted Local site STARTS it, collects,
        // and stops it again. "Index content" over 45 stopped sites means 45
        // sites started, indexed and stopped — not 45 rows saying did not run.
        //
        // This was the odd one out: `INDEX_SITE`, `OpportunisticScheduler`,
        // `INDEX_ALL_AUTO`, `SETUP_AI_ALL_AUTO`, `SYNC_GRAPH_ALL`,
        // `FLEET_HEALTH_CHECK_ALL` and `FLEET_PLUGIN_UPDATE_ALL` all send
        // `autoStartStop: true`. The Sites-tab bulk bar sent `{}`, so the one
        // surface a user actually presses was the only one that refused to do
        // the work. `executeSingle` starts the site, waits for MySQL, and stops
        // it again in its `finally` — and only for sites it started itself.
        options: { autoStartStop: opts?.autoStartStop ?? true },
      });
      if (result?.success && result.opId) {
        // `success` here means the manager accepted the job, NOT that it finished — it
        // returns an opId immediately and runs asynchronously. Clearing the selection on
        // this used to be the bug: rows unticked the instant the work started.
        this.bulkOpId = result.opId;
        this.setState(prev => ({ bulkJob: prev.bulkJob ? { ...prev.bulkJob, phase: 'running' } : null }));
        this.startBulkPolling();
      } else {
        this.setState(prev => ({
          bulkJob: prev.bulkJob
            ? { ...prev.bulkJob, phase: 'error', error: result?.error || 'Could not start' }
            : null,
        }));
      }
    } catch (err) {
      console.error('[NexusAI] bulk operation failed:', err);
      this.setState(prev => ({
        bulkJob: prev.bulkJob ? { ...prev.bulkJob, phase: 'error', error: (err as Error).message } : null,
      }));
    }
  };

  /**
   * Names the count and what it costs. Deliberately states no duration: nothing here
   * measures how long a pass takes, and an invented "about 40 minutes" is the kind of
   * plausible-looking default that gets believed.
   */
  private confirmLargeBulk(type: string, siteIds: string[]): boolean {
    const action = type === 'reindex' ? 'Index content' : 'Refresh metadata';
    const remote = this.state.siteRows.filter(
      r => siteIds.indexOf(r.id) !== -1 && r.source !== 'local',
    ).length;
    const cost = remote > 0
      ? ` This opens a connection to each of the ${remote} not on this Mac.`
      : '';
    return confirm(`${action} on ${siteIds.length} sites?${cost} You can cancel it once it starts.`);
  }

  private startBulkPolling(): void {
    if (this.bulkPollTimer !== null) return;
    this.bulkPollTimer = setInterval(() => { void this.pollBulkStatus(); }, 2000);
  }

  private stopBulkPolling(): void {
    if (this.bulkPollTimer !== null) {
      clearInterval(this.bulkPollTimer);
      this.bulkPollTimer = null;
    }
  }

  private async pollBulkStatus(): Promise<void> {
    if (!this.bulkOpId) return;
    try {
      const s = await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.BULK_STATUS, this.bulkOpId);
      if (!s?.success) return;
      const results: Record<string, { status: string }> = s.siteResults || {};
      const failedIds = Object.keys(results).filter(id => results[id]?.status === 'failed');
      const done = s.status !== 'running';
      this.setState(prev => ({
        bulkJob: prev.bulkJob
          ? {
              ...prev.bulkJob,
              phase: done ? 'result' : 'running',
              completed: s.progress?.completed ?? prev.bulkJob.completed,
              total: s.progress?.total ?? prev.bulkJob.total,
              failed: failedIds.length,
              failedIds,
            }
          : null,
      }));
      if (done) {
        this.stopBulkPolling();
        this.bulkOpId = null;
        // Fleet data changed underneath us — the table's own rows are now stale.
        void this.fetchAll();
      }
    } catch {
      /* transient IPC failure; the next tick retries rather than declaring the job dead */
    }
  }

  /** Dismissing a finished job is one of the two moments the selection is released. */
  dismissBulkJob = (): void => {
    this.stopBulkPolling();
    this.bulkOpId = null;
    this.setState({ bulkJob: null, selectedSiteIds: [] });
  };

  cancelBulkJob = (): void => {
    if (!this.bulkOpId) return;
    void this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.BULK_CANCEL, this.bulkOpId);
    // Do not clear the job here — the poll will observe 'cancelled' and land on a result
    // state, so the user still sees what happened rather than the bar vanishing.
  };

  /**
   * Open Settings on a named section, for a surface deeper in the tree that needs a setting the
   * dashboard owns — the shared AWS credential, reached from inside an agent's workspace.
   *
   * Both halves are this component's state, which is precisely why the callers could not do it
   * themselves and why routing could not either: `activeTab` selects Settings, `settingsSection`
   * travels into the shell and selects the section within it.
   */
  openSettingsSection = (section: SettingsSection): void => {
    this.setState({ activeTab: 'settings', settingsSection: section });
  };

  renderActiveTab(): React.ReactNode {
    switch (this.state.activeTab) {
      // WP-46 · M6. The arrival, and the re-entry a promoted row lands on.
      //
      // ONE PROMOTION, NO SECOND ANSWER: a waiting row hands back the session id
      // the registry gave it, this fetches THAT session by THAT id, and the row
      // travels into the re-entry untouched. There is no merge with the triage's
      // copy, no local cache keyed by id, and no re-derivation — which is what
      // makes "same session id, same cursor, same pending approvals" a property
      // of the shape rather than a promise a test has to police.
      case 'now': return this.state.returnSessionId
        ? React.createElement(SessionReEntry, {
            session: this.state.returnSession,
            onFindInRecord: () => this.setState({ returnSessionId: null, returnSession: null }),
            onStartNewRun: () => this.setState({ returnSessionId: null, returnSession: null }),
            // WP-54 · ITEM 6 — THE WAY BACK. The re-entry had two doors and both
            // of them belonged to §6c's unknown-arm case, so an ESTABLISHED arm —
            // the ordinary one — was a page a person could reach and not leave.
            // "A door that cannot be walked back is not a door", one screen
            // deeper than the front-door defect that produced the same finding.
            onBackToNow: () => this.setState({ returnSessionId: null, returnSession: null }),
          })
        : React.createElement(Arrival, {
            electron: this.props.electron,
            // WP-49 · the Inbox, collapsed onto the rows. Every field is the one
            // the retired tab read; the decision handlers are the same handlers,
            // so "behavior intact" is a property of the wiring rather than a
            // claim about it.
            inbox: {
              loaded: this.state.inboxLoaded,
              failed: this.state.inboxFailed,
              items: this.state.inboxItems,
              total: this.state.inboxTotal,
              pausedSources: this.state.inboxPausedSources,
              recentlyDecided: this.state.inboxRecentlyDecided,
            },
            // WP-54 · ITEM 5 — `onDecide` IS GONE, AND ITS ABSENCE IS THE FIX.
            //
            // Approve / Not now rode on the list rows. The designer's ruling,
            // stronger than the owner's and correct: *a gate without its
            // declaration is consent without context*, which is the failure XD-8
            // exists to prevent. So no row is answered in place; the row's door
            // leads to the gate and the gate is where the decision is made, with
            // the declaration in front of the person making it.
            //
            // `INBOX_DECIDE` is untouched and still serves the surfaces that ask
            // for a decision properly. What is removed is the one-click path
            // that asked for consent with nothing to consent to.
            onOpenSite: (siteName: string) => {
              // The door carries its WHOLE target (WP-44's rule), so the panel
              // opens scoped to the site the finding is about rather than at the
              // top of something.
              nexusStore.update({ nowDoorRequest: { kind: 'site', target: siteName } });
            },
            onOpenAgent: (agentId: string) => this.setState({ activeTab: 'agents' }),
            onReopen: (id: number) => {
              void this.props.electron.ipcRenderer
                .invoke(IPC_CHANNELS.INBOX_REOPEN, { id })
                .then(() => this.fetchAll());
            },
            onResumeAgent: (agentId: string) => {
              void this.props.electron.ipcRenderer
                .invoke(IPC_CHANNELS.AGENT_RESUME, { agentId })
                .then(() => this.fetchAll());
            },
            onRetryInbox: () => { void this.fetchAll(); },
            onPromote: (sessionId: string) => {
              this.props.electron.ipcRenderer
                .invoke(IPC_CHANNELS.RETURN_SESSION, sessionId)
                .then((session: SessionRow | undefined) => {
                  if (!this.mounted) return;
                  // `undefined` is 6c's second shape — a session id that resolves
                  // to nothing. It is carried as null and the re-entry says the
                  // platform cannot establish the arm, never that it is unknown.
                  this.setState({ returnSessionId: sessionId, returnSession: session ?? null });
                })
                .catch(() => {
                  if (this.mounted) this.setState({ returnSessionId: sessionId, returnSession: null });
                });
            },
          });
      // Progress readouts sit BELOW the table rather than inside SitesTab, so
      // the tab component stays a pure function of its props.
      //
      // Both moved here from Operations' zone 1 when it was gutted, and both
      // had to survive it. BulkOperationsPanel is the only progress readout for
      // BULK_EXECUTE, which is exactly what this tab's bulk bar dispatches.
      // The WPE sync block is NOT the deleted button's: `checkWpeSyncStatus`
      // runs on mount and fills `wpeSyncProgress` for a sync the scheduler
      // started, so dropping it would hide background syncs entirely.
      case 'sites': return React.createElement('div', null,
        // Round-7 item 7: the collapse happened. Properties IS the sites
        // list — the unit is the product's decision, not a toggle. SitesTab
        // and FleetTab are retired by this packet (files kept; the bulk
        // contract lives on in PropertiesTab's own scope block).
        this.renderPropertiesTab(),
        // Background syncs the scheduler started stay visible; renders null
        // when idle, so it is never an empty panel (round-3 finding 4).
        this.renderWpeSyncProgress(),
      );
      case 'record': return this.renderRecordTab();
      case 'settings': return React.createElement(SettingsTab, {
        electron: this.props.electron,
        door: this.state.governDoor,
        // Cleared by its consumer, so re-rendering the dashboard for any other
        // reason does not re-open the section and re-mark the row.
        onDoorHandled: () => {
          nexusStore.update({ governDoorRequest: null });
          if (this.mounted) this.setState({ governDoor: null });
        },
        openSection: this.state.settingsSection,
        onSectionOpened: () => { if (this.mounted) this.setState({ settingsSection: null }); },
      });
      // 'agents' case handled in render() directly (no stats dependency)
      // Sites is the landing tab; fallback points there to handle any stale/in-flight 'overview' value
      default: return this.renderPropertiesTab();
    }
  }

  // WPE Sync progress polling
  private wpeSyncPollInterval: NodeJS.Timeout | null = null;

  async checkWpeSyncStatus(): Promise<void> {
    try {
      const statusResult = await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.WPE_SYNC_STATUS);
      if (statusResult.success && statusResult.progress) {
        if (statusResult.progress.status === 'running') {
          this.setState({
            wpeSyncing: true,
            wpeSyncProgress: statusResult.progress,
          });
          this.startWpeSyncProgressPolling();
        }
      }
    } catch (err) {
      console.error('[FleetOverview] Failed to check WPE sync status:', err);
    }
  }

  startWpeSyncProgressPolling = (): void => {
    if (this.wpeSyncPollInterval) {
      clearInterval(this.wpeSyncPollInterval);
    }

    this.wpeSyncPollInterval = setInterval(async () => {
      try {
        const statusResult = await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.WPE_SYNC_STATUS);
        if (statusResult.success && statusResult.progress) {
          this.setState({
            wpeSyncing: statusResult.progress.status === 'running',
            wpeSyncProgress: statusResult.progress,
          });

          // Stop polling if sync completed or failed
          if (statusResult.progress.status === 'completed' || statusResult.progress.status === 'failed') {
            this.stopWpeSyncProgressPolling();
            // Refresh WPE sites after sync completes
            await this.fetchAll();
          }
        }
      } catch (err) {
        console.error('[FleetOverview] Failed to poll WPE sync status:', err);
      }
    }, 2000); // Poll every 2 seconds
  };

  stopWpeSyncProgressPolling = (): void => {
    if (this.wpeSyncPollInterval) {
      clearInterval(this.wpeSyncPollInterval);
      this.wpeSyncPollInterval = null;
    }
  };

  handleDiag = async (args: string[]): Promise<void> => {
    const { diagInstall } = this.state;
    if (!diagInstall.trim() || this.state.diagRunning) return;
    const cmd = args.join(' ');
    this.setState({ diagRunning: true });
    const result = await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.WPE_DIAGNOSE, {
      installName: diagInstall.trim(),
      args,
    });
    this.setState((prev) => ({
      diagRunning: false,
      diagResults: [{ cmd, ...result }, ...prev.diagResults].slice(0, 20),
    }));
  };

  handleCreateWPEBackup = async (): Promise<void> => {
    const { wpeSites } = this.state;
    if (wpeSites.length === 0) {
      if (toast) toast({ type: 'error', content: 'No WP Engine installs found. Run a WPE sync first.' });
      return;
    }

    let installId: string;
    let installName: string;

    if (wpeSites.length === 1) {
      installId = wpeSites[0].wpeInstallId || wpeSites[0].id;
      installName = wpeSites[0].name;
    } else {
      // Build a simple install list for the user to choose from
      const choices = wpeSites
        .map((s, i) => `${i + 1}. ${s.name} (${s.wpeInstallId || s.id})`)
        .join('\n');
      const choice = (window as any).prompt(
        `Select WP Engine install to back up:\n\n${choices}\n\nEnter number:`,
        '1',
      );
      if (!choice) return;
      const idx = parseInt(choice, 10) - 1;
      if (isNaN(idx) || idx < 0 || idx >= wpeSites.length) {
        if (toast) toast({ type: 'error', content: 'Invalid selection.' });
        return;
      }
      installId = wpeSites[idx].wpeInstallId || wpeSites[idx].id;
      installName = wpeSites[idx].name;
    }

    this.setState({ wpeBackupRunning: true, wpeBackupInstallId: installId, wpeBackupInstallName: installName });
    try {
      const result = await this.props.electron.ipcRenderer.invoke(
        IPC_CHANNELS.WPE_CREATE_BACKUP,
        { installId },
      );
      if (!this.mounted) return;
      if (result.success) {
        if (toast) toast({ type: 'success', content: `Backup created for ${installName}` });
      } else {
        if (toast) toast({ type: 'error', content: `Backup failed: ${result.error}` });
      }
    } catch (err: any) {
      if (!this.mounted) return;
      if (toast) toast({ type: 'error', content: `Backup error: ${err.message}` });
    } finally {
      if (this.mounted) {
        this.setState({ wpeBackupRunning: false, wpeBackupInstallId: null, wpeBackupInstallName: null });
      }
    }
  };

  handleSyncWPEMetadataNow = async (): Promise<void> => {
    if (this.state.wpeSyncNowRunning || this.state.wpeSyncing) return;
    this.setState({ wpeSyncNowRunning: true });
    try {
      const result = await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.WPE_SYNC_ALL);
      if (!this.mounted) return;
      if (result.success) {
        const count = result.synced ?? 0;
        if (toast) toast({ type: 'success', content: `WP Engine metadata synced — ${count} install${count !== 1 ? 's' : ''} updated` });
        await this.fetchAll();
      } else {
        if (toast) toast({ type: 'error', content: `Sync failed: ${result.error}. Check nexus wpe status for recovery guidance.` });
      }
    } catch (err: any) {
      if (!this.mounted) return;
      if (toast) toast({ type: 'error', content: `Sync error: ${err.message}` });
    } finally {
      if (this.mounted) this.setState({ wpeSyncNowRunning: false });
    }
  };

  render(): React.ReactNode {
    const { loading, error, stats, activeTab } = this.state;

    return React.createElement('div', {
      style: { display: 'flex', flexDirection: 'column' as const, width: '100%', height: '100%', overflow: 'hidden', color: 'var(--nxai-card-text)', userSelect: 'text' as const },
    },
      // Header: title + tab bar (fixed)
      React.createElement('div', {
        style: { flexShrink: 0, padding: '24px 32px 0' },
      },
        // XD-27 · "the title bar returns to Now the way a logo does." It is a
        // control and not a tab: it sits outside the strip, it never renders an
        // active underline, and it goes one place. That is what keeps Now from
        // becoming a peer of the three destinations beside it.
        React.createElement('h1', {
          style: {
            fontSize: '22px', fontWeight: 600, marginBottom: '16px',
            color: 'var(--nxai-card-text)', cursor: 'pointer',
          },
          'data-testid': 'nexus-mark-home',
          role: 'button',
          tabIndex: 0,
          title: 'Now',
          onClick: () => this.setState({ activeTab: 'now' }),
          onKeyDown: (e: any) => {
            if (e.key === 'Enter' || e.key === ' ') this.setState({ activeTab: 'now' });
          },
        }, 'Nexus AI'),
        this.renderTabBar(),
      ),

      // Content: each tab fills remaining height and scrolls independently
      // Agents tab: no stats dependency — renders AgentConsoleTab directly
      activeTab === 'agents'
        ? React.createElement('div', {
            style: { flexGrow: 1, overflow: 'auto' as const, display: 'flex', flexDirection: 'column' as const },
          },
            React.createElement(AgentConsoleTab, {
              electron: this.props.electron,
              onNavigateToInbox: () => this.setState({ activeTab: 'now' }),
              onOpenSettingsSection: this.openSettingsSection,
            }),
          )
        : loading
          ? React.createElement('div', {
              style: { padding: '40px 32px', color: 'var(--nxai-card-sub)', textAlign: 'center' as const },
            }, 'Loading dashboard...')
          : error
            ? React.createElement('div', {
                style: { padding: '40px 32px', color: UI_COLORS.STATUS_ERROR, textAlign: 'center' as const },
              }, `Error: ${error}`)
            : stats
              ? React.createElement('div', {
                  ref: (el: HTMLDivElement | null) => { this.contentScrollEl = el; },
                  style: { flex: 1, overflowY: 'auto' as const, padding: '24px 32px', display: 'flex', flexDirection: 'column' as const },
                }, this.renderActiveTab())
              : null,
      // Run lifecycle overlays — mounted here (always-mounted parent) so they survive tab switches
      React.createElement(RunToast, {
        onViewProgress: () => runStore.toggleDrawer(),
        onViewReport: () => runStore.toggleDrawer(),
      }),
      React.createElement(RunPill, { onOpen: () => runStore.toggleDrawer() }),
      React.createElement(RunDrawer, { electron: this.props.electron }),
      React.createElement(CredentialConsentModal, {
        electron: this.props.electron,
        request: this.state.credentialRequest
          ? { ...this.state.credentialRequest, scopes: this.state.credentialRequest.scopes ?? [] }
          : null,
        onDismiss: () => {
          nexusStore.update({ credentialConnectRequest: null });
          this.setState({ credentialRequest: null });
        },
      }),
    );
  }
}
