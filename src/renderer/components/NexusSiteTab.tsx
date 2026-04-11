/**
 * NexusSiteTab — Full Nexus AI tab for the Local site info panel.
 *
 * Renders as a dedicated tab route: /main/site-info/:siteId/nexus
 * Organizes all SiteNexusSection functionality into a card-based layout.
 *
 * Class-based — Local uses older React, no hooks allowed.
 */
import * as React from 'react';
import { IPC_CHANNELS, UI_COLORS } from '../../common/constants';
import type { NexusSettings, AIProvider, SiteAIConfig, DbScanResult } from '../../common/types';

export interface NexusSiteTabProps {
  site: { id: string; name: string; path: string; status?: string };
  siteStatus: string;
  electron: any;
  TextButton?: any;
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
  gatewayProvider?: 'active' | 'inactive' | 'not_installed';
  credentialsSynced: boolean;
  providers: string[];
  metadataAge?: string | null;
  metadataIsStale?: boolean;
}

interface NexusSiteTabState {
  indexEntry: IndexEntry | null;
  indexing: boolean;
  excluded: boolean;
  loading: boolean;
  aiStatus: SiteAiStatus | null;
  settingUpAI: boolean;
  setupResult: { success: boolean; message: string } | null;
  syncingCreds: boolean;
  wpVersion: string | null;
  wpVersionAge: string | null;
  upgradingWp: boolean;
  refreshingMetadata: boolean;
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

const dot = (color: string): React.CSSProperties => ({
  display: 'inline-block',
  width: 8,
  height: 8,
  borderRadius: '50%',
  backgroundColor: color,
  marginRight: 6,
  verticalAlign: 'middle',
  flexShrink: 0,
});

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: 'Anthropic (Claude)',
  openai: 'OpenAI (GPT)',
  google: 'Google (Gemini)',
  ollama: 'Ollama (local)',
  'local-gateway': 'Local AI Gateway',
};

const ALL_PROVIDERS: Array<{ id: string; label: string }> = [
  { id: 'anthropic', label: 'Anthropic (Claude)' },
  { id: 'openai', label: 'OpenAI (GPT)' },
  { id: 'google', label: 'Google (Gemini)' },
  { id: 'ollama', label: 'Ollama (local)' },
];

// ---------------------------------------------------------------------------
// Inline styles
// ---------------------------------------------------------------------------

const styles = {
  container: {
    padding: 24,
    overflowY: 'auto' as const,
    height: '100%',
    boxSizing: 'border-box' as const,
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 16,
    marginBottom: 16,
  },
  card: {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 8,
    padding: 16,
    boxSizing: 'border-box' as const,
  },
  cardFull: {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
    boxSizing: 'border-box' as const,
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.08em',
    textTransform: 'uppercase' as const,
    opacity: 0.6,
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    fontSize: 13,
    minHeight: 28,
    paddingBottom: 6,
    flexWrap: 'wrap' as const,
  },
  rowLabel: {
    opacity: 0.6,
    fontSize: 12,
    minWidth: 100,
    marginRight: 8,
    flexShrink: 0,
  },
  rowValue: {
    display: 'flex',
    alignItems: 'center',
    flex: 1,
    flexWrap: 'wrap' as const,
    gap: 4,
  },
  scoreDisplay: {
    fontSize: 32,
    fontWeight: 700,
    lineHeight: 1,
    marginBottom: 8,
  },
  issueItem: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 6,
    fontSize: 12,
    opacity: 0.85,
    marginBottom: 4,
    lineHeight: 1.4,
  },
  buttonRow: {
    display: 'flex',
    gap: 8,
    marginTop: 12,
    flexWrap: 'wrap' as const,
  },
  resultBanner: (success: boolean) => ({
    margin: '12px 0 0',
    padding: '6px 10px',
    borderRadius: 4,
    fontSize: 12,
    backgroundColor: success ? 'rgba(81,195,86,0.15)' : 'rgba(239,68,68,0.15)',
    color: success ? UI_COLORS.STATUS_RUNNING : UI_COLORS.STATUS_ERROR,
  }),
};

export class NexusSiteTab extends React.Component<NexusSiteTabProps, NexusSiteTabState> {
  private mounted = false;
  private _onSettingsApplied: (() => void) | null = null;

  state: NexusSiteTabState = {
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
  };

  componentDidMount(): void {
    this.mounted = true;
    this.fetchData();
    this._onSettingsApplied = () => { if (this.mounted) this.fetchData(); };
    window.addEventListener('nexus-ai:settings-applied', this._onSettingsApplied);
  }

  componentDidUpdate(prevProps: NexusSiteTabProps): void {
    if (prevProps.site.id !== this.props.site.id) {
      this.setState({ setupResult: null, showProviderPicker: false });
      this.fetchData();
      return;
    }
    const prevStatus = prevProps.site.status || prevProps.siteStatus;
    const currStatus = this.props.site.status || this.props.siteStatus;
    if (prevStatus !== 'running' && currStatus === 'running') {
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

    try {
      const aiResult = await ipc.invoke(IPC_CHANNELS.GET_AI_STATUS, this.props.site.id);
      if (!this.mounted) return;
      if (aiResult?.success) {
        this.setState({ aiStatus: aiResult.sites?.[this.props.site.id] ?? null });
      }
    } catch {
      // Non-fatal
    }

    try {
      const versionResult = await ipc.invoke(IPC_CHANNELS.GET_WP_VERSION, this.props.site.id);
      if (!this.mounted) return;
      if (versionResult?.success) {
        this.setState({
          wpVersion: versionResult.version,
          wpVersionAge: versionResult.metadataAge ?? null,
        });
      }
    } catch {
      // Non-fatal
    }

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
    } catch {
      // Non-fatal
    }

    try {
      const configResult = await ipc.invoke(IPC_CHANNELS.GET_SITE_AI_CONFIG, this.props.site.id);
      if (!this.mounted) return;
      if (configResult?.success) {
        this.setState({ siteAIConfig: configResult.config ?? null });
      }
    } catch {
      // Non-fatal
    }

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
    try {
      await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.INDEX_SITE, this.props.site.id);
      if (!this.mounted) return;
      await this.fetchData();
    } catch {
      // Error handled by refresh
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
      await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.SYNC_ALL_CREDENTIALS);
      if (!this.mounted) return;
      this.setState({ syncingCreds: false });
      this.fetchData();
    } catch {
      if (!this.mounted) return;
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
        this.setState({
          refreshingMetadata: false,
          wpVersionAge: result.metadataAge,
          setupResult: { success: true, message: 'Metadata refreshed successfully' },
        });
        this.fetchData();
      } else {
        this.setState({
          refreshingMetadata: false,
          setupResult: { success: false, message: result.error || 'Refresh failed' },
        });
      }
    } catch {
      if (!this.mounted) return;
      this.setState({
        refreshingMetadata: false,
        setupResult: { success: false, message: 'Refresh failed' },
      });
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

  // ---------------------------------------------------------------------------
  // Button helper
  // ---------------------------------------------------------------------------

  btn(props: { onClick?: () => void; disabled?: boolean; children: string }): React.ReactElement {
    const { TextButton } = this.props;
    if (TextButton) {
      return React.createElement(TextButton, {
        onClick: props.onClick,
        disabled: props.disabled,
        inline: true,
        style: { fontSize: 12 },
      }, props.children);
    }
    return React.createElement('a', {
      onClick: props.disabled ? undefined : props.onClick,
      style: {
        cursor: props.disabled ? 'default' : 'pointer',
        color: props.disabled ? '#888' : '#51c356',
        textDecoration: 'none',
        fontSize: 12,
        opacity: props.disabled ? 0.5 : 1,
        whiteSpace: 'nowrap' as const,
      },
      onMouseEnter: (e: any) => { if (!props.disabled) e.target.style.textDecoration = 'underline'; },
      onMouseLeave: (e: any) => { e.target.style.textDecoration = 'none'; },
    }, props.children);
  }

  // ---------------------------------------------------------------------------
  // Card helpers
  // ---------------------------------------------------------------------------

  cardRow(label: string, ...value: React.ReactNode[]): React.ReactElement {
    return React.createElement('div', { key: label, style: styles.row },
      React.createElement('span', { style: styles.rowLabel }, label),
      React.createElement('span', { style: styles.rowValue }, ...value),
    );
  }

  card(header: string, dotColor: string | null, ...body: React.ReactElement[]): React.ReactElement {
    const headerEl = React.createElement('div', { style: styles.cardHeader },
      dotColor !== null
        ? React.createElement('span', { style: dot(dotColor) })
        : null,
      header,
    );
    return React.createElement('div', { style: styles.card }, headerEl, ...body);
  }

  // ---------------------------------------------------------------------------
  // Render cards
  // ---------------------------------------------------------------------------

  renderContentIndexCard(): React.ReactElement {
    const { indexEntry, indexing, excluded, refreshingMetadata, aiStatus, wpVersion, wpVersionAge } = this.state;

    const stateColor = !indexEntry ? '#888'
      : indexEntry.state === 'indexed' ? UI_COLORS.STATUS_RUNNING
      : indexEntry.state === 'stale' ? UI_COLORS.STATUS_WARNING
      : indexEntry.state === 'error' ? UI_COLORS.STATUS_ERROR
      : UI_COLORS.WPE_BRAND;

    const stateLabel = indexEntry
      ? indexEntry.state.charAt(0).toUpperCase() + indexEntry.state.slice(1)
      : 'Not indexed';

    const hasMetadata = wpVersion !== null || !!(aiStatus?.metadataAge || wpVersionAge);
    const metadataAge = aiStatus?.metadataAge || wpVersionAge;
    const isStale = aiStatus?.metadataIsStale ?? false;

    return this.card('Content Index', stateColor,
      this.cardRow('Status',
        React.createElement('span', { style: dot(stateColor) }),
        React.createElement('span', { style: { marginRight: 6 } }, stateLabel),
        this.btn({
          onClick: indexing ? undefined : this.handleIndex,
          disabled: indexing,
          children: indexing ? 'Indexing...' : (indexEntry ? 'Re-index' : 'Index Now'),
        }),
      ),
      this.cardRow('Documents',
        indexEntry
          ? `${indexEntry.documentCount.toLocaleString()} docs \u2022 ${indexEntry.chunkCount.toLocaleString()} chunks`
          : '\u2014',
      ),
      this.cardRow('Last indexed',
        indexEntry ? formatTimeAgo(indexEntry.lastIndexed) : 'Never',
      ),
      this.cardRow('Auto-index',
        React.createElement('label', { style: { display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' } },
          React.createElement('input', {
            type: 'checkbox',
            checked: !excluded,
            onChange: this.handleExclusionToggle,
            style: { cursor: 'pointer' },
          }),
          !excluded ? 'Enabled' : 'Disabled',
        ),
      ),
      hasMetadata
        ? this.cardRow('Metadata cache',
            React.createElement('span', { style: dot(isStale ? UI_COLORS.STATUS_WARNING : UI_COLORS.STATUS_RUNNING) }),
            React.createElement('span', { style: { marginRight: 6 } },
              `Cached${metadataAge ? ` (${metadataAge}${isStale ? ', stale' : ''})` : ''}`,
            ),
            this.btn({
              onClick: refreshingMetadata ? undefined : this.handleRefreshMetadata,
              disabled: refreshingMetadata,
              children: refreshingMetadata ? 'Refreshing...' : 'Refresh',
            }),
          )
        : React.createElement('div', null),
    );
  }

  renderAIProviderCard(): React.ReactElement {
    const {
      aiStatus, siteAIConfig, wpVersion, settingUpAI, switchingProvider,
      showProviderPicker, pickerProvider, useLocalGateway, globalAIProvider, syncingCreds,
    } = this.state;

    const isAIConfigured = !!siteAIConfig;
    const canSetupAI = wpVersion === null || isWp7OrLater(wpVersion);
    const gatewayActive = aiStatus?.gatewayProvider === 'active';
    const gatewayPending = useLocalGateway && !gatewayActive;

    const headerDotColor = isAIConfigured ? UI_COLORS.STATUS_RUNNING : '#888';

    // Provider picker element
    const providerPickerEl = showProviderPicker
      ? React.createElement('span', { style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' as const, marginTop: 4 } },
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
            ...ALL_PROVIDERS.map(p =>
              React.createElement('option', { key: p.id, value: p.id }, p.label),
            ),
          ),
          this.btn({
            onClick: () => {
              if (!pickerProvider) return;
              if (isAIConfigured) {
                this.handleSwitchProvider();
              } else {
                this.handleSetupAI(pickerProvider as AIProvider);
              }
            },
            disabled: !pickerProvider || settingUpAI || switchingProvider,
            children: isAIConfigured
              ? (switchingProvider ? 'Switching...' : 'Switch')
              : (settingUpAI ? 'Setting up...' : 'Go'),
          }),
          this.btn({
            onClick: () => this.setState({ showProviderPicker: false, pickerProvider: '' }),
            children: 'Cancel',
          }),
        )
      : null;

    // Provider row
    let providerRow: React.ReactElement;
    if (isAIConfigured) {
      const providerDisplayName = PROVIDER_LABELS[siteAIConfig!.provider] ?? siteAIConfig!.provider;
      const displayName = (useLocalGateway && siteAIConfig!.provider !== 'ollama')
        ? `${providerDisplayName} via Gateway`
        : providerDisplayName;

      const changeEl = gatewayPending
        ? React.createElement('span', { style: { fontSize: 11, opacity: 0.6 } },
            `\u2192 will switch to ${PROVIDER_LABELS[globalAIProvider ?? ''] ?? globalAIProvider ?? 'global provider'} via Gateway`)
        : (!useLocalGateway || siteAIConfig!.provider === 'ollama'
          ? (!showProviderPicker
              ? this.btn({
                  onClick: () => this.setState({ showProviderPicker: true, pickerProvider: siteAIConfig!.provider as AIProvider }),
                  disabled: switchingProvider,
                  children: switchingProvider ? 'Switching...' : 'Change',
                })
              : null)
          : React.createElement('span', { style: { fontSize: 11, opacity: 0.6 } }, 'Change in Preferences'));

      providerRow = this.cardRow('Provider',
        React.createElement('span', { style: dot(UI_COLORS.STATUS_RUNNING) }),
        React.createElement('span', { style: { marginRight: 6 } }, displayName),
        changeEl,
        providerPickerEl,
      );
    } else {
      const setupText = settingUpAI ? 'Setting up...'
        : !canSetupAI ? 'Requires WP 7.0+'
        : 'Setup AI';

      providerRow = this.cardRow('Provider',
        React.createElement('span', { style: dot('#888') }),
        React.createElement('span', { style: { marginRight: 6 } }, 'Not configured'),
        !showProviderPicker && !settingUpAI
          ? this.btn({
              onClick: canSetupAI ? () => this.setState({ showProviderPicker: true, pickerProvider: '' }) : undefined,
              disabled: !canSetupAI,
              children: setupText,
            })
          : (settingUpAI ? React.createElement('span', { style: { fontSize: 11, opacity: 0.7 } }, 'Setting up...') : null),
        providerPickerEl,
      );
    }

    // Gateway row
    const gatewayColor = gatewayActive ? UI_COLORS.STATUS_RUNNING
      : gatewayPending ? UI_COLORS.STATUS_WARNING
      : '#888';
    const gatewayLabel = gatewayActive ? 'Active' : gatewayPending ? 'Pending' : 'Inactive';

    const gatewayRow = React.createElement('div', null,
      this.cardRow('Gateway',
        React.createElement('span', { style: dot(gatewayColor) }),
        React.createElement('span', { style: { marginRight: 6 } }, gatewayLabel),
        gatewayPending && canSetupAI
          ? this.btn({
              onClick: settingUpAI ? undefined : () => this.handleSetupAI(),
              disabled: settingUpAI || !canSetupAI,
              children: settingUpAI ? 'Applying...' : 'Apply',
            })
          : (!gatewayActive && !useLocalGateway
              ? React.createElement('span', { style: { fontSize: 11, opacity: 0.5 } }, 'Configure in Preferences')
              : null),
      ),
    );

    // Credentials row (only when AI is configured)
    const credsRow = isAIConfigured && aiStatus
      ? this.cardRow('Credentials',
          React.createElement('span', { style: dot(aiStatus.credentialsSynced ? UI_COLORS.STATUS_RUNNING : '#888') }),
          React.createElement('span', { style: { marginRight: 6 } },
            aiStatus.credentialsSynced
              ? `Synced (${PROVIDER_LABELS[siteAIConfig!.provider] ?? siteAIConfig!.provider})`
              : 'Not synced',
          ),
          this.btn({
            onClick: this.state.syncingCreds ? undefined : this.handleSyncCredentials,
            disabled: syncingCreds,
            children: syncingCreds ? 'Syncing...' : 'Sync Keys',
          }),
        )
      : null;

    // WP version row (show if we have it)
    const wpRow = aiStatus && wpVersion !== null
      ? this.cardRow('WordPress',
          React.createElement('span', { style: dot(!isWp7OrLater(wpVersion) ? UI_COLORS.STATUS_WARNING : UI_COLORS.STATUS_RUNNING) }),
          React.createElement('span', { style: { marginRight: 6 } }, wpVersion),
          !isWp7OrLater(wpVersion)
            ? this.btn({
                onClick: this.state.upgradingWp ? undefined : this.handleUpgradeWordPress,
                disabled: this.state.upgradingWp,
                children: this.state.upgradingWp ? 'Upgrading...' : 'Upgrade to WP 7.0',
              })
            : null,
        )
      : null;

    return this.card('AI Provider', headerDotColor,
      providerRow,
      gatewayRow,
      credsRow ?? React.createElement('div', null),
      wpRow ?? React.createElement('div', null),
    );
  }

  renderDatabaseHealthCard(): React.ReactElement {
    const { dbScan, dbScanning } = this.state;
    const siteStatus = this.props.site.status || this.props.siteStatus;
    const siteIsRunning = siteStatus === 'running';

    const scoreColor = !dbScan ? '#888'
      : dbScan.healthScore >= 80 ? UI_COLORS.STATUS_RUNNING
      : dbScan.healthScore >= 50 ? UI_COLORS.STATUS_WARNING
      : UI_COLORS.STATUS_ERROR;

    const scoreText = dbScan ? `${dbScan.healthScore}/100` : '';

    const headerDotColor = !dbScan ? '#888'
      : dbScan.healthScore >= 80 ? UI_COLORS.STATUS_RUNNING
      : dbScan.healthScore >= 50 ? UI_COLORS.STATUS_WARNING
      : UI_COLORS.STATUS_ERROR;

    const scoreDisplay = dbScan
      ? React.createElement('div', { style: { ...styles.scoreDisplay, color: scoreColor } }, scoreText)
      : React.createElement('div', { style: { fontSize: 13, opacity: 0.6, marginBottom: 8 } },
          siteIsRunning ? 'Not scanned yet' : 'Start site to scan',
        );

    const issuesList = dbScan && dbScan.summary.length > 0
      ? React.createElement('div', { style: { marginBottom: 8 } },
          ...dbScan.summary.map((issue: string, i: number) =>
            React.createElement('div', { key: i, style: styles.issueItem },
              React.createElement('span', null, '\u26A0'),
              React.createElement('span', null, issue),
            ),
          ),
        )
      : (dbScan
          ? React.createElement('div', { style: { fontSize: 12, opacity: 0.6, marginBottom: 8 } }, 'No issues found')
          : null);

    const buttonRow = React.createElement('div', { style: styles.buttonRow },
      this.btn({
        onClick: (dbScanning || !siteIsRunning) ? undefined : this.handleDbScan,
        disabled: dbScanning || !siteIsRunning,
        children: dbScanning ? 'Scanning...' : (dbScan ? 'Re-scan' : 'Scan Now'),
      }),
    );

    return React.createElement('div', { style: styles.cardFull },
      React.createElement('div', { style: styles.cardHeader },
        React.createElement('span', { style: dot(headerDotColor) }),
        'Database Health',
      ),
      scoreDisplay,
      issuesList,
      buttonRow,
    );
  }

  renderToolsCard(): React.ReactElement {
    const { aiContextStatus, generatingContext } = this.state;

    const contextExists = aiContextStatus?.exists ?? false;
    const contextAge = aiContextStatus?.ageString;
    const contextColor = contextExists ? UI_COLORS.STATUS_RUNNING : '#888';
    const contextText = aiContextStatus
      ? (contextExists ? `Generated ${contextAge}` : 'Not generated')
      : 'Loading...';

    const contextActions = [];
    if (aiContextStatus) {
      contextActions.push(
        this.btn({
          onClick: generatingContext ? undefined : this.handleGenerateContext,
          disabled: generatingContext,
          children: generatingContext ? 'Generating...' : (contextExists ? 'Regenerate' : 'Generate'),
        }),
      );
      if (contextExists && aiContextStatus.filePath) {
        contextActions.push(
          this.btn({
            onClick: this.handleShowInFinder,
            children: 'Show in Finder',
          }),
        );
      }
    }

    return React.createElement('div', { style: styles.cardFull },
      React.createElement('div', { style: styles.cardHeader },
        'Tools',
      ),
      this.cardRow('AI Context File',
        React.createElement('span', { style: dot(contextColor) }),
        React.createElement('span', { style: { marginRight: 6 } }, contextText),
        ...contextActions,
      ),
    );
  }

  render(): React.ReactNode {
    const { loading, setupResult } = this.state;

    if (loading) {
      return React.createElement('div', { style: styles.container },
        React.createElement('div', { style: { opacity: 0.6, fontSize: 13 } }, 'Loading Nexus AI data...'),
      );
    }

    const resultBanner = setupResult
      ? React.createElement('div', { style: styles.resultBanner(setupResult.success) },
          setupResult.message,
        )
      : null;

    return React.createElement('div', { style: styles.container },
      // Top row: 2-column grid
      React.createElement('div', { style: styles.grid },
        this.renderContentIndexCard(),
        this.renderAIProviderCard(),
      ),
      // Full-width: Database Health
      this.renderDatabaseHealthCard(),
      // Full-width: Tools
      this.renderToolsCard(),
      // Result banner at bottom
      resultBanner,
    );
  }
}
