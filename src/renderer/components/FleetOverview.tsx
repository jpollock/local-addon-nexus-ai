/**
 * Fleet Overview Dashboard
 *
 * Hub page showing stats, MCP connection panel, site index table, search, and visibility.
 * Class-based — Local uses older React, no hooks allowed.
 */
import * as React from 'react';
import { IPC_CHANNELS, UI_COLORS, POLL_INTERVALS } from '../../common/constants';
import type { NexusSettings } from '../../common/types';
import { ChatTab } from './ChatTab';
import { EventStatsCards } from './EventStatsCards';
import { EventTimeline } from './EventTimeline';
import { StorageHealthPanel } from './StorageHealthPanel';
import { TopIssuesPanel } from './TopIssuesPanel';
import { UnifiedSearchPanel } from './UnifiedSearchPanel';
import { SmartFiltersPanel } from './SmartFiltersPanel';
import { SavedQueriesPanel } from './SavedQueriesPanel';
import { SiteHealthBadge } from './SiteHealthBadge';
import { BulkOperationsPanel } from './BulkOperationsPanel';
import { SiteGroupsPanel } from './SiteGroupsPanel';

interface FleetOverviewProps {
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
}

interface SiteListItem {
  id: string;
  name: string;
  domain: string;
  status: string;
  isWpe: boolean;
  indexed: boolean;
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

interface FleetOverviewState {
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
  activeTab: 'overview' | 'sites' | 'operations' | 'chat';
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

export class FleetOverview extends React.Component<FleetOverviewProps, FleetOverviewState> {
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private mounted = false;

  state: FleetOverviewState = {
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
    settings: null,
  };

  componentDidMount(): void {
    this.mounted = true;
    this.injectCssVars();
    this.fetchAll();
    this.pollTimer = setInterval(() => this.fetchAll(), POLL_INTERVALS.DASHBOARD_STATS_MS);
  }

  componentWillUnmount(): void {
    this.mounted = false;
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.searchTimer) clearTimeout(this.searchTimer);
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
      const [stats, mcpInfo, sites, indexEntries, proxyResult, settings] = await Promise.all([
        ipc.invoke(IPC_CHANNELS.GET_DASHBOARD_STATS),
        ipc.invoke(IPC_CHANNELS.GET_MCP_INFO),
        ipc.invoke(IPC_CHANNELS.GET_SITES),
        ipc.invoke(IPC_CHANNELS.GET_FLEET_STATUS),
        ipc.invoke(IPC_CHANNELS.GET_AI_PROXY_INFO),
        ipc.invoke(IPC_CHANNELS.GET_SETTINGS),
      ]);
      if (!this.mounted) return;
      this.setState({
        stats,
        mcpInfo: mcpInfo ?? null,
        sites: sites ?? [],
        indexEntries: indexEntries ?? [],
        aiProxy: proxyResult?.proxy ?? null,
        settings: settings ?? null,
        loading: false,
        error: stats ? null : 'Failed to load stats',
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

  renderMcpPanel(): React.ReactNode {
    const { mcpInfo, copiedField } = this.state;
    if (!mcpInfo) {
      return React.createElement('div', {
        style: { ...cardStyle, marginBottom: '24px', textAlign: 'center' as const, padding: '24px', color: 'var(--nxai-card-sub)' },
      }, 'MCP server not yet running. Waiting for initialization...');
    }

    const claudeCodeCmd = `claude mcp add nexus-ai -- curl ${mcpInfo.url}`;
    const claudeDesktopConfig = JSON.stringify({
      mcpServers: {
        'nexus-ai': {
          url: mcpInfo.url,
          headers: { Authorization: `Bearer ${mcpInfo.authToken}` },
        },
      },
    }, null, 2);

    const copyBtn = (text: string, field: string) =>
      React.createElement('button', {
        style: { ...btnStyle, marginTop: '8px', fontSize: '11px' },
        onClick: () => this.copyToClipboard(text, field),
      }, copiedField === field ? 'Copied!' : 'Copy');

    const { settings } = this.state;
    const activeProvider = settings?.chatProvider
      ? settings.chatProvider.charAt(0).toUpperCase() + settings.chatProvider.slice(1)
      : 'Not configured';
    const activeModel = settings?.chatModel || 'default';

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
        settings?.chatModel
          ? React.createElement('span', { style: { fontSize: '12px', color: 'var(--nxai-card-text)' } },
              `(${activeModel})`,
            )
          : null,
      ),

      React.createElement('div', {
        style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' },
      },
        // Claude Code
        React.createElement('div', { style: cardStyle },
          React.createElement('div', { style: { fontSize: '13px', fontWeight: 600, marginBottom: '8px', color: 'var(--nxai-card-text)' } }, 'Claude Code'),
          React.createElement('div', { style: { fontSize: '11px', color: 'var(--nxai-card-sub)', marginBottom: '8px' } },
            'Run in your terminal:',
          ),
          React.createElement('div', { style: codeBlockStyle }, claudeCodeCmd),
          copyBtn(claudeCodeCmd, 'claude-code'),
        ),

        // Claude Desktop
        React.createElement('div', { style: cardStyle },
          React.createElement('div', { style: { fontSize: '13px', fontWeight: 600, marginBottom: '8px', color: 'var(--nxai-card-text)' } }, 'Claude Desktop'),
          React.createElement('div', { style: { fontSize: '11px', color: 'var(--nxai-card-sub)', marginBottom: '8px' } },
            'Add to claude_desktop_config.json:',
          ),
          React.createElement('div', { style: codeBlockStyle }, claudeDesktopConfig),
          copyBtn(claudeDesktopConfig, 'claude-desktop'),
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

  renderSiteTable(): React.ReactNode {
    const { sites, indexEntries, indexingId } = this.state;

    const indexMap = new Map<string, IndexEntry>();
    for (const entry of indexEntries) {
      indexMap.set(entry.siteId, entry);
    }

    // Sort: running first, then alphabetical
    const sorted = [...sites].sort((a, b) => {
      if (a.status === 'running' && b.status !== 'running') return -1;
      if (b.status === 'running' && a.status !== 'running') return 1;
      return a.name.localeCompare(b.name);
    });

    const thStyle: React.CSSProperties = {
      textAlign: 'left' as const,
      padding: '8px 12px',
      fontSize: '11px',
      fontWeight: 600,
      textTransform: 'uppercase',
      letterSpacing: '0.5px',
      color: 'var(--nxai-card-label)',
      borderBottom: '2px solid var(--nxai-card-border)',
    };

    const tdStyle: React.CSSProperties = {
      padding: '10px 12px',
      fontSize: '13px',
      color: 'var(--nxai-card-text)',
      borderBottom: '1px solid var(--nxai-card-border)',
    };

    return React.createElement('div', { style: { marginBottom: '24px' } },
      this.renderSectionLabel('Sites'),
      React.createElement('div', { style: { ...cardStyle, padding: 0, overflow: 'hidden' } },
        React.createElement('table', {
          style: { width: '100%', borderCollapse: 'collapse' as const },
        },
          React.createElement('thead', null,
            React.createElement('tr', null,
              React.createElement('th', { style: thStyle }, 'Site'),
              React.createElement('th', { style: thStyle }, 'Health'),
              React.createElement('th', { style: thStyle }, 'Status'),
              React.createElement('th', { style: thStyle }, 'Index'),
              React.createElement('th', { style: thStyle }, 'Documents'),
              React.createElement('th', { style: thStyle }, 'Chunks'),
              React.createElement('th', { style: thStyle }, 'Last Indexed'),
              React.createElement('th', { style: { ...thStyle, textAlign: 'right' as const } }, ''),
              React.createElement('th', { style: thStyle }, 'AI Setup'),
            ),
          ),
          React.createElement('tbody', null,
            sorted.length === 0
              ? React.createElement('tr', null,
                  React.createElement('td', {
                    colSpan: 9,
                    style: { ...tdStyle, textAlign: 'center' as const, color: 'var(--nxai-card-sub)', padding: '24px' },
                  }, 'No sites found'),
                )
              : sorted.map((site) => {
                  const idx = indexMap.get(site.id);
                  const isIndexing = indexingId === site.id;
                  const indexState = idx?.state ?? 'none';
                  const stateColor = indexState === 'indexed' ? UI_COLORS.STATUS_RUNNING
                    : indexState === 'stale' ? UI_COLORS.STATUS_WARNING
                    : indexState === 'indexing' ? UI_COLORS.WPE_BRAND
                    : indexState === 'error' ? UI_COLORS.STATUS_ERROR
                    : 'var(--nxai-card-sub)';

                  return React.createElement('tr', { key: site.id },
                    React.createElement('td', { style: tdStyle },
                      React.createElement('span', { style: { fontWeight: 500 } }, site.name),
                      site.isWpe ? React.createElement('span', {
                        style: tagStyle('rgba(14, 202, 212, 0.15)', UI_COLORS.WPE_BRAND),
                      }, 'WPE') : null,
                    ),
                    React.createElement('td', { style: { ...tdStyle, textAlign: 'center' as const } },
                      React.createElement(SiteHealthBadge, {
                        electron: this.props.electron,
                        siteId: site.id,
                        size: 'small',
                      }),
                    ),
                    React.createElement('td', { style: tdStyle },
                      React.createElement('span', { style: dotStyle(site.status === 'running' ? UI_COLORS.STATUS_RUNNING : UI_COLORS.STATUS_HALTED) }),
                      this.state.togglingId === site.id
                        ? React.createElement('button', {
                            style: { ...btnStyle, opacity: 0.6, cursor: 'not-allowed', fontSize: '11px', padding: '2px 8px' },
                            disabled: true,
                          }, site.status === 'running' ? 'Stopping...' : 'Starting...')
                        : React.createElement('button', {
                            style: { ...btnStyle, fontSize: '11px', padding: '2px 8px' },
                            onClick: () => this.handleToggleSite(site.id, site.status),
                          }, site.status === 'running' ? 'Stop' : 'Start'),
                    ),
                    React.createElement('td', { style: tdStyle },
                      React.createElement('span', { style: dotStyle(stateColor) }),
                      indexState === 'none' ? '\u2014' : indexState,
                    ),
                    React.createElement('td', { style: tdStyle }, idx?.documentCount?.toLocaleString() ?? '\u2014'),
                    React.createElement('td', { style: tdStyle }, idx?.chunkCount?.toLocaleString() ?? '\u2014'),
                    React.createElement('td', { style: tdStyle },
                      idx?.lastIndexed ? formatTimeAgo(idx.lastIndexed) : '\u2014',
                    ),
                    React.createElement('td', { style: { ...tdStyle, textAlign: 'right' as const } },
                      site.status === 'running'
                        ? React.createElement('button', {
                            style: isIndexing ? { ...btnStyle, opacity: 0.6, cursor: 'not-allowed' } : btnPrimaryStyle,
                            onClick: isIndexing ? undefined : () => this.handleIndex(site.id),
                            disabled: isIndexing,
                          }, isIndexing ? 'Indexing...' : (idx ? 'Re-index' : 'Index'))
                        : React.createElement('span', { style: { fontSize: '12px', color: 'var(--nxai-card-sub)' } }, 'Site stopped'),
                    ),
                    this.renderSetupAICell(site),
                  );
                }),
          ),
        ),
      ),
    );
  }

  renderOverviewTab(): React.ReactNode {
    const { stats } = this.state;
    if (!stats) return null;

    return React.createElement(React.Fragment, null,
      this.renderSetupBanner(stats),

      this.renderSectionLabel('Sites'),
      React.createElement('div', { style: cardContainerStyle },
        this.renderLocalSitesCard(stats),
        this.renderWpeConnectedCard(stats),
        this.renderRemoteSitesCard(stats),
      ),

      this.renderSectionLabel('Nexus AI'),
      React.createElement('div', { style: { ...cardContainerStyle, gridTemplateColumns: 'repeat(4, 1fr)' } },
        this.renderMcpCard(stats),
        this.renderEmbeddingCard(stats),
        this.renderIndexCard(stats),
        this.renderAiProxyCard(),
      ),

      this.renderMcpPanel(),

      
      // Visibility: Events and Timeline
      this.renderSectionLabel('Activity'),
      React.createElement(EventStatsCards, { electron: this.props.electron }),

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

renderSitesTab(): React.ReactNode {
    return React.createElement('div', null,
      // Site table at top
      this.renderSiteTable(),

      // Below: 2-column layout (groups left, search right)
      React.createElement('div', {
        style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginTop: '16px' },
      },
        // Left: Site Groups
        React.createElement(SiteGroupsPanel, {
          electron: this.props.electron,
          sites: this.state.sites.map(s => ({ id: s.id, name: s.name, domain: s.domain })),
        }),

        // Right: Search panels stacked
        React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: '16px' } },
          React.createElement(UnifiedSearchPanel, { electron: this.props.electron }),
          React.createElement(SmartFiltersPanel, { electron: this.props.electron }),
          React.createElement(SavedQueriesPanel, { electron: this.props.electron }),
        ),
      ),
    );
  }

  renderTabBar(): React.ReactNode {
    const { activeTab } = this.state;
    const tabs: { key: FleetOverviewState['activeTab']; label: string }[] = [
      { key: 'overview', label: 'Overview' },
      { key: 'sites', label: 'Sites' },
      { key: 'operations', label: 'Operations' },
      { key: 'chat', label: 'Chat' },
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
      ),

      // Bulk Operations Panel
      React.createElement(BulkOperationsPanel, { electron: this.props.electron }),
    );
  }

  renderChatTab(): React.ReactNode {
    return React.createElement(ChatTab, { electron: this.props.electron });
  }

  renderActiveTab(): React.ReactNode {
    switch (this.state.activeTab) {
      case 'overview': return this.renderOverviewTab();
      case 'sites': return this.renderSitesTab();
      case 'operations': return this.renderOperationsTab();
      case 'chat': return this.renderChatTab();
      default: return this.renderOverviewTab();
    }
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
