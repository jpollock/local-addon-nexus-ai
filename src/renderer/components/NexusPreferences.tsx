/**
 * Nexus AI Preferences Panel
 *
 * Registered via Local's `preferencesMenuItems` filter hook.
 * Controls auto-index behavior, per-site exclusions, and AI chat provider settings.
 *
 * Class-based — Local uses older React, no hooks allowed.
 */
import * as React from 'react';
import { IPC_CHANNELS, UI_COLORS } from '../../common/constants';
import type { ChatProvider, NexusSettings } from '../../common/types';

interface NexusPreferencesProps {
  electron: any;
}

interface SiteListItem {
  id: string;
  name: string;
  status: string;
}

interface ProviderInfo {
  id: string;
  displayName: string;
  requiresApiKey: boolean;
}

interface CredentialSyncResult {
  siteId: string;
  siteName: string;
  success: boolean;
  providers: string[];
  error?: string;
}

interface AiProxyInfo {
  url: string;
  port: number;
  running: boolean;
  models: string[];
}

interface NexusPreferencesState {
  settings: NexusSettings;
  sites: SiteListItem[];
  loading: boolean;
  saved: boolean;
  // Chat provider state
  providers: ProviderInfo[];
  models: string[];
  loadingModels: boolean;
  keyStatus: Record<string, 'valid' | 'invalid' | 'unchecked' | 'checking'>;
  keyInput: string;
  keySaved: boolean;
  // Credential sync state (Sprint 4)
  syncStatus: Record<string, { lastSync: number; success: boolean }>;
  syncing: boolean;
  syncResults: CredentialSyncResult[] | null;
  // AI Proxy state (Sprint 4)
  aiProxy: AiProxyInfo | null;
  // WPE Sync state (Phase 3)
  wpeSyncProgress: { total: number; current: number; currentSite: string; status: string } | null;
  wpeSyncedCount: number;
  wpeSyncing: boolean;
  wpeSyncError: string | null;
}

const labelStyle: React.CSSProperties = {
  fontSize: '14px',
  fontWeight: 600,
  color: 'var(--nxai-card-text, #111827)',
  marginBottom: '6px',
};

const descStyle: React.CSSProperties = {
  fontSize: '13px',
  color: 'var(--nxai-card-sub, #6b7280)',
  marginBottom: '16px',
  lineHeight: 1.5,
};

const checkboxRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
  padding: '8px 0',
};

const sectionStyle: React.CSSProperties = {
  marginBottom: '24px',
};

const selectStyle: React.CSSProperties = {
  padding: '8px 12px',
  fontSize: '14px',
  borderRadius: '6px',
  border: '1px solid var(--nxai-input-border, #d1d5db)',
  backgroundColor: 'var(--nxai-input-bg, #fff)',
  color: 'var(--nxai-card-text, #111827)',
  outline: 'none',
  minWidth: '200px',
  cursor: 'pointer',
};

const inputStyle: React.CSSProperties = {
  padding: '8px 12px',
  fontSize: '14px',
  borderRadius: '6px',
  border: '1px solid var(--nxai-input-border, #d1d5db)',
  backgroundColor: 'var(--nxai-input-bg, #fff)',
  color: 'var(--nxai-card-text, #111827)',
  outline: 'none',
  minWidth: '200px',
  fontFamily: 'monospace',
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

const dotStyle = (color: string): React.CSSProperties => ({
  display: 'inline-block',
  width: '8px',
  height: '8px',
  borderRadius: '50%',
  backgroundColor: color,
  marginRight: '6px',
});

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
  marginBottom: '12px',
};

export class NexusPreferences extends React.Component<NexusPreferencesProps, NexusPreferencesState> {
  private mounted = false;
  private wpeSyncPollInterval: NodeJS.Timeout | null = null;

  state: NexusPreferencesState = {
    settings: { autoIndex: true, excludedSiteIds: [] },
    sites: [],
    loading: true,
    saved: false,
    providers: [],
    models: [],
    loadingModels: false,
    keyStatus: {},
    keyInput: '',
    keySaved: false,
    syncStatus: {},
    syncing: false,
    syncResults: null,
    aiProxy: null,
    wpeSyncProgress: null,
    wpeSyncedCount: 0,
    wpeSyncing: false,
    wpeSyncError: null,
  };

  componentDidMount(): void {
    this.mounted = true;
    this.fetchData();
  }

  componentWillUnmount(): void {
    this.mounted = false;
    this.stopWpeSyncProgressPolling();
  }

  fetchData = async (): Promise<void> => {
    const ipc = this.props.electron.ipcRenderer;
    try {
      const [settings, sites, providers, keyStatus, syncStatus, proxyResult] = await Promise.all([
        ipc.invoke(IPC_CHANNELS.GET_SETTINGS),
        ipc.invoke(IPC_CHANNELS.GET_SITES),
        ipc.invoke(IPC_CHANNELS.GET_PROVIDERS),
        ipc.invoke(IPC_CHANNELS.GET_API_KEY_STATUS),
        ipc.invoke(IPC_CHANNELS.GET_CREDENTIAL_SYNC_STATUS),
        ipc.invoke(IPC_CHANNELS.GET_AI_PROXY_INFO),
      ]);
      if (!this.mounted) return;
      this.setState({
        settings: settings ?? { autoIndex: true, excludedSiteIds: [] },
        sites: sites ?? [],
        providers: providers ?? [],
        keyStatus: keyStatus ?? {},
        syncStatus: syncStatus ?? {},
        aiProxy: proxyResult?.proxy ?? null,
        loading: false,
      }, () => {
        // Load models and stored key for the current provider
        if (this.state.settings.chatProvider) {
          this.fetchModels(this.state.settings.chatProvider);
          this.loadStoredKey(this.state.settings.chatProvider);
        }
      });
    } catch {
      if (!this.mounted) return;
      this.setState({ loading: false });
    }
  };

  loadStoredKey = async (providerId: string): Promise<void> => {
    try {
      const key = await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.GET_API_KEY, providerId);
      if (!this.mounted) return;
      if (key) {
        this.setState({ keyInput: key, keySaved: true });
      }
    } catch {
      // Best-effort — key field stays empty
    }
  };

  fetchModels = async (providerId: string): Promise<void> => {
    this.setState({ loadingModels: true });
    try {
      const models = await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.GET_MODELS, providerId);
      if (!this.mounted) return;
      this.setState({ models: models ?? [], loadingModels: false });
    } catch {
      if (!this.mounted) return;
      this.setState({ models: [], loadingModels: false });
    }
  };

  handleAutoIndexToggle = (): void => {
    this.setState(
      (prev) => ({
        settings: { ...prev.settings, autoIndex: !prev.settings.autoIndex },
        saved: false,
      }),
      () => this.saveSettings(),
    );
  };

  handleSiteExclusionToggle = (siteId: string): void => {
    this.setState(
      (prev) => {
        const excluded = prev.settings.excludedSiteIds;
        const isExcluded = excluded.includes(siteId);
        return {
          settings: {
            ...prev.settings,
            excludedSiteIds: isExcluded
              ? excluded.filter((id) => id !== siteId)
              : [...excluded, siteId],
          },
          saved: false,
        };
      },
      () => this.saveSettings(),
    );
  };

  handleProviderChange = (e: React.ChangeEvent<HTMLSelectElement>): void => {
    const providerId = e.target.value as ChatProvider;
    this.setState(
      (prev) => ({
        settings: { ...prev.settings, chatProvider: providerId, chatModel: '' },
        models: [],
        keyInput: '',
        keySaved: false,
        saved: false,
      }),
      () => {
        this.saveSettings();
        this.fetchModels(providerId);
        if (providerId) {
          this.loadStoredKey(providerId);
        }
      },
    );
  };

  handleModelChange = (e: React.ChangeEvent<HTMLSelectElement>): void => {
    const model = e.target.value;
    this.setState(
      (prev) => ({
        settings: { ...prev.settings, chatModel: model },
        saved: false,
      }),
      () => this.saveSettings(),
    );
  };

  handleKeyInputChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    this.setState({ keyInput: e.target.value, keySaved: false });
  };

  handleSaveKey = async (): Promise<void> => {
    const { keyInput, settings } = this.state;
    const providerId = settings.chatProvider;
    if (!providerId || !keyInput.trim()) return;

    await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.SAVE_API_KEY, providerId, keyInput.trim());
    if (!this.mounted) return;

    this.setState((prev) => ({
      keyStatus: { ...prev.keyStatus, [providerId]: 'unchecked' },
      keySaved: true,
    }));
  };

  handleValidateKey = async (): Promise<void> => {
    const { keyInput, settings } = this.state;
    const providerId = settings.chatProvider;
    if (!providerId || !keyInput.trim()) return;

    this.setState((prev) => ({
      keyStatus: { ...prev.keyStatus, [providerId]: 'checking' },
    }));

    try {
      const result = await this.props.electron.ipcRenderer.invoke(
        IPC_CHANNELS.VALIDATE_API_KEY,
        providerId,
        keyInput.trim(),
      );
      if (!this.mounted) return;

      this.setState((prev) => ({
        keyStatus: { ...prev.keyStatus, [providerId]: result.valid ? 'valid' : 'invalid' },
      }));

      // Refresh models after key validation
      if (result.valid) {
        this.fetchModels(providerId);
      }
    } catch {
      if (!this.mounted) return;
      this.setState((prev) => ({
        keyStatus: { ...prev.keyStatus, [providerId]: 'invalid' },
      }));
    }
  };

  handleSyncAll = async (): Promise<void> => {
    this.setState({ syncing: true, syncResults: null });
    try {
      const result = await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.SYNC_ALL_CREDENTIALS);
      if (!this.mounted) return;
      this.setState({ syncing: false, syncResults: result?.results ?? [] });
      // Refresh sync status
      const syncStatus = await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.GET_CREDENTIAL_SYNC_STATUS);
      if (this.mounted) this.setState({ syncStatus: syncStatus ?? {} });
    } catch {
      if (!this.mounted) return;
      this.setState({ syncing: false, syncResults: [] });
    }
  };

  saveSettings = async (): Promise<void> => {
    try {
      await this.props.electron.ipcRenderer.invoke(
        IPC_CHANNELS.UPDATE_SETTINGS,
        this.state.settings,
      );
      if (this.mounted) this.setState({ saved: true });
    } catch {
      // Best-effort save
    }
  };

  // -----------------------------------------------------------------------
  // Chat Section Render
  // -----------------------------------------------------------------------

  renderChatSection(): React.ReactNode {
    const { settings, providers, models, loadingModels, keyStatus, keyInput, keySaved } = this.state;
    const currentProvider = providers.find((p) => p.id === settings.chatProvider);
    const currentStatus = settings.chatProvider ? (keyStatus[settings.chatProvider] ?? 'unchecked') : 'unchecked';

    const statusColor = currentStatus === 'valid' ? UI_COLORS.STATUS_RUNNING
      : currentStatus === 'invalid' ? UI_COLORS.STATUS_ERROR
      : currentStatus === 'checking' ? UI_COLORS.WPE_BRAND
      : 'var(--nxai-card-sub, #999)';

    const statusLabel = currentStatus === 'valid' ? 'Valid'
      : currentStatus === 'invalid' ? 'Invalid'
      : currentStatus === 'checking' ? 'Checking...'
      : 'Not checked';

    return React.createElement('div', { style: sectionStyle },
      React.createElement('div', { style: labelStyle }, 'AI Chat'),
      React.createElement('div', { style: descStyle },
        'Configure the AI provider for the Chat tab. Ollama runs locally with no API key required.',
      ),

      // Provider dropdown
      React.createElement('div', { style: rowStyle },
        React.createElement('span', { style: { fontSize: '13px', fontWeight: 500, minWidth: '70px', color: 'var(--nxai-card-text)' } }, 'Provider'),
        React.createElement('select', {
          value: settings.chatProvider || '',
          onChange: this.handleProviderChange,
          style: selectStyle,
        },
          React.createElement('option', { value: '' }, 'Select a provider...'),
          ...providers.map((p) =>
            React.createElement('option', { key: p.id, value: p.id },
              `${p.displayName}${!p.requiresApiKey ? ' (no key required)' : ''}`,
            ),
          ),
        ),
      ),

      // Model selector (shown when provider selected)
      settings.chatProvider ? React.createElement('div', { style: rowStyle },
        React.createElement('span', { style: { fontSize: '13px', fontWeight: 500, minWidth: '70px', color: 'var(--nxai-card-text)' } }, 'Model'),
        loadingModels
          ? React.createElement('span', { style: { fontSize: '13px', color: 'var(--nxai-card-sub)' } }, 'Loading models...')
          : React.createElement('select', {
              value: settings.chatModel || '',
              onChange: this.handleModelChange,
              style: selectStyle,
            },
              React.createElement('option', { value: '' }, 'Select a model...'),
              ...models.map((m) =>
                React.createElement('option', { key: m, value: m }, m),
              ),
            ),
      ) : null,

      // API Key input (shown when provider requires key)
      currentProvider?.requiresApiKey ? React.createElement('div', { style: { marginTop: '4px' } },
        React.createElement('div', { style: rowStyle },
          React.createElement('span', { style: { fontSize: '13px', fontWeight: 500, minWidth: '70px', color: 'var(--nxai-card-text)' } }, 'API Key'),
          React.createElement('input', {
            type: 'password',
            value: keyInput,
            onChange: this.handleKeyInputChange,
            placeholder: 'Enter API key...',
            style: { ...inputStyle, flex: 1, maxWidth: '350px' },
          }),
          React.createElement('button', {
            style: {
              ...btnSmallStyle,
              ...(keyInput.trim() && !keySaved ? { backgroundColor: UI_COLORS.WPE_BRAND, color: '#fff', border: 'none' } : {}),
            },
            onClick: this.handleSaveKey,
            disabled: !keyInput.trim() || keySaved,
          }, keySaved ? 'Saved' : 'Apply'),
          React.createElement('button', {
            style: btnSmallStyle,
            onClick: this.handleValidateKey,
            disabled: !keyInput.trim() || currentStatus === 'checking',
          }, 'Check Key'),
        ),

        // Status indicator
        React.createElement('div', {
          style: { display: 'flex', alignItems: 'center', gap: '6px', marginLeft: '80px', marginBottom: '8px' },
        },
          React.createElement('span', { style: dotStyle(statusColor) }),
          React.createElement('span', {
            style: { fontSize: '12px', color: statusColor },
          }, statusLabel),
        ),
      ) : null,
    );
  }

  renderCredentialSyncSection(): React.ReactNode {
    const { syncStatus, syncing, syncResults, sites } = this.state;
    const runningSites = sites.filter((s) => s.status === 'running');
    const syncEntries = Object.entries(syncStatus);
    const hasSyncData = syncEntries.length > 0;

    return React.createElement('div', { style: sectionStyle },
      React.createElement('div', { style: labelStyle }, 'Credential Sync'),
      React.createElement('div', { style: descStyle },
        'Push API keys to running WordPress sites so their AI features can use your configured providers.',
      ),

      // Sync status summary
      hasSyncData
        ? React.createElement('div', { style: { marginBottom: '12px' } },
            ...syncEntries.map(([siteId, status]: [string, any]) => {
              const site = sites.find((s) => s.id === siteId);
              const color = status.success ? UI_COLORS.STATUS_RUNNING : UI_COLORS.STATUS_ERROR;
              const ago = status.lastSync ? this.formatTimeAgo(status.lastSync) : 'Never';
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
      React.createElement('div', { style: rowStyle },
        React.createElement('button', {
          style: {
            ...btnSmallStyle,
            ...(syncing ? { opacity: 0.6, cursor: 'not-allowed' } : { backgroundColor: UI_COLORS.WPE_BRAND, color: '#fff', border: 'none' }),
          },
          onClick: syncing ? undefined : this.handleSyncAll,
          disabled: syncing || runningSites.length === 0,
        }, syncing ? 'Syncing...' : `Sync All (${runningSites.length} running)`),
      ),

      // Results
      syncResults && syncResults.length > 0
        ? React.createElement('div', { style: { marginTop: '8px' } },
            ...syncResults.map((r: CredentialSyncResult) =>
              React.createElement('div', {
                key: r.siteId,
                style: { fontSize: '12px', padding: '2px 0', color: r.success ? UI_COLORS.STATUS_RUNNING : UI_COLORS.STATUS_ERROR },
              }, `${r.siteName}: ${r.success ? `synced (${r.providers.join(', ')})` : r.error ?? 'failed'}`),
            ),
          )
        : null,
    );
  }

  renderAiProxySection(): React.ReactNode {
    const { aiProxy } = this.state;
    const running = aiProxy?.running ?? false;
    const color = running ? UI_COLORS.STATUS_RUNNING : 'var(--nxai-card-sub, #999)';

    return React.createElement('div', { style: sectionStyle },
      React.createElement('div', { style: labelStyle }, 'AI Proxy Server'),
      React.createElement('div', { style: descStyle },
        'OpenAI-compatible proxy backed by Ollama. Enables tool injection and agentic mode for advanced AI clients.',
      ),
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
        React.createElement('span', { style: dotStyle(color) }),
        React.createElement('span', { style: { fontSize: '14px', fontWeight: 500, color: 'var(--nxai-card-text)' } },
          running ? 'Running' : 'Not running',
        ),
        aiProxy?.port
          ? React.createElement('span', { style: { fontSize: '12px', color: 'var(--nxai-card-sub)' } },
              `Port ${aiProxy.port}`,
            )
          : null,
      ),
      aiProxy?.models && aiProxy.models.length > 0
        ? React.createElement('div', { style: { fontSize: '12px', color: 'var(--nxai-card-sub)', marginTop: '6px' } },
            `Models: ${aiProxy.models.slice(0, 5).join(', ')}${aiProxy.models.length > 5 ? ` +${aiProxy.models.length - 5} more` : ''}`,
          )
        : null,
    );
  }

  // WPE Sync methods (Phase 3)
  startWpeSyncProgressPolling = (): void => {
    // Clear any existing interval
    if (this.wpeSyncPollInterval) {
      clearInterval(this.wpeSyncPollInterval);
    }

    // Poll progress every 1 second
    this.wpeSyncPollInterval = setInterval(async () => {
      try {
        const statusResult = await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.WPE_SYNC_STATUS);
        if (statusResult.success && statusResult.progress) {
          this.setState({ wpeSyncProgress: statusResult.progress });

          // Stop polling if sync completed or failed
          if (statusResult.progress.status === 'completed' || statusResult.progress.status === 'failed') {
            if (this.wpeSyncPollInterval) {
              clearInterval(this.wpeSyncPollInterval);
              this.wpeSyncPollInterval = null;
            }
          }
        }
      } catch (error) {
        console.error('[NexusPreferences] Failed to poll WPE sync progress:', error);
      }
    }, 1000);
  };

  stopWpeSyncProgressPolling = (): void => {
    if (this.wpeSyncPollInterval) {
      clearInterval(this.wpeSyncPollInterval);
      this.wpeSyncPollInterval = null;
    }
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
        this.setState({
          wpeSyncedCount: result.synced || 0,
          wpeSyncing: false,
          wpeSyncProgress: null,
          wpeSyncError: null,
        });
      } else {
        const errorMsg = result.error || 'Unknown error occurred during sync';
        this.setState({
          wpeSyncing: false,
          wpeSyncProgress: null,
          wpeSyncError: errorMsg,
        });
        console.error('[NexusPreferences] WPE sync failed:', errorMsg);
      }
    } catch (error) {
      this.stopWpeSyncProgressPolling();
      const errorMsg = error instanceof Error ? error.message : 'Failed to sync WPE sites';
      this.setState({
        wpeSyncing: false,
        wpeSyncProgress: null,
        wpeSyncError: errorMsg,
      });
      console.error('[NexusPreferences] WPE sync error:', error);
    }
  };

  renderWpeSyncSection(): React.ReactNode {
    const { wpeSyncing, wpeSyncedCount, wpeSyncProgress, wpeSyncError } = this.state;

    return React.createElement('div', { style: sectionStyle },
      React.createElement('div', { style: labelStyle }, 'WP Engine Sites'),
      React.createElement('div', { style: descStyle },
        'Sync your WP Engine sites to make them searchable alongside local sites. Indexed content is available in Site Finder.',
      ),

      // Sync button and status
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' } },
        React.createElement('button', {
          onClick: this.handleWpeSync,
          disabled: wpeSyncing,
          style: {
            padding: '8px 16px',
            borderRadius: '6px',
            border: 'none',
            backgroundColor: wpeSyncing ? '#9ca3af' : '#3b82f6',
            color: '#fff',
            fontSize: '13px',
            fontWeight: 600,
            cursor: wpeSyncing ? 'not-allowed' : 'pointer',
            opacity: wpeSyncing ? 0.6 : 1,
          },
        }, wpeSyncing ? 'Syncing...' : 'Sync Now'),

        // Synced count
        wpeSyncedCount > 0 && !wpeSyncing
          ? React.createElement('span', {
              style: {
                fontSize: '13px',
                color: 'var(--nxai-card-sub, #6b7280)',
              },
            }, `${wpeSyncedCount} site${wpeSyncedCount === 1 ? '' : 's'} synced`)
          : null,
      ),

      // Progress indicator
      wpeSyncProgress
        ? React.createElement('div', {
            style: {
              fontSize: '12px',
              color: 'var(--nxai-card-sub, #6b7280)',
              marginTop: '8px',
              fontStyle: 'italic',
            },
          }, `Syncing ${wpeSyncProgress.currentSite}... (${wpeSyncProgress.current}/${wpeSyncProgress.total})`)
        : null,

      // Error display
      wpeSyncError
        ? React.createElement('div', {
            style: {
              padding: '12px',
              marginTop: '12px',
              borderRadius: '6px',
              backgroundColor: '#fee2e2',
              border: '1px solid #fecaca',
            },
          },
            React.createElement('div', {
              style: {
                fontSize: '13px',
                fontWeight: 600,
                color: '#991b1b',
                marginBottom: '4px',
              },
            }, 'Sync Failed'),
            React.createElement('div', {
              style: {
                fontSize: '12px',
                color: 'var(--color-error, #dc2626)',
              },
            }, wpeSyncError),
          )
        : null,
    );
  }

  private formatTimeAgo(timestamp: number): string {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return 'Just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  render(): React.ReactNode {
    const { settings, sites, loading } = this.state;

    if (loading) {
      return React.createElement('div', {
        style: { padding: '24px', color: 'var(--nxai-card-sub, #6b7280)' },
      }, 'Loading preferences...');
    }

    return React.createElement('div', { style: { padding: '24px' } },
      // Auto-index toggle
      React.createElement('div', { style: sectionStyle },
        React.createElement('div', { style: labelStyle }, 'Auto-Index'),
        React.createElement('div', { style: descStyle },
          'When enabled, site content is automatically indexed for AI search when a site starts.',
        ),
        React.createElement('label', { style: checkboxRowStyle },
          React.createElement('input', {
            type: 'checkbox',
            checked: settings.autoIndex,
            onChange: this.handleAutoIndexToggle,
            style: { width: '16px', height: '16px', cursor: 'pointer' },
          }),
          React.createElement('span', {
            style: { fontSize: '14px', color: 'var(--nxai-card-text, #111827)' },
          }, 'Automatically index sites when started'),
        ),
      ),

      // Per-site exclusions (only when auto-index is on)
      settings.autoIndex
        ? React.createElement('div', { style: sectionStyle },
            React.createElement('div', { style: labelStyle }, 'Excluded Sites'),
            React.createElement('div', { style: descStyle },
              'Checked sites will not be auto-indexed when started. You can still manually index them.',
            ),
            sites.length === 0
              ? React.createElement('div', { style: descStyle }, 'No sites found.')
              : sites.map((site) =>
                  React.createElement('label', {
                    key: site.id,
                    style: checkboxRowStyle,
                  },
                    React.createElement('input', {
                      type: 'checkbox',
                      checked: settings.excludedSiteIds.includes(site.id),
                      onChange: () => this.handleSiteExclusionToggle(site.id),
                      style: { width: '16px', height: '16px', cursor: 'pointer' },
                    }),
                    React.createElement('span', {
                      style: { fontSize: '13px', color: 'var(--nxai-card-text, #111827)' },
                    }, site.name),
                    React.createElement('span', {
                      style: {
                        fontSize: '11px',
                        color: site.status === 'running' ? UI_COLORS.STATUS_RUNNING : 'var(--nxai-card-sub)',
                        marginLeft: '4px',
                      },
                    }, `(${site.status})`),
                  ),
                ),
          )
        : null,

      // Divider
      React.createElement('hr', {
        style: {
          border: 'none',
          borderTop: '1px solid var(--nxai-card-border, #e5e7eb)',
          marginBottom: '24px',
        },
      }),

      // AI Chat section
      this.renderChatSection(),

      // Divider
      React.createElement('hr', {
        style: {
          border: 'none',
          borderTop: '1px solid var(--nxai-card-border, #e5e7eb)',
          marginBottom: '24px',
        },
      }),

      // Credential sync section (Sprint 4)
      this.renderCredentialSyncSection(),

      // Divider
      React.createElement('hr', {
        style: {
          border: 'none',
          borderTop: '1px solid var(--nxai-card-border, #e5e7eb)',
          marginBottom: '24px',
        },
      }),

      // AI Proxy section (Sprint 4)
      this.renderAiProxySection(),

      // Divider
      React.createElement('hr', {
        style: {
          border: 'none',
          borderTop: '1px solid var(--nxai-card-border, #e5e7eb)',
          marginBottom: '24px',
        },
      }),

      // WPE Sync section (Phase 3)
      this.renderWpeSyncSection(),
    );
  }
}
