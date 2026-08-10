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
import { AIGatewayPanel } from './AIGatewayPanel';
import { LoadingSpinner } from './LoadingSpinner';
import { SystemTab } from './SystemTab';
import { SettingsTab } from './SettingsTab';
import { FleetCompletenessWidget } from './FleetCompletenessWidget';
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

interface DashboardStats {
  localSites: { total: number; running: number; halted: number };
  wpeConnected: { count: number };
  remoteSites: { total: number; unlinked: number; capiAvailable: boolean; wpeAuthenticated: boolean };
  mcpServer: { running: boolean; toolCount: number; port: number | null; version: string | null };
  embedding: { ready: boolean; model: string; quantized: boolean; dimensions: number; maxSequenceLength: number };
  index: { localIndexed: number; localTotal: number; wpeIndexed: number; wpeTotal: number; totalDocuments: number; totalChunks: number; lastIndexed: number | null };
}

interface McpInfo {
  url: string;
  authToken: string;
  port: number;
  version: string;
  tools: string[];
  stdioPath: string;
}

interface StartupStatus {
  ready: boolean;
  phase: string | null;
  error: {
    message: string;
    name: string;
    code: string | null;
    phase: string;
    hint: string | null;
  } | null;
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

interface AiProxyInfo {
  url: string;
  port: number;
  running: boolean;
  models: string[];
  toolCapableModels: string[];
}

interface FleetVersionEntry {
  version: string;
  count: number;
}

interface FleetSummaryData {
  total: number;
  totalLocal: number;
  totalWpe: number;
  wpVersions: FleetVersionEntry[];
  phpVersions: FleetVersionEntry[];
  completeness: { none: number; filesystem: number; metadata: number; indexed: number };
  wpeSync?: { synced: number; neverSynced: number };
  staleCount: number;
  neverScannedCount: number;
}

interface FleetPlugin {
  slug: string;
  title: string;
  siteCount: number;
}

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
  setupId: string | null;
  setupResults: Record<string, SetupAIResult>;
  loading: boolean;
  error: string | null;
  activeTab: 'overview' | 'activity' | 'operations' | 'settings' | 'agents';
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
  wpeStopping: boolean;
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
}

// -- Shared styles --

const bigNumberStyle: React.CSSProperties = {
  fontSize: '36px',
  fontWeight: 700,
  lineHeight: 1,
  marginBottom: '8px',
};

const subStatStyle: React.CSSProperties = {
  fontSize: '13px',
  color: 'var(--nxai-card-sub, #6b7280)',
  lineHeight: 1.6,
};

const dotStyle = (color: string): React.CSSProperties => ({
  display: 'inline-block',
  width: '8px',
  height: '8px',
  borderRadius: '50%',
  backgroundColor: color,
  marginRight: '6px',
});

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

const btnStyle: React.CSSProperties = {
  padding: '6px 14px',
  borderRadius: '6px',
  border: '1px solid var(--nxai-card-border, #e5e7eb)',
  backgroundColor: 'var(--nxai-card-bg, #fff)',
  color: 'var(--nxai-card-text, #111827)',
  fontSize: '12px',
  fontWeight: 500,
  cursor: 'pointer',
};

const btnPrimaryStyle: React.CSSProperties = {
  ...btnStyle,
  backgroundColor: UI_COLORS.WPE_BRAND,
  color: '#fff',
  border: 'none',
};

const codeBlockStyle: React.CSSProperties = {
  fontFamily: 'monospace',
  fontSize: '12px',
  backgroundColor: 'var(--nxai-code-bg, #f3f4f6)',
  border: '1px solid var(--nxai-card-border, #e5e7eb)',
  borderRadius: '8px',
  padding: '14px',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-all',
  lineHeight: 1.5,
  color: 'var(--nxai-card-text, #111827)',
};

function formatTimeAgo(timestamp: number): string {
  if (!timestamp) return 'Never';
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

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
    setupId: null,
    setupResults: {},
    loading: true,
    error: null,
    activeTab: 'overview',
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
    wpeStopping: false,
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
      const [stats, mcpInfo, sites, indexEntries, proxyResult, settings, wpeSitesResult, fleetSummaryResult, wpeAccounts, startupStatus] = await Promise.all([
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
      });
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

  handleSetupAI = async (siteId: string): Promise<void> => {
    this.setState({ setupId: siteId });
    try {
      const result: SetupAIResult = await this.props.electron.ipcRenderer.invoke(
        IPC_CHANNELS.SETUP_AI, siteId,
      );
      if (!this.mounted) return;
      this.setState((prev) => ({
        setupId: null,
        setupResults: { ...prev.setupResults, [siteId]: result },
      }));
    } catch {
      if (!this.mounted) return;
      this.setState((prev) => ({
        setupId: null,
        setupResults: {
          ...prev.setupResults,
          [siteId]: { success: false, aiPlugin: 'failed', providerPlugins: 'failed', aiFeatures: 'failed', credentials: 'failed', acfAbilities: 'failed', message: 'Setup failed' },
        },
      }));
    }
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

  handleIndexAllFleet = async (): Promise<void> => {
    this.setState({ fleetIndexRunning: true });
    try {
      const result = await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.INDEX_ALL_FLEET);
      if (!this.mounted) return;
      this.setState({ fleetIndexOpId: result?.opId ?? null, fleetIndexRunning: false });
    } catch {
      if (!this.mounted) return;
      this.setState({ fleetIndexRunning: false });
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

  handleIndexAllAuto = async (): Promise<void> => {
    this.setState({ indexAllAutoRunning: true });
    try {
      const result = await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.INDEX_ALL_AUTO);
      if (!this.mounted) return;
      this.setState({ indexAllAutoOpId: result?.opId ?? null, indexAllAutoRunning: false });
    } catch {
      if (!this.mounted) return;
      this.setState({ indexAllAutoRunning: false });
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

  handleSyncGraph = async (): Promise<void> => {
    this.setState({ syncGraphRunning: true });
    try {
      const result = await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.SYNC_GRAPH_ALL);
      if (!this.mounted) return;
      this.setState({ syncGraphOpId: result?.opId ?? null, syncGraphRunning: false });
    } catch {
      if (!this.mounted) return;
      this.setState({ syncGraphRunning: false });
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
    const tabs: { key: NexusOverviewState['activeTab']; label: string }[] = [
      { key: 'overview',     label: 'Dashboard' },
      { key: 'operations',   label: 'Operations' },
      { key: 'activity',     label: 'Activity' },
      { key: 'agents',       label: 'Agents' },
      { key: 'settings',     label: 'Settings' },
    ];

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

  renderOpsButton(
    label: string,
    loadingLabel: string,
    isRunning: boolean,
    opId: string | null,
    handler: () => void,
    description?: string,
    disabled?: boolean,
  ): React.ReactNode {
    const inactive = isRunning || disabled;
    return React.createElement('div', { style: { flex: '1', minWidth: '220px' } },
      React.createElement('button', {
        style: inactive
          ? { ...btnPrimaryStyle, opacity: 0.4, cursor: 'not-allowed', width: '100%' }
          : { ...btnPrimaryStyle, width: '100%' },
        onClick: inactive ? undefined : handler,
        disabled: inactive,
        title: disabled ? 'Requires WP Engine login' : undefined,
      }, isRunning ? loadingLabel : label),
      description
        ? React.createElement('div', { style: { fontSize: '11px', color: 'var(--nxai-card-sub, #6b7280)', marginTop: '4px', lineHeight: '1.3' } }, description)
        : null,
      opId
        ? React.createElement('div', { style: { fontSize: '12px', color: UI_COLORS.STATUS_RUNNING, marginTop: '4px' } }, 'Started — check progress below.')
        : null,
    );
  }

  renderOperationsTab(): React.ReactNode {
    const { wpeAccounts, wpeAccountFilter, opsAdvancedExpanded } = this.state;
    const wpeDisabled = !(this.state.stats?.remoteSites.wpeAuthenticated ?? false);
    const btnRow = { display: 'flex', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' as const };
    const divider = React.createElement('hr', { style: { border: 'none', borderTop: '1px solid var(--nxai-card-border, #e5e7eb)', margin: '28px 0 22px' } });

    // Compact inline WPE account scope badge
    const allAccountIds = wpeAccounts.map(a => a.id);
    const includedIds = wpeAccountFilter ?? allAccountIds;
    const scopeBadge = wpeAccounts.length > 0
      ? React.createElement('span', {
          style: { fontSize: 11, color: 'var(--nxai-card-sub, #6b7280)', fontWeight: 400, marginLeft: 8 },
        }, `· ${includedIds.length === allAccountIds.length ? 'All accounts' : `${includedIds.length} of ${allAccountIds.length} accounts`}`)
      : null;

    // ── Zone 1: Keep data current ─────────────────────────────────────────────
    const zone1 = React.createElement('div', null,

      // Local sites
      React.createElement('div', {
        style: { fontSize: 11, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '.06em', color: 'var(--nxai-card-sub, #6b7280)', marginBottom: 10 },
      }, 'Local'),
      React.createElement('div', { style: btnRow },
        this.renderOpsButton(
          'Refresh metadata', 'Refreshing…',
          this.state.syncGraphRunning, this.state.syncGraphOpId,
          this.handleSyncGraph,
          'WP-CLI: active plugins, WP version, PHP version, themes. Starts halted sites temporarily.',
        ),
        this.renderOpsButton(
          'Index content', 'Indexing…',
          this.state.indexAllAutoRunning, this.state.indexAllAutoOpId,
          this.handleIndexAllAuto,
          'Vector index of posts/pages for search. Starts halted sites temporarily.',
        ),
      ),

      // WP Engine sites
      React.createElement('div', {
        style: { fontSize: 11, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '.06em', color: 'var(--nxai-card-sub, #6b7280)', marginBottom: 10, display: 'flex', alignItems: 'center' },
      }, 'WP Engine', scopeBadge),
      React.createElement('div', { style: btnRow },
        this.renderOpsButton(
          'Sync metadata', 'Syncing…',
          this.state.wpeSyncing, null,
          this.handleWpeSync,
          'SSH: plugins, WP/PHP version, themes for all WPE installs. Progress shown below.',
          wpeDisabled,
        ),
        this.renderOpsButton(
          'Index content', 'Indexing…',
          this.state.fleetIndexRunning, this.state.fleetIndexOpId,
          this.handleIndexAllFleet,
          'Extracts posts/pages via SSH WP-CLI and builds searchable index. Requires SSH key.',
          wpeDisabled,
        ),
      ),

      // WPE sync inline progress (shows while metadata sync is running)
      this.state.wpeSyncing && this.state.wpeSyncProgress
        ? React.createElement('div', {
            'data-testid': 'wpe-sync-progress',
            style: { border: '1px solid var(--nxai-card-border, #e5e7eb)', borderRadius: 8, padding: '12px 16px', marginBottom: 12 },
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
          )
        : null,

      // WPE content index inline progress (shows while SSH indexing is running)
      this.state.fleetIndexRunning
        ? React.createElement('div', {
            style: { border: '1px solid var(--nxai-card-border, #e5e7eb)', borderRadius: 8, padding: '12px 16px', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10 },
          },
            React.createElement('div', { style: { width: 12, height: 12, borderRadius: '50%', background: '#0ECAD4', animation: 'pulse 1.5s ease-in-out infinite', flexShrink: 0 } }),
            React.createElement('div', null,
              React.createElement('div', { style: { fontSize: 13, fontWeight: 600 } }, 'WPE content indexing'),
              React.createElement('div', { style: { fontSize: 12, color: 'var(--nxai-card-sub, #6b7280)' } },
                'Extracting posts via SSH and building search index. This may take several minutes.',
              ),
            ),
          )
        : null,

      // Bulk ops progress — directly below buttons for immediate feedback
      React.createElement(BulkOperationsPanel, {
        electron: this.props.electron,
        siteNames: new Map(Object.values(this.state.sites || {}).map((s: any) => [s.id, s.name])),
      }),
    );

    // ── Zone 2: Site status ───────────────────────────────────────────────────
    const zone2 = React.createElement('div', null,
      divider,
      renderSectionLabel('Site Status'),
      React.createElement(SystemTab, {
        electron: this.props.electron,
        sites: this.state.sites.map((s) => ({ id: s.id, name: s.name, status: s.status })),
        indexEntries: (this.state.indexEntries ?? []).map((e: any) => ({
          siteId: e.siteId, siteName: e.siteName ?? '', state: e.state,
          documentCount: e.documentCount, chunkCount: e.chunkCount,
          lastIndexed: e.lastIndexed, durationMs: e.durationMs, errors: e.errors,
        })),
      }),
    );

    // ── Zone 3: Advanced (collapsed by default) ───────────────────────────────
    const advancedItems = [
      'Factory Reset',
      'Reset Content Index',
      'Database Health',
      'Housekeeping',
      'SSH Diagnostics',
    ];

    const zone3 = React.createElement('div', null,
      divider,
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
      zone1,
      zone2,
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

  renderActiveTab(): React.ReactNode {
    switch (this.state.activeTab) {
      case 'overview': return React.createElement(OverviewTab, {
        electron: this.props.electron,
        stats: this.state.stats,
        fleetSummary: this.state.fleetSummary,
        settings: this.state.settings,
        wpeAuthError: this.state.wpeAuthError,
        aiProxy: this.state.aiProxy,
        mcpInfo: this.state.mcpInfo,
        startupStatus: this.state.startupStatus,
        onNavigate: (tab) => this.setState({ activeTab: tab }),
        onRefresh: () => { void this.fetchAll(); },
      });
      case 'activity': return this.renderActivityTab();
      case 'operations': return this.renderOperationsTab();
      case 'settings': return React.createElement(SettingsTab, { electron: this.props.electron });
      // 'agents' case handled in render() directly (no stats dependency)
      default: return React.createElement(OverviewTab, {
        electron: this.props.electron,
        stats: this.state.stats,
        fleetSummary: this.state.fleetSummary,
        settings: this.state.settings,
        wpeAuthError: this.state.wpeAuthError,
        aiProxy: this.state.aiProxy,
        mcpInfo: this.state.mcpInfo,
        startupStatus: this.state.startupStatus,
        onNavigate: (tab) => this.setState({ activeTab: tab }),
        onRefresh: () => { void this.fetchAll(); },
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

  handleWpeSyncStop = (): void => {
    this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.WPE_SYNC_STOP);
    this.setState({ wpeStopping: true });
  };

  handleWpeSync = async (): Promise<void> => {
    if (this.state.wpeSyncing) return;

    this.setState({ wpeSyncing: true, wpeSyncProgress: null, wpeSyncError: null });

    // Start polling for progress
    this.startWpeSyncProgressPolling();

    try {
      // Sync all WPE sites
      const result = await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.WPE_SYNC_ALL);

      // Stop polling
      this.stopWpeSyncProgressPolling();

      if (result.success) {
        const syncedCount = result.synced || 0;
        this.setState({
          wpeSyncedCount: syncedCount,
          wpeSyncing: false,
          wpeStopping: false,
          wpeSyncProgress: null,
          wpeSyncError: null,
        });

        // Show success toast
        if (toast) {
          if (syncedCount > 0) {
            toast({ type: 'success', content: `Successfully synced ${syncedCount} WP Engine site${syncedCount === 1 ? '' : 's'}` });
          } else {
            toast({ type: 'cta', content: 'No WP Engine sites found to sync' });
          }
        }

        // Refresh data
        await this.fetchAll();
      } else {
        const errorMsg = result.error || 'Unknown error occurred during sync';
        this.setState({
          wpeSyncing: false,
          wpeSyncProgress: null,
          wpeSyncError: errorMsg,
        });
        if (toast) {
          toast({ type: 'error', content: `WPE sync failed: ${errorMsg}` });
        }
        console.error('[NexusOverview] WPE sync failed:', errorMsg);
      }
    } catch (error) {
      this.stopWpeSyncProgressPolling();
      const errorMsg = error instanceof Error ? error.message : 'Failed to sync WPE sites';
      this.setState({
        wpeSyncing: false,
        wpeSyncProgress: null,
        wpeSyncError: errorMsg,
      });
      if (toast) {
        toast({ type: 'error', content: `WPE sync error: ${errorMsg}` });
      }
      console.error('[NexusOverview] WPE sync error:', error);
    }
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
            React.createElement(AgentConsoleTab, { electron: this.props.electron }),
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
