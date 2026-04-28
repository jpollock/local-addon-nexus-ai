/**
 * Nexus Overview Dashboard
 *
 * Simplified addon dashboard with Overview and Operations tabs only.
 * Sites, Content, and Chat have been extracted to separate interfaces.
 * Class-based — Local uses older React, no hooks allowed.
 */
import * as React from 'react';
import { IPC_CHANNELS, UI_COLORS, POLL_INTERVALS } from '../../common/constants';
import type { NexusSettings } from '../../common/types';
import { EventStatsCards } from './EventStatsCards';
import { EventTimeline } from './EventTimeline';
import { StorageHealthPanel } from './StorageHealthPanel';
import { TopIssuesPanel } from './TopIssuesPanel';
import { BulkOperationsPanel } from './BulkOperationsPanel';
import { SiteGroupsPanel } from './SiteGroupsPanel';
import { AIGatewayPanel } from './AIGatewayPanel';
import { LoadingSpinner } from './LoadingSpinner';
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
  source?: 'local' | 'wpe';
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
  copiedField: string | null;
  loading: boolean;
  error: string | null;
  activeTab: 'overview' | 'activity' | 'operations';
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
  wpeSyncStats: { total: number; has_wp_version: number; has_php_version: number; last_sync_at: number | null; fresh_count: number; stale_count: number } | null;
  wpeSyncThresholdHours: number;
  // Fleet Intelligence panels
  fleetSummary: FleetSummaryData | null;
  fleetPlugins: FleetPlugin[];
  // Credential sync state
  syncStatus: Record<string, { lastSync: number; success: boolean }>;
  syncing: boolean;
  syncResults: Array<{ siteId: string; siteName: string; success: boolean; providers: string[]; error?: string }> | null;
  wpeAuthError: boolean;
  // Onboarding
  onboardingDismissed: boolean;
  // WPE action buttons
  wpeBackupRunning: boolean;
  wpeBackupInstallId: string | null;
  wpeBackupInstallName: string | null;
  wpeSyncNowRunning: boolean;
  // WPE account filter
  wpeAccounts: Array<{ id: string; name: string; nickname?: string }>;
  wpeAccountFilter: string[] | null;
}

// -- Shared styles --

const cardContainerStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, 1fr)',
  gap: '16px',
  marginBottom: '24px',
};

const cardStyle: React.CSSProperties = {
  borderRadius: '10px',
  padding: '20px',
  border: '1px solid var(--nxai-card-border, #e5e7eb)',
  backgroundColor: 'var(--nxai-card-bg, #fff)',
};

const cardTitleStyle: React.CSSProperties = {
  fontSize: '11px',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.8px',
  color: 'var(--nxai-card-label, #6b7280)',
  marginBottom: '12px',
};

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

const sectionLabelStyle: React.CSSProperties = {
  fontSize: '13px',
  fontWeight: 600,
  color: 'var(--nxai-section-label, #374151)',
  marginBottom: '12px',
  marginTop: '8px',
};

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
  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private wpeSyncPassivePoll: ReturnType<typeof setInterval> | null = null;
  private mounted = false;

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
    copiedField: null,
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
    wpeSyncStats: null,
    wpeSyncThresholdHours: 8,
    syncStatus: {},
    syncing: false,
    syncResults: null,
    wpeAuthError: false,
    fleetSummary: null,
    fleetPlugins: [],
    onboardingDismissed: true, // default true prevents flash; overridden after settings load
    wpeBackupRunning: false,
    wpeBackupInstallId: null,
    wpeBackupInstallName: null,
    wpeSyncNowRunning: false,
    wpeAccounts: [],
    wpeAccountFilter: null,
  };

  componentDidMount(): void {
    this.mounted = true;
    this.injectCssVars();
    this.fetchAll();
    this.pollTimer = setInterval(() => this.fetchAll(), POLL_INTERVALS.DASHBOARD_STATS_MS);
    
    // Check if WPE sync is already running (catches auto-syncs started before mount)
    this.checkWpeSyncStatus();

    // Passive poll: pick up auto-syncs that start after mount (every 10s when not already syncing)
    this.wpeSyncPassivePoll = setInterval(() => {
      if (!this.state.wpeSyncing) {
        this.checkWpeSyncStatus();
      }
    }, 10000);
  }

  componentWillUnmount(): void {
    this.mounted = false;
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    if (this.wpeSyncPassivePoll) clearInterval(this.wpeSyncPassivePoll);
    this.stopWpeSyncProgressPolling();
  }

  injectCssVars(): void {
    const id = 'nexus-ai-dashboard-vars';
    if (document.getElementById(id)) return;
    const style = document.createElement('style');
    style.id = id;
    style.textContent = `
      :root {
        --nxai-card-bg: #ffffff;
        --nxai-card-border: #e5e7eb;
        --nxai-card-label: #6b7280;
        --nxai-card-sub: #6b7280;
        --nxai-card-text: #111827;
        --nxai-section-label: #374151;
        --nxai-code-bg: #f3f4f6;
        --nxai-table-hover: #f9fafb;
        --nxai-input-bg: #ffffff;
        --nxai-input-border: #d1d5db;
        --nxai-score-bg: #e5e7eb;
        --nxai-score-fill: ${UI_COLORS.WPE_BRAND};
      }
      .Theme__Dark {
        --nxai-card-bg: #2a2a2a;
        --nxai-card-border: #404040;
        --nxai-card-label: #9ca3af;
        --nxai-card-sub: #9ca3af;
        --nxai-card-text: #f3f4f6;
        --nxai-section-label: #d1d5db;
        --nxai-code-bg: #1f1f1f;
        --nxai-table-hover: #333333;
        --nxai-input-bg: #2a2a2a;
        --nxai-input-border: #555;
        --nxai-score-bg: #404040;
        --nxai-score-fill: ${UI_COLORS.WPE_BRAND};
      }
    `;
    document.head.appendChild(style);
  }

  fetchAll = async (): Promise<void> => {
    const ipc = this.props.electron.ipcRenderer;
    try {
      const [stats, mcpInfo, sites, indexEntries, proxyResult, settings, wpeSitesResult, syncStatus, wpeSyncStatsResult, fleetSummaryResult, wpeAccounts, startupStatus] = await Promise.all([
        ipc.invoke(IPC_CHANNELS.GET_DASHBOARD_STATS),
        ipc.invoke(IPC_CHANNELS.GET_MCP_INFO),
        ipc.invoke(IPC_CHANNELS.GET_SITES),
        ipc.invoke(IPC_CHANNELS.GET_FLEET_STATUS),
        ipc.invoke(IPC_CHANNELS.GET_AI_PROXY_INFO),
        ipc.invoke(IPC_CHANNELS.GET_SETTINGS),
        ipc.invoke(IPC_CHANNELS.WPE_GET_SYNCED_SITES),
        ipc.invoke(IPC_CHANNELS.GET_CREDENTIAL_SYNC_STATUS),
        ipc.invoke(IPC_CHANNELS.WPE_SYNC_STATS),
        ipc.invoke(IPC_CHANNELS.GET_FLEET_SUMMARY),
        ipc.invoke(IPC_CHANNELS.GET_WPE_ACCOUNTS).catch(() => []),
        ipc.invoke(IPC_CHANNELS.GET_STARTUP_STATUS),
      ]);
      if (!this.mounted) return;

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
        syncStatus: syncStatus ?? {},
        wpeSyncStats: wpeSyncStatsResult?.stats ?? null,
        wpeSyncThresholdHours: wpeSyncStatsResult?.thresholdHours ?? 8,
        loading: false,
        error: stats ? null : 'Failed to load stats',
        wpeAuthError: wpeSitesResult?.wpeAuthError ?? false,
        fleetSummary: fleetSummaryResult ?? null,
        onboardingDismissed: settings?.onboardingDismissed ?? false,
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
          IPC_CHANNELS.SEARCH_UNIFIED, { query, options: { limit: 20 } },
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

  copyToClipboard = (text: string, field: string): void => {
    navigator.clipboard.writeText(text).then(() => {
      this.setState({ copiedField: field });
      setTimeout(() => {
        if (this.mounted) this.setState({ copiedField: null });
      }, 2000);
    });
  };

  // -- Card renders (unchanged from original) --

  renderSectionLabel(text: string): React.ReactNode {
    return React.createElement('div', { style: sectionLabelStyle }, text);
  }

  renderLocalSitesCard(stats: DashboardStats): React.ReactNode {
    const { localSites } = stats;
    return React.createElement('div', { style: cardStyle },
      React.createElement('div', { style: cardTitleStyle }, 'Local Sites'),
      React.createElement('div', { style: { ...bigNumberStyle, color: 'var(--nxai-card-text)' } }, localSites.total),
      React.createElement('div', { style: subStatStyle },
        React.createElement('span', { style: dotStyle(UI_COLORS.STATUS_RUNNING) }),
        `${localSites.running} running`,
        React.createElement('br'),
        React.createElement('span', { style: dotStyle(UI_COLORS.STATUS_HALTED) }),
        `${localSites.halted} halted`,
      ),
    );
  }

  renderWpeConnectedCard(stats: DashboardStats): React.ReactNode {
    const { wpeConnected } = stats;
    return React.createElement('div', { style: cardStyle },
      React.createElement('div', { style: cardTitleStyle }, 'WPE-Connected'),
      React.createElement('div', { style: { ...bigNumberStyle, color: UI_COLORS.WPE_BRAND } }, wpeConnected.count),
      React.createElement('div', { style: subStatStyle },
        'Local sites linked to',
        React.createElement('br'),
        'WP Engine environments',
      ),
    );
  }

  renderRemoteSitesCard(stats: DashboardStats): React.ReactNode {
    const { remoteSites } = stats;
    if (!remoteSites.capiAvailable) {
      return React.createElement('div', { style: cardStyle },
        React.createElement('div', { style: cardTitleStyle }, 'Remote Sites'),
        React.createElement('div', { style: { ...bigNumberStyle, color: 'var(--nxai-card-sub)' } }, '\u2014'),
        React.createElement('div', { style: subStatStyle }, 'WPE not authenticated'),
      );
    }
    return React.createElement('div', { style: cardStyle },
      React.createElement('div', { style: cardTitleStyle }, 'Remote Sites'),
      React.createElement('div', { style: { ...bigNumberStyle, color: 'var(--nxai-card-text)' } }, remoteSites.total),
      React.createElement('div', { style: subStatStyle }, `${remoteSites.total - remoteSites.unlinked} linked · ${remoteSites.unlinked} not linked`),
    );
  }

  renderMcpCard(stats: DashboardStats): React.ReactNode {
    const { mcpServer: mcp } = stats;
    const statusColor = mcp.running ? UI_COLORS.STATUS_RUNNING : UI_COLORS.STATUS_ERROR;
    const statusLabel = mcp.running ? 'Running' : 'Stopped';
    return React.createElement('div', { style: cardStyle },
      React.createElement('div', { style: cardTitleStyle }, 'MCP Server'),
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', marginBottom: '8px' } },
        React.createElement('span', { style: dotStyle(statusColor) }),
        React.createElement('span', { style: { fontSize: '18px', fontWeight: 600, color: 'var(--nxai-card-text)' } }, statusLabel),
      ),
      React.createElement('div', { style: subStatStyle },
        `${mcp.toolCount} tools available`,
        mcp.port ? React.createElement('span', null, React.createElement('br'), `Port ${mcp.port}`) : null,
        mcp.version ? React.createElement('span', null, React.createElement('br'), `v${mcp.version}`) : null,
      ),
    );
  }

  renderEmbeddingCard(stats: DashboardStats): React.ReactNode {
    const { embedding } = stats;
    return React.createElement('div', { style: cardStyle },
      React.createElement('div', { style: cardTitleStyle }, 'Embedding Model'),
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', marginBottom: '8px' } },
        React.createElement('span', { style: dotStyle(embedding.ready ? UI_COLORS.STATUS_RUNNING : UI_COLORS.STATUS_WARNING) }),
        React.createElement('span', { style: { fontSize: '14px', fontWeight: 600, color: 'var(--nxai-card-text)' } }, embedding.model),
        embedding.quantized
          ? React.createElement('span', { style: tagStyle('rgba(14, 202, 212, 0.15)', UI_COLORS.WPE_BRAND) }, 'QUANTIZED')
          : null,
      ),
      React.createElement('div', { style: subStatStyle },
        `${embedding.dimensions}d vectors`,
        React.createElement('br'),
        `${embedding.maxSequenceLength} max tokens`,
        React.createElement('br'),
        embedding.ready ? 'Model loaded' : 'Loading...',
      ),
    );
  }

  renderIndexCard(stats: DashboardStats): React.ReactNode {
    const { index } = stats;
    const totalIndexed = index.localIndexed + index.wpeIndexed;
    const totalSites = index.localTotal + index.wpeTotal;
    return React.createElement('div', { style: cardStyle },
      React.createElement('div', { style: cardTitleStyle }, 'Context Index'),
      React.createElement('div', { style: { ...bigNumberStyle, color: 'var(--nxai-card-text)' } },
        `${totalIndexed}`,
        React.createElement('span', { style: { fontSize: '14px', fontWeight: 400, color: 'var(--nxai-card-sub)' } },
          ` / ${totalSites} sites`,
        ),
      ),
      React.createElement('div', { style: subStatStyle },
        React.createElement('span', null, `${index.localIndexed} local · ${index.wpeIndexed} remote`),
        React.createElement('br'),
        `${index.totalDocuments.toLocaleString()} documents`,
        React.createElement('br'),
        `Last indexed: ${index.lastIndexed ? formatTimeAgo(index.lastIndexed) : 'Never'}`,
      ),
    );
  }

  renderGraphCard(): React.ReactNode {
    const { wpeSyncStats } = this.state;
    const total = wpeSyncStats?.total ?? 0;
    const hasWp = wpeSyncStats?.has_wp_version ?? 0;
    const hasPhp = wpeSyncStats?.has_php_version ?? 0;
    const plugins = 0; // could query graph but keep simple for now

    if (!wpeSyncStats) {
      return React.createElement('div', { style: cardStyle },
        React.createElement('div', { style: cardTitleStyle }, 'Site Graph'),
        React.createElement('div', { style: { ...bigNumberStyle, color: 'var(--nxai-card-sub)' } }, '—'),
        React.createElement('div', { style: subStatStyle }, 'No WPE data yet'),
      );
    }

    const wpPct = total > 0 ? Math.round((hasWp / total) * 100) : 0;
    const phpPct = total > 0 ? Math.round((hasPhp / total) * 100) : 0;
    const wpColor = wpPct === 100 ? UI_COLORS.STATUS_RUNNING : wpPct > 50 ? UI_COLORS.STATUS_WARNING : UI_COLORS.STATUS_ERROR;

    return React.createElement('div', { style: cardStyle },
      React.createElement('div', { style: cardTitleStyle }, 'Site Graph'),
      React.createElement('div', { style: { ...bigNumberStyle, color: 'var(--nxai-card-text)' } },
        total,
        React.createElement('span', { style: { fontSize: '13px', fontWeight: 400, color: 'var(--nxai-card-sub)' } }, ' WPE installs'),
      ),
      React.createElement('div', { style: subStatStyle },
        React.createElement('span', { style: { color: wpColor } }, `WP version: ${hasWp}/${total} (${wpPct}%)`),
        React.createElement('br'),
        `PHP version: ${hasPhp}/${total} (${phpPct}%)`,
        React.createElement('br'),
        `Plugins synced for ${total > 0 ? total : '—'} installs`,
      ),
    );
  }

  renderWpeSyncCard(): React.ReactNode {
    const { wpeSyncStats, wpeSyncThresholdHours, wpeSyncing } = this.state;

    if (wpeSyncing) {
      return React.createElement('div', { style: cardStyle },
        React.createElement('div', { style: cardTitleStyle }, 'WPE Sync'),
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', marginBottom: '8px' } },
          React.createElement('span', { style: dotStyle(UI_COLORS.STATUS_WARNING) }),
          React.createElement('span', { style: { fontSize: '18px', fontWeight: 600, color: 'var(--nxai-card-text)' } }, 'Syncing…'),
        ),
        React.createElement('div', { style: subStatStyle }, 'Sync in progress'),
      );
    }

    if (!wpeSyncStats || !wpeSyncStats.last_sync_at) {
      return React.createElement('div', { style: cardStyle },
        React.createElement('div', { style: cardTitleStyle }, 'WPE Sync'),
        React.createElement('div', { style: { ...bigNumberStyle, color: 'var(--nxai-card-sub)' } }, '—'),
        React.createElement('div', { style: subStatStyle }, 'Never synced'),
      );
    }

    const ageMs = Date.now() - wpeSyncStats.last_sync_at;
    const ageHours = Math.round(ageMs / 3600000);
    const ageMins = Math.round(ageMs / 60000);
    const ageLabel = ageHours > 0 ? `${ageHours}h ago` : `${ageMins}m ago`;
    const isStale = ageMs > wpeSyncThresholdHours * 3600000;
    const statusColor = isStale ? UI_COLORS.STATUS_WARNING : UI_COLORS.STATUS_RUNNING;
    const staleCount = wpeSyncStats.stale_count ?? 0;
    const freshCount = wpeSyncStats.fresh_count ?? 0;

    return React.createElement('div', { style: cardStyle },
      React.createElement('div', { style: cardTitleStyle }, 'WPE Sync'),
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', marginBottom: '8px' } },
        React.createElement('span', { style: dotStyle(statusColor) }),
        React.createElement('span', { style: { fontSize: '16px', fontWeight: 600, color: 'var(--nxai-card-text)' } }, ageLabel),
      ),
      React.createElement('div', { style: subStatStyle },
        React.createElement('span', { style: { color: UI_COLORS.STATUS_RUNNING } }, `${freshCount} fresh`),
        staleCount > 0
          ? React.createElement('span', { style: { color: UI_COLORS.STATUS_WARNING } }, ` · ${staleCount} stale`)
          : React.createElement('span', null, ' · all current ✓'),
        React.createElement('br'),
        `SSH sync threshold: ${wpeSyncThresholdHours}h`,
      ),
    );
  }

  renderAiProxyCard(): React.ReactNode {
    const { aiProxy } = this.state;
    const running = aiProxy?.running ?? false;
    const statusColor = running ? UI_COLORS.STATUS_RUNNING : 'var(--nxai-card-sub)';

    return React.createElement('div', { style: cardStyle },
      React.createElement('div', { style: cardTitleStyle }, 'AI Proxy'),
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', marginBottom: '8px' } },
        React.createElement('span', { style: dotStyle(statusColor) }),
        React.createElement('span', { style: { fontSize: '18px', fontWeight: 600, color: 'var(--nxai-card-text)' } },
          running ? 'Running' : 'Stopped',
        ),
      ),
      React.createElement('div', { style: subStatStyle },
        aiProxy?.port ? `Port ${aiProxy.port}` : 'Not configured',
        aiProxy?.models?.length
          ? React.createElement('span', null,
              React.createElement('br'),
              `${aiProxy.models.length} model${aiProxy.models.length !== 1 ? 's' : ''} available`,
            )
          : null,
        aiProxy?.toolCapableModels?.length
          ? React.createElement('span', null,
              React.createElement('br'),
              `${aiProxy.toolCapableModels.length} tool-capable`,
            )
          : null,
      ),
    );
  }

  // -- New sections --

  renderSetupBanner(stats: DashboardStats): React.ReactNode {
    if (stats.embedding.ready) return null;
    return React.createElement('div', {
      style: {
        padding: '12px 16px',
        borderRadius: '8px',
        backgroundColor: 'rgba(245, 158, 11, 0.1)',
        border: `1px solid ${UI_COLORS.STATUS_WARNING}`,
        marginBottom: '20px',
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
      },
    },
      React.createElement('span', { style: dotStyle(UI_COLORS.STATUS_WARNING) }),
      React.createElement('span', { style: { fontSize: '13px', color: 'var(--nxai-card-text)' } },
        'Setting up Nexus AI\u2026 Embedding model loading.',
      ),
    );
  }

  handleWpeConnect = (): void => {
    this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.WPE_LOGIN_START).catch(() => {});
  };

  renderWpeAuthBanner(): React.ReactNode {
    const { wpeAuthError } = this.state;
    if (!wpeAuthError) return null;
    return React.createElement('div', {
      style: {
        padding: '12px 16px',
        borderRadius: '8px',
        backgroundColor: 'rgba(59, 130, 246, 0.08)',
        border: '1px solid rgba(59, 130, 246, 0.35)',
        marginBottom: '20px',
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
      },
    },
      React.createElement('span', { style: { fontSize: '15px', lineHeight: 1, flexShrink: 0 } }, '\u{1F512}'),
      React.createElement('span', { style: { fontSize: '13px', color: 'var(--nxai-card-text)', flex: 1 } },
        React.createElement('strong', null, 'Not connected to WP Engine.'),
        ' Sign in to enable WPE site management, deep scans, backups, and content indexing.',
      ),
      React.createElement('button', {
        style: { padding: '6px 14px', borderRadius: '6px', border: 'none', backgroundColor: '#0ECAD4', color: '#fff', fontSize: '13px', fontWeight: 600, cursor: 'pointer', flexShrink: 0 },
        onClick: this.handleWpeConnect,
      }, 'Connect'),
    );
  }


  renderMcpPanel(): React.ReactNode {
    const { mcpInfo, copiedField, startupStatus } = this.state;
    if (!mcpInfo) {
      // When async init failed, show the real error + actionable hint rather
      // than an indefinite "waiting" banner — see issue #36.
      if (startupStatus?.error) {
        const err = startupStatus.error;
        return React.createElement(
          'div',
          {
            style: {
              ...cardStyle,
              marginBottom: '24px',
              padding: '20px',
              borderLeft: '4px solid var(--nxai-danger, #d14343)',
              backgroundColor: 'var(--nxai-danger-bg, rgba(209, 67, 67, 0.06))',
            },
          },
          React.createElement('div', {
            style: { fontWeight: 600, color: 'var(--nxai-card-text)', marginBottom: '8px' },
          }, `MCP server failed to start (phase: ${err.phase})`),
          React.createElement('div', {
            style: { fontFamily: 'monospace', fontSize: '12px', color: 'var(--nxai-card-text)', marginBottom: err.hint ? '12px' : '0', whiteSpace: 'pre-wrap' as const },
          }, err.message),
          err.hint
            ? React.createElement('div', {
              style: { fontSize: '13px', color: 'var(--nxai-card-text)' },
            },
              React.createElement('strong', null, 'Suggested fix: '),
              err.hint,
            )
            : null,
        );
      }
      const phaseLabel = startupStatus?.phase ? ` (${startupStatus.phase})` : '';
      return React.createElement('div', {
        style: { ...cardStyle, marginBottom: '24px', textAlign: 'center' as const, padding: '24px', color: 'var(--nxai-card-sub)' },
      }, `MCP server not yet running. Waiting for initialization${phaseLabel}...`);
    }

    // Both Claude Code and Claude Desktop use the stdio bridge so configs
    // survive Local restarts without needing to update port/token.
    const claudeCodeCmd = `claude mcp add local-nexus-ai -- node "${mcpInfo.stdioPath}"`;
    const claudeDesktopConfig = JSON.stringify({
      mcpServers: {
        'local-nexus-ai': {
          command: 'node',
          args: [mcpInfo.stdioPath],
        },
      },
    }, null, 2);

    const copyBtn = (text: string, field: string) =>
      React.createElement('button', {
        style: { ...btnStyle, marginTop: '8px', fontSize: '11px' },
        onClick: () => this.copyToClipboard(text, field),
      }, copiedField === field ? 'Copied!' : 'Copy');

    const { settings } = this.state;
    const activeProvider = settings?.aiProvider
      ? settings.aiProvider.charAt(0).toUpperCase() + settings.aiProvider.slice(1)
      : 'Not configured';
    const activeModel = settings?.aiModel || 'default';

    const codeStyle = { fontFamily: 'monospace', backgroundColor: 'var(--nxai-code-bg, rgba(0,0,0,0.08))', padding: '1px 5px', borderRadius: '3px', fontSize: '11px' };

    return React.createElement('div', { style: { marginBottom: '24px' } },
      this.renderSectionLabel('Connect to AI Tools'),
      React.createElement('div', {
        style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' },
      },
        React.createElement('span', { style: dotStyle(UI_COLORS.STATUS_RUNNING) }),
        React.createElement('span', { style: { fontSize: '13px', color: 'var(--nxai-card-text)' } },
          `Server running on port ${mcpInfo.port}`,
        ),
        React.createElement('span', { style: { fontSize: '12px', color: 'var(--nxai-card-sub)' } },
          `\u2022 ${mcpInfo.tools.length} tools \u2022 v${mcpInfo.version}`,
        ),
      ),
      React.createElement('div', {
        style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', paddingLeft: '24px' },
      },
        React.createElement('span', { style: { fontSize: '12px', color: 'var(--nxai-card-sub)' } },
          `Active AI: ${activeProvider}`,
        ),
        settings?.aiModel
          ? React.createElement('span', { style: { fontSize: '12px', color: 'var(--nxai-card-text)' } },
              `(${activeModel})`,
            )
          : null,
      ),

      React.createElement('div', {
        style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' },
      },
        // Claude Code — unique command
        React.createElement('div', { style: cardStyle },
          React.createElement('div', { style: { fontSize: '12px', fontWeight: 600, marginBottom: '6px', color: 'var(--nxai-card-text)' } }, 'Claude Code'),
          React.createElement('div', { style: { fontSize: '11px', color: 'var(--nxai-card-sub)', marginBottom: '6px' } }, 'Run in your terminal:'),
          React.createElement('div', { style: { ...codeBlockStyle, fontSize: '10px' } }, claudeCodeCmd),
          copyBtn(claudeCodeCmd, 'claude-code'),
        ),

        // All other agents share the same stdio config
        React.createElement('div', { style: cardStyle },
          React.createElement('div', { style: { fontSize: '12px', fontWeight: 600, marginBottom: '6px', color: 'var(--nxai-card-text)' } },
            'Claude Desktop · Cursor · Windsurf · Cline · Gemini',
          ),
          React.createElement('div', { style: { fontSize: '11px', color: 'var(--nxai-card-sub)', marginBottom: '6px' } },
            'All use the same config — auto-install with:',
          ),
          React.createElement('div', { style: { ...codeBlockStyle, fontSize: '10px' } },
            'nexus mcp setup --agent <name> --write',
          ),
          copyBtn('nexus mcp setup --agent <name> --write', 'other-agents'),
          React.createElement('div', { style: { marginTop: '8px', fontSize: '10px', color: 'var(--nxai-card-sub)' } },
            'Names: ',
            React.createElement('code', { style: codeStyle }, 'claude-desktop'),
            ' · ',
            React.createElement('code', { style: codeStyle }, 'cursor'),
            ' · ',
            React.createElement('code', { style: codeStyle }, 'windsurf'),
            ' · ',
            React.createElement('code', { style: codeStyle }, 'cline'),
            ' · ',
            React.createElement('code', { style: codeStyle }, 'gemini'),
          ),
        ),
      ),
    );
  }

  renderSetupAICell(site: SiteListItem): React.ReactNode {
    const { setupId, setupResults } = this.state;
    const result = setupResults[site.id];
    const isSettingUp = setupId === site.id;

    const tdStyle: React.CSSProperties = {
      padding: '10px 12px',
      fontSize: '13px',
      color: 'var(--nxai-card-text)',
      borderBottom: '1px solid var(--nxai-card-border)',
    };

    // WPE sites can't have AI setup (remote)
    if (site.source === 'wpe') {
      return React.createElement('td', { style: tdStyle },
        React.createElement('span', { style: { fontSize: '12px', color: 'var(--nxai-card-sub)' } }, 'N/A'),
      );
    }

    if (site.status !== 'running') {
      return React.createElement('td', { style: tdStyle },
        React.createElement('span', { style: { fontSize: '12px', color: 'var(--nxai-card-sub)' } }, '\u2014'),
      );
    }

    if (isSettingUp) {
      return React.createElement('td', { style: tdStyle },
        React.createElement('button', {
          style: { ...btnStyle, opacity: 0.6, cursor: 'not-allowed' },
          disabled: true,
        }, 'Setting up...'),
      );
    }

    if (result) {
      if (result.success) {
        const summaryParts: string[] = [];
        if (result.aiPlugin === 'installed') summaryParts.push('Plugin installed');
        else if (result.aiPlugin === 'activated') summaryParts.push('Plugin activated');
        else if (result.aiPlugin === 'already_active') summaryParts.push('Plugin active');
        if (result.aiFeatures === 'enabled') summaryParts.push('experiments on');
        if (result.credentials === 'synced') summaryParts.push('keys synced');
        const summary = summaryParts.length > 0 ? summaryParts.join(', ') : 'Set up';
        return React.createElement('td', { style: tdStyle },
          React.createElement('span', { style: dotStyle(UI_COLORS.STATUS_RUNNING) }),
          React.createElement('span', { style: { fontSize: '12px' }, title: result.message }, summary),
        );
      }
      // Failed
      return React.createElement('td', { style: tdStyle },
        React.createElement('span', {
          style: { fontSize: '12px', color: UI_COLORS.STATUS_ERROR },
          title: result.message,
        }, 'Setup failed'),
      );
    }

    return React.createElement('td', { style: tdStyle },
      React.createElement('button', {
        style: btnPrimaryStyle,
        onClick: () => this.handleSetupAI(site.id),
      }, 'Setup for AI'),
    );
  }

  renderFleetSummaryCard(): React.ReactNode {
    const { fleetSummary } = this.state;
    if (!fleetSummary) {
      return React.createElement('div', { style: { ...cardStyle, gridColumn: '1 / 3' } },
        React.createElement('div', { style: cardTitleStyle }, 'Fleet Summary'),
        React.createElement('div', { style: { color: 'var(--nxai-card-sub)', fontSize: '13px' } }, 'Loading fleet data\u2026'),
      );
    }

    const { total, totalLocal, totalWpe, wpVersions, phpVersions, completeness, staleCount, neverScannedCount } = fleetSummary;

    // Show top 3 WP versions
    const topWp = wpVersions.slice(0, 3);
    const otherWpCount = wpVersions.slice(3).reduce((s, e) => s + (e.version !== 'unknown' ? e.count : 0), 0);

    // Show top 3 PHP versions
    const topPhp = phpVersions.slice(0, 3);
    const otherPhpCount = phpVersions.slice(3).reduce((s, e) => s + (e.version !== 'unknown' ? e.count : 0), 0);

    const versionListStyle: React.CSSProperties = {
      fontSize: '12px',
      color: 'var(--nxai-card-text)',
      lineHeight: '1.8',
    };

    const colStyle: React.CSSProperties = {
      flex: 1,
    };

    const labelStyle: React.CSSProperties = {
      fontSize: '11px',
      fontWeight: 600,
      textTransform: 'uppercase' as const,
      letterSpacing: '0.5px',
      color: 'var(--nxai-card-label)',
      marginBottom: '6px',
    };

    return React.createElement('div', { style: { ...cardStyle, gridColumn: '1 / 3' } },
      React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' } },
        React.createElement('div', { style: cardTitleStyle }, 'Fleet Intelligence'),
        React.createElement('div', { style: { fontSize: '22px', fontWeight: 700, color: 'var(--nxai-card-text)' } },
          `${total} sites`,
          React.createElement('span', { style: { fontSize: '12px', fontWeight: 400, color: 'var(--nxai-card-sub)', marginLeft: '8px' } },
            `${totalLocal} local \u00B7 ${totalWpe} WPE`,
          ),
        ),
      ),

      React.createElement('div', { style: { display: 'flex', gap: '24px' } },
        // WP Versions column
        React.createElement('div', { style: colStyle },
          React.createElement('div', { style: labelStyle }, 'WordPress'),
          React.createElement('div', { style: versionListStyle },
            ...topWp.map(e =>
              React.createElement('div', { key: e.version },
                React.createElement('span', { style: { fontWeight: 500 } }, e.version),
                React.createElement('span', { style: { color: 'var(--nxai-card-sub)', marginLeft: '6px' } }, `${e.count} site${e.count !== 1 ? 's' : ''}`),
              )
            ),
            otherWpCount > 0
              ? React.createElement('div', { style: { color: 'var(--nxai-card-sub)' } }, `+${otherWpCount} on other versions`)
              : null,
          ),
        ),

        // PHP Versions column
        React.createElement('div', { style: colStyle },
          React.createElement('div', { style: labelStyle }, 'PHP'),
          React.createElement('div', { style: versionListStyle },
            ...topPhp.map(e =>
              React.createElement('div', { key: e.version },
                React.createElement('span', { style: { fontWeight: 500 } }, e.version),
                React.createElement('span', { style: { color: 'var(--nxai-card-sub)', marginLeft: '6px' } }, `${e.count} site${e.count !== 1 ? 's' : ''}`),
              )
            ),
            otherPhpCount > 0
              ? React.createElement('div', { style: { color: 'var(--nxai-card-sub)' } }, `+${otherPhpCount} on other versions`)
              : null,
          ),
        ),

        // Completeness column
        React.createElement('div', { style: colStyle },
          React.createElement('div', { style: labelStyle }, 'Twin Data'),
          React.createElement('div', { style: versionListStyle },
            completeness.indexed > 0
              ? React.createElement('div', null, `\u2705 indexed: ${completeness.indexed}`)
              : null,
            completeness.metadata > 0
              ? React.createElement('div', null, `\u2705 metadata: ${completeness.metadata}`)
              : null,
            completeness.filesystem > 0
              ? React.createElement('div', null, `\uD83D\uDD36 filesystem: ${completeness.filesystem}`)
              : null,
            completeness.none > 0
              ? React.createElement('div', null, `\u274C none: ${completeness.none}`)
              : null,
          ),
        ),

        // Freshness column
        React.createElement('div', { style: colStyle },
          React.createElement('div', { style: labelStyle }, 'Freshness'),
          React.createElement('div', { style: versionListStyle },
            staleCount > 0
              ? React.createElement('div', { style: { color: UI_COLORS.STATUS_WARNING } },
                  `\u26A0\uFE0F ${staleCount} need${staleCount !== 1 ? '' : 's'} refresh`,
                )
              : React.createElement('div', { style: { color: UI_COLORS.STATUS_RUNNING } }, '\u2713 All current'),
            neverScannedCount > 0
              ? React.createElement('div', { style: { color: 'var(--nxai-card-sub)' } },
                  `${neverScannedCount} never scanned`,
                )
              : null,
          ),
        ),
      ),
    );
  }

  renderFleetPluginsCard(): React.ReactNode {
    const { fleetPlugins } = this.state;

    const topPlugins = fleetPlugins.slice(0, 10);

    return React.createElement('div', { style: cardStyle },
      React.createElement('div', { style: cardTitleStyle }, 'Top Plugins'),
      topPlugins.length === 0
        ? React.createElement('div', { style: { color: 'var(--nxai-card-sub)', fontSize: '13px' } },
            'No plugin data yet. Run fleet refresh to populate.',
          )
        : React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: '6px' } },
            ...topPlugins.map((plugin, idx) =>
              React.createElement('div', {
                key: plugin.slug,
                style: {
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '4px 0',
                  borderBottom: idx < topPlugins.length - 1 ? '1px solid var(--nxai-card-border)' : 'none',
                },
              },
                React.createElement('div', { style: { flex: 1, minWidth: 0 } },
                  React.createElement('div', {
                    style: { fontSize: '12px', fontWeight: 500, color: 'var(--nxai-card-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
                    title: plugin.slug,
                  }, plugin.title !== plugin.slug ? plugin.title : plugin.slug),
                  plugin.title !== plugin.slug
                    ? React.createElement('div', { style: { fontSize: '10px', color: 'var(--nxai-card-sub)', fontFamily: 'monospace' } }, plugin.slug)
                    : null,
                ),
                React.createElement('div', {
                  style: { fontSize: '12px', color: 'var(--nxai-card-sub)', marginLeft: '12px', whiteSpace: 'nowrap' as const, flexShrink: 0 },
                }, `${plugin.siteCount} site${plugin.siteCount !== 1 ? 's' : ''}`),
              )
            ),
          ),
    );
  }

  handleDismissOnboarding = async (): Promise<void> => {
    this.setState({ onboardingDismissed: true });
    try {
      await this.props.electron.ipcRenderer.invoke(
        IPC_CHANNELS.UPDATE_SETTINGS,
        { onboardingDismissed: true },
      );
    } catch {
      // Best-effort
    }
  };

  renderOnboardingCard(): React.ReactNode {
    if (this.state.onboardingDismissed) return null;

    const cardStyle2: React.CSSProperties = {
      borderRadius: '10px',
      padding: '20px 24px',
      border: `1px solid ${UI_COLORS.WPE_BRAND}`,
      backgroundColor: 'rgba(81, 187, 123, 0.07)',
      marginBottom: '20px',
    };
    const stepStyle: React.CSSProperties = {
      display: 'flex',
      alignItems: 'flex-start',
      gap: '12px',
      marginBottom: '10px',
      fontSize: '14px',
    };
    const numStyle: React.CSSProperties = {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '22px',
      height: '22px',
      borderRadius: '50%',
      backgroundColor: UI_COLORS.WPE_BRAND,
      color: '#fff',
      fontSize: '12px',
      fontWeight: 700,
      flexShrink: 0,
    };
    const prefLinkStyle: React.CSSProperties = {
      color: UI_COLORS.WPE_BRAND,
      textDecoration: 'underline',
      cursor: 'pointer',
      background: 'none',
      border: 'none',
      padding: 0,
      fontSize: 'inherit',
    };

    return React.createElement('div', { style: cardStyle2 },
      React.createElement('div', {
        style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' },
      },
        React.createElement('strong', { style: { fontSize: '15px' } }, 'Getting Started with Nexus AI'),
        React.createElement('button', {
          onClick: this.handleDismissOnboarding,
          title: 'Dismiss — don\'t show again',
          style: { background: 'none', border: 'none', cursor: 'pointer', opacity: 0.5, fontSize: '18px', lineHeight: 1, padding: '0 4px' },
        }, '\u00d7'),
      ),
      React.createElement('div', { style: stepStyle },
        React.createElement('span', { style: numStyle }, '1'),
        React.createElement('span', null,
          'Configure your AI provider in ',
          React.createElement('button', { onClick: () => navigateToPreferences(this.props.electron), style: prefLinkStyle }, 'Preferences'),
          ' to connect Claude, OpenAI, or another provider.',
        ),
      ),
      React.createElement('div', { style: stepStyle },
        React.createElement('span', { style: numStyle }, '2'),
        React.createElement('span', null,
          'Enable auto-indexing in ',
          React.createElement('button', { onClick: () => navigateToPreferences(this.props.electron), style: prefLinkStyle }, 'Preferences'),
          ' so new content is indexed automatically when sites start.',
        ),
      ),
      React.createElement('div', { style: stepStyle },
        React.createElement('span', { style: numStyle }, '3'),
        React.createElement('span', null,
          'Go to a site and click ',
          React.createElement('strong', null, '"Install AI Tools"'),
          ' to enable WordPress AI features on that site.',
        ),
      ),
      React.createElement('div', {
        style: { marginTop: '14px', borderTop: '1px solid rgba(81,187,123,0.3)', paddingTop: '12px' },
      },
        React.createElement('button', {
          onClick: this.handleDismissOnboarding,
          style: { background: 'none', border: 'none', cursor: 'pointer', fontSize: '12px', opacity: 0.6, padding: 0, textDecoration: 'underline' },
        }, 'Dismiss — don\'t show again'),
      ),
    );
  }

  renderSiteContentSummary(): React.ReactNode {
    const { sites, indexEntries } = this.state;
    const localSites = sites.filter((s) => s.source === 'local' || !s.isWpe);
    if (localSites.length === 0) return null;

    const entryBySiteId = new Map(indexEntries.map((e) => [e.siteId, e]));

    return React.createElement('div', {
      style: { border: '1px solid var(--nxai-card-border, #e5e7eb)', borderRadius: '10px', overflow: 'hidden', marginBottom: '0' },
    },
      ...localSites.map((site, i) => {
        const entry = entryBySiteId.get(site.id);
        const isIndexed = entry?.state === 'indexed';
        const docCount = entry?.documentCount ?? 0;
        const lastIndexed = entry?.lastIndexed;
        const daysAgo = lastIndexed ? Math.floor((Date.now() - lastIndexed) / 86400000) : null;
        const recencyLabel = daysAgo === null ? null : daysAgo === 0 ? 'today' : daysAgo === 1 ? 'yesterday' : `${daysAgo}d ago`;

        return React.createElement('div', {
          key: site.id,
          style: {
            display: 'flex',
            alignItems: 'center',
            padding: '9px 14px',
            borderBottom: i < localSites.length - 1 ? '1px solid var(--nxai-card-border, #e5e7eb)' : 'none',
            gap: '10px',
          },
        },
          React.createElement('span', {
            style: { width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0, backgroundColor: isIndexed ? UI_COLORS.WPE_BRAND : 'var(--nxai-card-border)' },
          }),
          React.createElement('span', { style: { flex: 1, fontSize: '13px', fontWeight: 600, color: 'var(--nxai-card-text)' } }, site.name),
          isIndexed
            ? React.createElement('span', { style: { fontSize: '12px', color: 'var(--nxai-card-sub)' } },
                `${docCount} post${docCount !== 1 ? 's' : ''}${recencyLabel ? ` · indexed ${recencyLabel}` : ''}`)
            : React.createElement('span', { style: { fontSize: '12px', color: 'var(--nxai-card-sub)', fontStyle: 'italic' } }, 'Not indexed'),
        );
      }),
    );
  }

  renderOverviewTab(): React.ReactNode {
    const { stats } = this.state;
    if (!stats) return null;

    return React.createElement('div', null,
      this.renderOnboardingCard(),
      this.renderSetupBanner(stats),
      this.renderWpeAuthBanner(),

      // Connect AI Tools (moved to top)
      this.renderMcpPanel(),

      this.renderSectionLabel('Sites'),
      this.renderSiteContentSummary(),
      React.createElement('div', { style: { ...cardContainerStyle, marginTop: '12px' } },
        this.renderLocalSitesCard(stats),
        this.renderWpeConnectedCard(stats),
        this.renderRemoteSitesCard(stats),
      ),

      this.renderSectionLabel('Nexus AI'),
      React.createElement('div', { style: { ...cardContainerStyle, gridTemplateColumns: 'repeat(3, 1fr)' } },
        this.renderMcpCard(stats),
        this.renderEmbeddingCard(stats),
        this.renderAiProxyCard(),
      ),
      React.createElement('div', { style: { ...cardContainerStyle, gridTemplateColumns: 'repeat(3, 1fr)', marginTop: '12px' } },
        this.renderIndexCard(stats),
        this.renderGraphCard(),
        this.renderWpeSyncCard(),
      ),

      // Fleet Intelligence — indexing status, completeness, version distribution
      this.renderSectionLabel('Fleet Intelligence'),
      this.renderFleetSummaryCard(),

      // AI Gateway — tabbed: Requests | By Caller
      React.createElement(AIGatewayPanel, { electron: this.props.electron }),
    );
  }

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

renderSearchBar(): React.ReactNode {
    const { searchQuery, searching, indexEntries, sites, indexAllAutoRunning } = this.state;
    const localSites = sites.filter((s) => s.source === 'local' || !s.isWpe);
    const indexedCount = indexEntries.filter((e) => e.state === 'indexed').length;
    const totalLocal = localSites.length;
    const noneIndexed = totalLocal > 0 && indexedCount === 0;

    return React.createElement('div', {
      style: { marginBottom: '16px' },
    },
      // Search input row
      React.createElement('div', {
        style: { position: 'relative' as const, display: 'flex', alignItems: 'center', gap: '10px' },
      },
        React.createElement('div', {
          style: { position: 'relative' as const, flex: 1 },
        },
          React.createElement('span', {
            style: { position: 'absolute' as const, left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--nxai-card-sub)', pointerEvents: 'none' as const, fontSize: '15px' },
          }, '🔍'),
          React.createElement('input', {
            type: 'text',
            placeholder: noneIndexed ? 'Index your sites to search across all of them' : `Search across ${indexedCount} indexed site${indexedCount !== 1 ? 's' : ''}...`,
            value: searchQuery,
            disabled: noneIndexed,
            onChange: this.handleSearch,
            style: {
              width: '100%',
              padding: '10px 12px 10px 36px',
              fontSize: '14px',
              border: '1px solid var(--nxai-input-border, #d1d5db)',
              borderRadius: '8px',
              backgroundColor: noneIndexed ? 'var(--nxai-score-bg, #404040)' : 'var(--nxai-input-bg, #fff)',
              color: 'var(--nxai-card-text)',
              opacity: noneIndexed ? 0.6 : 1,
              outline: 'none',
              boxSizing: 'border-box' as const,
            },
          }),
          searching && React.createElement('span', {
            style: { position: 'absolute' as const, right: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--nxai-card-sub)', fontSize: '12px' },
          }, 'Searching...'),
        ),
        // Index status badge + CTA
        totalLocal > 0 && React.createElement('div', {
          style: { display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 },
        },
          React.createElement('span', {
            style: { fontSize: '12px', color: noneIndexed ? UI_COLORS.STATUS_WARNING : 'var(--nxai-card-sub)', whiteSpace: 'nowrap' as const },
          }, noneIndexed ? `${totalLocal} sites not indexed` : `${indexedCount} / ${totalLocal} indexed`),
          React.createElement('button', {
            onClick: this.handleIndexAllAuto,
            disabled: indexAllAutoRunning,
            style: {
              padding: '8px 14px',
              fontSize: '12px',
              fontWeight: 600,
              borderRadius: '6px',
              border: 'none',
              cursor: indexAllAutoRunning ? 'not-allowed' : 'pointer',
              backgroundColor: noneIndexed ? UI_COLORS.WPE_BRAND : 'var(--nxai-card-border, #e5e7eb)',
              color: noneIndexed ? '#fff' : 'var(--nxai-card-text)',
              whiteSpace: 'nowrap' as const,
            },
          }, indexAllAutoRunning ? 'Indexing...' : noneIndexed ? 'Index All Sites' : 'Re-index All'),
        ),
      ),
    );
  }

  renderSearchResults(): React.ReactNode {
    const { searchQuery, searchResults, searching, sites } = this.state;
    const ipc = this.props.electron.ipcRenderer;

    // Build domain map for WP Admin links
    const domainBySiteId = new Map<string, string>();
    for (const s of sites) {
      if (s.domain) domainBySiteId.set(s.id, s.domain);
    }

    const openWpAdmin = (siteId: string) => {
      const domain = domainBySiteId.get(siteId);
      if (domain) this.props.electron.shell?.openExternal(`http://${domain}/wp-admin/`);
    };

    const openInLocal = (siteId: string) => {
      ipc.invoke(IPC_CHANNELS.SIDEBAR_NAVIGATE_TO_SITE, { siteId });
    };

    if (searching) {
      return React.createElement('div', {
        style: { padding: '40px', textAlign: 'center' as const, color: 'var(--nxai-card-sub)' },
      }, 'Searching...');
    }

    if (searchQuery.trim() && searchResults.length === 0) {
      return React.createElement('div', {
        style: { padding: '40px', textAlign: 'center' as const, color: 'var(--nxai-card-sub)' },
      }, `No results for "${searchQuery}"`);
    }

    // Group results by site
    const bySite = new Map<string, { siteName: string; siteId: string; results: UISearchResult[] }>();
    for (const r of searchResults) {
      if (!bySite.has(r.siteId)) bySite.set(r.siteId, { siteName: r.siteName, siteId: r.siteId, results: [] });
      bySite.get(r.siteId)!.results.push(r);
    }

    return React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: '16px' } },
      ...Array.from(bySite.values()).map((group) =>
        React.createElement('div', {
          key: group.siteId,
          style: { border: '1px solid var(--nxai-card-border, #e5e7eb)', borderRadius: '10px', overflow: 'hidden' },
        },
          // Site header
          React.createElement('div', {
            style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', backgroundColor: 'var(--nxai-score-bg, #f3f4f6)', borderBottom: '1px solid var(--nxai-card-border, #e5e7eb)' },
          },
            React.createElement('span', {
              style: { fontSize: '13px', fontWeight: 700, color: 'var(--nxai-card-text)' },
            }, group.siteName),
            React.createElement('div', { style: { display: 'flex', gap: '8px' } },
              React.createElement('button', {
                onClick: () => openInLocal(group.siteId),
                style: { padding: '4px 10px', fontSize: '11px', borderRadius: '5px', border: '1px solid var(--nxai-card-border)', backgroundColor: 'transparent', color: UI_COLORS.WPE_BRAND, cursor: 'pointer', fontWeight: 600 },
              }, 'Open in Local'),
              domainBySiteId.has(group.siteId) && React.createElement('button', {
                onClick: () => openWpAdmin(group.siteId),
                style: { padding: '4px 10px', fontSize: '11px', borderRadius: '5px', border: '1px solid var(--nxai-card-border)', backgroundColor: 'transparent', color: 'var(--nxai-card-sub)', cursor: 'pointer', fontWeight: 600 },
              }, 'WP Admin'),
            ),
          ),
          // Results list
          ...group.results.map((r, i) =>
            React.createElement('div', {
              key: r.id,
              style: {
                padding: '10px 14px',
                borderBottom: i < group.results.length - 1 ? '1px solid var(--nxai-card-border, #e5e7eb)' : 'none',
                display: 'flex',
                flexDirection: 'column' as const,
                gap: '3px',
              },
            },
              React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
                React.createElement('span', {
                  style: { fontSize: '13px', fontWeight: 600, color: 'var(--nxai-card-text)', flex: 1 },
                }, r.title || '(untitled)'),
                React.createElement('span', {
                  style: { fontSize: '10px', padding: '2px 6px', borderRadius: '4px', backgroundColor: 'var(--nxai-score-bg)', color: 'var(--nxai-card-sub)', textTransform: 'uppercase' as const, fontWeight: 600, letterSpacing: '0.5px' },
                }, r.postType),
              ),
              React.createElement('p', {
                style: { fontSize: '12px', color: 'var(--nxai-card-sub)', margin: 0, lineHeight: 1.4,
                  overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const },
              }, r.content),
            ),
          ),
        ),
      ),
    );
  }

  renderTabBar(): React.ReactNode {
    const { activeTab } = this.state;
    const tabs: { key: NexusOverviewState['activeTab']; label: string }[] = [
      { key: 'overview', label: 'Overview' },
      { key: 'activity', label: 'Activity' },
      { key: 'operations', label: 'Operations' },
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
      React.createElement('span', { style: { color: '#6b7280', fontWeight: 600 } }, 'Deep Scan Scope:'),
      React.createElement('span', { style: { color: '#111827', flex: 1 } }, scopeLabel),
      React.createElement('span', { style: { color: '#9ca3af' } }, '· Manage in Preferences → Nexus AI'),
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
        ? React.createElement('div', { style: { fontSize: '11px', color: '#6b7280', marginTop: '4px', lineHeight: '1.3' } }, description)
        : null,
      opId
        ? React.createElement('div', { style: { fontSize: '12px', color: UI_COLORS.STATUS_RUNNING, marginTop: '4px' } }, 'Started — check progress below.')
        : null,
    );
  }

  renderOperationsTab(): React.ReactNode {
    const groupStyle = { display: 'flex', gap: '12px', marginBottom: '24px', flexWrap: 'wrap' as const };
    const groupLabelStyle = { fontSize: '12px', fontWeight: '600' as const, color: '#6b7280', textTransform: 'uppercase' as const, letterSpacing: '0.05em', marginBottom: '8px' };

    const wpeDisabled = !(this.state.stats?.remoteSites.wpeAuthenticated ?? false);

    return React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const } },
      this.renderSectionLabel('Operations'),

      // ── WPE Deep Scan Scope ──────────────────────────────────────────────────
      this.renderWpeAccountScope(),

      // ── Refresh Site Data ────────────────────────────────────────────────────
      React.createElement('div', { style: groupLabelStyle }, 'Refresh Site Data'),
      React.createElement('div', { style: groupStyle },
        this.renderOpsButton(
          'Refresh local sites', 'Syncing...',
          this.state.syncGraphRunning, this.state.syncGraphOpId,
          this.handleSyncGraph,
          'WP-CLI scan: updates plugin list, WP version, themes. Starts halted sites temporarily.',
        ),
        this.renderOpsButton(
          'Refresh WPE sites', 'Syncing...',
          this.state.wpeSyncing, null,
          this.handleWpeSync,
          'SSH scan: updates plugin list, WP version, themes for all WPE installs.',
          wpeDisabled,
        ),
      ),

      // ── Index for Search ────────────────────────────────────────────────────
      React.createElement('div', { style: groupLabelStyle }, 'Index for Search'),
      React.createElement('div', { style: groupStyle },
        this.renderOpsButton(
          'Index local sites', 'Indexing...',
          this.state.indexAllAutoRunning, this.state.indexAllAutoOpId,
          this.handleIndexAllAuto,
          'Extracts and indexes post/page content from local sites. Starts halted sites temporarily.',
        ),
        this.renderOpsButton(
          'Index WPE sites', 'Indexing...',
          this.state.fleetIndexRunning, this.state.fleetIndexOpId,
          this.handleIndexAllFleet,
          'SSH: extracts and indexes post/page content from WPE installs. Requires SSH key.',
          wpeDisabled,
        ),
      ),

      // ── AI Features ─────────────────────────────────────────────────────────
      React.createElement('div', { style: groupLabelStyle }, 'AI Features'),
      React.createElement('div', { style: groupStyle },
        this.renderOpsButton(
          'Set up AI on all local sites', 'Setting up...',
          this.state.setupAllAutoRunning, this.state.setupAllAutoOpId,
          this.handleSetupAllAuto,
          'Installs AI plugin and syncs API credentials. Local sites only. Starts halted sites temporarily.',
        ),
      ),

      // WPE sync progress (runs outside bulkOpManager — show inline)
      this.state.wpeSyncing && this.state.wpeSyncProgress
        ? React.createElement('div', {
            style: { border: '1px solid var(--nxai-card-border, #e5e7eb)', borderRadius: '10px', padding: '16px 20px', marginBottom: '12px' },
          },
            React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' } },
              React.createElement('span', { style: { fontSize: '13px', fontWeight: 600 } }, 'WPE SSH sync'),
              React.createElement('span', { style: { fontSize: '12px', color: '#6b7280' } },
                `${this.state.wpeSyncProgress.current} / ${this.state.wpeSyncProgress.total} sites`,
              ),
            ),
            React.createElement('div', { style: { fontSize: '12px', color: '#6b7280' } },
              this.state.wpeSyncProgress.currentSite
                ? `Syncing: ${this.state.wpeSyncProgress.currentSite}`
                : 'Starting...',
            ),
          )
        : null,

      // Bulk Operations Panel — shows running / completed operations
      React.createElement(BulkOperationsPanel, {
        electron: this.props.electron,
        siteNames: new Map(Object.values(this.state.sites || {}).map((s: any) => [s.id, s.name])),
      }),

      // ── Maintenance ──────────────────────────────────────────────────────────
      React.createElement('hr', { style: { border: 'none', borderTop: '1px solid var(--nxai-card-border, #e5e7eb)', margin: '32px 0 24px' } }),
      this.renderSectionLabel('Maintenance'),
      this.renderDbScanSection(),
      this.renderContentMaintenance(),

      // ── Developer Tools ───────────────────────────────────────────────────────
      React.createElement('hr', { style: { border: 'none', borderTop: '1px solid var(--nxai-card-border, #e5e7eb)', margin: '32px 0 24px' } }),
      this.renderSectionLabel('Developer Tools'),
      this.renderSshDiagnostics(),
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
      padding: '5px 10px', borderRadius: '4px', border: '1px solid var(--color-border-primary, #ccc)',
      backgroundColor: 'transparent', fontSize: '11px', cursor: diagRunning ? 'not-allowed' : 'pointer',
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
            backgroundColor: 'var(--color-background-secondary, #f9fafb)',
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
            backgroundColor: 'var(--color-background-secondary, #f9fafb)',
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
      case 'overview': return this.renderOverviewTab();
      case 'activity': return this.renderActivityTab();
      case 'operations': return this.renderOperationsTab();
      default: return this.renderOverviewTab();
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

  // Credential Sync methods
  handleSyncAll = async (): Promise<void> => {
    this.setState({ syncing: true, syncResults: null });
    try {
      const result = await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.SYNC_ALL_CREDENTIALS);
      if (!this.mounted) return;

      const results = result?.results ?? [];
      this.setState({ syncing: false, syncResults: results });

      // Show toast notification
      const successCount = results.filter((r: any) => r.success).length;
      const failCount = results.length - successCount;

      if (toast) {
        if (failCount === 0 && successCount > 0) {
          toast({ type: 'success', content: `Successfully synced credentials to ${successCount} site${successCount === 1 ? '' : 's'}` });
        } else if (failCount > 0 && successCount > 0) {
          toast({ type: 'error', content: `Synced ${successCount} site${successCount === 1 ? '' : 's'}, ${failCount} failed` });
        } else if (failCount > 0) {
          toast({ type: 'error', content: `Failed to sync credentials to ${failCount} site${failCount === 1 ? '' : 's'}` });
        }
      }

      // Refresh sync status
      const syncStatus = await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.GET_CREDENTIAL_SYNC_STATUS);
      if (this.mounted) this.setState({ syncStatus: syncStatus ?? {} });
    } catch (err) {
      if (!this.mounted) return;
      this.setState({ syncing: false, syncResults: [] });
      if (toast) {
        toast({ type: 'error', content: 'Failed to sync credentials' });
      }
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

  renderCredentialSyncSection(): React.ReactNode {
    const { syncStatus, syncing, syncResults, sites } = this.state;
    const runningSites = sites.filter((s) => s.status === 'running');
    const syncEntries = Object.entries(syncStatus);
    const hasSyncData = syncEntries.length > 0;

    const sectionStyle: React.CSSProperties = { marginBottom: '24px' };
    const descStyle: React.CSSProperties = {
      fontSize: '13px',
      color: 'var(--nxai-card-sub, #6b7280)',
      marginBottom: '16px',
      lineHeight: 1.5,
    };
    const rowStyle: React.CSSProperties = {
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      marginBottom: '12px',
    };
    const btnSmallStyle: React.CSSProperties = {
      padding: '6px 12px',
      borderRadius: '6px',
      border: '1px solid var(--nxai-card-border, #e5e7eb)',
      backgroundColor: 'var(--nxai-card-bg, #fff)',
      color: 'var(--nxai-card-text, #111827)',
      fontSize: '12px',
      fontWeight: 500,
      cursor: 'pointer',
    };

    return React.createElement('div', { style: sectionStyle },
      React.createElement('div', { style: descStyle },
        'Push API keys to running WordPress sites so their AI features can use your configured providers.',
      ),

      // Sync status summary
      hasSyncData
        ? React.createElement('div', { style: { marginBottom: '12px' } },
            ...syncEntries.map(([siteId, status]: [string, any]) => {
              const site = sites.find((s) => s.id === siteId);
              const color = status.success ? UI_COLORS.STATUS_RUNNING : UI_COLORS.STATUS_ERROR;
              const ago = status.lastSync ? formatTimeAgo(status.lastSync) : 'Never';
              return React.createElement('div', {
                key: siteId,
                style: { display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 0', fontSize: '13px' },
              },
                React.createElement('span', { style: dotStyle(color) }),
                React.createElement('span', { style: { color: 'var(--nxai-card-text)' } }, site?.name ?? siteId),
                React.createElement('span', { style: { color: 'var(--nxai-card-sub)', fontSize: '12px' } }, `(${ago})`),
              );
            }),
          )
        : React.createElement('div', { style: { ...descStyle, fontStyle: 'italic' } },
            'No credentials have been synced yet.',
          ),

      // Sync All button
      React.createElement('div', { style: { ...rowStyle, alignItems: 'center' } },
        React.createElement('button', {
          style: {
            ...btnSmallStyle,
            ...(syncing ? { opacity: 0.6, cursor: 'not-allowed' } : { backgroundColor: UI_COLORS.WPE_BRAND, color: '#fff', border: 'none' }),
          },
          onClick: syncing ? undefined : this.handleSyncAll,
          disabled: syncing || runningSites.length === 0,
        }, syncing ? 'Syncing...' : `Sync All (${runningSites.length} running)`),
        syncing ? React.createElement(LoadingSpinner, { size: 16, inline: true }) : null,
      ),

      // Results
      syncResults && syncResults.length > 0
        ? React.createElement('div', { style: { marginTop: '8px' } },
            ...syncResults.map((r) =>
              React.createElement('div', {
                key: r.siteId,
                style: { fontSize: '12px', padding: '2px 0', color: r.success ? UI_COLORS.STATUS_RUNNING : UI_COLORS.STATUS_ERROR },
              }, `${r.siteName}: ${r.success ? `synced (${r.providers.join(', ')})` : r.error ?? 'failed'}`),
            ),
          )
        : null,
    );
  }

  renderWpeSyncSection(): React.ReactNode {
    const { wpeSyncing, wpeStopping, wpeSyncProgress, wpeSyncError, wpeSyncStats, wpeSyncThresholdHours } = this.state;

    const subStyle: React.CSSProperties = { fontSize: '12px', color: 'var(--nxai-card-sub, #6b7280)' };

    // Format last sync time
    let lastSyncLabel = 'Never synced';
    if (wpeSyncStats?.last_sync_at) {
      const ageMs = Date.now() - wpeSyncStats.last_sync_at;
      const ageHours = Math.floor(ageMs / 3600000);
      const ageMins = Math.floor((ageMs % 3600000) / 60000);
      lastSyncLabel = ageHours > 0
        ? `Last synced ${ageHours}h${ageMins > 0 ? ` ${ageMins}m` : ''} ago`
        : `Last synced ${ageMins}m ago`;
    }

    return React.createElement('div', { style: { marginBottom: '24px' } },

      // Sync button row
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px', flexWrap: 'wrap' as const } },
        React.createElement('button', {
          onClick: this.handleWpeSync,
          disabled: wpeSyncing,
          style: {
            padding: '8px 16px', borderRadius: '6px', border: 'none',
            backgroundColor: wpeSyncing ? '#3b82f680' : '#3b82f6',
            color: '#fff', fontSize: '13px', fontWeight: 600,
            cursor: wpeSyncing ? 'not-allowed' : 'pointer',
          },
        }, wpeSyncing ? 'Syncing...' : 'Sync All'),
        wpeSyncing
          ? React.createElement('button', {
              onClick: this.handleWpeSyncStop,
              style: {
                padding: '8px 14px', borderRadius: '6px', border: '1px solid #ef4444',
                backgroundColor: 'transparent', color: '#ef4444', fontSize: '13px',
                fontWeight: 600, cursor: 'pointer',
              },
            }, 'Stop')
          : null,
        wpeSyncing ? React.createElement(LoadingSpinner, { size: 14, inline: true }) : null,
      ),

      // In-progress / stopping message
      wpeSyncing && wpeSyncProgress
        ? React.createElement('div', { style: { marginBottom: '8px' } },
            React.createElement('div', { style: { ...subStyle, fontStyle: 'italic' } },
              `${wpeSyncProgress.currentSite} (${wpeSyncProgress.current}/${wpeSyncProgress.total}` +
              (wpeSyncProgress.skipped > 0 ? `, ${wpeSyncProgress.skipped} skipped` : '') + ')',
            ),
            wpeStopping
              ? React.createElement('div', {
                  style: { fontSize: '12px', color: '#f59e0b', marginTop: '4px', fontWeight: 500 },
                }, '⚠ Stopping after current batch completes…')
              : null,
          )
        : null,

      // Stats row (persists across restarts, per-site freshness)
      wpeSyncStats
        ? React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: '4px' } },
            React.createElement('div', { style: subStyle }, lastSyncLabel),
            React.createElement('div', { style: subStyle },
              `${wpeSyncStats.fresh_count}/${wpeSyncStats.total} fresh`,
              wpeSyncStats.stale_count > 0
                ? React.createElement('span', { style: { color: '#f59e0b' } },
                    ` · ${wpeSyncStats.stale_count} need refresh (>${wpeSyncThresholdHours}h old)`,
                  )
                : React.createElement('span', { style: { color: '#51BB7B' } }, ' · all up to date ✓'),
            ),
            React.createElement('div', { style: subStyle },
              `WP version: ${wpeSyncStats.has_wp_version}/${wpeSyncStats.total}`,
              wpeSyncStats.total - wpeSyncStats.has_wp_version > 0
                ? React.createElement('span', {
                    style: { opacity: 0.7 },
                    title: 'WP version requires SSH — installs without SSH access show unknown',
                  }, ` (${wpeSyncStats.total - wpeSyncStats.has_wp_version} need SSH)`)
                : null,
              ` · PHP: ${wpeSyncStats.has_php_version}/${wpeSyncStats.total}`,
            ),
          )
        : React.createElement('div', { style: subStyle }, 'No sync data yet. Click Sync to fetch WP Engine site metadata.'),

      // Single-site sync (when not running a full sync)
      !wpeSyncing
        ? React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', marginTop: '10px' } },
            React.createElement('input', {
              type: 'text',
              placeholder: 'install-name (sync single)',
              style: {
                padding: '5px 10px', borderRadius: '5px', fontSize: '12px',
                border: '1px solid var(--color-border-primary, #ccc)',
                backgroundColor: 'var(--color-background-secondary, #f9fafb)',
                width: '180px',
              },
              onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
                if (e.key === 'Enter') {
                  const installName = (e.target as HTMLInputElement).value.trim();
                  if (installName) {
                    this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.WPE_SYNC_SINGLE, { installId: installName });
                    (e.target as HTMLInputElement).value = '';
                  }
                }
              },
            }),
            React.createElement('span', { style: { ...subStyle, fontSize: '11px' } }, '↵ to sync'),
          )
        : null,

      // Error
      wpeSyncError
        ? React.createElement('div', {
            style: {
              padding: '10px 12px', marginTop: '10px', borderRadius: '6px',
              backgroundColor: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)',
              fontSize: '12px', color: '#dc2626',
            },
          }, `Sync error: ${wpeSyncError}`)
        : null,
    );
  }

  render(): React.ReactNode {
    const { loading, error, stats } = this.state;

    return React.createElement('div', {
      style: { display: 'flex', flexDirection: 'column' as const, height: '100%', overflow: 'hidden', color: 'var(--nxai-card-text)', userSelect: 'text' as const },
    },
      // Header: title + search bar + tab bar (fixed)
      React.createElement('div', {
        style: { flexShrink: 0, padding: '24px 32px 0' },
      },
        React.createElement('h1', {
          style: { fontSize: '22px', fontWeight: 600, marginBottom: '16px', color: 'var(--nxai-card-text)' },
        }, 'Nexus AI Dashboard'),
        stats ? this.renderSearchBar() : null,
        !this.state.searchQuery.trim() ? this.renderTabBar() : null,
      ),

      // Content: search results when query active, otherwise tab content
      React.createElement('div', {
        style: { flexGrow: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' as const },
      },
        loading
          ? React.createElement('div', {
              style: { padding: '40px 32px', color: 'var(--nxai-card-sub)', textAlign: 'center' as const },
            }, 'Loading dashboard...')
          : error
            ? React.createElement('div', {
                style: { padding: '40px 32px', color: UI_COLORS.STATUS_ERROR, textAlign: 'center' as const },
              }, `Error: ${error}`)
            : stats
              ? React.createElement('div', {
                  style: { flex: 1, overflowY: 'auto' as const, padding: '24px 32px', display: 'flex', flexDirection: 'column' as const },
                }, this.state.searchQuery.trim() ? this.renderSearchResults() : this.renderActiveTab())
              : null,
      ),
    );
  }
}
