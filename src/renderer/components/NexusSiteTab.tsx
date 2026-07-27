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
import type { NexusSettings, SiteAIConfig, DbScanResult, IwConnectionStatus } from '../../common/types';

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
  /** Which WP AI connector is currently active — derived from aiStatus + iwStatus */
  wpAiConnector: 'power' | 'local-gateway' | 'direct' | null;
  /** User's pending connector choice in the picker (State 0) */
  wpAiPickerChoice: 'power' | 'local-gateway' | 'direct' | null;
  /** For Direct path: which AI provider the user picked */
  wpAiDirectProvider: 'anthropic' | 'openai' | 'google' | 'ollama' | null;
  /** True while any WP AI setup step is running */
  wpAiSettingUp: boolean;
  /** Error from most recent WP AI setup step, or null */
  wpAiSetupError: string | null;
  useLocalGateway: boolean;
  globalAIProvider: string | null;
  /** Nexus-level key status per provider — used to gate Direct provider options */
  keyStatus: Record<string, string>;
  dbScan: DbScanResult | null;
  dbScanning: boolean;
  iwStatus: IwConnectionStatus | null;
  iwConnecting: boolean;
  iwPollInterval: ReturnType<typeof setInterval> | null;
  iwError: string | null;
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
    // opacity removed from container — applied to label text only so status dots render at full vividity
  },
  cardHeaderLabel: {
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

function detectWpAiConnector(
  aiStatus: SiteAiStatus | null,
  iwStatus: IwConnectionStatus | null,
): 'power' | 'local-gateway' | 'direct' | null {
  if (!aiStatus) return null;
  if (iwStatus?.connected && iwStatus?.wpEngineConnectorApproved) return 'power';
  if (aiStatus.gatewayProvider === 'active') return 'local-gateway';
  if (aiStatus.aiPlugin === 'active') return 'direct';
  return null;
}

export class NexusSiteTab extends React.Component<NexusSiteTabProps, NexusSiteTabState> {
  private mounted = false;
  private _onSettingsApplied: (() => void) | null = null;
  private _onIndexProgress: ((_: any, data: any) => void) | null = null;

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
    wpAiConnector: null,
    wpAiPickerChoice: null,
    wpAiDirectProvider: 'anthropic',
    wpAiSettingUp: false,
    wpAiSetupError: null,
    useLocalGateway: false,
    globalAIProvider: null,
    keyStatus: {},
    dbScan: null,
    dbScanning: false,
    iwStatus: null,
    iwConnecting: false,
    iwPollInterval: null,
    iwError: null,
  };

  componentDidMount(): void {
    this.mounted = true;
    this.fetchData();
    this._onSettingsApplied = () => { if (this.mounted) this.fetchData(); };
    window.addEventListener('nexus-ai:settings-applied', this._onSettingsApplied);

    // Re-fetch when the lifecycle hook finishes indexing this site — handles the case
    // where componentDidUpdate fires (site→running) before indexSite completes.
    this._onIndexProgress = (_: any, data: any) => {
      if (data?.siteId === this.props.site.id && (data?.state === 'indexed' || data?.state === 'error')) {
        if (this.mounted) this.fetchData();
      }
    };
    this.props.electron.ipcRenderer.on(IPC_CHANNELS.INDEX_PROGRESS, this._onIndexProgress);
  }

  componentDidUpdate(prevProps: NexusSiteTabProps, prevState: NexusSiteTabState): void {
    if (prevProps.site.id !== this.props.site.id) {
      this.setState({ setupResult: null });
      this.fetchData();
      return;
    }
    const prevStatus = prevProps.site.status || prevProps.siteStatus;
    const currStatus = this.props.site.status || this.props.siteStatus;
    if (prevStatus !== 'running' && currStatus === 'running') {
      this.fetchData();
    }
    // If connector changed (e.g. after setup completes), clear picker choice
    const prevConnector = detectWpAiConnector(prevState.aiStatus ?? null, prevState.iwStatus ?? null);
    const currConnector = detectWpAiConnector(this.state.aiStatus ?? null, this.state.iwStatus ?? null);
    if (prevConnector !== currConnector && currConnector !== null) {
      this.setState({ wpAiPickerChoice: null, wpAiSetupError: null });
    }
  }

  componentWillUnmount(): void {
    this.mounted = false;
    if (this._onSettingsApplied) {
      window.removeEventListener('nexus-ai:settings-applied', this._onSettingsApplied);
    }
    if (this._onIndexProgress) {
      this.props.electron.ipcRenderer.removeListener(IPC_CHANNELS.INDEX_PROGRESS, this._onIndexProgress);
    }
    if (this.state.iwPollInterval) clearInterval(this.state.iwPollInterval);
  }

  fetchData = async (): Promise<void> => {
    const ipc = this.props.electron.ipcRenderer;
    let rawAiStatus: SiteAiStatus | null = null;
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
        rawAiStatus = aiResult.sites?.[this.props.site.id] ?? null;
        this.setState({ aiStatus: rawAiStatus });
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

    const [iwStatusResult, keyStatusResult] = await Promise.all([
      ipc.invoke(IPC_CHANNELS.IW_GET_STATUS, this.props.site.id).catch(() => null),
      ipc.invoke(IPC_CHANNELS.GET_API_KEY_STATUS).catch(() => ({})),
    ]);
    if (!this.mounted) return;
    const iwStatusTyped = (iwStatusResult as IwConnectionStatus | null) ?? null;
    this.setState({
      iwStatus: iwStatusTyped,
      wpAiConnector: detectWpAiConnector(rawAiStatus, iwStatusTyped),
      keyStatus: (keyStatusResult as Record<string, string>) ?? {},
    });
  };

  handleIndex = async (): Promise<void> => {
    this.setState({ indexing: true });
    try {
      await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.INDEX_SITE, { siteId: this.props.site.id });
      if (!this.mounted) return;
      await this.fetchData();
    } catch {
      // Error handled by refresh
    }
    if (this.mounted) this.setState({ indexing: false });
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
      React.createElement('span', { style: styles.cardHeaderLabel }, header),
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
        React.createElement('span', { style: styles.cardHeaderLabel }, 'Database Health'),
      ),
      scoreDisplay,
      issuesList,
      buttonRow,
    );
  }

  renderWpAiCard(): React.ReactNode {
    const {
      aiStatus, iwStatus, wpAiPickerChoice, wpAiDirectProvider, wpAiSettingUp, wpAiSetupError,
      useLocalGateway, globalAIProvider, keyStatus,
    } = this.state;

    const activeConnector = this.state.wpAiConnector;
    // If user clicked "Change →", show picker/steps regardless of activeConnector
    const workingConnector: 'power' | 'local-gateway' | 'direct' | null = wpAiPickerChoice ?? activeConnector;
    const isEditing = wpAiPickerChoice !== null;

    // Smart default: what does the user's global Nexus config suggest?
    const DIRECT_PROVIDERS_LIST = ['anthropic', 'openai', 'google', 'ollama'] as const;
    const naturalPath: 'local-gateway' | 'direct' | null = (() => {
      if (useLocalGateway) return 'local-gateway';
      if (globalAIProvider && (DIRECT_PROVIDERS_LIST as readonly string[]).includes(globalAIProvider)) return 'direct';
      return null;
    })();
    const naturalDirectProvider = naturalPath === 'direct' ? (globalAIProvider as typeof DIRECT_PROVIDERS_LIST[number]) : null;
    // Direct path has a key if provider is ollama (keyless) or key exists in Nexus
    const naturalDirectHasKey = naturalDirectProvider === 'ollama' || !!(naturalDirectProvider && keyStatus[naturalDirectProvider]);
    const naturalDirectLabel = PROVIDER_LABELS[naturalDirectProvider ?? ''] ?? naturalDirectProvider ?? 'Provider';

    const providerLabel = PROVIDER_LABELS[wpAiDirectProvider ?? ''] ?? (wpAiDirectProvider ?? 'Provider');

    // ─── Shared style atoms ───────────────────────────────────────────────────
    const cardHeadStyle: React.CSSProperties = {
      padding: '11px 14px',
      borderBottom: '1px solid #2d3748',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
    };
    const titleStyle: React.CSSProperties = {
      fontSize: 10,
      fontWeight: 700,
      textTransform: 'uppercase' as const,
      letterSpacing: '0.1em',
      color: '#4b5563',
      display: 'flex',
      alignItems: 'center',
      gap: 6,
    };
    const badgeBase: React.CSSProperties = {
      fontSize: 9,
      fontWeight: 700,
      padding: '2px 6px',
      borderRadius: 10,
      letterSpacing: '.04em',
    };

    // ─── Step row renderer ────────────────────────────────────────────────────
    const renderStepRow = (
      stepNum: number,
      label: string,
      detail: string,
      done: boolean,
      action?: () => void,
      actionLabel?: string,
      locked?: boolean,
      autoNote?: string,
    ): React.ReactElement => {
      const circleBase: React.CSSProperties = {
        width: 18, height: 18, borderRadius: '50%',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 10, fontWeight: 700, flexShrink: 0, marginTop: 1,
      };
      const circleStyle: React.CSSProperties = done
        ? { ...circleBase, background: 'rgba(81,187,123,.15)', color: '#51bb7b' }
        : locked
          ? { ...circleBase, background: 'rgba(75,85,99,.2)', color: '#9ca3af', opacity: 0.4 }
          : { ...circleBase, background: 'rgba(75,85,99,.2)', color: '#9ca3af' };

      return React.createElement('div', {
        key: `step-${stepNum}`,
        style: {
          display: 'flex', gap: 10, padding: '10px 14px',
          borderBottom: '1px solid rgba(255,255,255,0.04)', alignItems: 'flex-start',
        },
      },
        React.createElement('div', { style: circleStyle }, done ? '✓' : String(stepNum)),
        React.createElement('div', { style: { flex: 1 } },
          React.createElement('div', {
            style: { fontSize: 12, fontWeight: 600, color: done || !locked ? '#e6edf3' : '#6b7280', marginBottom: 2 },
          }, label),
          React.createElement('div', {
            style: { fontSize: 11, color: '#6b7280', lineHeight: '1.4' },
          }, autoNote && (done || locked) ? autoNote : detail),
        ),
        !done && !locked && action
          ? React.createElement('button', {
              style: {
                fontSize: 11, padding: '3px 10px', borderRadius: 4, border: 'none',
                background: '#51bb7b', color: '#fff',
                cursor: wpAiSettingUp ? 'default' : 'pointer',
                fontFamily: 'inherit', opacity: wpAiSettingUp ? 0.6 : 1, flexShrink: 0,
              },
              onClick: wpAiSettingUp ? undefined : action,
              disabled: !!wpAiSettingUp,
            }, wpAiSettingUp ? 'Working…' : (actionLabel ?? 'Go'))
          : null,
      );
    };

    // ─── State 2 — active connector ───────────────────────────────────────────
    // State 2 only when truly active AND not in edit mode (user clicked "Change →")
    if (activeConnector !== null && !isEditing) {
      const connectorBadge = activeConnector === 'power'
        ? React.createElement('span', { style: { ...badgeBase, background: 'rgba(14,202,212,.12)', color: '#0ECAD4' } }, 'Power')
        : activeConnector === 'local-gateway'
          ? React.createElement('span', { style: { ...badgeBase, background: 'rgba(75,85,99,.3)', color: '#9ca3af' } }, 'Gateway')
          : React.createElement('span', { style: { ...badgeBase, background: 'rgba(37,99,235,.15)', color: '#60a5fa' } }, 'Direct');

      const head = React.createElement('div', { style: cardHeadStyle },
        React.createElement('div', { style: titleStyle },
          'WordPress AI',
          React.createElement('span', { style: { ...badgeBase, background: 'rgba(81,187,123,.15)', color: '#51bb7b' } }, 'Active'),
          connectorBadge,
        ),
      );

      const dotGreen: React.CSSProperties = {
        width: 7, height: 7, borderRadius: '50%', background: '#51bb7b', flexShrink: 0,
      };
      const activeRowStyle: React.CSSProperties = {
        display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
        borderBottom: '1px solid rgba(255,255,255,0.04)',
      };
      const openAdmin = () => {
        const url = `http://${this.props.site.name}.local/wp-admin/`;
        if (this.props.electron?.shell?.openExternal) this.props.electron.shell.openExternal(url);
      };

      const wpAiRow = React.createElement('div', { style: activeRowStyle },
        React.createElement('span', { style: dotGreen }),
        React.createElement('div', { style: { flex: 1 } },
          React.createElement('div', { style: { fontSize: 12, fontWeight: 600, color: '#e6edf3' } }, 'WP AI active'),
          React.createElement('div', { style: { fontSize: 11, color: '#6b7280' } },
            'Plugin installed · all experiments enabled',
          ),
        ),
        React.createElement('button', {
          style: {
            fontSize: 11, padding: '3px 10px', borderRadius: 4,
            border: '1px solid #2d3748', background: 'none', color: '#9ca3af',
            cursor: 'pointer', fontFamily: 'inherit',
          },
          onClick: openAdmin,
        }, 'WP Admin →'),
      );

      const powerRow = activeConnector === 'power'
        ? React.createElement('div', { style: activeRowStyle },
            React.createElement('span', { style: dotGreen }),
            React.createElement('div', { style: { flex: 1 } },
              React.createElement('div', { style: { fontSize: 12, fontWeight: 600, color: '#e6edf3' } }, 'Hub Plugin connected'),
              React.createElement('div', { style: { fontSize: 11, color: '#6b7280' } },
                iwStatus?.projectId ? `Project: ${iwStatus.projectId}` : 'Power connected',
              ),
            ),
            React.createElement('button', {
              style: {
                fontSize: 11, padding: '3px 10px', borderRadius: 4,
                border: '1px solid #374151', background: 'none', color: '#9ca3af',
                cursor: 'pointer', fontFamily: 'inherit',
              },
              onClick: () => this.handleIwDisconnect(),
            }, 'Disconnect'),
          )
        : null;

      // Footer row: Change connector + Remove WP AI
      // Footer: Change / Remove — both disabled while any operation is running
      const footerRow = React.createElement('div', {
        style: {
          display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
          gap: 8, padding: '8px 14px',
          borderTop: '1px solid rgba(255,255,255,0.04)',
        },
      },
        wpAiSettingUp
          ? React.createElement('span', { style: { fontSize: 11, color: '#6b7280', fontStyle: 'italic' as const } }, 'Working…')
          : null,
        React.createElement('button', {
          style: {
            fontSize: 11, padding: '3px 10px', borderRadius: 4,
            border: '1px solid #374151', background: 'none',
            color: wpAiSettingUp ? '#4b5563' : '#9ca3af',
            cursor: wpAiSettingUp ? 'default' : 'pointer', fontFamily: 'inherit',
          },
          disabled: !!wpAiSettingUp,
          onClick: wpAiSettingUp ? undefined : () => this.handleWpAiChange(),
        }, 'Change connector'),
        React.createElement('button', {
          style: {
            fontSize: 11, padding: '3px 10px', borderRadius: 4,
            border: '1px solid #374151', background: 'none',
            color: wpAiSettingUp ? '#4b5563' : '#f87171',
            cursor: wpAiSettingUp ? 'default' : 'pointer', fontFamily: 'inherit',
          },
          disabled: !!wpAiSettingUp,
          onClick: wpAiSettingUp ? undefined : () => this.handleWpAiRemove(),
        }, 'Remove WP AI'),
      );

      return React.createElement('div', { style: { ...styles.cardFull, padding: 0, borderColor: '#1e4620' } },
        head,
        wpAiRow,
        powerRow,
        footerRow,
      );
    }

    // ─── workingConnector set — picker or steps ───────────────────────────────
    if (workingConnector !== null) {
      // Any sign that setup has begun → show step rows instead of picker cards.
      // Exception: when isEditing (user clicked "Change connector"), always show
      // the picker so they can choose a DIFFERENT connector, not the current one's steps.
      const anyStepProgress = !isEditing && !!(
        wpAiSettingUp ||
        iwStatus?.connected ||
        (aiStatus?.aiPlugin && aiStatus.aiPlugin !== 'not_installed') ||
        (aiStatus?.gatewayProvider && aiStatus.gatewayProvider !== 'not_installed')
      );

      const head = React.createElement('div', { style: cardHeadStyle },
        React.createElement('div', { style: titleStyle }, 'WordPress AI'),
        React.createElement('button', {
          style: {
            fontSize: 11, background: 'none', border: 'none',
            color: '#6b7280', cursor: 'pointer', fontFamily: 'inherit', padding: '2px 4px',
          },
          onClick: () => this.setState({ wpAiPickerChoice: null, wpAiSetupError: null }),
        }, '← Back'),
      );

      const errorEl = wpAiSetupError
        ? React.createElement('div', {
            style: { padding: '8px 14px', fontSize: 11, color: '#ef4444', lineHeight: '1.4' },
          }, wpAiSetupError)
        : null;

      // ── Picker view — connector not yet started ─────────────────────────────
      if (!anyStepProgress) {
        const OPTIONS: Array<{ id: 'power' | 'local-gateway' | 'direct'; name: string; desc: string }> = [
          { id: 'power', name: 'WP Engine Power', desc: 'Use your WPE account AI — no API key needed. Connect via Hub Plugin.' },
          { id: 'local-gateway', name: 'Local AI Gateway', desc: 'Route through Nexus to your configured provider (Anthropic, OpenAI, Gemini, Ollama, Power).' },
          { id: 'direct', name: 'Direct API', desc: 'Connect Anthropic, OpenAI, Google Gemini, or Ollama directly to this site.' },
        ];

        const DIRECT_PROVIDERS: Array<{ id: 'anthropic' | 'openai' | 'google' | 'ollama'; label: string }> = [
          { id: 'anthropic', label: 'Anthropic (Claude)' },
          { id: 'openai', label: 'OpenAI (GPT)' },
          { id: 'google', label: 'Google (Gemini)' },
          { id: 'ollama', label: 'Ollama (local)' },
        ];
        // Only show providers with a key configured in Nexus, plus Ollama (keyless).
        const availableDirectProviders = DIRECT_PROVIDERS.filter(
          p => p.id === 'ollama' || keyStatus[p.id],
        );

        const optionCards = OPTIONS.map(opt =>
          React.createElement('div', {
            key: opt.id,
            style: {
              border: `1px solid ${wpAiPickerChoice === opt.id ? '#51bb7b' : '#2d3748'}`,
              borderRadius: 7, padding: '9px 11px',
              display: 'flex', gap: 9, cursor: 'pointer', marginBottom: 5,
              background: wpAiPickerChoice === opt.id ? 'rgba(81,187,123,.05)' : 'none',
            },
            onClick: () => this.setState({ wpAiPickerChoice: opt.id }),
          },
            React.createElement('div', {
              style: {
                width: 13, height: 13, borderRadius: '50%',
                border: `2px solid ${wpAiPickerChoice === opt.id ? '#51bb7b' : '#374151'}`,
                flexShrink: 0, marginTop: 2,
                background: wpAiPickerChoice === opt.id ? '#51bb7b' : 'none',
              },
            }),
            React.createElement('div', { style: { flex: 1 } },
              React.createElement('div', {
                style: { fontSize: 12, fontWeight: 600, color: '#e6edf3', marginBottom: 2 },
              }, opt.name),
              React.createElement('div', {
                style: { fontSize: 11, color: '#6b7280', lineHeight: '1.4' },
              }, opt.desc),
            ),
          ),
        );

        const directSubPicker = wpAiPickerChoice === 'direct'
          ? React.createElement('div', { style: { marginBottom: 10 } },
              availableDirectProviders.length === 0
                ? React.createElement('div', {
                    style: { fontSize: 11, color: '#6b7280', padding: '6px 0', lineHeight: '1.5' },
                  }, 'No API keys configured in Nexus. Add a key in Preferences first.')
                : React.createElement('div', null,
                    React.createElement('div', { style: { fontSize: 11, color: '#6b7280', marginBottom: 6 } }, 'Choose provider:'),
                    React.createElement('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' as const } },
                      ...availableDirectProviders.map(p =>
                        React.createElement('button', {
                          key: p.id,
                          style: {
                            fontSize: 11, padding: '3px 10px', borderRadius: 4,
                            fontFamily: 'inherit', cursor: 'pointer',
                            border: `1px solid ${wpAiDirectProvider === p.id ? '#51bb7b' : '#374151'}`,
                            background: wpAiDirectProvider === p.id ? 'rgba(81,187,123,.1)' : 'none',
                            color: wpAiDirectProvider === p.id ? '#51bb7b' : '#9ca3af',
                          },
                          onClick: () => this.setState({ wpAiDirectProvider: p.id }),
                        }, p.label),
                      ),
                    ),
                  ),
            )
          : null;

        return React.createElement('div', { style: { ...styles.cardFull, padding: 0 } },
          head,
          React.createElement('div', { style: { padding: '12px 14px' } },
            ...optionCards,
            directSubPicker,
            React.createElement('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 } },
              isEditing && activeConnector !== null
                ? React.createElement('button', {
                    style: { fontSize: 11, padding: '5px 10px', borderRadius: 5, border: '1px solid #374151', background: 'none', color: '#9ca3af', cursor: 'pointer', fontFamily: 'inherit' },
                    onClick: () => this.setState({ wpAiPickerChoice: null, wpAiSetupError: null }),
                  }, 'Cancel')
                : null,
              React.createElement('button', {
                style: {
                  fontSize: 11, padding: '5px 14px', borderRadius: 5, border: 'none',
                  background: wpAiSettingUp ? 'rgba(81,187,123,.4)' : '#51bb7b',
                  color: '#fff',
                  cursor: wpAiSettingUp ? 'default' : 'pointer',
                  fontFamily: 'inherit', fontWeight: 500,
                  opacity: wpAiSettingUp ? 0.7 : 1,
                },
                disabled: !!wpAiSettingUp,
                onClick: wpAiSettingUp ? undefined : () => this.handleWpAiConnect(),
              }, wpAiSettingUp ? 'Setting up…' : 'Set up →'),
            ),
          ),
          errorEl,
        );
      }

      // ── Steps view — setup in progress or partially complete ───────────────
      let steps: React.ReactElement[] = [];

      if (workingConnector === 'power') {
        steps = [
          renderStepRow(
            1,
            'Connect to WP Engine Power',
            'Installs Hub Plugin, opens WP Admin to complete OAuth.',
            iwStatus?.connected === true,
            () => this.handleIwConnect(),
            'Connect',
            false,
          ),
          renderStepRow(
            2,
            'Install WP AI & enable features',
            'WP AI plugin + all AI experiments. Power handles auth — no key needed.',
            aiStatus?.aiPlugin === 'active',
            () => this.handleWpAiSetup('power'),
            'Setup',
            !iwStatus?.connected,
          ),
          renderStepRow(
            3,
            'Authorise Power connector',
            'Allows the WP Engine connector to serve AI requests.',
            iwStatus?.wpEngineConnectorApproved === true,
            undefined,
            undefined,
            aiStatus?.aiPlugin !== 'active',
            'Completed automatically with step 2.',
          ),
        ];
      } else if (workingConnector === 'local-gateway') {
        steps = [
          renderStepRow(
            1,
            'Install WP AI & Local Gateway plugin',
            'Installs WP AI plugin + gateway provider, enables all AI experiments.',
            aiStatus?.aiPlugin === 'active' && aiStatus?.gatewayProvider === 'active',
            () => this.handleWpAiSetup('local-gateway'),
            'Install',
            false,
          ),
        ];
      } else if (workingConnector === 'direct') {
        // Direct path is ONE step — install + credential sync is automatic inside setup-ai.
        // Key is already in Nexus KeyVault; setup-ai syncs it to WP DB during install.
        steps = [
          renderStepRow(
            1,
            `Install WP AI & ${providerLabel} plugin`,
            `Installs WP AI plugin + ${providerLabel} provider, enables AI experiments, syncs API key.`,
            aiStatus?.aiPlugin === 'active',
            () => this.handleWpAiSetup(wpAiDirectProvider ?? 'anthropic'),
            'Install',
            false,
          ),
        ];
      }

      return React.createElement('div', { style: { ...styles.cardFull, padding: 0 } },
        head,
        ...steps,
        errorEl,
      );
    }

    // ─── State 0 — empty (no connector, no pending choice) ────────────────────
    const emptyHead = React.createElement('div', { style: cardHeadStyle },
      React.createElement('div', { style: titleStyle }, 'WordPress AI'),
    );

    // Smart default CTA — respect global Nexus settings so Local Gateway and
    // Direct provider paths remain ONE CLICK (same as old behaviour).
    const primaryAction = (() => {
      if (naturalPath === 'local-gateway') {
        return {
          label: 'Setup AI via Local Gateway',
          onClick: () => this.handleWpAiSetup('local-gateway'),
        };
      }
      if (naturalPath === 'direct' && naturalDirectHasKey) {
        return {
          label: `Setup AI with ${naturalDirectLabel}`,
          onClick: () => this.handleWpAiSetup(naturalDirectProvider ?? 'anthropic'),
        };
      }
      return {
        label: 'Connect to Power',
        onClick: () => this.setState({ wpAiPickerChoice: 'power' }),
      };
    })();

    const emptyBody = React.createElement('div', {
      style: {
        padding: '20px 16px', textAlign: 'center' as const,
        display: 'flex', flexDirection: 'column' as const, alignItems: 'center', gap: 10,
      },
    },
      React.createElement('div', { style: { fontSize: 13, fontWeight: 600, color: '#e6edf3' } },
        'No AI configured for this site',
      ),
      React.createElement('div', { style: { fontSize: 11, color: '#6b7280', maxWidth: 240, lineHeight: '1.5' } },
        naturalPath
          ? `Uses your Nexus AI setting. Choose a different option below.`
          : 'Choose how WordPress AI gets its capabilities.',
      ),
      React.createElement('div', { style: { display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' as const, justifyContent: 'center' } },
        React.createElement('button', {
          style: {
            fontSize: 11, padding: '5px 12px', borderRadius: 5, border: 'none',
            background: wpAiSettingUp ? 'rgba(81,187,123,.5)' : '#51bb7b',
            color: '#fff', cursor: wpAiSettingUp ? 'default' : 'pointer',
            fontFamily: 'inherit', fontWeight: 500,
          },
          disabled: !!wpAiSettingUp,
          onClick: wpAiSettingUp ? undefined : primaryAction.onClick,
        }, wpAiSettingUp ? 'Setting up…' : primaryAction.label),
        React.createElement('button', {
          style: {
            fontSize: 11, padding: '5px 10px', borderRadius: 5,
            border: '1px solid #374151', background: 'none',
            color: '#9ca3af', cursor: 'pointer', fontFamily: 'inherit',
          },
          onClick: () => this.setState({ wpAiPickerChoice: 'power' }),
        }, 'Other options ↓'),
      ),
      wpAiSetupError ? React.createElement('div', {
        style: { fontSize: 11, color: '#ef4444', marginTop: 4 },
      }, wpAiSetupError) : null,
    );

    return React.createElement('div', { style: { ...styles.cardFull, padding: 0 } },
      emptyHead,
      emptyBody,
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
        React.createElement('span', { style: styles.cardHeaderLabel }, 'Tools'),
      ),
      this.cardRow('AI Context File',
        React.createElement('span', { style: dot(contextColor) }),
        React.createElement('span', { style: { marginRight: 6 } }, contextText),
        ...contextActions,
      ),
    );
  }

  handleIwConnect = async (): Promise<void> => {
    const ipc = this.props.electron.ipcRenderer;
    this.setState({ iwConnecting: true, iwError: null });
    try {
      const connectResult = await ipc.invoke(IPC_CHANNELS.IW_CONNECT, this.props.site.id) as { ok: boolean; error?: string } | null;
      if (!connectResult?.ok) {
        if (this.mounted) this.setState({ iwConnecting: false, iwError: connectResult?.error ?? 'Connect failed' });
        return;
      }
    } catch (err: any) {
      if (this.mounted) this.setState({ iwConnecting: false, iwError: String(err?.message ?? err) });
      return;
    }
    if (!this.mounted) return;
    const started = Date.now();
    const interval = setInterval(async () => {
      if (!this.mounted) { clearInterval(interval); return; }
      const status = await ipc.invoke(IPC_CHANNELS.IW_GET_STATUS, this.props.site.id).catch(() => null) as IwConnectionStatus | null;
      if (status?.connected || Date.now() - started > 180_000) {
        clearInterval(interval);
        this.setState({ iwStatus: status, iwConnecting: false, iwPollInterval: null });
      } else if (status) {
        this.setState({ iwStatus: status });
      }
    }, 2000);
    this.setState({ iwPollInterval: interval });
  };

  handleIwDisconnect = async (): Promise<void> => {
    const ipc = this.props.electron.ipcRenderer;
    try {
      await ipc.invoke(IPC_CHANNELS.IW_DISCONNECT, this.props.site.id);
      const status = await ipc.invoke(IPC_CHANNELS.IW_GET_STATUS, this.props.site.id).catch(() => null) as IwConnectionStatus | null;
      if (!this.mounted) return;
      this.setState({ iwStatus: status });
    } catch {
      // Best-effort
    }
  };

  /** Fresh install (no existing config) — always uses SETUP_AI. */
  handleWpAiSetup = async (provider: string): Promise<void> => {
    const { site, electron } = this.props;
    const ipc = electron.ipcRenderer;
    this.setState({ wpAiSettingUp: true, wpAiSetupError: null });
    try {
      const result = await ipc.invoke(IPC_CHANNELS.SETUP_AI, site.id, provider) as { success: boolean; message: string } | null;
      if (!this.mounted) return;
      if (result?.success) {
        this.setState({ wpAiSettingUp: false, wpAiSetupError: null, wpAiPickerChoice: null });
        await this.fetchData();
      } else {
        this.setState({ wpAiSettingUp: false, wpAiSetupError: result?.message ?? 'Setup failed' });
      }
    } catch (err: any) {
      if (this.mounted) this.setState({ wpAiSettingUp: false, wpAiSetupError: String(err?.message ?? err) });
    }
  };

  /** Switch from an existing provider to a new one — uses SWITCH_AI_PROVIDER
   *  which deactivates the old plugin before installing the new one. */
  handleWpAiSwitch = async (provider: string): Promise<void> => {
    const { site, electron } = this.props;
    const ipc = electron.ipcRenderer;
    this.setState({ wpAiSettingUp: true, wpAiSetupError: null });
    try {
      const result = await ipc.invoke(IPC_CHANNELS.SWITCH_AI_PROVIDER, site.id, provider) as { success: boolean; error?: string } | null;
      if (!this.mounted) return;
      if (result?.success) {
        this.setState({ wpAiSettingUp: false, wpAiSetupError: null, wpAiPickerChoice: null });
        await this.fetchData();
      } else {
        this.setState({ wpAiSettingUp: false, wpAiSetupError: result?.error ?? 'Switch failed' });
      }
    } catch (err: any) {
      if (this.mounted) this.setState({ wpAiSettingUp: false, wpAiSetupError: String(err?.message ?? err) });
    }
  };

  /** Remove WP AI from this site — deactivates the WP AI plugin and clears config. */
  handleWpAiRemove = async (): Promise<void> => {
    const { site, electron } = this.props;
    const ipc = electron.ipcRenderer;
    this.setState({ wpAiSettingUp: true, wpAiSetupError: null });
    try {
      const result = await ipc.invoke(IPC_CHANNELS.REMOVE_WP_AI, site.id) as { success: boolean; error?: string } | null;
      if (!this.mounted) return;
      this.setState({ wpAiSettingUp: false, wpAiPickerChoice: null, wpAiSetupError: result?.success === false ? (result.error ?? 'Remove failed') : null });
      await this.fetchData();
    } catch (err: any) {
      if (this.mounted) this.setState({ wpAiSettingUp: false, wpAiSetupError: String(err?.message ?? err) });
    }
  };

  handleWpAiConnect = async (): Promise<void> => {
    const { wpAiPickerChoice, wpAiDirectProvider, wpAiConnector } = this.state;
    const isSwitch = wpAiConnector !== null; // true = changing existing config

    if (wpAiPickerChoice === 'power') {
      // Power always uses the Hub connect + SETUP_AI flow regardless of switching
      this.handleIwConnect();
    } else if (wpAiPickerChoice === 'local-gateway') {
      if (isSwitch) {
        await this.handleWpAiSwitch('local-gateway');
      } else {
        await this.handleWpAiSetup('local-gateway');
      }
    } else if (wpAiPickerChoice === 'direct') {
      const provider = wpAiDirectProvider ?? 'anthropic';
      if (isSwitch) {
        await this.handleWpAiSwitch(provider);
      } else {
        await this.handleWpAiSetup(provider);
      }
    }
  };

  handleWpAiDisconnect = async (): Promise<void> => {
    this.handleIwDisconnect();
  };

  handleWpAiChange = (): void => {
    this.setState({
      wpAiPickerChoice: this.state.wpAiConnector,
      wpAiSetupError: null,
    });
  };

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

    return React.createElement('div', {
      style: { padding: '14px', display: 'flex', flexDirection: 'column' as const, gap: 10, overflowY: 'auto' as const },
    },
      this.renderContentIndexCard(),
      this.renderWpAiCard(),
      this.renderToolsCard(),
      this.renderDatabaseHealthCard(),
      resultBanner,
    );
  }
}
