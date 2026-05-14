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
import { injectThemeVars } from '../utils/theme';
import type { NexusSettings, AIProvider, SiteAIConfig, DbScanResult } from '../../common/types';

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
  gatewayProvider?: 'active' | 'inactive' | 'not_installed'; // NEW: Local Gateway provider
  credentialsSynced: boolean;
  providers: string[];
  metadataAge?: string | null; // NEW: "Just now", "5m ago", etc.
  metadataIsStale?: boolean; // NEW: true if > 24 hours old
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
  wpVersion: string | null;
  wpVersionAge: string | null; // NEW: Age of WP version cache
  upgradingWp: boolean;
  refreshingMetadata: boolean; // NEW: True while refreshing cache
  aiContextStatus: { exists: boolean; ageString?: string; filePath?: string } | null;
  generatingContext: boolean;
  siteAIConfig: SiteAIConfig | null;
  showProviderPicker: boolean;
  pickerProvider: AIProvider | '';
  switchingProvider: boolean;
  useLocalGateway: boolean;
  globalAIProvider: string | null;
  dbScan: DbScanResult | null;
  dbScanning: boolean;
  detailsExpanded: boolean;
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

function isWp7OrLater(version: string | null): boolean {
  if (!version) return false;
  const match = version.match(/^(\d+)\.(\d+)/);
  if (!match) return false;
  const major = parseInt(match[1], 10);
  return major >= 7;
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

const PROVIDER_LABELS: Record<string, string> = {
  anthropic:      'Anthropic (Claude)',
  openai:         'OpenAI (GPT)',
  google:         'Google (Gemini)',
  ollama:         'Ollama (local)',
  'local-gateway': 'Local AI Gateway',
};

const ALL_PROVIDERS: Array<{ id: string; label: string }> = [
  { id: 'anthropic', label: 'Anthropic (Claude)' },
  { id: 'openai',    label: 'OpenAI (GPT)' },
  { id: 'google',    label: 'Google (Gemini)' },
  { id: 'ollama',    label: 'Ollama (local)' },
];

/** Mimics Local's <TableListRow label="..."> — renders a <li class="TableListRow"> */
function row(label: string, ...children: React.ReactNode[]): React.ReactElement {
  return React.createElement('li', { className: 'TableListRow', key: label },
    React.createElement('strong', null, label),
    React.createElement('div', null, ...children),
  );
}

export class SiteNexusSection extends React.Component<SiteNexusSectionProps, SiteNexusSectionState> {
  private mounted = false;
  private _onSettingsApplied: (() => void) | null = null;

  state: SiteNexusSectionState = {
    indexEntry: null,
    indexing: false,
    excluded: false,
    loading: true,
    aiStatus: null,
    settingUpAI: false,
    setupResult: null,
    syncingCreds: false,
    wpVersion: null,
    wpVersionAge: null,
    upgradingWp: false,
    refreshingMetadata: false,
    aiContextStatus: null,
    generatingContext: false,
    siteAIConfig: null,
    showProviderPicker: false,
    pickerProvider: '',
    switchingProvider: false,
    useLocalGateway: false,
    globalAIProvider: null,
    dbScan: null,
    dbScanning: false,
    detailsExpanded: false,
  };

  componentDidMount(): void {
    injectThemeVars();
    this.mounted = true;
    this.fetchData();
    this._onSettingsApplied = () => { if (this.mounted) this.fetchData(); };
    window.addEventListener('nexus-ai:settings-applied', this._onSettingsApplied);
  }

  componentDidUpdate(prevProps: SiteNexusSectionProps): void {
    // Re-fetch when switching to a different site
    if (prevProps.site.id !== this.props.site.id) {
      this.setState({ setupResult: null, showProviderPicker: false });
      this.fetchData();
      return;
    }

    // Re-fetch AI status when site transitions to running
    // This ensures we show correct status after Local restarts
    if (prevProps.site.status !== 'running' && this.props.site.status === 'running') {
      this.fetchData();
    }
  }

  componentWillUnmount(): void {
    this.mounted = false;
    if (this._onSettingsApplied) {
      window.removeEventListener('nexus-ai:settings-applied', this._onSettingsApplied);
    }
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
        useLocalGateway: !!((nexusSettings as any)?.useLocalGateway),
        globalAIProvider: (nexusSettings as any)?.aiProvider ?? null,
      });
    } catch {
      if (!this.mounted) return;
      this.setState({ loading: false });
    }

    // Fetch AI status separately so it can't break the core UI
    try {
      const aiResult = await ipc.invoke(IPC_CHANNELS.GET_AI_STATUS, this.props.site.id);
      if (!this.mounted) return;

      if (aiResult?.success) {
        this.setState({ aiStatus: aiResult.sites?.[this.props.site.id] ?? null });
      } else {
        console.warn('[NexusAI] get-ai-status returned error:', aiResult?.error || 'Unknown error');
      }
    } catch (err: any) {
      console.error('[NexusAI] get-ai-status failed:', err?.message || err?.toString() || 'Unknown error', err);
      // AI status unavailable — non-fatal
    }

    // Fetch WordPress version separately
    try {
      const versionResult = await ipc.invoke(IPC_CHANNELS.GET_WP_VERSION, this.props.site.id);
      if (!this.mounted) return;
      if (versionResult?.success) {
        this.setState({
          wpVersion: versionResult.version,
          wpVersionAge: versionResult.metadataAge ?? null,
        });
      }
    } catch (err: any) {
      console.error('[NexusAI] get-wp-version failed:', err?.message || err?.toString() || 'Unknown error', err);
      // WP version unavailable — non-fatal
    }

    // Fetch AI context file status separately
    try {
      const contextResult = await ipc.invoke(IPC_CHANNELS.AI_CONTEXT_GET_STATUS, this.props.site.id);
      if (!this.mounted) return;
      if (contextResult?.success) {
        this.setState({
          aiContextStatus: {
            exists: contextResult.exists,
            ageString: contextResult.ageString,
            filePath: contextResult.filePath,
          },
        });
      }
    } catch (err: any) {
      console.error('[NexusAI] ai-context-get-status failed:', err?.message || err?.toString() || 'Unknown error', err);
      // AI context status unavailable — non-fatal
    }

    // Fetch per-site AI config
    try {
      const configResult = await ipc.invoke(IPC_CHANNELS.GET_SITE_AI_CONFIG, this.props.site.id);
      if (!this.mounted) return;
      if (configResult?.success) {
        this.setState({ siteAIConfig: configResult.config ?? null });
      }
    } catch {
      // Non-fatal
    }

    // Fetch last DB scan result (non-fatal)
    try {
      const lastScanResult = await ipc.invoke(IPC_CHANNELS.DB_GET_LAST_SCAN, this.props.site.id);
      if (!this.mounted) return;
      if (lastScanResult?.success) this.setState({ dbScan: lastScanResult.scan ?? null });
    } catch {
      // Non-fatal
    }
  };

  handleIndex = async (): Promise<void> => {
    this.setState({ indexing: true });
    const startTime = Date.now();
    try {
      await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.INDEX_SITE, this.props.site.id);
      if (!this.mounted) return;
      await this.fetchData();
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      const { indexEntry } = this.state;
      const docCount = indexEntry?.documentCount ?? 0;
      const msg = `Indexed ${docCount.toLocaleString()} documents in ${elapsed}s`;
      (window as any).showToast?.(msg, 'success');
    } catch (err: any) {
      if (!this.mounted) return;
      const hint = 'Try indexing fewer sites at once.';
      (window as any).showToast?.(`Indexing failed. ${hint}`, 'error');
    }
    if (this.mounted) this.setState({ indexing: false });
  };

  handleSetupAI = async (provider?: AIProvider): Promise<void> => {
    this.setState({ settingUpAI: true, setupResult: null, showProviderPicker: false });
    try {
      const result = await this.props.electron.ipcRenderer.invoke(
        IPC_CHANNELS.SETUP_AI, this.props.site.id, provider,
      );
      if (!this.mounted) return;
      const msg = result.success
        ? 'AI tools installed and ready.'
        : `${result.message || 'Setup failed'}. Check that the site is running. Start it from Local, then try again.`;
      (window as any).showToast?.(msg, result.success ? 'success' : 'error');
      this.setState({
        settingUpAI: false,
        setupResult: { success: result.success, message: result.message },
      });
      this.fetchData();
    } catch {
      if (!this.mounted) return;
      const msg = 'Setup failed. Check that the site is running. Start it from Local, then try again.';
      (window as any).showToast?.(msg, 'error');
      this.setState({ settingUpAI: false, setupResult: { success: false, message: 'Setup failed' } });
    }
  };

  handleSwitchProvider = async (): Promise<void> => {
    const { pickerProvider } = this.state;
    if (!pickerProvider) return;
    this.setState({ switchingProvider: true, setupResult: null, showProviderPicker: false });
    try {
      const result = await this.props.electron.ipcRenderer.invoke(
        IPC_CHANNELS.SWITCH_AI_PROVIDER, this.props.site.id, pickerProvider,
      );
      if (!this.mounted) return;
      this.setState({
        switchingProvider: false,
        setupResult: {
          success: result.success,
          message: result.success
            ? `Switched to ${pickerProvider}`
            : (result.error ?? 'Switch failed'),
        },
      });
      if (result.success) this.fetchData();
    } catch {
      if (!this.mounted) return;
      this.setState({ switchingProvider: false, setupResult: { success: false, message: 'Switch failed' } });
    }
  };

  handleSyncCredentials = async (): Promise<void> => {
    this.setState({ syncingCreds: true });
    try {
      const result = await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.SYNC_ALL_CREDENTIALS);
      if (!this.mounted) return;
      if (result && result.success === false) {
        const msg = 'Credentials sync failed. Your API key may be invalid. Re-enter it in Preferences.';
        (window as any).showToast?.(msg, 'error');
      } else {
        (window as any).showToast?.('Credentials synced successfully.', 'success');
      }
      this.setState({ syncingCreds: false });
      this.fetchData();
    } catch {
      if (!this.mounted) return;
      const msg = 'Credentials sync failed. Your API key may be invalid. Re-enter it in Preferences.';
      (window as any).showToast?.(msg, 'error');
      this.setState({ syncingCreds: false });
    }
  };

  handleUpgradeWordPress = async (): Promise<void> => {
    this.setState({ upgradingWp: true, setupResult: null });
    try {
      const result = await this.props.electron.ipcRenderer.invoke(
        IPC_CHANNELS.UPGRADE_WP, this.props.site.id,
      );
      if (!this.mounted) return;
      if (result.success) {
        this.setState({
          upgradingWp: false,
          wpVersion: result.version,
          setupResult: { success: true, message: `WordPress upgraded to ${result.version}` },
        });
      } else {
        this.setState({
          upgradingWp: false,
          setupResult: { success: false, message: `Upgrade failed: ${result.error}` },
        });
      }
      this.fetchData();
    } catch {
      if (!this.mounted) return;
      this.setState({ upgradingWp: false, setupResult: { success: false, message: 'Upgrade failed' } });
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

  handleRefreshMetadata = async (): Promise<void> => {
    this.setState({ refreshingMetadata: true, setupResult: null });
    try {
      const result = await this.props.electron.ipcRenderer.invoke(
        IPC_CHANNELS.REFRESH_SITE_METADATA,
        this.props.site.id,
      );
      if (!this.mounted) return;

      if (result.success) {
        // Update state with fresh data
        this.setState({
          refreshingMetadata: false,
          wpVersionAge: result.metadataAge,
          setupResult: { success: true, message: 'Metadata refreshed successfully' },
        });
        // Re-fetch AI status to update plugin states
        await this.fetchData();
        if (!this.mounted) return;
        const wpVer = this.state.wpVersion;
        const pluginCount = this.state.aiStatus?.providers?.length;
        const detail = wpVer ? `WordPress ${wpVer}` : '';
        (window as any).showToast?.(`Metadata updated${detail ? ` — ${detail}` : ''}.`, 'success');
      } else {
        this.setState({
          refreshingMetadata: false,
          setupResult: { success: false, message: result.error || 'Refresh failed' },
        });
        (window as any).showToast?.(`Metadata refresh failed: ${result.error || 'Unknown error'}`, 'error');
      }
    } catch {
      if (!this.mounted) return;
      this.setState({
        refreshingMetadata: false,
        setupResult: { success: false, message: 'Refresh failed' },
      });
      (window as any).showToast?.('Metadata refresh failed.', 'error');
    }
  };

  handleGenerateContext = async (): Promise<void> => {
    this.setState({ generatingContext: true, setupResult: null });
    try {
      const result = await this.props.electron.ipcRenderer.invoke(
        IPC_CHANNELS.AI_CONTEXT_GENERATE,
        this.props.site.id,
      );
      if (!this.mounted) return;

      if (result.success) {
        this.setState({
          generatingContext: false,
          setupResult: { success: true, message: `AI context generated: ${result.filePath}` },
        });
        // Refresh to show new file status
        this.fetchData();
      } else {
        this.setState({
          generatingContext: false,
          setupResult: { success: false, message: result.error || 'Generation failed' },
        });
      }
    } catch {
      if (!this.mounted) return;
      this.setState({
        generatingContext: false,
        setupResult: { success: false, message: 'Generation failed' },
      });
    }
  };

  handleShowInFinder = (): void => {
    const { aiContextStatus } = this.state;
    if (!aiContextStatus?.filePath) return;

    // Use Electron's shell API to show file in Finder/Explorer
    const { shell } = this.props.electron;
    if (shell && shell.showItemInFolder) {
      shell.showItemInFolder(aiContextStatus.filePath);
    }
  };

  handleDbScan = async (): Promise<void> => {
    this.setState({ dbScanning: true, setupResult: null });
    try {
      const result = await this.props.electron.ipcRenderer.invoke(
        IPC_CHANNELS.DB_SCAN_SITE,
        this.props.site.id,
      );
      if (!this.mounted) return;
      if (result?.success) {
        this.setState({ dbScan: result.scan ?? null, dbScanning: false });
      } else {
        this.setState({
          dbScanning: false,
          setupResult: { success: false, message: result?.error ?? 'Scan failed' },
        });
      }
    } catch (err: any) {
      if (!this.mounted) return;
      this.setState({
        dbScanning: false,
        setupResult: { success: false, message: err?.message ?? 'Scan failed' },
      });
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

  /** Helper to create a styled action button with tooltip support */
  createActionButtonWithTitle(props: {
    onClick?: () => void;
    disabled?: boolean;
    title?: string;
    children: string;
  }): React.ReactElement {
    const { TextButton } = this.props;

    if (TextButton) {
      return React.createElement(TextButton, {
        onClick: props.onClick,
        disabled: props.disabled,
        inline: true,
        title: props.title,
        style: { paddingLeft: '10px' },
      }, props.children);
    }

    return React.createElement('a', {
      onClick: props.disabled ? undefined : props.onClick,
      title: props.title,
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
        if (!props.disabled) e.target.style.textDecoration = 'underline';
      },
      onMouseLeave: (e: any) => {
        e.target.style.textDecoration = 'none';
      },
    }, props.children);
  }

  render(): React.ReactNode {
    const { indexEntry, indexing, excluded, loading, aiStatus, settingUpAI, setupResult, syncingCreds, wpVersion, wpVersionAge, upgradingWp, refreshingMetadata, siteAIConfig, showProviderPicker, pickerProvider, switchingProvider, useLocalGateway, globalAIProvider, detailsExpanded } = this.state;

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

    // Tooltip for index state label
    const stateLabelTooltip = indexEntry?.state === 'indexed'
      ? 'Content is indexed for semantic search. Update Index if you\'ve published new content.'
      : indexEntry?.state === 'stale'
      ? 'This data is more than 24 hours old. Click Refresh Metadata to update it.'
      : undefined;

    // Always-visible rows
    const alwaysRows: React.ReactElement[] = [];
    // Detail rows (hidden by default)
    const detailRows: React.ReactElement[] = [];

    // -- ALWAYS VISIBLE: Index status + action --
    const indexButtonText = indexing ? 'Working...'
      : indexEntry ? 'Update Index'
      : 'Index Content';
    const indexButtonTitle = indexing ? undefined
      : indexEntry
      ? 'Creates a searchable database of posts, pages, and products using AI. Run after adding content to your site.'
      : 'Creates a searchable database of posts, pages, and products using AI. Run after adding content to your site.';

    alwaysRows.push(row('Index status',
      React.createElement('span', {
        style: dotStyle(stateColor),
        title: stateLabelTooltip,
      }),
      React.createElement('span', { title: stateLabelTooltip }, stateLabel),
      this.createActionButtonWithTitle({
        onClick: indexing ? undefined : this.handleIndex,
        disabled: indexing,
        title: indexButtonTitle,
        children: indexButtonText,
      }),
    ));

    // -- ALWAYS VISIBLE: WordPress version --
    if (aiStatus && wpVersion !== null) {
      const needsUpgrade = !isWp7OrLater(wpVersion);
      alwaysRows.push(row('WordPress',
        React.createElement('span', { style: dotStyle(needsUpgrade ? UI_COLORS.STATUS_WARNING : UI_COLORS.STATUS_RUNNING) }),
        wpVersion,
        needsUpgrade
          ? this.createActionButtonWithTitle({
              onClick: upgradingWp ? undefined : this.handleUpgradeWordPress,
              disabled: upgradingWp,
              title: 'Upgrade WordPress to the latest version. Required for AI features.',
              children: upgradingWp ? 'Working...' : 'Upgrade to WP 7.0',
            })
          : null,
      ));
    }

    // -- ALWAYS VISIBLE: AI Provider row --
    const canSetupAI = wpVersion === null || isWp7OrLater(wpVersion);
    const isAIConfigured = !!siteAIConfig;
    const gatewayActive = aiStatus ? (aiStatus.gatewayProvider === 'active') : false;
    const gatewayPending = useLocalGateway && !gatewayActive;

    if (aiStatus) {
      // Provider picker — shown inline when user clicks Install AI Tools or Change Provider
      const providerPickerElement = showProviderPicker
        ? React.createElement('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 6, marginLeft: 10 } },
            React.createElement('select', {
              value: pickerProvider,
              onChange: (e: any) => this.setState({ pickerProvider: e.target.value }),
              style: {
                fontSize: 12,
                padding: '2px 6px',
                borderRadius: 4,
                border: '1px solid rgba(128,128,128,0.3)',
                backgroundColor: 'transparent',
                color: 'inherit',
                cursor: 'pointer',
              },
            },
              React.createElement('option', { value: '' }, 'Pick provider...'),
              ...ALL_PROVIDERS.map((p) =>
                React.createElement('option', { key: p.id, value: p.id }, p.label),
              ),
            ),
            this.createActionButtonWithTitle({
              onClick: () => {
                if (!pickerProvider) return;
                if (isAIConfigured) {
                  this.handleSwitchProvider();
                } else {
                  this.handleSetupAI(pickerProvider as AIProvider);
                }
              },
              disabled: !pickerProvider || settingUpAI || switchingProvider,
              children: isAIConfigured ? (switchingProvider ? 'Working...' : 'Switch') : (settingUpAI ? 'Working...' : 'Go'),
            }),
            this.createActionButtonWithTitle({
              onClick: () => this.setState({ showProviderPicker: false, pickerProvider: '' }),
              children: 'Cancel',
            }),
          )
        : null;

      if (isAIConfigured) {
        const providerDisplayName = PROVIDER_LABELS[siteAIConfig!.provider] ?? siteAIConfig!.provider;
        const displayName = (useLocalGateway && siteAIConfig!.provider !== 'ollama')
          ? `${providerDisplayName} via Gateway`
          : providerDisplayName;

        const changeButton = gatewayPending
          ? React.createElement('span', { style: { fontSize: '12px', opacity: 0.6, paddingLeft: 8 } },
              `→ will switch to ${PROVIDER_LABELS[globalAIProvider ?? ''] ?? globalAIProvider ?? 'global provider'} via Gateway`)
          : (!useLocalGateway || siteAIConfig!.provider === 'ollama'
            ? (!showProviderPicker
                ? this.createActionButtonWithTitle({
                    onClick: () => this.setState({ showProviderPicker: true, pickerProvider: siteAIConfig!.provider as AIProvider }),
                    disabled: switchingProvider,
                    children: switchingProvider ? 'Working...' : 'Change',
                  })
                : null)
            : React.createElement('span', { style: { fontSize: '12px', opacity: 0.6, paddingLeft: 8 } }, 'Change in Preferences'));

        alwaysRows.push(row('AI Provider',
          React.createElement('span', { style: dotStyle(UI_COLORS.STATUS_RUNNING) }),
          displayName,
          changeButton,
          providerPickerElement,
        ));
      } else {
        // Not configured — show Install AI Tools button (Item 7: always label "Install AI Tools")
        const setupButtonText = settingUpAI ? 'Working...' : 'Install AI Tools';
        const setupDisabled = settingUpAI || !canSetupAI;
        const setupTitle = !canSetupAI
          ? 'Requires WordPress 7.0 or later. Upgrade WordPress first.'
          : 'Installs the WordPress AI plugin and configures it with your provider credentials. Requires WordPress 7.0+.';

        alwaysRows.push(row('AI Provider',
          React.createElement('span', { style: dotStyle('#888') }),
          'Not configured',
          !showProviderPicker && !settingUpAI
            ? this.createActionButtonWithTitle({
                onClick: canSetupAI ? () => this.setState({ showProviderPicker: true, pickerProvider: '' }) : undefined,
                disabled: setupDisabled,
                title: setupTitle,
                children: setupButtonText,
              })
            : (settingUpAI ? React.createElement('span', { style: { fontSize: 12, opacity: 0.7, paddingLeft: 8 } }, 'Working...') : null),
          providerPickerElement,
        ));
      }
    }

    // -- DETAIL: Documents + chunks --
    detailRows.push(row('Documents',
      indexEntry
        ? `${indexEntry.documentCount.toLocaleString()} documents \u2022 ${indexEntry.chunkCount.toLocaleString()} chunks`
        : '\u2014',
    ));

    // -- DETAIL: Last indexed --
    detailRows.push(row('Last indexed',
      indexEntry ? formatTimeAgo(indexEntry.lastIndexed) : 'Never',
    ));

    // -- DETAIL: Auto-index toggle --
    detailRows.push(row('Auto-index',
      React.createElement('input', {
        type: 'checkbox',
        checked: !excluded,
        onChange: this.handleExclusionToggle,
        title: 'When on, this site is indexed automatically when started.',
        style: { cursor: 'pointer', verticalAlign: 'middle', marginRight: 8 },
      }),
      !excluded ? 'On' : 'Off',
    ));

    // -- DETAIL: Metadata refresh --
    const hasMetadata = wpVersion !== null || (aiStatus && (aiStatus.metadataAge || wpVersionAge));
    const metadataAge = aiStatus?.metadataAge || wpVersionAge;
    const isStale = aiStatus?.metadataIsStale ?? false;

    if (hasMetadata) {
      const ageDisplay = metadataAge
        ? ` (${metadataAge}${isStale ? ', stale' : ''})`
        : '';

      detailRows.push(row('Metadata',
        React.createElement('span', {
          style: dotStyle(isStale ? UI_COLORS.STATUS_WARNING : UI_COLORS.STATUS_RUNNING),
          title: isStale ? 'This data is more than 24 hours old. Click Refresh Metadata to update it.' : undefined,
        }),
        React.createElement('span', {
          title: isStale ? 'This data is more than 24 hours old. Click Refresh Metadata to update it.' : undefined,
        }, `Cached${ageDisplay}`),
        this.createActionButtonWithTitle({
          onClick: refreshingMetadata ? undefined : this.handleRefreshMetadata,
          disabled: refreshingMetadata,
          title: 'Updates WordPress version, plugin list, themes, and admin email from the live site.',
          children: refreshingMetadata ? 'Working...' : 'Refresh Metadata',
        }),
      ));
    }

    // -- DETAIL: AI Plugin status (only show if not active) --
    if (aiStatus && aiStatus.aiPlugin !== 'active') {
      detailRows.push(row('AI plugin',
        React.createElement('span', { style: dotStyle(pluginColor(aiStatus.aiPlugin)) }),
        pluginLabel(aiStatus.aiPlugin),
      ));
    }

    // -- DETAIL: Local AI Gateway row --
    if (aiStatus) {
      const gatewayColor = gatewayActive ? UI_COLORS.STATUS_RUNNING
        : gatewayPending ? UI_COLORS.STATUS_WARNING
        : '#888';
      const gatewayLabel = gatewayActive ? 'Active' : gatewayPending ? 'Pending' : 'Inactive';

      detailRows.push(row('Local AI Gateway',
        React.createElement('span', { style: dotStyle(gatewayColor) }),
        gatewayLabel,
        gatewayPending && canSetupAI
          ? this.createActionButtonWithTitle({
              onClick: settingUpAI ? undefined : () => this.handleSetupAI(),
              disabled: settingUpAI || !canSetupAI,
              children: settingUpAI ? 'Working...' : 'Apply',
            })
          : null,
      ));

      // -- DETAIL: Credentials --
      if (isAIConfigured) {
        const credsSynced = aiStatus.credentialsSynced ?? false;
        detailRows.push(row('Credentials',
          React.createElement('span', { style: dotStyle(credsSynced ? UI_COLORS.STATUS_RUNNING : '#888') }),
          credsSynced ? `Synced (${PROVIDER_LABELS[siteAIConfig!.provider] ?? siteAIConfig!.provider})` : 'Not synced',
          this.createActionButtonWithTitle({
            onClick: syncingCreds ? undefined : this.handleSyncCredentials,
            disabled: syncingCreds,
            title: 'Sends your AI provider API key to this WordPress site so AI features work in wp-admin.',
            children: syncingCreds ? 'Working...' : 'Sync AI Credentials',
          }),
        ));
      }
    }

    // -- DETAIL: AI Context File --
    const { aiContextStatus, generatingContext } = this.state;
    if (aiContextStatus) {
      const contextExists = aiContextStatus.exists;
      const contextAge = aiContextStatus.ageString;
      const statusText = contextExists ? `Generated ${contextAge}` : 'Not generated';
      const statusColor = contextExists ? UI_COLORS.STATUS_RUNNING : '#888';

      const actions = [];
      actions.push(this.createActionButtonWithTitle({
        onClick: generatingContext ? undefined : this.handleGenerateContext,
        disabled: generatingContext,
        children: generatingContext ? 'Working...' : (contextExists ? 'Regenerate' : 'Generate'),
      }));

      if (contextExists && aiContextStatus.filePath) {
        actions.push(this.createActionButtonWithTitle({
          onClick: this.handleShowInFinder,
          children: 'Show in Finder',
        }));
      }

      detailRows.push(row('AI Context File',
        React.createElement('span', { style: dotStyle(statusColor) }),
        statusText,
        ...actions,
      ));
    }

    // -- DETAIL: Database Health row --
    const { dbScan, dbScanning } = this.state;
    const dbScoreColor = !dbScan ? '#888'
      : dbScan.healthScore >= 80 ? UI_COLORS.STATUS_RUNNING
      : dbScan.healthScore >= 50 ? UI_COLORS.STATUS_WARNING
      : UI_COLORS.STATUS_ERROR;
    const siteIsRunning = this.props.site.status === 'running';
    const dbScoreText = dbScan ? `${dbScan.healthScore}/100` : (siteIsRunning ? 'Not scanned' : 'Start site to scan');

    detailRows.push(row('Database Health',
      React.createElement('span', { style: dotStyle(dbScoreColor) }),
      dbScoreText,
      this.createActionButtonWithTitle({
        onClick: (dbScanning || !siteIsRunning) ? undefined : this.handleDbScan,
        disabled: dbScanning || !siteIsRunning,
        title: siteIsRunning ? 'Scans the WordPress database for performance issues, orphaned data, and optimization opportunities.' : 'Start the site to enable database scanning.',
        children: dbScanning ? 'Scanning...' : (dbScan ? 'Re-scan' : 'Scan'),
      }),
    ));

    if (dbScan && dbScan.summary.length > 0) {
      detailRows.push(row('Top DB issue', dbScan.summary[0]));
    }

    // -- Show/hide details toggle --
    const detailToggle = React.createElement('li', {
      key: '__details-toggle',
      className: 'TableListRow',
      style: { cursor: 'pointer', opacity: 0.6 },
      onClick: () => this.setState({ detailsExpanded: !detailsExpanded }),
    },
      React.createElement('strong', null, ''),
      React.createElement('div', null,
        detailsExpanded ? 'Hide details \u25be' : 'Show details \u25b8',
      ),
    );

    const allRows = [
      ...alwaysRows,
      detailToggle,
      ...(detailsExpanded ? detailRows : []),
    ];

    return React.createElement('div', null,
      React.createElement('ul', { className: 'TableList' }, ...allRows),

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
