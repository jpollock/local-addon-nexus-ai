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
import type { NexusSettings, AIProvider, SiteAIConfig } from '../../common/types';

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
  { id: 'anthropic',      label: 'Anthropic (Claude)' },
  { id: 'openai',         label: 'OpenAI (GPT)' },
  { id: 'google',         label: 'Google (Gemini)' },
  { id: 'ollama',         label: 'Ollama (local)' },
  { id: 'local-gateway',  label: 'Local AI Gateway' },
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
  };

  componentDidMount(): void {
    this.mounted = true;
    this.fetchData();
  }

  componentDidUpdate(prevProps: SiteNexusSectionProps): void {
    // Re-fetch when switching to a different site
    if (prevProps.site.id !== this.props.site.id) {
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
        // Update state with fresh data
        this.setState({
          refreshingMetadata: false,
          wpVersionAge: result.metadataAge,
          setupResult: { success: true, message: 'Metadata refreshed successfully' },
        });
        // Re-fetch AI status to update plugin states
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
    const { indexEntry, indexing, excluded, loading, aiStatus, settingUpAI, setupResult, syncingCreds, wpVersion, wpVersionAge, upgradingWp, refreshingMetadata, siteAIConfig, showProviderPicker, pickerProvider, switchingProvider } = this.state;

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

    // Metadata refresh button (shown at top if metadata exists)
    const hasMetadata = wpVersion !== null || (aiStatus && (aiStatus.metadataAge || wpVersionAge));
    const metadataAge = aiStatus?.metadataAge || wpVersionAge;
    const isStale = aiStatus?.metadataIsStale ?? false;

    if (hasMetadata) {
      const ageDisplay = metadataAge
        ? ` (${metadataAge}${isStale ? ', stale' : ''})`
        : '';

      rows.push(row('Metadata',
        React.createElement('span', { style: dotStyle(isStale ? UI_COLORS.STATUS_WARNING : UI_COLORS.STATUS_RUNNING) }),
        `Cached${ageDisplay}`,
        this.createActionButton({
          onClick: refreshingMetadata ? undefined : this.handleRefreshMetadata,
          disabled: refreshingMetadata,
          children: refreshingMetadata ? 'Refreshing...' : 'Refresh',
        }),
      ));
    }

    // AI rows (only render if AI status is loaded)
    if (aiStatus) {
      // WordPress Version (show if we have it)
      if (wpVersion !== null) {
        const needsUpgrade = !isWp7OrLater(wpVersion);

        rows.push(row('WordPress',
          React.createElement('span', { style: dotStyle(needsUpgrade ? UI_COLORS.STATUS_WARNING : UI_COLORS.STATUS_RUNNING) }),
          wpVersion,
          needsUpgrade
            ? this.createActionButton({
                onClick: upgradingWp ? undefined : this.handleUpgradeWordPress,
                disabled: upgradingWp,
                children: upgradingWp ? 'Upgrading...' : 'Upgrade to WP 7.0',
              })
            : null,
        ));
      }

      // AI Provider row — always show when we have aiStatus
      const canSetupAI = wpVersion === null || isWp7OrLater(wpVersion);
      const isAIConfigured = !!siteAIConfig;

      // Provider picker — shown inline when user clicks Setup AI or Change Provider
      const providerPickerElement = showProviderPicker
        ? React.createElement('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 6 } },
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
            // Confirm button
            this.createActionButton({
              onClick: () => {
                if (!pickerProvider) return;
                if (isAIConfigured) {
                  this.handleSwitchProvider();
                } else {
                  this.handleSetupAI(pickerProvider as AIProvider);
                }
              },
              disabled: !pickerProvider || settingUpAI || switchingProvider,
              children: isAIConfigured ? (switchingProvider ? 'Switching...' : 'Switch') : (settingUpAI ? 'Setting up...' : 'Go'),
            }),
            // Cancel
            this.createActionButton({
              onClick: () => this.setState({ showProviderPicker: false, pickerProvider: '' }),
              children: 'Cancel',
            }),
          )
        : null;

      // AI Provider row
      if (isAIConfigured) {
        // Already set up — show provider name + Change Provider link
        rows.push(row('AI Provider',
          React.createElement('span', { style: dotStyle(UI_COLORS.STATUS_RUNNING) }),
          PROVIDER_LABELS[siteAIConfig!.provider] ?? siteAIConfig!.provider,
          !showProviderPicker
            ? this.createActionButton({
                onClick: () => this.setState({ showProviderPicker: true, pickerProvider: siteAIConfig!.provider as AIProvider }),
                disabled: switchingProvider,
                children: switchingProvider ? 'Switching...' : 'Change',
              })
            : null,
          providerPickerElement,
        ));
      } else {
        // Not configured — show Setup AI button (with provider picker)
        const setupButtonText = settingUpAI ? 'Setting up...'
          : !canSetupAI ? 'Requires WP 7.0+'
          : 'Setup AI';

        rows.push(row('AI Provider',
          React.createElement('span', { style: dotStyle('#888') }),
          'Not configured',
          !showProviderPicker && !settingUpAI
            ? this.createActionButton({
                onClick: canSetupAI ? () => this.setState({ showProviderPicker: true, pickerProvider: '' }) : undefined,
                disabled: !canSetupAI,
                children: setupButtonText,
              })
            : (settingUpAI ? React.createElement('span', { style: { fontSize: 12, opacity: 0.7, paddingLeft: 8 } }, 'Setting up...') : null),
          providerPickerElement,
        ));
      }

      // AI Plugin status row (secondary, only show if not active)
      const needsGatewayUpdate =
        aiStatus.aiPlugin === 'active' &&
        (!aiStatus.gatewayProvider || aiStatus.gatewayProvider === 'not_installed');

      if (aiStatus.aiPlugin !== 'active') {
        rows.push(row('AI plugin',
          React.createElement('span', { style: dotStyle(pluginColor(aiStatus.aiPlugin)) }),
          pluginLabel(aiStatus.aiPlugin),
        ));
      }

      // Local Gateway
      if (aiStatus.gatewayProvider === 'active') {
        rows.push(row('Local Gateway',
          React.createElement('span', { style: dotStyle(UI_COLORS.STATUS_RUNNING) }),
          'Active',
        ));
      } else if (needsGatewayUpdate) {
        rows.push(row('Local Gateway',
          React.createElement('span', { style: dotStyle(UI_COLORS.STATUS_WARNING) }),
          'Available update',
          this.createActionButton({
            onClick: settingUpAI ? undefined : () => this.handleSetupAI(siteAIConfig?.provider as AIProvider),
            disabled: settingUpAI,
            children: settingUpAI ? 'Updating...' : 'Update Setup',
          }),
        ));
      }

      // Credentials — only show if AI is configured
      if (isAIConfigured) {
        const credsSynced = aiStatus.credentialsSynced ?? false;
        rows.push(row('Credentials',
          React.createElement('span', { style: dotStyle(credsSynced ? UI_COLORS.STATUS_RUNNING : '#888') }),
          credsSynced ? `Synced (${PROVIDER_LABELS[siteAIConfig!.provider] ?? siteAIConfig!.provider})` : 'Not synced',
          this.createActionButton({
            onClick: syncingCreds ? undefined : this.handleSyncCredentials,
            disabled: syncingCreds,
            children: syncingCreds ? 'Syncing...' : 'Sync Keys',
          }),
        ));
      }
    }

    // AI Context File (show for all sites)
    const { aiContextStatus, generatingContext } = this.state;
    if (aiContextStatus) {
      const contextExists = aiContextStatus.exists;
      const contextAge = aiContextStatus.ageString;

      const statusText = contextExists
        ? `Generated ${contextAge}`
        : 'Not generated';

      const statusColor = contextExists ? UI_COLORS.STATUS_RUNNING : '#888';

      const actions = [];

      // Generate/Regenerate button
      actions.push(this.createActionButton({
        onClick: generatingContext ? undefined : this.handleGenerateContext,
        disabled: generatingContext,
        children: generatingContext ? 'Generating...' : (contextExists ? 'Regenerate' : 'Generate'),
      }));

      // Show in Finder button (only if exists)
      if (contextExists && aiContextStatus.filePath) {
        actions.push(this.createActionButton({
          onClick: this.handleShowInFinder,
          children: 'Show in Finder',
        }));
      }

      rows.push(row('AI Context File',
        React.createElement('span', { style: dotStyle(statusColor) }),
        statusText,
        ...actions,
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
