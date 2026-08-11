/**
 * Nexus Overview Dashboard
 *
 * Simplified addon dashboard with Overview and Operations tabs only.
 * Sites, Content, and Chat have been extracted to separate interfaces.
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
import { OverviewTab } from './tabs/OverviewTab';
import { InboxTab } from './tabs/InboxTab';
import { SitesTab } from './tabs/SitesTab';
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
  { key: 'overview',   label: 'Dashboard' },
  { key: 'inbox',      label: 'Inbox' },
  { key: 'sites',      label: 'Sites' },
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
    activeTab: 'overview',
    siteRows: [],
    // Not zero-with-a-scope: nothing has been read yet, and the empty scope
    // string is what `loaded: false` renders behind anyway.
    siteRowsTotal: { count: 0, scope: '' },
    siteRowsLoaded: false,
    siteRowsFailed: false,
    selectedSiteIds: [],
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
        const day = now.toISOString().slice(0, 10);
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
      React.createElement('span', { style: { color: 'var(--nxai-status-neutral, #9ca3af)' } }, '· Manage in Preferences → Nexus AI'),
    );
  }

  /**
   * Operations is a HOLDING PEN, not a destination. Do not "finish the job" by
   * deleting it.
   *
   * Spec 5 moved its two real zones out: the data-currency buttons became
   * selection-scoped actions on the Sites table, and the per-site list (
   * the per-site list) became the table itself. What is left is zone 3 — Factory
   * Reset, Reset Content Index, Database Health, Housekeeping, SSH Diagnostics.
   *
   * Those are app-level maintenance with no per-site meaning, so they cannot
   * become bulk actions. Their destination is the Advanced section **spec 6**
   * builds in Settings. Deleting this tab before that lands would make all five
   * unreachable from the UI for the entire gap between the two specs.
   *
   * Spec 6 empties this and removes the tab. Until then it stays.
   */
  renderOperationsTab(): React.ReactNode {
    const { opsAdvancedExpanded } = this.state;

    // ── Zone 3: Advanced (collapsed by default) ───────────────────────────────
    const advancedItems = [
      'Factory Reset',
      'Reset Content Index',
      'Database Health',
      'Housekeeping',
      'SSH Diagnostics',
    ];

    const zone3 = React.createElement('div', null,
      // Collapsible header
      React.createElement('div', {
        'data-testid': 'ops-advanced-toggle',
        onClick: () => this.setState({ opsAdvancedExpanded: !opsAdvancedExpanded }),
        style: {
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 14px', cursor: 'pointer', userSelect: 'none' as const,
          border: '1px solid var(--nxai-card-border, #e5e7eb)', borderRadius: opsAdvancedExpanded ? '8px 8px 0 0' : 8,
          background: 'var(--nxai-card-bg, #fff)',
        },
      },
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          React.createElement('span', { style: { fontSize: 13, fontWeight: 600 } }, 'Advanced'),
          React.createElement('span', { style: { fontSize: 11, color: 'var(--nxai-card-sub, #6b7280)', opacity: 0.7 } },
            advancedItems.join(' · '),
          ),
        ),
        React.createElement('span', {
          style: { fontSize: 9, color: 'var(--nxai-card-sub, #6b7280)', display: 'inline-block', transform: opsAdvancedExpanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' },
        }, '▶'),
      ),

      // Expanded body
      opsAdvancedExpanded
        ? React.createElement('div', {
            style: { border: '1px solid var(--nxai-card-border, #e5e7eb)', borderTop: 'none', borderRadius: '0 0 8px 8px', padding: '20px 20px 8px', background: 'var(--nxai-card-bg, #fff)' },
          },
            renderSectionLabel('Factory Reset'),
            this.renderFactoryReset(),
            renderSectionLabel('Reset Content Index'),
            this.renderContentIndexReset(),
            renderSectionLabel('Database Health'),
            this.renderDbScanSection(),
            renderSectionLabel('Housekeeping'),
            this.renderContentMaintenance(),
            renderSectionLabel('SSH Diagnostics'),
            this.renderSshDiagnostics(),
          )
        : null,
    );

    return React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const } },
      zone3,
    );
  }

  renderFactoryReset(): React.ReactNode {
    const { factoryResetConfirming, factoryResetRunning, factoryResetDone, factoryResetChecked } = this.state;

    if (factoryResetDone) {
      return React.createElement('div', {
        style: { padding: '10px 14px', background: 'rgba(81,187,123,0.06)', border: '1px solid rgba(81,187,123,0.2)', borderRadius: 7, marginBottom: 24, fontSize: 12, color: '#51BB7B' },
      },
        '✓ All Nexus AI data deleted. ',
        React.createElement('strong', null, 'Restart Local'),
        ' to complete the reset.',
        React.createElement('button', {
          onClick: () => this.setState({ factoryResetDone: false }),
          style: { marginLeft: 12, background: 'none', border: 'none', color: '#51BB7B', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' },
        }, 'Dismiss'),
      );
    }

    return React.createElement('div', { style: { marginBottom: 24 } },
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: factoryResetConfirming ? 10 : 0 } },
        React.createElement('button', {
          onClick: () => this.setState(prev => ({ factoryResetConfirming: !prev.factoryResetConfirming, factoryResetChecked: false })),
          style: {
            padding: '7px 14px', borderRadius: 5, fontSize: 12, fontWeight: 600,
            cursor: factoryResetRunning ? 'not-allowed' : 'pointer',
            border: '1px solid rgba(239,68,68,0.35)',
            background: factoryResetConfirming ? 'rgba(239,68,68,0.08)' : 'var(--nxai-card-bg)',
            color: '#ef4444', opacity: factoryResetRunning ? 0.5 : 1,
          },
          disabled: factoryResetRunning,
        }, factoryResetRunning ? 'Resetting…' : '⚠ Factory Reset'),
        React.createElement('span', { style: { fontSize: 12, color: 'var(--nxai-card-sub, #6b7280)' } },
          'Deletes all Nexus AI data — graph, vectors, settings, site configs.',
        ),
      ),

      factoryResetConfirming ? React.createElement('div', {
        style: { padding: '12px 14px', background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 7 },
      },
        React.createElement('div', { style: { fontSize: 12, marginBottom: 10, lineHeight: 1.55 } },
          React.createElement('strong', { style: { color: '#ef4444' } }, 'Permanently deletes:'),
          React.createElement('ul', { style: { margin: '5px 0 5px 16px', color: 'var(--nxai-card-sub, #6b7280)', fontSize: 11 } },
            React.createElement('li', null, 'IndexRegistry · SiteMetadataCache · Settings'),
            React.createElement('li', null, 'API key status · Site AI configs · WPE install cache'),
            React.createElement('li', null, 'Graph DB (plugins, themes, users, events)'),
            React.createElement('li', null, 'Vector store — all embeddings'),
          ),
          React.createElement('div', { style: { fontSize: 11, color: 'var(--nxai-card-sub, #6b7280)', marginTop: 5 } },
            '✓ API keys (Keychain), WPE OAuth, and telemetry ID are ',
            React.createElement('strong', null, 'not affected'),
            '. Restart Local after reset.',
          ),
        ),
        React.createElement('label', { style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer', marginBottom: 10 } },
          React.createElement('input', {
            type: 'checkbox', checked: factoryResetChecked,
            onChange: (e: any) => this.setState({ factoryResetChecked: e.target.checked }),
          }),
          'I understand — this cannot be undone',
        ),
        React.createElement('div', { style: { display: 'flex', gap: 8 } },
          React.createElement('button', {
            disabled: !factoryResetChecked || factoryResetRunning,
            onClick: async () => {
              this.setState({ factoryResetRunning: true });
              const result = await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.FACTORY_RESET);
              if (result?.success) {
                this.setState({ factoryResetRunning: false, factoryResetConfirming: false, factoryResetDone: true, factoryResetChecked: false });
              } else {
                this.setState({ factoryResetRunning: false });
                (window as any).showToast?.(`Reset failed: ${result?.error}`, 'error');
              }
            },
            style: {
              padding: '6px 14px', borderRadius: 5, border: 'none', fontSize: 12, fontWeight: 600,
              cursor: !factoryResetChecked || factoryResetRunning ? 'not-allowed' : 'pointer',
              background: !factoryResetChecked ? '#444' : '#ef4444', color: '#fff',
              opacity: !factoryResetChecked ? 0.5 : 1, fontFamily: 'inherit',
            },
          }, factoryResetRunning ? 'Resetting…' : 'Reset Everything'),
          React.createElement('button', {
            onClick: () => this.setState({ factoryResetConfirming: false, factoryResetChecked: false }),
            style: { padding: '6px 14px', borderRadius: 5, border: '1px solid var(--nxai-card-border)', fontSize: 12, background: 'var(--nxai-card-bg)', color: 'inherit', cursor: 'pointer', fontFamily: 'inherit' },
          }, 'Cancel'),
        ),
      ) : null,
    );
  }

  renderContentIndexReset(): React.ReactNode {
    const { indexResetConfirming, indexResetRunning, indexResetResult, indexEntries, _resetConfirmChecked } = this.state;
    const sub: React.CSSProperties = { fontSize: '12px', color: 'var(--nxai-card-sub)' };

    const indexedCount = (indexEntries ?? []).filter((e: any) => e.state === 'indexed' || e.state === 'stale').length;
    const totalDocs = (indexEntries ?? []).reduce((s: number, e: any) => s + (e.documentCount ?? 0), 0);

    if (indexResetResult) {
      return React.createElement('div', { style: { marginBottom: '24px' } },
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 14px', background: 'rgba(81,187,123,0.06)', border: '1px solid rgba(81,187,123,0.2)', borderRadius: '7px', fontSize: '12px', color: '#51BB7B' } },
          '✓ Content index cleared — ',
          React.createElement('span', { style: { color: 'var(--nxai-card-sub)' } }, `${indexResetResult.siteCount} site${indexResetResult.siteCount !== 1 ? 's' : ''}, ${indexResetResult.docCount.toLocaleString()} documents removed. Content will be re-indexed when sites start.`),
          React.createElement('button', {
            onClick: () => this.setState({ indexResetResult: null }),
            style: { marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--nxai-card-sub)', fontSize: '11px', cursor: 'pointer', fontFamily: 'inherit', padding: '0 4px' },
          }, 'Dismiss'),
        ),
      );
    }

    return React.createElement('div', { style: { marginBottom: '24px' } },
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: indexResetConfirming ? '10px' : '0' } },
        React.createElement('button', {
          disabled: indexResetRunning,
          onClick: () => this.setState({ indexResetConfirming: !indexResetConfirming, indexResetResult: null }),
          style: {
            padding: '7px 14px', borderRadius: '5px', border: '1px solid var(--nxai-card-border)', fontSize: '12px',
            fontWeight: 600, cursor: indexResetRunning ? 'not-allowed' : 'pointer',
            background: 'var(--nxai-card-bg)', color: indexResetConfirming ? '#f87171' : 'inherit',
            opacity: indexResetRunning ? 0.6 : 1,
          },
        }, indexResetRunning ? 'Resetting…' : 'Reset Content Index'),
        React.createElement('span', { style: sub },
          indexedCount > 0
            ? `${indexedCount} site${indexedCount !== 1 ? 's' : ''} · ${totalDocs.toLocaleString()} documents · vectors only, graph and metadata untouched`
            : 'Clears vector index and registry — graph DB, metadata, and settings are untouched',
        ),
      ),

      // Inline confirmation panel
      indexResetConfirming ? React.createElement('div', {
        style: { padding: '12px 14px', background: 'rgba(248,113,113,0.05)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: '7px' },
      },
        React.createElement('div', { style: { fontSize: '12px', marginBottom: '10px', lineHeight: 1.5 } },
          React.createElement('strong', { style: { color: '#f87171' } }, 'This will permanently delete:'),
          React.createElement('ul', { style: { margin: '6px 0 0 16px', color: 'var(--nxai-card-sub)' } },
            React.createElement('li', null, `sqlite-vec vector tables for ${indexedCount} site${indexedCount !== 1 ? 's' : ''} (${totalDocs.toLocaleString()} documents)`),
            React.createElement('li', null, 'All IndexRegistry entries (sites will show as unindexed)'),
          ),
          React.createElement('div', { style: { marginTop: '6px', color: 'var(--nxai-card-sub)' } },
            '✓ Graph DB, site metadata, AI config, WPE cache, and settings are ',
            React.createElement('strong', null, 'not affected'),
            '. Auto-index will rebuild when sites start.',
          ),
        ),
        React.createElement('label', { style: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', cursor: 'pointer', marginBottom: '10px' } },
          React.createElement('input', {
            type: 'checkbox',
            id: 'reset-index-confirm',
            onChange: (e: any) => this.setState({ _resetConfirmChecked: e.target.checked }),
          }),
          'I understand — auto-index will rebuild when sites start',
        ),
        React.createElement('div', { style: { display: 'flex', gap: '8px' } },
          React.createElement('button', {
            disabled: indexResetRunning || !_resetConfirmChecked,
            onClick: async () => {
              this.setState({ indexResetRunning: true });
              const result = await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.RESET_CONTENT_INDEX);
              this.setState({
                indexResetRunning: false,
                indexResetConfirming: false,
                indexResetResult: result.success ? { siteCount: result.siteCount, docCount: result.docCount } : null,
                _resetConfirmChecked: false,
              });
              if (!result.success) {
                (window as any).showToast?.(`Reset failed: ${result.error}`, 'error');
              }
            },
            style: {
              padding: '6px 14px', borderRadius: '5px', border: 'none', fontSize: '12px', fontWeight: 600,
              cursor: !_resetConfirmChecked || indexResetRunning ? 'not-allowed' : 'pointer',
              background: !_resetConfirmChecked ? '#444' : '#ef4444',
              color: '#fff', opacity: !_resetConfirmChecked ? 0.5 : 1,
              fontFamily: 'inherit',
            },
          }, indexResetRunning ? 'Resetting…' : 'Reset Index'),
          React.createElement('button', {
            onClick: () => this.setState({ indexResetConfirming: false, _resetConfirmChecked: false }),
            style: { padding: '6px 14px', borderRadius: '5px', border: '1px solid var(--nxai-card-border)', fontSize: '12px', background: 'var(--nxai-card-bg)', color: 'inherit', cursor: 'pointer', fontFamily: 'inherit' },
          }, 'Cancel'),
        ),
      ) : null,
    );
  }

  renderDbScanSection(): React.ReactNode {
    const { dbScanRunning, dbScanResults } = this.state;
    const sub: React.CSSProperties = { fontSize: '12px', color: 'var(--nxai-card-sub)' };

    const scoreColor = (score?: number) => {
      if (score === undefined) return '#6b7280';
      if (score >= 90) return UI_COLORS.STATUS_RUNNING;
      if (score >= 70) return UI_COLORS.STATUS_WARNING;
      return UI_COLORS.STATUS_ERROR;
    };

    return React.createElement('div', { style: { marginBottom: '24px' } },
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' } },
        React.createElement('button', {
          style: {
            padding: '7px 14px', borderRadius: '5px', border: 'none', fontSize: '12px',
            fontWeight: 600, cursor: dbScanRunning ? 'not-allowed' : 'pointer',
            backgroundColor: dbScanRunning ? '#9ca3af' : '#3b82f6', color: '#fff',
            opacity: dbScanRunning ? 0.7 : 1,
          },
          disabled: dbScanRunning,
          onClick: async () => {
            this.setState({ dbScanRunning: true, dbScanResults: null });
            const result = await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.DB_SCAN_ALL);
            this.setState({
              dbScanRunning: false,
              dbScanResults: result.success ? result.scans : null,
            });
            if (!result.success) {
              (window as any).showToast?.(`DB scan failed: ${result.error}`, 'error');
            }
          },
        }, dbScanRunning ? 'Scanning...' : 'Scan All Running Sites'),
        dbScanResults
          ? React.createElement('span', { style: sub }, `${dbScanResults.length} site${dbScanResults.length !== 1 ? 's' : ''} scanned`)
          : React.createElement('span', { style: sub }, 'Scans all running local sites for database health issues'),
      ),

      // Results table
      dbScanResults && dbScanResults.length > 0
        ? React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: '6px' } },
            dbScanResults.map((scan) =>
              React.createElement('div', {
                key: scan.siteId,
                style: {
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '8px 12px', borderRadius: '5px',
                  backgroundColor: 'var(--nxai-card-bg, #fff)',
                  border: '1px solid var(--nxai-card-border, #e5e7eb)',
                },
              },
                React.createElement('span', { style: { fontSize: '13px', fontWeight: 500, color: 'var(--nxai-card-text)' } },
                  scan.siteName,
                ),
                scan.error
                  ? React.createElement('span', { style: { fontSize: '12px', color: UI_COLORS.STATUS_ERROR } }, `Error: ${scan.error}`)
                  : React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '12px' } },
                      React.createElement('span', {
                        style: { fontSize: '14px', fontWeight: 700, color: scoreColor(scan.healthScore) },
                      }, `${scan.healthScore ?? '?'}/100`),
                      scan.issues && scan.issues.length > 0
                        ? React.createElement('span', { style: { fontSize: '11px', color: 'var(--nxai-card-sub)' } },
                            `${scan.issues.length} issue${scan.issues.length !== 1 ? 's' : ''}`,
                          )
                        : React.createElement('span', { style: { fontSize: '11px', color: UI_COLORS.STATUS_RUNNING } }, '✓ clean'),
                    ),
              ),
            ),
          )
        : null,
    );
  }

  renderContentMaintenance(): React.ReactNode {
    const sub: React.CSSProperties = { fontSize: '12px', color: 'var(--nxai-card-sub)' };
    const dangerBtn: React.CSSProperties = {
      padding: '7px 14px', borderRadius: '5px', border: '1px solid #ef4444', fontSize: '12px',
      fontWeight: 600, cursor: 'pointer', backgroundColor: 'transparent', color: '#ef4444',
    };
    const grayBtn: React.CSSProperties = {
      padding: '7px 14px', borderRadius: '5px', border: 'none', fontSize: '12px',
      fontWeight: 600, cursor: 'pointer', backgroundColor: '#6b7280', color: '#fff',
    };

    return React.createElement('div', { style: { marginBottom: '24px' } },
      React.createElement('div', { style: { display: 'flex', gap: '10px', flexWrap: 'wrap' as const } },

        React.createElement('button', {
          style: grayBtn,
          title: 'Remove WPE installs that no longer exist in CAPI (marked inactive after CAPI sync)',
          onClick: async () => {
            const result = await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.CLEANUP_GHOST_INSTALLS);
            if (result.success) {
              (window as any).showToast?.(`Removed ${result.removed} ghost install${result.removed !== 1 ? 's' : ''} from graph`, 'success');
              await this.fetchAll();
            }
          },
        }, 'Remove Ghost Installs'),

        React.createElement('button', {
          style: dangerBtn,
          onClick: async () => {
            if (!(window as any).confirm?.('This will clear all graph and vector data then run a full sync. Continue?')) return;
            (window as any).showToast?.('Resetting data — full sync starting, this will take a while...', 'info');
            const result = await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.RESET_AND_REFRESH);
            if (result.success) {
              (window as any).showToast?.(
                `Reset complete: ${result.capiInstalls} CAPI installs, ${result.sshSynced} SSH synced, ${result.vectorTablesDropped} vector tables cleared`,
                'success',
              );
              await this.fetchAll();
            } else {
              (window as any).showToast?.(`Reset failed: ${result.error}`, 'error');
            }
          },
        }, 'Reset & Refresh All Data'),
      ),

      React.createElement('div', { style: { ...sub, marginTop: '8px' } },
        'Reset: clears graph + vector store, then runs full CAPI + SSH sync. Takes ~30 min for full fleet.',
      ),
    );
  }

  renderSshDiagnostics(): React.ReactNode {
    const { diagInstall, diagRunning, diagResults } = this.state;
    const sub: React.CSSProperties = { fontSize: '11px', color: 'var(--nxai-card-sub)' };
    const btnStyle: React.CSSProperties = {
      padding: '5px 10px', borderRadius: '4px', border: '1px solid var(--nxai-card-border, #30363d)',
      backgroundColor: 'var(--nxai-card-bg, #21262d)', color: 'var(--nxai-card-text, #e6edf3)',
      fontSize: '11px', cursor: diagRunning ? 'not-allowed' : 'pointer',
      opacity: diagRunning ? 0.5 : 1, fontFamily: 'monospace',
    };

    const PRESETS: Array<{ label: string; args: string[] }> = [
      { label: 'wp core version', args: ['core', 'version'] },
      { label: 'wp plugin list', args: ['plugin', 'list', '--format=json'] },
      { label: 'wp user list', args: ['user', 'list', '--format=json'] },
      { label: 'wp post-type list', args: ['post-type', 'list', '--format=json'] },
      { label: 'wp post list (5)', args: ['post', 'list', '--format=json', '--posts_per_page=5', '--fields=ID,post_title,post_type'] },
      { label: 'wp cli info', args: ['cli', 'info'] },
    ];

    return React.createElement('div', { style: { marginBottom: '24px' } },
      React.createElement('div', { style: { ...sub, marginBottom: '8px' } },
        'Run WP-CLI commands against any WPE install to diagnose SSH/timing issues.',
      ),

      // Install input
      React.createElement('div', { style: { display: 'flex', gap: '8px', marginBottom: '8px', alignItems: 'center' } },
        React.createElement('input', {
          type: 'text',
          placeholder: 'install-name (e.g. acfrecipes)',
          value: diagInstall,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => this.setState({ diagInstall: e.target.value }),
          style: {
            padding: '5px 10px', borderRadius: '4px', fontSize: '12px', fontFamily: 'monospace',
            border: '1px solid var(--color-border-primary, #ccc)', width: '220px',
            backgroundColor: 'var(--nxai-input-bg, transparent)',
          },
        }),
        diagRunning
          ? React.createElement('span', { style: { ...sub, fontStyle: 'italic' } }, 'running…')
          : null,
      ),

      // Preset command buttons
      React.createElement('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' as const, marginBottom: '8px' } },
        PRESETS.map(({ label, args }) =>
          React.createElement('button', {
            key: label,
            style: btnStyle,
            disabled: diagRunning || !diagInstall.trim(),
            onClick: () => this.handleDiag(args),
          }, label),
        ),
      ),

      // Custom command input
      React.createElement('div', { style: { display: 'flex', gap: '6px', marginBottom: '12px', alignItems: 'center' } },
        React.createElement('input', {
          type: 'text',
          placeholder: 'wp post list --post_type=recipe --format=json',
          style: {
            padding: '5px 10px', borderRadius: '4px', fontSize: '11px', fontFamily: 'monospace',
            border: '1px solid var(--color-border-primary, #ccc)',
            backgroundColor: 'var(--nxai-input-bg, transparent)',
            flex: 1,
          },
          onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
            if (e.key === 'Enter' && !diagRunning && diagInstall.trim()) {
              const raw = (e.target as HTMLInputElement).value.trim();
              if (raw) {
                // Strip leading "wp " if user typed it
                const normalized = raw.startsWith('wp ') ? raw.slice(3) : raw;
                const args = normalized.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)?.map(a => a.replace(/^['"]|['"]$/g, '')) ?? [];
                this.handleDiag(args);
              }
            }
          },
        }),
        React.createElement('span', { style: sub }, '↵'),
      ),

      // Results
      diagResults.length > 0
        ? React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: '8px' } },
            diagResults.map((r, i) =>
              React.createElement('div', {
                key: i,
                style: {
                  padding: '8px 10px', borderRadius: '4px', fontSize: '11px', fontFamily: 'monospace',
                  backgroundColor: r.success ? 'rgba(81,187,123,0.07)' : 'rgba(239,68,68,0.07)',
                  border: `1px solid ${r.success ? 'rgba(81,187,123,0.2)' : 'rgba(239,68,68,0.2)'}`,
                },
              },
                React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', marginBottom: '4px' } },
                  React.createElement('span', { style: { fontWeight: 600, color: 'var(--nxai-card-text)' } }, r.cmd),
                  React.createElement('span', { style: { color: r.success ? '#51BB7B' : '#ef4444' } },
                    `${r.success ? '✓' : '✗'} ${r.durationMs}ms`,
                  ),
                ),
                React.createElement('pre', {
                  style: { margin: 0, whiteSpace: 'pre-wrap' as const, wordBreak: 'break-all' as const,
                    maxHeight: '200px', overflow: 'auto', color: 'var(--nxai-card-sub)', fontSize: '10px',
                    userSelect: 'text' as const, cursor: 'text' },
                }, r.error ?? (r.stdout?.slice(0, 2000) || '(empty)') + (r.stdout && r.stdout.length > 2000 ? '\n… (truncated)' : '')),
              ),
            ),
          )
        : null,
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
      // Only clear on success. Keeping the selection after a failure lets the
      // user retry without re-ticking rows they already chose.
      if (result?.success) this.setState({ selectedSiteIds: [] });
    } catch (err) {
      console.error('[NexusAI] bulk operation failed:', err);
    }
  };

  renderActiveTab(): React.ReactNode {
    const overviewProps = {
      electron: this.props.electron,
      stats: this.state.stats,
      fleetSummary: this.state.fleetSummary,
      settings: this.state.settings,
      wpeAuthError: this.state.wpeAuthError,
      aiProxy: this.state.aiProxy,
      mcpInfo: this.state.mcpInfo,
      startupStatus: this.state.startupStatus,
      onNavigate: (tab: 'overview' | 'activity' | 'settings' | 'agents' | 'inbox') => this.setState({ activeTab: tab }),
      onRefresh: () => { void this.fetchAll(); },
    };

    switch (this.state.activeTab) {
      case 'overview': return React.createElement(OverviewTab, overviewProps);
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
      default: return React.createElement(OverviewTab, overviewProps);
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
