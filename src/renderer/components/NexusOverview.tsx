/**
 * Nexus Overview Dashboard
 *
 * Addon dashboard with six tabs: Overview, Inbox, Sites, Activity, Agents, Settings.
 * Operations was retired in spec 6a (Task 11); its five maintenance actions moved
 * to Settings → Advanced.
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
import { AssistantPanel } from './AssistantPanel';
import { AgentConsoleTab } from './agents/AgentConsoleTab';
import { agentStore } from './agents/AgentStore';
import { runStore } from './agents/RunStore';
import { RunToast } from './agents/RunToast';
import { RunPill } from './agents/RunPill';
import { RunDrawer } from './agents/RunDrawer';
import { CredentialConsentModal } from './credentials/CredentialConsentModal';
import { cardContainerStyle, cardStyle, cardTitleStyle, renderSectionLabel } from './tabs/shared/cards';
import { InboxTab } from './tabs/InboxTab';
import { SitesTab, BULK_CONFIRM_THRESHOLD, type BulkJobView } from './tabs/SitesTab';
// Types only — a value import would pull main-process code into the renderer
// bundle. Precedent: credentials/ConnectionsPanel.tsx:3.
import type { SiteRow } from '../../main/fleet/siteRows';
import type { PopulationCount } from '../../main/fleet/FleetCounts';
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
  { key: 'sites',      label: 'Sites' },
  { key: 'inbox',      label: 'Inbox' },
  { key: 'activity',   label: 'Activity' },
  { key: 'agents',     label: 'Agents' },
  { key: 'settings',   label: 'Settings' },
] as const;

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
  /** Sites table. `siteRowsFailed` is distinct from an empty list — see SitesTab. */
  siteRows: SiteRow[];
  siteRowsTotal: PopulationCount;
  siteRowsLoaded: boolean;
  siteRowsFailed: boolean;
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
  inboxCounts: { decide: number; problem: number; know: number };
  inboxPausedSources: string[];
  inboxRecentlyDecided: InboxItem[];
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
    activeTab: 'sites',
    siteRows: [],
    // Not zero-with-a-scope: nothing has been read yet, and the empty scope
    // string is what `loaded: false` renders behind anyway.
    siteRowsTotal: { count: 0, scope: '' },
    siteRowsLoaded: false,
    siteRowsFailed: false,
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
    inboxCounts: { decide: 0, problem: 0, know: 0 },
    inboxPausedSources: [],
    inboxRecentlyDecided: [],
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
      const [stats, mcpInfo, sites, indexEntries, proxyResult, settings, wpeSitesResult, fleetSummaryResult, wpeAccounts, startupStatus, inboxResult, siteRowsResult] = await Promise.all([
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
        // These two are positionally bound to `inboxResult` and `siteRowsResult`
        // above, in this order. A rejected invoke would reject the whole
        // Promise.all and blank every other panel, so each resolves to the same
        // failure shape its handler returns. `success: false` is NOT an empty
        // result — SitesTab renders "couldn't read your sites" for it.
        ipc.invoke(IPC_CHANNELS.GET_INBOX).catch(() => ({ success: false })),
        ipc.invoke(IPC_CHANNELS.GET_SITE_ROWS).catch(() => ({ success: false, rows: [], total: { count: 0, scope: '' } })),
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
        inboxCounts: inboxResult?.counts ?? { decide: 0, problem: 0, know: 0 },
        inboxPausedSources: inboxResult?.pausedSources ?? [],
        inboxRecentlyDecided: inboxResult?.recentlyDecided ?? [],
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


  renderActivityTab(): React.ReactNode {
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
      ...tabs.map((tab) => {
        const isActive = activeTab === tab.key;
        return React.createElement('div', {
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
  handleSiteBulk = async (type: string, siteIds: string[]): Promise<void> => {
    if (siteIds.length === 0) return;

    if (siteIds.length > BULK_CONFIRM_THRESHOLD && !this.confirmLargeBulk(type, siteIds)) return;

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
        siteNames: this.state.siteRows.reduce((acc: Record<string, string>, r) => {
          if (siteIds.indexOf(r.id) !== -1) acc[r.id] = r.name;
          return acc;
        }, {}),
        options: {},
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

  renderActiveTab(): React.ReactNode {
    switch (this.state.activeTab) {
      case 'inbox': return React.createElement(InboxTab, {
        loaded: this.state.inboxLoaded,
        failed: this.state.inboxFailed,
        items: this.state.inboxItems,
        total: this.state.inboxTotal,
        counts: this.state.inboxCounts,
        pausedSources: this.state.inboxPausedSources,
        recentlyDecided: this.state.inboxRecentlyDecided,
        onDecide: async (id: number, decision: string, status: 'dismissed' | 'done') => {
          await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.INBOX_DECIDE, { id, decision, status });
          void this.fetchAll();
        },
        onReopen: async (id: number) => {
          await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.INBOX_REOPEN, { id });
          void this.fetchAll();
        },
        onResumeAgent: async (agentId: string) => {
          await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.AGENT_RESUME, { agentId });
          void this.fetchAll();
        },
        onRetry: () => { void this.fetchAll(); },
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
        React.createElement(SitesTab, {
        loaded: this.state.siteRowsLoaded,
        failed: this.state.siteRowsFailed,
        rows: this.state.siteRows,
        total: this.state.siteRowsTotal,
        selected: this.state.selectedSiteIds,
        onToggle: this.toggleSiteSelection,
        onToggleAll: this.toggleAllSiteSelection,
        onBulk: (type: string, ids: string[]) => { void this.handleSiteBulk(type, ids); },
        // One site, through the same audited bulk path as everything else —
        // not `nexus host index <alias>`, which fans out over the connection.
        onIndexHost: (siteId: string) => { void this.handleSiteBulk('reindex', [siteId]); },
        onRetry: () => { void this.fetchAll(); },
        job: this.state.bulkJob,
        onCancelJob: this.cancelBulkJob,
        onDismissJob: this.dismissBulkJob,
        onSelectFailed: (ids: string[]) => this.setState({ selectedSiteIds: ids, bulkJob: null }),
        }),
        this.renderWpeSyncProgress(),
        React.createElement(BulkOperationsPanel, {
          electron: this.props.electron,
          siteNames: new Map(Object.values(this.state.sites || {}).map((s: any) => [s.id, s.name])),
        }),
      );
      case 'activity': return this.renderActivityTab();
      case 'settings': return React.createElement(SettingsTab, { electron: this.props.electron });
      // 'agents' case handled in render() directly (no stats dependency)
      // Sites is the landing tab; fallback points there to handle any stale/in-flight 'overview' value
      default: return React.createElement(SitesTab, {
        loaded: this.state.siteRowsLoaded,
        failed: this.state.siteRowsFailed,
        rows: this.state.siteRows,
        total: this.state.siteRowsTotal,
        selected: this.state.selectedSiteIds,
        onToggle: this.toggleSiteSelection,
        onToggleAll: this.toggleAllSiteSelection,
        onBulk: (type: string, ids: string[]) => { void this.handleSiteBulk(type, ids); },
        onIndexHost: (siteId: string) => { void this.handleSiteBulk('reindex', [siteId]); },
        onRetry: () => { void this.fetchAll(); },
      });
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
        React.createElement('h1', {
          style: { fontSize: '22px', fontWeight: 600, marginBottom: '16px', color: 'var(--nxai-card-text)' },
        }, 'Nexus AI Dashboard'),
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
              onNavigateToInbox: () => this.setState({ activeTab: 'inbox' }),
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
