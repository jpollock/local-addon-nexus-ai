/**
 * ConnectionsSection — grouped by what each thing gets you.
 *
 * Three groups per README.md §5:
 * - Where your sites are (WP Engine, Other hosts)
 * - How Nexus answers you (AI provider, with Local AI Gateway nested underneath)
 * - What else Nexus can do (Google, WPE API key, S3)
 */
import * as React from 'react';
import { IPC_CHANNELS, UI_COLORS } from '../../../common/constants';
import type { AIProvider, NexusSettings } from '../../../common/types';

interface WpeAccount { id: string; name: string; nickname?: string; }
interface ExternalHost { alias: string; site: string; environment: string; domain: string; }

interface ConnectionsProps {
  settings: NexusSettings;
  wpeAccounts: WpeAccount[];
  externalHosts: ExternalHost[];
  onSave: (patch: Partial<NexusSettings>) => void;
  electron: any;
}

interface ConnectionsState {
  providers: Array<{ id: string; name: string }>;
  models: string[];
  loadingModels: boolean;
  keyInput: string;
  keyIsSet: boolean;
  keySaved: boolean;
  keyStatus: Record<string, 'valid' | 'invalid' | 'unchecked'>;
  // WPE API credentials
  wpeCredentialsConfigured: boolean;
  wpeUsernameInput: string;
  wpePasswordInput: string;
  wpePendingClear: boolean;
  wpeCredsSaved: boolean;
  // AWS S3 credentials
  awsConnected: boolean;
  awsRevoked: boolean;
  awsLabel: string;
  awsConnectionId: string;
  awsKeyIdInput: string;
  awsSecretInput: string;
  awsSecretVisible: boolean;
  awsSaving: boolean;
  awsError: string;
  awsSaved: boolean;
  awsShowReenter: boolean;
}

export class ConnectionsSection extends React.Component<ConnectionsProps, ConnectionsState> {
  private mounted = false;

  state: ConnectionsState = {
    providers: [],
    models: [],
    loadingModels: false,
    keyInput: '',
    keyIsSet: false,
    keySaved: false,
    keyStatus: {},
    wpeCredentialsConfigured: false,
    wpeUsernameInput: '',
    wpePasswordInput: '',
    wpePendingClear: false,
    wpeCredsSaved: false,
    awsConnected: false,
    awsRevoked: false,
    awsLabel: '',
    awsConnectionId: '',
    awsKeyIdInput: '',
    awsSecretInput: '',
    awsSecretVisible: false,
    awsSaving: false,
    awsError: '',
    awsSaved: false,
    awsShowReenter: false,
  };

  componentDidMount(): void {
    this.mounted = true;
    this.loadConnectionStates();
  }

  componentWillUnmount(): void {
    this.mounted = false;
  }

  async loadConnectionStates(): Promise<void> {
    const ipc = this.props.electron.ipcRenderer;

    // Load providers and models for current provider
    const providers = await ipc.invoke(IPC_CHANNELS.GET_PROVIDERS).catch(() => []);
    if (!this.mounted) return;
    this.setState({ providers });

    // Load models for current provider
    const providerId = this.props.settings.aiProvider;
    if (providerId) {
      this.fetchModels(providerId);
      this.loadStoredKey(providerId);
    }

    // Load WPE API credentials status
    const wpeCredsStatus = await ipc.invoke(IPC_CHANNELS.WPE_GET_API_CREDENTIALS_STATUS).catch(() => null);
    if (!this.mounted) return;

    // Load AWS credentials status
    const awsStatus = await ipc.invoke(IPC_CHANNELS.CREDENTIAL_API_KEY_STATUS, { provider: 'aws' }).catch(() => null);

    this.setState({
      wpeCredentialsConfigured: wpeCredsStatus?.configured ?? false,
      awsConnected: awsStatus?.status === 'active',
      awsRevoked: awsStatus?.status === 'revoked',
      awsLabel: awsStatus?.label ?? '',
      awsConnectionId: awsStatus?.connectionId ?? '',
    });
  }

  async fetchModels(providerId: AIProvider): Promise<void> {
    this.setState({ loadingModels: true });
    try {
      const models = await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.GET_MODELS, providerId);
      if (!this.mounted) return;
      this.setState({ models: models ?? [], loadingModels: false });
    } catch {
      if (this.mounted) this.setState({ models: [], loadingModels: false });
    }
  }

  async loadStoredKey(providerId: AIProvider): Promise<void> {
    try {
      const result = await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.GET_API_KEY, providerId);
      if (!this.mounted) return;
      if (result.maskedKey) {
        this.setState({ keyInput: result.maskedKey, keySaved: true, keyIsSet: true });
      } else {
        this.setState({ keyInput: '', keySaved: false, keyIsSet: false });
      }
    } catch {
      if (this.mounted) this.setState({ keyInput: '', keySaved: false, keyIsSet: false });
    }
  }

  handleProviderChange = (e: React.ChangeEvent<HTMLSelectElement>): void => {
    const providerId = e.target.value as AIProvider;
    this.props.onSave({ aiProvider: providerId, aiModel: '' as any });
    this.setState({ models: [], keyInput: '', keySaved: false, keyIsSet: false }, () => {
      this.fetchModels(providerId);
      if (providerId) this.loadStoredKey(providerId);
    });
  };

  handleModelChange = (e: React.ChangeEvent<HTMLSelectElement>): void => {
    this.props.onSave({ aiModel: e.target.value });
  };

  handleKeyInputChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    this.setState({ keyInput: e.target.value, keySaved: false, keyIsSet: false });
  };

  handleSaveKey = async (): Promise<void> => {
    const { keyInput, keyIsSet } = this.state;
    const providerId = this.props.settings.aiProvider;
    if (!providerId || !keyInput.trim() || keyIsSet) return;

    await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.SAVE_API_KEY, providerId, keyInput.trim());
    if (!this.mounted) return;

    this.setState((prev) => ({
      keyStatus: { ...prev.keyStatus, [providerId]: 'unchecked' },
      keySaved: true,
      keyIsSet: true,
    }));
  };

  // WPE API credentials handlers
  handleWpeUsernameChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    this.setState({ wpeUsernameInput: e.target.value, wpeCredsSaved: false, wpePendingClear: false });
  };

  handleWpePasswordChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    this.setState({ wpePasswordInput: e.target.value, wpeCredsSaved: false, wpePendingClear: false });
  };

  handleWpeClearCredentials = (): void => {
    this.setState({
      wpeUsernameInput: '',
      wpePasswordInput: '',
      wpePendingClear: true,
      wpeCredsSaved: false,
    });
  };

  handleWpeApplyCredentials = async (): Promise<void> => {
    const { wpeUsernameInput, wpePasswordInput, wpePendingClear } = this.state;

    try {
      if (wpePendingClear) {
        await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.WPE_CLEAR_API_CREDENTIALS);
        if (!this.mounted) return;
        this.setState({
          wpeCredentialsConfigured: false,
          wpeUsernameInput: '',
          wpePasswordInput: '',
          wpePendingClear: false,
          wpeCredsSaved: true,
        });
      } else if (wpeUsernameInput.trim() && wpePasswordInput.trim()) {
        await this.props.electron.ipcRenderer.invoke(
          IPC_CHANNELS.WPE_SET_API_CREDENTIALS,
          wpeUsernameInput.trim(),
          wpePasswordInput.trim(),
        );
        if (!this.mounted) return;
        this.setState({
          wpeCredentialsConfigured: true,
          wpeCredsSaved: true,
        });
      }
    } catch {
      if (this.mounted) this.setState({ wpeCredsSaved: false });
    }
  };

  // AWS S3 credentials handlers
  handleAwsKeyIdChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    this.setState({ awsKeyIdInput: e.target.value, awsError: '', awsSaved: false });
  };

  handleAwsSecretChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    this.setState({ awsSecretInput: e.target.value, awsError: '', awsSaved: false });
  };

  handleAwsToggleSecret = (): void => {
    this.setState(s => ({ awsSecretVisible: !s.awsSecretVisible }));
  };

  handleAwsSave = async (): Promise<void> => {
    const { awsKeyIdInput, awsSecretInput } = this.state;
    if (!awsKeyIdInput.trim() || !awsSecretInput.trim()) return;
    this.setState({ awsSaving: true, awsError: '' });
    try {
      const result = await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.CREDENTIAL_API_KEY_SET, {
        provider: 'aws',
        fields: { accessKeyId: awsKeyIdInput.trim(), secretAccessKey: awsSecretInput.trim() },
      }) as { ok: boolean; connectionId?: string; label?: string; error?: string; code?: string };

      if (result.ok) {
        this.setState({
          awsSaving: false, awsSaved: true, awsConnected: true, awsRevoked: false,
          awsConnectionId: result.connectionId!, awsLabel: result.label!,
          awsKeyIdInput: '', awsSecretInput: '', awsShowReenter: false,
        });
      } else {
        const errorMap: Record<string, string> = {
          InvalidAccessKeyId: 'Access Key ID not recognised — check it was copied correctly.',
          SignatureDoesNotMatch: 'Secret Access Key is incorrect — re-copy from AWS.',
          NetworkError: 'Could not reach AWS — check your internet connection.',
        };
        this.setState({
          awsSaving: false,
          awsError: errorMap[result.code!] ?? result.error ?? 'Validation failed.',
        });
      }
    } catch {
      this.setState({ awsSaving: false, awsError: 'An unexpected error occurred.' });
    }
  };

  handleAwsDisconnect = async (): Promise<void> => {
    const { awsConnectionId } = this.state;
    if (!awsConnectionId) return;
    try {
      await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.CREDENTIAL_API_KEY_CLEAR, { connectionId: awsConnectionId });
      this.setState({
        awsConnected: false, awsRevoked: false, awsLabel: '', awsConnectionId: '',
        awsSaved: false, awsError: '', awsShowReenter: false,
      });
    } catch {
      this.setState({ awsError: 'Failed to disconnect — try again.' });
    }
  };

  renderGroupHeading(text: string): React.ReactElement {
    return React.createElement('div', {
      style: {
        fontSize: 14,
        fontWeight: 700,
        color: 'var(--nxai-card-text)',
        marginTop: 24,
        marginBottom: 12,
      },
    }, text);
  }

  renderWhereSitesAre(): React.ReactElement {
    const { wpeAccounts, externalHosts } = this.props;
    const wpeCount = wpeAccounts.length;
    const extCount = externalHosts.length;

    return React.createElement('div', null,
      this.renderGroupHeading('Where your sites are'),

      // WP Engine
      React.createElement('div', {
        style: {
          padding: 16,
          background: 'var(--nxai-card-bg)',
          border: '1px solid var(--nxai-card-border)',
          borderRadius: 6,
          marginBottom: 8,
        },
      },
        React.createElement('div', {
          style: {
            fontSize: 14,
            fontWeight: 600,
            color: 'var(--nxai-card-text)',
            marginBottom: 4,
          },
        }, 'WP Engine'),
        React.createElement('div', {
          style: {
            fontSize: 12,
            color: 'var(--nxai-card-sub)',
          },
        }, wpeCount > 0
          ? `${wpeCount} ${wpeCount === 1 ? 'account' : 'accounts'} connected`
          : 'No accounts connected yet'),
      ),

      // Other hosts (External SSH)
      React.createElement('div', {
        style: {
          padding: 16,
          background: 'var(--nxai-card-bg)',
          border: '1px solid var(--nxai-card-border)',
          borderRadius: 6,
          marginBottom: 8,
        },
      },
        React.createElement('div', {
          style: {
            fontSize: 14,
            fontWeight: 600,
            color: 'var(--nxai-card-text)',
            marginBottom: 4,
          },
        }, 'Other hosts'),
        React.createElement('div', {
          style: {
            fontSize: 12,
            color: 'var(--nxai-card-sub)',
          },
        }, extCount > 0
          ? `${extCount} ${extCount === 1 ? 'host' : 'hosts'} registered`
          : 'No external hosts registered yet'),
      ),
    );
  }

  renderProviderAndGateway(): React.ReactElement {
    const { settings } = this.props;
    const { providers, models, loadingModels, keyInput, keySaved, keyIsSet } = this.state;
    const providerId = settings.aiProvider;

    return React.createElement('div', null,
      this.renderGroupHeading('How Nexus answers you'),

      // Provider and model selects
      React.createElement('div', {
        style: {
          padding: 16,
          background: 'var(--nxai-card-bg)',
          border: '1px solid var(--nxai-card-border)',
          borderRadius: 6,
          marginBottom: 8,
        },
      },
        React.createElement('div', {
          style: {
            fontSize: 14,
            fontWeight: 600,
            color: 'var(--nxai-card-text)',
            marginBottom: 12,
          },
        }, 'AI Provider'),

        // Provider select
        React.createElement('div', { style: { marginBottom: 12 } },
          React.createElement('select', {
            value: providerId ?? '',
            onChange: this.handleProviderChange,
            style: {
              padding: '6px 10px',
              fontSize: 13,
              background: 'var(--nxai-input-bg)',
              border: '1px solid var(--nxai-input-border)',
              borderRadius: 4,
              color: 'var(--nxai-card-text)',
              width: '100%',
              maxWidth: 300,
            },
          },
            React.createElement('option', { value: '', disabled: true }, 'Select provider...'),
            ...providers.map((p: any) =>
              React.createElement('option', { key: p.id, value: p.id }, p.name)),
          ),
        ),

        // Model select
        providerId ? React.createElement('div', { style: { marginBottom: 12 } },
          loadingModels
            ? React.createElement('span', {
              style: { fontSize: 13, color: 'var(--nxai-card-sub)' },
            }, 'Loading models...')
            : React.createElement('select', {
              value: settings.aiModel ?? '',
              onChange: this.handleModelChange,
              disabled: models.length === 0,
              style: {
                padding: '6px 10px',
                fontSize: 13,
                background: 'var(--nxai-input-bg)',
                border: '1px solid var(--nxai-input-border)',
                borderRadius: 4,
                color: 'var(--nxai-card-text)',
                width: '100%',
                maxWidth: 300,
              },
            },
              React.createElement('option', { value: '', disabled: true }, 'Select model...'),
              ...models.map((m) =>
                React.createElement('option', { key: m, value: m }, m)),
            ),
        ) : null,

        // API key input
        providerId ? React.createElement('div', { style: { marginBottom: 12 } },
          React.createElement('input', {
            type: keyIsSet ? 'text' : 'password',
            value: keyInput,
            onChange: this.handleKeyInputChange,
            placeholder: 'API key',
            style: {
              padding: '6px 10px',
              fontSize: 13,
              background: 'var(--nxai-input-bg)',
              border: '1px solid var(--nxai-input-border)',
              borderRadius: 4,
              color: 'var(--nxai-card-text)',
              width: '100%',
              maxWidth: 300,
              fontFamily: 'monospace',
            },
          }),
        ) : null,

        // Save key button
        providerId ? React.createElement('button', {
          onClick: this.handleSaveKey,
          disabled: !keyInput.trim() || keyIsSet,
          style: {
            padding: '6px 12px',
            fontSize: 13,
            borderRadius: 4,
            background: (!keyInput.trim() || keyIsSet) ? 'var(--nxai-card-bg)' : 'var(--nxai-accent)',
            border: '1px solid var(--nxai-input-border)',
            color: (!keyInput.trim() || keyIsSet) ? 'var(--nxai-card-text)' : 'var(--nxai-accent-text)',
            cursor: (!keyInput.trim() || keyIsSet) ? 'default' : 'pointer',
          },
        }, keySaved ? 'Saved' : 'Save key') : null,
      ),

      // Local AI Gateway (nested under provider)
      React.createElement('div', {
        style: {
          marginLeft: 28,
          padding: 16,
          background: 'var(--nxai-section-bg)',
          border: '1px solid var(--nxai-card-border)',
          borderRadius: 6,
          marginBottom: 8,
        },
      },
        React.createElement('label', {
          style: {
            display: 'flex',
            alignItems: 'center',
            cursor: 'pointer',
          },
        },
          React.createElement('input', {
            type: 'checkbox',
            checked: settings.useLocalGateway ?? false,
            onChange: (e: any) => this.props.onSave({ useLocalGateway: e.target.checked }),
            style: { marginRight: 10 },
          }),
          React.createElement('span', {
            style: {
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--nxai-card-text)',
            },
          }, 'Let WordPress sites use it too'),
        ),
      ),
    );
  }

  renderWhatElse(): React.ReactElement {
    const {
      wpeCredentialsConfigured, wpeUsernameInput, wpePasswordInput, wpePendingClear, wpeCredsSaved,
      awsConnected, awsRevoked, awsLabel, awsKeyIdInput, awsSecretInput, awsSecretVisible,
      awsSaving, awsError, awsSaved, awsShowReenter,
    } = this.state;

    const hasWpeChanges = wpePendingClear ||
      (wpeUsernameInput.trim() !== '' && wpePasswordInput.trim() !== '');

    const wpeStatusColor = wpeCredentialsConfigured ? UI_COLORS.STATUS_RUNNING : 'var(--nxai-status-neutral)';
    const wpeStatusLabel = wpeCredentialsConfigured ? 'Configured' : 'Not configured';

    const awsStatusColor = awsConnected
      ? UI_COLORS.STATUS_RUNNING
      : awsRevoked ? 'var(--nxai-danger-text)' : 'var(--nxai-status-neutral)';
    const awsStatusLabel = awsConnected ? 'Connected' : awsRevoked ? 'Keys no longer valid' : 'Not connected';

    const showAwsForm = (!awsConnected && !awsRevoked) || awsShowReenter;

    return React.createElement('div', null,
      this.renderGroupHeading('What else Nexus can do'),

      // Backups (WPE API credentials)
      React.createElement('div', {
        style: {
          padding: 16,
          background: 'var(--nxai-card-bg)',
          border: '1px solid var(--nxai-card-border)',
          borderRadius: 6,
          marginBottom: 12,
        },
      },
        React.createElement('div', {
          style: {
            fontSize: 14,
            fontWeight: 600,
            color: 'var(--nxai-card-text)',
            marginBottom: 4,
          },
        }, 'Backups'),
        React.createElement('div', {
          style: {
            fontSize: 12,
            color: 'var(--nxai-card-sub)',
            marginBottom: 12,
          },
        }, 'WP Engine API credentials for backup creation'),

        // Status
        React.createElement('div', {
          style: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 },
        },
          React.createElement('span', {
            style: {
              display: 'inline-block',
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: wpeStatusColor,
            },
          }),
          React.createElement('span', {
            style: { fontSize: 13, color: wpeStatusColor, fontWeight: 500 },
          }, wpeStatusLabel),
        ),

        // Form
        React.createElement('div', { style: { marginBottom: 8 } },
          React.createElement('input', {
            type: 'text',
            value: wpeUsernameInput,
            onChange: this.handleWpeUsernameChange,
            placeholder: 'API username',
            style: {
              padding: '6px 10px',
              fontSize: 13,
              background: 'var(--nxai-input-bg)',
              border: '1px solid var(--nxai-input-border)',
              borderRadius: 4,
              color: 'var(--nxai-card-text)',
              width: '100%',
              maxWidth: 300,
              marginBottom: 8,
            },
          }),
        ),
        React.createElement('div', { style: { marginBottom: 12 } },
          React.createElement('input', {
            type: 'password',
            value: wpePasswordInput,
            onChange: this.handleWpePasswordChange,
            placeholder: 'API password',
            style: {
              padding: '6px 10px',
              fontSize: 13,
              background: 'var(--nxai-input-bg)',
              border: '1px solid var(--nxai-input-border)',
              borderRadius: 4,
              color: 'var(--nxai-card-text)',
              width: '100%',
              maxWidth: 300,
            },
          }),
        ),

        // Buttons
        React.createElement('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
          React.createElement('button', {
            onClick: this.handleWpeApplyCredentials,
            disabled: !hasWpeChanges || wpeCredsSaved,
            style: {
              padding: '6px 12px',
              fontSize: 13,
              borderRadius: 4,
              background: (hasWpeChanges && !wpeCredsSaved) ? 'var(--nxai-accent)' : 'var(--nxai-card-bg)',
              border: '1px solid var(--nxai-input-border)',
              color: (hasWpeChanges && !wpeCredsSaved) ? 'var(--nxai-accent-text)' : 'var(--nxai-card-text)',
              cursor: (hasWpeChanges && !wpeCredsSaved) ? 'pointer' : 'default',
            },
          }, wpeCredsSaved ? 'Saved' : 'Apply'),
          React.createElement('button', {
            onClick: this.handleWpeClearCredentials,
            disabled: !wpeCredentialsConfigured && wpeUsernameInput === '' && wpePasswordInput === '',
            style: {
              padding: '6px 12px',
              fontSize: 13,
              borderRadius: 4,
              background: 'var(--nxai-card-bg)',
              border: '1px solid var(--nxai-input-border)',
              color: 'var(--nxai-card-text)',
            },
          }, 'Clear'),
        ),
      ),

      // Reading access logs (AWS S3)
      React.createElement('div', {
        style: {
          padding: 16,
          background: 'var(--nxai-card-bg)',
          border: '1px solid var(--nxai-card-border)',
          borderRadius: 6,
          marginBottom: 12,
        },
      },
        React.createElement('div', {
          style: {
            fontSize: 14,
            fontWeight: 600,
            color: 'var(--nxai-card-text)',
            marginBottom: 4,
          },
        }, 'Reading access logs'),
        React.createElement('div', {
          style: {
            fontSize: 12,
            color: 'var(--nxai-card-sub)',
            marginBottom: 12,
          },
        }, 'Read-only AWS access for your WP Engine log bucket'),

        // Status
        React.createElement('div', {
          style: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 },
        },
          React.createElement('span', {
            style: {
              display: 'inline-block',
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: awsStatusColor,
            },
          }),
          React.createElement('span', {
            style: { fontSize: 13, color: awsStatusColor, fontWeight: 500 },
          }, awsStatusLabel),
          awsConnected && awsLabel ? React.createElement('span', {
            style: { fontSize: 12, opacity: 0.6, marginLeft: 4, fontFamily: 'monospace' },
          }, awsLabel) : null,
        ),

        // Revoked warning
        awsRevoked && !awsShowReenter
          ? React.createElement('div', {
            style: { fontSize: 12, color: 'var(--nxai-danger-text)', marginBottom: 12, lineHeight: 1.4 },
          }, 'AWS returned an authorization error during the last log sync. Your keys may have been rotated or deleted. Re-enter credentials to reconnect.')
          : null,

        // Form
        showAwsForm ? React.createElement('div', null,
          React.createElement('div', { style: { marginBottom: 8 } },
            React.createElement('input', {
              type: 'text',
              value: awsKeyIdInput,
              onChange: this.handleAwsKeyIdChange,
              placeholder: 'AKIA…',
              style: {
                padding: '6px 10px',
                fontSize: 13,
                background: 'var(--nxai-input-bg)',
                border: '1px solid var(--nxai-input-border)',
                borderRadius: 4,
                color: 'var(--nxai-card-text)',
                width: '100%',
                maxWidth: 300,
                fontFamily: 'monospace',
              },
            }),
          ),
          React.createElement('div', { style: { display: 'flex', gap: 6, marginBottom: 8 } },
            React.createElement('input', {
              type: awsSecretVisible ? 'text' : 'password',
              value: awsSecretInput,
              onChange: this.handleAwsSecretChange,
              placeholder: '••••••••',
              style: {
                padding: '6px 10px',
                fontSize: 13,
                background: 'var(--nxai-input-bg)',
                border: '1px solid var(--nxai-input-border)',
                borderRadius: 4,
                color: 'var(--nxai-card-text)',
                flex: 1,
                maxWidth: 250,
                fontFamily: 'monospace',
              },
            }),
            React.createElement('button', {
              onClick: this.handleAwsToggleSecret,
              style: {
                padding: '6px 12px',
                fontSize: 13,
                borderRadius: 4,
                background: 'var(--nxai-card-bg)',
                border: '1px solid var(--nxai-input-border)',
                color: 'var(--nxai-card-text)',
              },
            }, awsSecretVisible ? 'Hide' : 'Show'),
          ),
          awsError ? React.createElement('div', {
            style: { fontSize: 12, color: 'var(--nxai-danger-text)', marginBottom: 8 },
          }, awsError) : null,
          React.createElement('div', { style: { display: 'flex', gap: 8, marginBottom: 12 } },
            React.createElement('button', {
              onClick: this.handleAwsSave,
              disabled: !awsKeyIdInput.trim() || !awsSecretInput.trim() || awsSaving || awsSaved,
              style: {
                padding: '6px 12px',
                fontSize: 13,
                borderRadius: 4,
                background: (awsKeyIdInput.trim() && awsSecretInput.trim() && !awsSaved)
                  ? 'var(--nxai-accent)' : 'var(--nxai-card-bg)',
                border: '1px solid var(--nxai-input-border)',
                color: (awsKeyIdInput.trim() && awsSecretInput.trim() && !awsSaved)
                  ? 'var(--nxai-accent-text)' : 'var(--nxai-card-text)',
                cursor: (awsKeyIdInput.trim() && awsSecretInput.trim() && !awsSaved) ? 'pointer' : 'default',
              },
            }, awsSaving ? 'Checking…' : awsSaved ? 'Connected' : 'Save'),
            awsShowReenter ? React.createElement('button', {
              onClick: () => this.setState({ awsShowReenter: false, awsKeyIdInput: '', awsSecretInput: '', awsError: '' }),
              style: {
                padding: '6px 12px',
                fontSize: 13,
                borderRadius: 4,
                background: 'var(--nxai-card-bg)',
                border: '1px solid var(--nxai-input-border)',
                color: 'var(--nxai-card-text)',
              },
            }, 'Cancel') : null,
          ),
        ) : null,

        // Connected state actions
        awsConnected && !awsShowReenter
          ? React.createElement('div', { style: { display: 'flex', gap: 8, marginBottom: 12 } },
            React.createElement('button', {
              onClick: () => this.setState({ awsShowReenter: true }),
              style: {
                padding: '6px 12px',
                fontSize: 13,
                borderRadius: 4,
                background: 'var(--nxai-card-bg)',
                border: '1px solid var(--nxai-input-border)',
                color: 'var(--nxai-card-text)',
              },
            }, 'Re-enter credentials'),
            React.createElement('button', {
              onClick: this.handleAwsDisconnect,
              style: {
                padding: '6px 12px',
                fontSize: 13,
                borderRadius: 4,
                background: 'var(--nxai-card-bg)',
                border: '1px solid var(--nxai-input-border)',
                color: 'var(--nxai-card-text)',
              },
            }, 'Disconnect'),
          ) : null,

        awsRevoked && !awsShowReenter
          ? React.createElement('button', {
            onClick: () => this.setState({ awsShowReenter: true, awsError: '' }),
            style: {
              padding: '6px 12px',
              fontSize: 13,
              borderRadius: 4,
              background: 'var(--nxai-card-bg)',
              border: '1px solid var(--nxai-input-border)',
              color: 'var(--nxai-card-text)',
              marginBottom: 12,
            },
          }, 'Re-enter credentials') : null,
      ),
    );
  }

  render(): React.ReactElement {
    return React.createElement('div', null,
      this.renderWhereSitesAre(),
      this.renderProviderAndGateway(),
      this.renderWhatElse(),
    );
  }
}
