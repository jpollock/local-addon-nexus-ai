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
import { AIGatewayUsagePanel } from './AIGatewayUsagePanel';
import { AIGatewayByCallerPanel } from './AIGatewayByCallerPanel';
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
  remoteSites: { total: number; unlinked: number; capiAvailable: boolean };
  mcpServer: { running: boolean; toolCount: number; port: number | null; version: string | null };
  embedding: { ready: boolean; model: string; quantized: boolean; dimensions: number; maxSequenceLength: number };
  index: { sitesIndexed: number; totalSites: number; totalDocuments: number; totalChunks: number; lastIndexed: number | null };
}

interface McpInfo {
  url: string;
  authToken: string;
  port: number;
  version: string;
  tools: string[];
  stdioPath: string;
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

interface NexusOverviewState {
  stats: DashboardStats | null;
  mcpInfo: McpInfo | null;
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
  wpeSyncStats: { total: number; has_wp_version: number; has_php_version: number; last_sync_at: number | null; fresh_count: number; stale_count: number } | null;
  wpeSyncThresholdHours: number;
  // Credential sync state
  syncStatus: Record<string, { lastSync: number; success: boolean }>;
  syncing: boolean;
  syncResults: Array<{ siteId: string; siteName: string; success: boolean; providers: string[]; error?: string }> | null;
  wpeAuthError: boolean;
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

export class NexusOverview extends React.Component<NexusOverviewProps, NexusOverviewState> {
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private wpeSyncPassivePoll: ReturnType<typeof setInterval> | null = null;
  private mounted = false;

  state: NexusOverviewState = {
    stats: null,
    mcpInfo: null,
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
    wpeSyncStats: null,
    wpeSyncThresholdHours: 8,
    syncStatus: {},
    syncing: false,
    syncResults: null,
    wpeAuthError: false,
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
      const [stats, mcpInfo, sites, indexEntries, proxyResult, settings, wpeSitesResult, syncStatus, wpeSyncStatsResult] = await Promise.all([
        ipc.invoke(IPC_CHANNELS.GET_DASHBOARD_STATS),
        ipc.invoke(IPC_CHANNELS.GET_MCP_INFO),
        ipc.invoke(IPC_CHANNELS.GET_SITES),
        ipc.invoke(IPC_CHANNELS.GET_FLEET_STATUS),
        ipc.invoke(IPC_CHANNELS.GET_AI_PROXY_INFO),
        ipc.invoke(IPC_CHANNELS.GET_SETTINGS),
        ipc.invoke(IPC_CHANNELS.WPE_GET_SYNCED_SITES),
        ipc.invoke(IPC_CHANNELS.GET_CREDENTIAL_SYNC_STATUS),
        ipc.invoke(IPC_CHANNELS.WPE_SYNC_STATS),
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
      React.createElement('div', { style: subStatStyle }, `${remoteSites.unlinked} not linked to Local`),
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
    return React.createElement('div', { style: cardStyle },
      React.createElement('div', { style: cardTitleStyle }, 'Context Index'),
      React.createElement('div', { style: { ...bigNumberStyle, color: 'var(--nxai-card-text)' } },
        `${index.sitesIndexed}`,
        React.createElement('span', { style: { fontSize: '14px', fontWeight: 400, color: 'var(--nxai-card-sub)' } },
          ` / ${index.totalSites} sites`,
        ),
      ),
      React.createElement('div', { style: subStatStyle },
        `${index.totalDocuments.toLocaleString()} documents`,
        React.createElement('br'),
        `${index.totalChunks.toLocaleString()} chunks`,
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
        `Threshold: ${wpeSyncThresholdHours}h`,
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

  renderWpeAuthBanner(): React.ReactNode {
    const { stats, wpeAuthError } = this.state;
    if (!stats?.remoteSites.capiAvailable || !wpeAuthError) return null;
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
      React.createElement('span', {
        style: { fontSize: '15px', lineHeight: 1, flexShrink: 0 },
      }, '\u{1F512}'),
      React.createElement('span', { style: { fontSize: '13px', color: 'var(--nxai-card-text)', flex: 1 } },
        React.createElement('strong', null, 'Not signed in to WP Engine.'),
        ' WPE-specific features are unavailable. Run ',
        React.createElement('code', {
          style: { fontFamily: 'monospace', fontSize: '12px', backgroundColor: 'var(--nxai-code-bg, rgba(0,0,0,0.08))', padding: '1px 5px', borderRadius: '3px' },
        }, 'nexus wpe login'),
        ' to connect, or check your status with ',
        React.createElement('code', {
          style: { fontFamily: 'monospace', fontSize: '12px', backgroundColor: 'var(--nxai-code-bg, rgba(0,0,0,0.08))', padding: '1px 5px', borderRadius: '3px' },
        }, 'nexus wpe status'),
        '.',
      ),
    );
  }

  renderMcpPanel(): React.ReactNode {
    const { mcpInfo, copiedField } = this.state;
    if (!mcpInfo) {
      return React.createElement('div', {
        style: { ...cardStyle, marginBottom: '24px', textAlign: 'center' as const, padding: '24px', color: 'var(--nxai-card-sub)' },
      }, 'MCP server not yet running. Waiting for initialization...');
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

  renderOverviewTab(): React.ReactNode {
    const { stats } = this.state;
    if (!stats) return null;

    return React.createElement(React.Fragment, null,
      this.renderSetupBanner(stats),
      this.renderWpeAuthBanner(),

      // Connect AI Tools (moved to top)
      this.renderMcpPanel(),

      this.renderSectionLabel('Sites'),
      React.createElement('div', { style: cardContainerStyle },
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

      // AI Gateway Usage (moved from Operations tab)
      React.createElement(AIGatewayUsagePanel, { electron: this.props.electron }),

      // AI Gateway By Caller (aggregated view)
      React.createElement(AIGatewayByCallerPanel, { electron: this.props.electron }),
    );
  }

  renderActivityTab(): React.ReactNode {
    return React.createElement('div', null,
      // Event Stats Cards
      React.createElement(EventStatsCards, { electron: this.props.electron }),

      // Timeline + Side Panels
      React.createElement('div', {
        style: { display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '16px', marginBottom: '24px' },
      },
        React.createElement(EventTimeline, { electron: this.props.electron }),
        React.createElement('div', {
          style: { display: 'flex', flexDirection: 'column' as const, gap: '16px' },
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


  renderOperationsTab(): React.ReactNode {
    return React.createElement('div', null,
      // Fleet Operations section
      this.renderSectionLabel('Fleet Operations'),

      // Fleet operation buttons (4 buttons)
      React.createElement('div', { style: { display: 'flex', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' } },
        // Setup AI Fleet (running only)
        React.createElement('div', { style: { flex: '1', minWidth: '250px' } },
          React.createElement('button', {
            style: this.state.fleetSetupRunning
              ? { ...btnPrimaryStyle, opacity: 0.6, cursor: 'not-allowed', width: '100%' }
              : { ...btnPrimaryStyle, width: '100%' },
            onClick: this.state.fleetSetupRunning ? undefined : this.handleSetupAIFleet,
            disabled: this.state.fleetSetupRunning,
          }, this.state.fleetSetupRunning ? 'Setting up...' : 'Setup AI for All Running Sites'),
          this.state.fleetSetupOpId
            ? React.createElement('div', {
                style: { fontSize: '12px', color: UI_COLORS.STATUS_RUNNING, marginTop: '4px' },
              }, 'Started! Check progress below.')
            : null,
        ),

        // Index All Fleet (running only)
        React.createElement('div', { style: { flex: '1', minWidth: '250px' } },
          React.createElement('button', {
            style: this.state.fleetIndexRunning
              ? { ...btnPrimaryStyle, opacity: 0.6, cursor: 'not-allowed', width: '100%' }
              : { ...btnPrimaryStyle, width: '100%' },
            onClick: this.state.fleetIndexRunning ? undefined : this.handleIndexAllFleet,
            disabled: this.state.fleetIndexRunning,
          }, this.state.fleetIndexRunning ? 'Indexing...' : 'Index All Running Sites'),
          this.state.fleetIndexOpId
            ? React.createElement('div', {
                style: { fontSize: '12px', color: UI_COLORS.STATUS_RUNNING, marginTop: '4px' },
              }, 'Started! Check progress below.')
            : null,
        ),

        // Setup AI for ALL Sites (auto-start)
        React.createElement("div", { style: { flex: "1", minWidth: "250px" } },
          React.createElement("button", {
            style: this.state.setupAllAutoRunning
              ? { ...btnPrimaryStyle, opacity: 0.6, cursor: "not-allowed", width: "100%" }
              : { ...btnPrimaryStyle, width: "100%" },
            onClick: this.state.setupAllAutoRunning ? undefined : this.handleSetupAllAuto,
            disabled: this.state.setupAllAutoRunning,
          }, this.state.setupAllAutoRunning ? "Setting up..." : "Setup AI for All Sites (auto-start)"),
          this.state.setupAllAutoOpId
            ? React.createElement("div", {
                style: { fontSize: "12px", color: UI_COLORS.STATUS_RUNNING, marginTop: "4px" },
              }, "Started! Check progress below.")
            : null,
        ),

        // Re-index ALL Sites (auto-start)
        React.createElement("div", { style: { flex: "1", minWidth: "250px" } },
          React.createElement("button", {
            style: this.state.indexAllAutoRunning
              ? { ...btnPrimaryStyle, opacity: 0.6, cursor: "not-allowed", width: "100%" }
              : { ...btnPrimaryStyle, width: "100%" },
            onClick: this.state.indexAllAutoRunning ? undefined : this.handleIndexAllAuto,
            disabled: this.state.indexAllAutoRunning,
          }, this.state.indexAllAutoRunning ? "Indexing..." : "Re-index All Sites (auto-start)"),
          this.state.indexAllAutoOpId
            ? React.createElement("div", {
                style: { fontSize: "12px", color: UI_COLORS.STATUS_RUNNING, marginTop: "4px" },
              }, "Started! Check progress below.")
            : null,
        ),

        // Sync Graph (all sites, auto-start/stop)
        React.createElement("div", { style: { flex: "1", minWidth: "250px" } },
          React.createElement("button", {
            style: this.state.syncGraphRunning
              ? { ...btnPrimaryStyle, opacity: 0.6, cursor: "not-allowed", width: "100%" }
              : { ...btnPrimaryStyle, width: "100%" },
            onClick: this.state.syncGraphRunning ? undefined : this.handleSyncGraph,
            disabled: this.state.syncGraphRunning,
          }, this.state.syncGraphRunning ? "Syncing..." : "Refresh Site Finder Data (auto-start)"),
          this.state.syncGraphOpId
            ? React.createElement("div", {
                style: { fontSize: "12px", color: UI_COLORS.STATUS_RUNNING, marginTop: "4px" },
              }, "Started! Check progress below.")
            : null,
        ),
      ),

      // Bulk Operations Panel
      React.createElement(BulkOperationsPanel, { electron: this.props.electron }),

      // Divider
      React.createElement('hr', {
        style: {
          border: 'none',
          borderTop: '1px solid var(--nxai-card-border, #e5e7eb)',
          margin: '32px 0 24px',
        },
      }),

      // Credential Sync section
      this.renderSectionLabel('Credential Sync'),
      this.renderCredentialSyncSection(),

      // Divider
      React.createElement('hr', {
        style: {
          border: 'none',
          borderTop: '1px solid var(--nxai-card-border, #e5e7eb)',
          margin: '32px 0 24px',
        },
      }),

      // WPE Sync section
      this.renderSectionLabel('WP Engine Sites'),
      this.renderWpeSyncSection(),

      // SSH Diagnostics
      this.renderSectionLabel('SSH Diagnostics'),
      this.renderSshDiagnostics(),
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
      { label: 'wp cli info', args: ['cli', 'info'] },
      { label: 'wp post list', args: ['post', 'list', '--format=json', '--posts_per_page=5'] },
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
      React.createElement('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' as const, marginBottom: '12px' } },
        PRESETS.map(({ label, args }) =>
          React.createElement('button', {
            key: label,
            style: btnStyle,
            disabled: diagRunning || !diagInstall.trim(),
            onClick: () => this.handleDiag(args),
          }, label),
        ),
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
                    maxHeight: '120px', overflow: 'auto', color: 'var(--nxai-card-sub)', fontSize: '10px' },
                }, r.error ?? (r.stdout?.slice(0, 500) || '(empty)')),
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
      // Header: title + tab bar (fixed)
      React.createElement('div', {
        style: { flexShrink: 0, padding: '24px 32px 0' },
      },
        React.createElement('h1', {
          style: { fontSize: '22px', fontWeight: 600, marginBottom: '16px', color: 'var(--nxai-card-text)' },
        }, 'Nexus AI Dashboard'),
        this.renderTabBar(),
      ),

      // Content: scrollable area
      React.createElement('div', {
        style: { flexGrow: 1, overflowY: 'auto' as const, padding: '24px 32px' },
      },
        loading
          ? React.createElement('div', {
              style: { color: 'var(--nxai-card-sub)', padding: '40px 0', textAlign: 'center' as const },
            }, 'Loading dashboard...')
          : error
            ? React.createElement('div', {
                style: { color: UI_COLORS.STATUS_ERROR, padding: '40px 0', textAlign: 'center' as const },
              }, `Error: ${error}`)
            : stats
              ? this.renderActiveTab()
              : null,
      ),
    );
  }
}
