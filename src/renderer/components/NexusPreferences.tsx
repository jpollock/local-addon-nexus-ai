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
import type { NexusSettings } from '../../common/types';

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
      const [settings, sites, providers, keyStatus] = await Promise.all([
        ipc.invoke(IPC_CHANNELS.GET_SETTINGS),
        ipc.invoke(IPC_CHANNELS.GET_SITES),
        ipc.invoke(IPC_CHANNELS.GET_PROVIDERS),
        ipc.invoke(IPC_CHANNELS.GET_API_KEY_STATUS),
      ]);
      if (!this.mounted) return;
      this.setState({
        settings: settings ?? { autoIndex: true, excludedSiteIds: [] },
        sites: sites ?? [],
        providers: providers ?? [],
        keyStatus: keyStatus ?? {},
        loading: false,
      }, () => {
        // Load models for the current provider
        if (this.state.settings.chatProvider) {
          this.fetchModels(this.state.settings.chatProvider);
        }
      });
    } catch {
      if (!this.mounted) return;
      this.setState({ loading: false });
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
    const providerId = e.target.value;
    this.setState(
      (prev) => ({
        settings: { ...prev.settings, chatProvider: providerId, chatModel: '' },
        models: [],
        keyInput: '',
        saved: false,
      }),
      () => {
        this.saveSettings();
        this.fetchModels(providerId);
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

    // Auto-trigger validation after save
    this.handleValidateKey();
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
            style: btnSmallStyle,
            onClick: this.handleSaveKey,
            disabled: !keyInput.trim(),
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
          keySaved && currentStatus !== 'checking'
            ? React.createElement('span', {
                style: { fontSize: '12px', color: UI_COLORS.STATUS_RUNNING, marginLeft: '8px' },
              }, 'Saved')
            : null,
        ),
      ) : null,
    );
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
    );
  }
}
