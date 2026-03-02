/**
 * Fleet Overview Dashboard
 *
 * Stats dashboard showing what Nexus AI knows about the fleet.
 * No site list — just summary cards with key metrics.
 *
 * Class-based — Local uses older React, no hooks allowed.
 */
import * as React from 'react';
import { IPC_CHANNELS, UI_COLORS, POLL_INTERVALS } from '../../common/constants';

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

interface FleetOverviewState {
  stats: DashboardStats | null;
  loading: boolean;
  error: string | null;
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

export class FleetOverview extends React.Component<FleetOverviewProps, FleetOverviewState> {
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private mounted = false;

  state: FleetOverviewState = {
    stats: null,
    loading: true,
    error: null,
  };

  componentDidMount(): void {
    this.mounted = true;
    this.injectCssVars();
    this.fetchStats();
    this.pollTimer = setInterval(() => this.fetchStats(), POLL_INTERVALS.DASHBOARD_STATS_MS);
  }

  componentWillUnmount(): void {
    this.mounted = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /**
   * Inject CSS custom properties that adapt to Local's theme.
   * Local uses .Theme__Dark on a parent element for dark mode.
   */
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
      }
      .Theme__Dark {
        --nxai-card-bg: #2a2a2a;
        --nxai-card-border: #404040;
        --nxai-card-label: #9ca3af;
        --nxai-card-sub: #9ca3af;
        --nxai-card-text: #f3f4f6;
        --nxai-section-label: #d1d5db;
      }
    `;
    document.head.appendChild(style);
  }

  fetchStats = async (): Promise<void> => {
    try {
      const stats = await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.GET_DASHBOARD_STATS);
      if (!this.mounted) return;
      if (stats) {
        this.setState({ stats, loading: false, error: null });
      } else {
        this.setState({ error: 'Failed to load stats', loading: false });
      }
    } catch (err: any) {
      if (!this.mounted) return;
      this.setState({ error: err.message || 'Failed to load stats', loading: false });
    }
  };

  renderSectionLabel(text: string): React.ReactNode {
    return React.createElement('div', {
      style: {
        fontSize: '13px',
        fontWeight: 600,
        color: 'var(--nxai-section-label, #374151)',
        marginBottom: '12px',
        marginTop: '8px',
      },
    }, text);
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
        React.createElement('div', { style: { ...bigNumberStyle, color: 'var(--nxai-card-sub)' } }, '—'),
        React.createElement('div', { style: subStatStyle }, 'WPE not authenticated'),
      );
    }
    return React.createElement('div', { style: cardStyle },
      React.createElement('div', { style: cardTitleStyle }, 'Remote Sites'),
      React.createElement('div', { style: { ...bigNumberStyle, color: 'var(--nxai-card-text)' } }, remoteSites.total),
      React.createElement('div', { style: subStatStyle },
        `${remoteSites.unlinked} not linked to Local`,
      ),
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
        React.createElement('span', { style: { fontSize: '14px', fontWeight: 600, color: 'var(--nxai-card-text)' } },
          embedding.model,
        ),
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

  render(): React.ReactNode {
    const { stats, loading, error } = this.state;

    return React.createElement('div', {
      style: {
        padding: '24px 32px',
        color: 'var(--nxai-card-text)',
      },
    },
      // Title
      React.createElement('h1', {
        style: { fontSize: '22px', fontWeight: 600, marginBottom: '24px', color: 'var(--nxai-card-text)' },
      }, 'Fleet Overview'),

      loading
        ? React.createElement('div', { style: { color: 'var(--nxai-card-sub)', padding: '40px 0', textAlign: 'center' as const } }, 'Loading dashboard...')
        : error
          ? React.createElement('div', { style: { color: UI_COLORS.STATUS_ERROR, padding: '40px 0', textAlign: 'center' as const } }, `Error: ${error}`)
          : stats
            ? React.createElement(React.Fragment, null,
                // Sites section
                this.renderSectionLabel('Sites'),
                React.createElement('div', { style: cardContainerStyle },
                  this.renderLocalSitesCard(stats),
                  this.renderWpeConnectedCard(stats),
                  this.renderRemoteSitesCard(stats),
                ),

                // Nexus AI section
                this.renderSectionLabel('Nexus AI'),
                React.createElement('div', { style: cardContainerStyle },
                  this.renderMcpCard(stats),
                  this.renderEmbeddingCard(stats),
                  this.renderIndexCard(stats),
                ),
              )
            : null,
    );
  }
}
