/**
 * Overview tab — extracted from NexusOverview.
 *
 * Shows dashboard stats, MCP connection, Fleet Intelligence, and AI integration.
 * State limited to dismissals and ephemeral clipboard feedback.
 */
import * as React from 'react';
import { IPC_CHANNELS, UI_COLORS } from '../../../common/constants';
import type { NexusSettings } from '../../../common/types';
import { FleetCompletenessWidget } from '../FleetCompletenessWidget';
import { AIGatewayPanel } from '../AIGatewayPanel';
import { cardContainerStyle, cardStyle, cardTitleStyle, renderSectionLabel } from './shared/cards';

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

interface OverviewTabProps {
  electron: any;
  stats: DashboardStats | null;
  fleetSummary: FleetSummaryData | null;
  settings: NexusSettings | null;
  wpeAuthError: boolean;
  aiProxy: AiProxyInfo | null;
  mcpInfo: McpInfo | null;
  startupStatus: StartupStatus | null;
  onNavigate: (tab: 'overview' | 'activity' | 'operations' | 'settings' | 'agents') => void;
  onRefresh: () => void;
}

interface OverviewTabState {
  wpeBannerDismissed: boolean;
  wpeNotConnectedDismissed: boolean;
  copiedField: string | null;
}

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

export class OverviewTab extends React.Component<OverviewTabProps, OverviewTabState> {
  private mounted = false;

  state: OverviewTabState = {
    wpeBannerDismissed: false,
    wpeNotConnectedDismissed: false,
    copiedField: null,
  };

  componentDidMount(): void {
    this.mounted = true;
    // Initialize dismiss state from settings
    const { settings } = this.props;
    if (settings) {
      this.setState({
        wpeBannerDismissed: settings.wpeBannerDismissed ?? false,
        wpeNotConnectedDismissed: settings.wpeNotConnectedBannerDismissed ?? false,
      });
    }
  }

  componentWillUnmount(): void {
    this.mounted = false;
  }

  componentDidUpdate(prevProps: OverviewTabProps): void {
    // Sync dismiss state when settings change (e.g., from another tab or IPC update)
    if (this.props.settings !== prevProps.settings && this.props.settings) {
      this.setState({
        wpeBannerDismissed: this.props.settings.wpeBannerDismissed ?? false,
        wpeNotConnectedDismissed: this.props.settings.wpeNotConnectedBannerDismissed ?? false,
      });
    }
  }

  copyToClipboard = (text: string, field: string): void => {
    navigator.clipboard.writeText(text).then(() => {
      this.setState({ copiedField: field });
      setTimeout(() => {
        if (this.mounted) this.setState({ copiedField: null });
      }, 2000);
    });
  };

  handleWpeConnect = (): void => {
    this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.WPE_LOGIN_START).catch(() => {});
  };

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

  renderAiProxyCard(): React.ReactNode {
    const { aiProxy } = this.props;
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
        'Setting up Nexus AI… Embedding model loading.',
      ),
    );
  }

  renderWpeAuthBanner(): React.ReactNode {
    const { wpeAuthError } = this.props;
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
    const { mcpInfo, startupStatus } = this.props;
    const { copiedField } = this.state;
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

    const { settings } = this.props;
    const activeProvider = settings?.aiProvider
      ? settings.aiProvider.charAt(0).toUpperCase() + settings.aiProvider.slice(1)
      : 'Not configured';
    const activeModel = settings?.aiModel || 'default';

    const codeStyle = { fontFamily: 'monospace', backgroundColor: 'var(--nxai-code-bg, rgba(0,0,0,0.08))', padding: '1px 5px', borderRadius: '3px', fontSize: '11px' };

    return React.createElement('div', { style: { marginBottom: '24px' } },
      renderSectionLabel('Connect to AI Tools'),
      React.createElement('div', {
        style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' },
      },
        React.createElement('span', { style: dotStyle(UI_COLORS.STATUS_RUNNING) }),
        React.createElement('span', { style: { fontSize: '13px', color: 'var(--nxai-card-text)' } },
          `Server running on port ${mcpInfo.port}`,
        ),
        React.createElement('span', { style: { fontSize: '12px', color: 'var(--nxai-card-sub)' } },
          `• ${mcpInfo.tools.length} tools • v${mcpInfo.version}`,
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

  renderFleetSummaryCard(): React.ReactNode {
    const { fleetSummary } = this.props;
    if (!fleetSummary) {
      return React.createElement('div', { style: { ...cardStyle, gridColumn: '1 / 3' } },
        React.createElement('div', { style: cardTitleStyle }, 'Fleet Summary'),
        React.createElement('div', { style: { color: 'var(--nxai-card-sub)', fontSize: '13px' } }, 'Loading fleet data…'),
      );
    }

    const { total, totalLocal, totalWpe, wpVersions, phpVersions, completeness, wpeSync, staleCount, neverScannedCount } = fleetSummary;

    // Show top 3 WP versions
    const topWp = wpVersions.slice(0, 3);
    const otherWpCount = wpVersions.slice(3).reduce((s, e) => s + (e.version !== 'unknown' ? e.count : 0), 0);

    // Show top 3 PHP versions; track unknown separately so it's always surfaced
    const knownPhp = phpVersions.filter(e => e.version !== 'unknown');
    const unknownPhpEntry = phpVersions.find(e => e.version === 'unknown');
    const topPhp = knownPhp.slice(0, 3);
    const otherPhpCount = knownPhp.slice(3).reduce((s, e) => s + e.count, 0);

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
            `${totalLocal} local · ${totalWpe} WPE`,
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
            unknownPhpEntry
              ? React.createElement('div', { style: { color: 'var(--nxai-card-sub)', fontStyle: 'italic' } },
                  `${unknownPhpEntry.count} unknown (need SSH sync)`,
                )
              : null,
          ),
        ),

        // Local Twins + WPE Sync column
        React.createElement('div', { style: colStyle },
          React.createElement('div', { style: labelStyle }, 'Local Twins'),
          React.createElement('div', { style: versionListStyle },
            completeness.indexed > 0
              ? React.createElement('div', null, `✅ indexed: ${completeness.indexed}`)
              : null,
            completeness.metadata > 0
              ? React.createElement('div', null, `✅ metadata: ${completeness.metadata}`)
              : null,
            completeness.filesystem > 0
              ? React.createElement('div', null, `🔶 filesystem: ${completeness.filesystem}`)
              : null,
            completeness.none > 0
              ? React.createElement('div', null, `❌ none: ${completeness.none}`)
              : null,
          ),
          wpeSync && totalWpe > 0
            ? React.createElement('div', { style: { marginTop: 10 } },
                React.createElement('div', { style: { ...labelStyle, marginBottom: 4 } }, 'WPE Sync'),
                React.createElement('div', { style: versionListStyle },
                  React.createElement('div', null,
                    React.createElement('span', { style: { fontWeight: 500 } }, `${wpeSync.synced}/${totalWpe}`),
                    React.createElement('span', { style: { color: 'var(--nxai-card-sub)', marginLeft: '6px' } }, 'synced'),
                  ),
                  wpeSync.neverSynced > 0
                    ? React.createElement('div', { style: { color: 'var(--nxai-card-sub)', fontStyle: 'italic' } },
                        `${wpeSync.neverSynced} need SSH sync`,
                      )
                    : null,
                ),
              )
            : null,
        ),

        // Freshness column
        React.createElement('div', { style: colStyle },
          React.createElement('div', { style: labelStyle }, 'Freshness'),
          React.createElement('div', { style: versionListStyle },
            staleCount > 0
              ? React.createElement('div', { style: { color: UI_COLORS.STATUS_WARNING } },
                  `⚠️ ${staleCount} need${staleCount !== 1 ? '' : 's'} refresh`,
                )
              : React.createElement('div', { style: { color: UI_COLORS.STATUS_RUNNING } }, '✓ All current'),
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

  renderWpeBanner(): React.ReactNode {
    const { stats } = this.props;
    const { wpeBannerDismissed } = this.state;
    if (!stats) return null;
    const wpeTotal = stats.remoteSites?.total ?? 0;
    if (wpeTotal === 0 || wpeBannerDismissed) return null;

    const dismissBanner = (): void => {
      this.setState({ wpeBannerDismissed: true });
      this.props.electron.ipcRenderer.invoke(
        IPC_CHANNELS.UPDATE_SETTINGS,
        { wpeBannerDismissed: true },
      ).catch(() => {});
    };

    return React.createElement('div', {
      'data-testid': 'wpe-onboarding-banner',
      style: {
        ...cardStyle,
        marginBottom: 16,
        borderColor: '#0ECAD4',
        borderLeftWidth: 4,
        position: 'relative' as const,
      },
    },
      React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' } },
        React.createElement('div', { style: { fontWeight: 700, fontSize: 13, marginBottom: 8, color: '#0ECAD4' } },
          `WP Engine connected — ${wpeTotal} install${wpeTotal !== 1 ? 's' : ''}`,
        ),
        React.createElement('button', {
          'data-testid': 'wpe-banner-dismiss',
          onClick: dismissBanner,
          style: {
            background: 'transparent', border: 'none', cursor: 'pointer',
            fontSize: 16, color: 'var(--nxai-card-sub, #6b7280)', padding: '0 4px',
            fontFamily: 'inherit',
          },
        }, '×'),
      ),
      React.createElement('div', { style: { fontSize: 12, color: 'var(--nxai-card-sub, #6b7280)', lineHeight: 1.6 } },
        React.createElement('div', { style: { marginBottom: 4 } },
          '● CAPI data (domain, PHP version, environment) syncs automatically — no SSH required.',
        ),
        React.createElement('div', null,
          '● WP version, plugins, and users require SSH sync — opt in via Settings → WP Engine Installs.',
        ),
      ),
      React.createElement('div', { style: { marginTop: 10 } },
        React.createElement('button', {
          onClick: () => this.props.onNavigate('settings'),
          style: {
            padding: '4px 12px', borderRadius: 5, fontSize: 11, fontWeight: 600,
            background: 'rgba(14,202,212,.12)', color: '#0ECAD4',
            border: '1px solid rgba(14,202,212,.3)', cursor: 'pointer', fontFamily: 'inherit',
          },
        }, 'Open Settings'),
      ),
    );
  }

  renderWpeNotConnectedBanner(): React.ReactNode {
    const { stats } = this.props;
    const { wpeNotConnectedDismissed } = this.state;
    if (!stats || wpeNotConnectedDismissed) return null;
    // Only show when WPE is genuinely not connected (no remote sites)
    if ((stats.remoteSites?.total ?? 0) > 0) return null;

    const dismiss = (): void => {
      this.setState({ wpeNotConnectedDismissed: true });
      this.props.electron.ipcRenderer.invoke(
        IPC_CHANNELS.UPDATE_SETTINGS,
        { wpeNotConnectedBannerDismissed: true },
      ).catch(() => {});
    };

    return React.createElement('div', {
      'data-testid': 'wpe-not-connected-banner',
      style: {
        ...cardStyle,
        marginBottom: 16,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 16px',
        fontSize: 12,
        color: 'var(--nxai-card-sub, #6b7280)',
      },
    },
      React.createElement('span', null,
        '☁ Have WP Engine sites? ',
        React.createElement('span', {
          style: { color: '#0ECAD4', cursor: 'pointer', textDecoration: 'underline' },
          onClick: () => {
            // Open Local's Connect panel — use the WPE auth banner hint
            this.props.onNavigate('settings');
          },
        }, 'Connect via Local → Connect'),
        ' to manage your full fleet.',
      ),
      React.createElement('button', {
        'data-testid': 'wpe-not-connected-dismiss',
        onClick: dismiss,
        style: {
          background: 'transparent', border: 'none', cursor: 'pointer',
          fontSize: 14, color: 'var(--nxai-card-sub, #6b7280)', padding: '0 4px',
          fontFamily: 'inherit',
        },
      }, '×'),
    );
  }

  render(): React.ReactNode {
    const { stats } = this.props;
    if (!stats) return null;

    return React.createElement('div', null,
      // Banners
      this.renderSetupBanner(stats),
      this.renderWpeAuthBanner(),
      this.renderWpeNotConnectedBanner(),
      this.renderWpeBanner(),

      // Connect AI Tools — MCP connection panel
      this.renderMcpPanel(),

      // Fleet Intelligence — site counts + completeness + summary
      renderSectionLabel('Fleet Intelligence'),
      React.createElement('div', { style: cardContainerStyle },
        this.renderLocalSitesCard(stats),
        this.renderWpeConnectedCard(stats),
        this.renderRemoteSitesCard(stats),
      ),
      React.createElement('div', { style: { marginTop: 16 } },
        React.createElement(FleetCompletenessWidget, {
          electron: this.props.electron,
          onSchedule: () => this.props.onNavigate('settings'),
          onIndexSites: () => this.props.onNavigate('operations'),
        }),
      ),
      React.createElement('div', { style: { marginTop: 16 } }, this.renderFleetSummaryCard()),

      // AI Integration — MCP status + proxy + gateway usage
      renderSectionLabel('AI Integration'),
      React.createElement('div', { style: { ...cardContainerStyle, gridTemplateColumns: 'repeat(2, 1fr)' } },
        this.renderMcpCard(stats),
        this.renderAiProxyCard(),
      ),
      React.createElement(AIGatewayPanel, { electron: this.props.electron }),
    );
  }
}
