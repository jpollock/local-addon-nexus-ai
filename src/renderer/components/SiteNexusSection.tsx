/**
 * Per-Site Nexus AI Section
 *
 * Renders on the site overview page via `SiteInfoOverview_Addon_Section` filter.
 * Uses Local's global TableList/TableListRow CSS classes for native dark-theme styling.
 *
 * Class-based — Local uses older React, no hooks allowed.
 */
import * as React from 'react';
import { IPC_CHANNELS, UI_COLORS } from '../../common/constants';
import type { NexusSettings } from '../../common/types';

interface SiteNexusSectionProps {
  site: { id: string; name: string; path: string; status?: string };
  electron: any;
  TextButton?: any; // Optional: Local's TextButton component passed from renderer
}

interface IndexEntry {
  siteId: string;
  state: string;
  documentCount: number;
  chunkCount: number;
  lastIndexed: number;
}

interface SiteAiStatus {
  aiPlugin: 'active' | 'inactive' | 'not_installed';
  ollamaProvider: 'active' | 'inactive' | 'not_installed';
  credentialsSynced: boolean;
  providers: string[];
}

interface SiteNexusSectionState {
  indexEntry: IndexEntry | null;
  indexing: boolean;
  excluded: boolean;
  loading: boolean;
  aiStatus: SiteAiStatus | null;
  settingUpAI: boolean;
  setupResult: { success: boolean; message: string } | null;
  syncingCreds: boolean;
}

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

const dotStyle = (color: string): React.CSSProperties => ({
  display: 'inline-block',
  width: 8,
  height: 8,
  borderRadius: '50%',
  backgroundColor: color,
  marginRight: 8,
  verticalAlign: 'middle',
});

const pluginColor = (status: string) =>
  status === 'active' ? UI_COLORS.STATUS_RUNNING
  : status === 'inactive' ? UI_COLORS.STATUS_WARNING
  : '#888';

const pluginLabel = (status: string) =>
  status === 'active' ? 'Active'
  : status === 'inactive' ? 'Installed (inactive)'
  : 'Not installed';

/** Mimics Local's <TableListRow label="..."> — renders a <li class="TableListRow"> */
function row(label: string, ...children: React.ReactNode[]): React.ReactElement {
  return React.createElement('li', { className: 'TableListRow', key: label },
    React.createElement('strong', null, label),
    React.createElement('div', null, ...children),
  );
}

export class SiteNexusSection extends React.Component<SiteNexusSectionProps, SiteNexusSectionState> {
  private mounted = false;

  state: SiteNexusSectionState = {
    indexEntry: null,
    indexing: false,
    excluded: false,
    loading: true,
    aiStatus: null,
    settingUpAI: false,
    setupResult: null,
    syncingCreds: false,
  };

  componentDidMount(): void {
    this.mounted = true;
    this.fetchData();
  }

  componentWillUnmount(): void {
    this.mounted = false;
  }

  fetchData = async (): Promise<void> => {
    const ipc = this.props.electron.ipcRenderer;
    try {
      const [entries, settings] = await Promise.all([
        ipc.invoke(IPC_CHANNELS.GET_FLEET_STATUS),
        ipc.invoke(IPC_CHANNELS.GET_SETTINGS),
      ]);
      if (!this.mounted) return;
      const entry = (entries ?? []).find((e: IndexEntry) => e.siteId === this.props.site.id) ?? null;
      const nexusSettings = settings as NexusSettings | null;
      this.setState({
        indexEntry: entry,
        excluded: nexusSettings?.excludedSiteIds?.includes(this.props.site.id) ?? false,
        loading: false,
      });
    } catch {
      if (!this.mounted) return;
      this.setState({ loading: false });
    }

    // Fetch AI status separately so it can't break the core UI
    try {
      const aiResult = await ipc.invoke(IPC_CHANNELS.GET_AI_STATUS, this.props.site.id);
      if (!this.mounted) return;
      this.setState({ aiStatus: aiResult?.sites?.[this.props.site.id] ?? null });
    } catch {
      // AI status unavailable — non-fatal
    }
  };

  handleIndex = async (): Promise<void> => {
    this.setState({ indexing: true });
    try {
      await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.INDEX_SITE, this.props.site.id);
      if (!this.mounted) return;
      await this.fetchData();
    } catch {
      // Error handled by refresh
    }
    if (this.mounted) this.setState({ indexing: false });
  };

  handleSetupAI = async (): Promise<void> => {
    this.setState({ settingUpAI: true, setupResult: null });
    try {
      const result = await this.props.electron.ipcRenderer.invoke(
        IPC_CHANNELS.SETUP_AI, this.props.site.id,
      );
      if (!this.mounted) return;
      this.setState({
        settingUpAI: false,
        setupResult: { success: result.success, message: result.message },
      });
      this.fetchData();
    } catch {
      if (!this.mounted) return;
      this.setState({ settingUpAI: false, setupResult: { success: false, message: 'Setup failed' } });
    }
  };

  handleSyncCredentials = async (): Promise<void> => {
    this.setState({ syncingCreds: true });
    try {
      await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.SYNC_ALL_CREDENTIALS);
      if (!this.mounted) return;
      this.setState({ syncingCreds: false });
      this.fetchData();
    } catch {
      if (!this.mounted) return;
      this.setState({ syncingCreds: false });
    }
  };

  handleExclusionToggle = async (): Promise<void> => {
    const ipc = this.props.electron.ipcRenderer;
    try {
      const settings = (await ipc.invoke(IPC_CHANNELS.GET_SETTINGS)) as NexusSettings;
      const siteId = this.props.site.id;
      const isExcluded = settings.excludedSiteIds.includes(siteId);
      const newExcluded = isExcluded
        ? settings.excludedSiteIds.filter((id: string) => id !== siteId)
        : [...settings.excludedSiteIds, siteId];

      await ipc.invoke(IPC_CHANNELS.UPDATE_SETTINGS, { excludedSiteIds: newExcluded });
      if (this.mounted) this.setState({ excluded: !isExcluded });
    } catch {
      // Best-effort
    }
  };

  /** Helper to create action button using Local's TextButton if available */
  createActionButton(props: {
    onClick?: () => void;
    disabled?: boolean;
    children: string;
  }): React.ReactElement {
    const { TextButton } = this.props;

    // Debug: Log whether we have TextButton
    if (!this.state.loading && !TextButton && typeof console !== 'undefined') {
      console.warn('[Nexus AI] TextButton component not available, using fallback');
    }

    if (TextButton) {
      return React.createElement(TextButton, {
        onClick: props.onClick,
        disabled: props.disabled,
        inline: true,
        style: { paddingLeft: '10px' },
      }, props.children);
    }

    // Fallback: Use a styled anchor that looks like Local's TextButton
    return React.createElement('a', {
      onClick: props.disabled ? undefined : props.onClick,
      style: {
        paddingLeft: '10px',
        cursor: props.disabled ? 'default' : 'pointer',
        color: props.disabled ? '#888' : '#51c356',
        textDecoration: 'none',
        fontWeight: 400,
        fontSize: 'inherit',
        opacity: props.disabled ? 0.5 : 1,
      },
      onMouseEnter: (e: any) => {
        if (!props.disabled) {
          e.target.style.textDecoration = 'underline';
        }
      },
      onMouseLeave: (e: any) => {
        e.target.style.textDecoration = 'none';
      },
    }, props.children);
  }

  render(): React.ReactNode {
    const { indexEntry, indexing, excluded, loading, aiStatus, settingUpAI, setupResult, syncingCreds } = this.state;

    if (loading) {
      return React.createElement('ul', { className: 'TableList' },
        row('Status', 'Loading...'),
      );
    }

    const stateColor = !indexEntry ? '#888'
      : indexEntry.state === 'indexed' ? UI_COLORS.STATUS_RUNNING
      : indexEntry.state === 'stale' ? UI_COLORS.STATUS_WARNING
      : indexEntry.state === 'error' ? UI_COLORS.STATUS_ERROR
      : UI_COLORS.WPE_BRAND;

    const stateLabel = indexEntry
      ? indexEntry.state.charAt(0).toUpperCase() + indexEntry.state.slice(1)
      : 'Not indexed';

    const rows: React.ReactElement[] = [];

    // Index status + action
    rows.push(row('Index status',
      React.createElement('span', { style: dotStyle(stateColor) }),
      stateLabel,
      this.createActionButton({
        onClick: indexing ? undefined : this.handleIndex,
        disabled: indexing,
        children: indexing ? 'Indexing...' : (indexEntry ? 'Re-index' : 'Index Now'),
      }),
    ));

    // Documents + chunks
    rows.push(row('Documents',
      indexEntry
        ? `${indexEntry.documentCount.toLocaleString()} documents \u2022 ${indexEntry.chunkCount.toLocaleString()} chunks`
        : '\u2014',
    ));

    // Last indexed
    rows.push(row('Last indexed',
      indexEntry ? formatTimeAgo(indexEntry.lastIndexed) : 'Never',
    ));

    // Auto-index toggle
    rows.push(row('Auto-index',
      React.createElement('input', {
        type: 'checkbox',
        checked: !excluded,
        onChange: this.handleExclusionToggle,
        style: { cursor: 'pointer', verticalAlign: 'middle', marginRight: 8 },
      }),
      !excluded ? 'On' : 'Off',
    ));

    // AI rows (only render if AI status is loaded)
    if (aiStatus) {
      // AI Plugin
      rows.push(row('AI plugin',
        React.createElement('span', { style: dotStyle(pluginColor(aiStatus.aiPlugin)) }),
        pluginLabel(aiStatus.aiPlugin),
        aiStatus.aiPlugin !== 'active'
          ? this.createActionButton({
              onClick: settingUpAI ? undefined : this.handleSetupAI,
              disabled: settingUpAI,
              children: settingUpAI ? 'Setting up...' : 'Setup AI',
            })
          : null,
      ));

      // Ollama Provider
      rows.push(row('Ollama provider',
        React.createElement('span', { style: dotStyle(pluginColor(aiStatus.ollamaProvider)) }),
        pluginLabel(aiStatus.ollamaProvider),
      ));

      // Credentials
      const credsSynced = aiStatus.credentialsSynced ?? false;
      rows.push(row('Credentials',
        React.createElement('span', { style: dotStyle(credsSynced ? UI_COLORS.STATUS_RUNNING : '#888') }),
        credsSynced ? `Synced (${aiStatus.providers.join(', ')})` : 'Not synced',
        this.createActionButton({
          onClick: syncingCreds ? undefined : this.handleSyncCredentials,
          disabled: syncingCreds,
          children: syncingCreds ? 'Syncing...' : 'Sync Keys',
        }),
      ));
    }

    return React.createElement('div', null,
      React.createElement('ul', { className: 'TableList' }, ...rows),

      // Setup result banner
      setupResult
        ? React.createElement('div', {
            style: {
              margin: '8px 30px',
              padding: '6px 12px',
              borderRadius: 4,
              fontSize: 13,
              backgroundColor: setupResult.success ? 'rgba(81, 195, 86, 0.15)' : 'rgba(239, 68, 68, 0.15)',
              color: setupResult.success ? UI_COLORS.STATUS_RUNNING : UI_COLORS.STATUS_ERROR,
            },
          }, setupResult.message)
        : null,
    );
  }
}
