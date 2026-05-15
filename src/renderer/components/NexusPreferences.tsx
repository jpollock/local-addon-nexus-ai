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
import type { AIProvider, NexusSettings } from '../../common/types';

interface NexusPreferencesProps {
  electron: any;
  /** Called whenever settings change — triggers Apply button activation */
  onSettingsChange?: (settings: NexusSettings) => void;
  /** Passed by Local's withMenuLayout (forwarded via sections props) */
  setApplyButtonDisabled?: (disabled: boolean) => void;
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


interface WpeAccount {
  id: string;
  name: string;
  nickname?: string;
}

interface NexusPreferencesState {
  settings: NexusSettings;
  sites: SiteListItem[];
  wpeAccounts: WpeAccount[];
  wpeInstalls: Array<{ installName: string; environment: string; primaryDomain: string }>;
  installSearch: string;
  loading: boolean;
  saved: boolean;
  // Chat provider state
  providers: ProviderInfo[];
  models: string[];
  loadingModels: boolean;
  keyStatus: Record<string, 'valid' | 'invalid' | 'unchecked' | 'checking'>;
  keyInput: string;
  keySaved: boolean;
  keyIsSet: boolean;  // Whether a key is already stored (received as masked value)
  // WPE API Credentials state
  wpeCredentialsConfigured: boolean;
  wpeUsername: string;
  wpePassword: string;
  wpeUsernameInput: string;
  wpePasswordInput: string;
  wpePendingClear: boolean;
  wpeCredsSaved: boolean;
  // Section expand/collapse state (Item 6)
  expandedSections: Set<string>;
  expandedOps: Set<string>;
  acctScopeExpanded: boolean;
  addingException: { op: string; installName: string; environment: string; allowing: boolean } | null;
}

const labelStyle: React.CSSProperties = {
  fontSize: '14px',
  fontWeight: 600,
  marginBottom: '6px',
};

const descStyle: React.CSSProperties = {
  fontSize: '13px',
  marginBottom: '16px',
  lineHeight: 1.5,
  opacity: 0.7,
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
  border: '1px solid rgba(128, 128, 128, 0.3)',
  outline: 'none',
  minWidth: '200px',
  cursor: 'pointer',
};

const inputStyle: React.CSSProperties = {
  padding: '8px 12px',
  fontSize: '14px',
  lineHeight: '1.5',
  borderRadius: '6px',
  border: '1px solid rgba(128, 128, 128, 0.3)',
  outline: 'none',
  width: '350px',
  maxWidth: '100%',
  fontFamily: 'monospace',
  boxSizing: 'border-box',
};

const btnSmallStyle: React.CSSProperties = {
  padding: '6px 12px',
  borderRadius: '6px',
  border: '1px solid',
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

const WPE_OPERATION_DEFAULTS = {
  pull:   { development: true,  staging: true,  production: true  },
  wpcli:  { development: true,  staging: true,  production: false },
  push:   { development: true,  staging: true,  production: false },
  delete: { development: false, staging: false, production: false },
} as const;

type WpeOperation = keyof typeof WPE_OPERATION_DEFAULTS;
type WpeEnv = 'development' | 'staging' | 'production';

export class NexusPreferences extends React.Component<NexusPreferencesProps, NexusPreferencesState> {
  private mounted = false;

  state: NexusPreferencesState = {
    settings: { autoIndex: true, excludedSiteIds: [] },
    sites: [],
    wpeAccounts: [],
    wpeInstalls: [],
    installSearch: '',
    loading: true,
    saved: false,
    providers: [],
    models: [],
    loadingModels: false,
    keyStatus: {},
    keyInput: '',
    keySaved: false,
    keyIsSet: false,
    wpeCredentialsConfigured: false,
    wpeUsername: '',
    wpePassword: '',
    wpeUsernameInput: '',
    wpePasswordInput: '',
    wpePendingClear: false,
    wpeCredsSaved: false,
    expandedSections: new Set(['ai-provider']),
    expandedOps: new Set<string>(),
    acctScopeExpanded: false,
    addingException: null,
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
      const [settings, sites, providers, keyStatus, wpeCredsStatus, wpeAccounts, wpeInstalls] = await Promise.all([
        ipc.invoke(IPC_CHANNELS.GET_SETTINGS),
        ipc.invoke(IPC_CHANNELS.GET_SITES),
        ipc.invoke(IPC_CHANNELS.GET_PROVIDERS),
        ipc.invoke(IPC_CHANNELS.GET_API_KEY_STATUS),
        ipc.invoke(IPC_CHANNELS.WPE_GET_API_CREDENTIALS_STATUS),
        ipc.invoke(IPC_CHANNELS.GET_WPE_ACCOUNTS).catch(() => []),
        ipc.invoke(IPC_CHANNELS.GET_WPE_INSTALLS_CACHE).catch(() => []),
      ]);
      if (!this.mounted) return;
      this.setState({
        settings: settings ?? { autoIndex: true, excludedSiteIds: [] },
        sites: sites ?? [],
        wpeAccounts: Array.isArray(wpeAccounts) ? wpeAccounts : [],
        wpeInstalls: Array.isArray(wpeInstalls) ? wpeInstalls : [],
        providers: providers ?? [],
        keyStatus: keyStatus ?? {},
        wpeCredentialsConfigured: wpeCredsStatus?.configured ?? false,
        wpeUsername: wpeCredsStatus?.username ?? '',
        wpeUsernameInput: wpeCredsStatus?.username ?? '',
        loading: false,
      }, () => {
        // Load models and stored key for the current provider
        if (this.state.settings.aiProvider) {
          this.fetchModels(this.state.settings.aiProvider);
          this.loadStoredKey(this.state.settings.aiProvider);
        }
      });
    } catch {
      if (!this.mounted) return;
      this.setState({ loading: false });
    }
  };

  loadStoredKey = async (providerId: string): Promise<void> => {
    try {
      // GET_API_KEY now returns { maskedKey: string | null, isSet: boolean }
      // The full key is never sent to the renderer — only a masked preview.
      const result = await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.GET_API_KEY, providerId);
      if (!this.mounted) return;
      if (result?.isSet && result.maskedKey) {
        // Show the masked key in the input as a placeholder; mark as saved
        this.setState({ keyInput: result.maskedKey, keySaved: true, keyIsSet: true });
      } else {
        this.setState({ keyInput: '', keySaved: false, keyIsSet: false });
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
      // Auto-select the first model if none is currently chosen
      if (models?.length && !this.state.settings.aiModel) {
        this.setState((prev) => {
          const next = { ...prev.settings, aiModel: models[0] };
          this.notifyChange(next);
          return { models, loadingModels: false, settings: next };
        });
      } else {
        this.setState({ models: models ?? [], loadingModels: false });
      }
    } catch {
      if (!this.mounted) return;
      this.setState({ models: [], loadingModels: false });
    }
  };

  notifyChange = (settings: NexusSettings): void => {
    this.props.onSettingsChange?.(settings);
  };

  handleGatewayToggle = (): void => {
    this.setState((prev) => {
      const next = { ...prev.settings, useLocalGateway: !(prev.settings as any).useLocalGateway };
      this.notifyChange(next);
      return { settings: next };
    });
  };

  handleAutoIndexToggle = (): void => {
    this.setState((prev) => {
      const next = { ...prev.settings, autoIndex: !prev.settings.autoIndex };
      this.notifyChange(next);
      return { settings: next };
    });
  };

  handleSiteExclusionToggle = (siteId: string): void => {
    this.setState((prev) => {
      const excluded = prev.settings.excludedSiteIds;
      const isExcluded = excluded.includes(siteId);
      const next = {
        ...prev.settings,
        excludedSiteIds: isExcluded
          ? excluded.filter((id) => id !== siteId)
          : [...excluded, siteId],
      };
      this.notifyChange(next);
      return { settings: next };
    });
  };

  handleWpeSyncIntervalChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const val = parseInt(e.target.value, 10);
    const hours = isNaN(val) || val < 1 ? 1 : val > 168 ? 168 : val;
    this.setState((prev) => {
      const next = { ...prev.settings, wpeSyncIntervalHours: hours };
      this.notifyChange(next);
      return { settings: next };
    });
  };

  handleHaltedRefreshIntervalChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const val = parseInt(e.target.value, 10);
    const hours = isNaN(val) || val < 1 ? 1 : val > 168 ? 168 : val;
    this.setState((prev) => {
      const next = { ...prev.settings, haltedSiteRefreshIntervalHours: hours };
      this.notifyChange(next);
      return { settings: next };
    });
  };

  handleWpeRefreshIntervalChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const val = parseInt(e.target.value, 10);
    const hours = isNaN(val) || val < 1 ? 1 : val > 168 ? 168 : val;
    this.setState((prev) => {
      const next = { ...prev.settings, wpeRefreshIntervalHours: hours };
      this.notifyChange(next);
      return { settings: next };
    });
  };


  renderWpeAccessControlSection(): React.ReactNode {
    const { settings, wpeAccounts, expandedOps, acctScopeExpanded, addingException, wpeInstalls, installSearch } = this.state;
    const perms = settings.wpeOperationPermissions ?? {};
    const exceptions = settings.wpeSiteExceptions ?? [];
    const accountFilter = settings.wpeAccountFilter;
    const allAccountIds = wpeAccounts.map((a) => a.id);
    const includedIds: string[] = accountFilter ?? allAccountIds;
    const allIncluded = !accountFilter || includedIds.length === allAccountIds.length;

    const getPermVal = (op: WpeOperation, env: WpeEnv): boolean => {
      const custom = (perms as any)[op]?.[env];
      return custom !== undefined ? custom : WPE_OPERATION_DEFAULTS[op][env];
    };

    const OPERATIONS: Array<{ id: WpeOperation; label: string; sub: string; icon: string; color: string }> = [
      { id: 'pull',   label: 'Pull to local',    sub: 'Download files + database from WPE',      icon: '⬇', color: '59,130,246' },
      { id: 'wpcli',  label: 'WP-CLI over SSH',  sub: 'Run commands on remote WPE installs',      icon: '⌘', color: '167,139,250' },
      { id: 'push',   label: 'Push to WPE',      sub: 'Overwrite remote with local files and DB', icon: '⬆', color: '251,191,36' },
      { id: 'delete', label: 'Delete / Promote', sub: 'Irreversible CAPI operations',              icon: '🗑', color: '248,113,113' },
    ];

    const renderToggle = (checked: boolean, onChange: (v: boolean) => void): React.ReactNode =>
      React.createElement('label', {
        style: { position: 'relative' as const, width: 34, height: 19, flexShrink: 0, cursor: 'pointer', display: 'inline-flex' },
        onClick: (e: React.MouseEvent) => e.stopPropagation(),
      },
        React.createElement('input', { type: 'checkbox', checked, style: { display: 'none' }, onChange: (e: any) => onChange(e.target.checked) }),
        React.createElement('div', { style: { position: 'absolute' as const, inset: 0, background: checked ? '#51BB7B' : 'var(--nxai-card-border, #30363d)', borderRadius: 10, transition: 'background 0.2s' } }),
        React.createElement('div', { style: { position: 'absolute' as const, top: 2, left: checked ? 17 : 2, width: 15, height: 15, background: checked ? '#fff' : 'var(--nxai-status-neutral, #9ca3af)', borderRadius: '50%', transition: 'all 0.2s', boxShadow: '0 1px 2px rgba(0,0,0,0.3)' } }),
      );

    const renderOpCard = (op: typeof OPERATIONS[number]): React.ReactNode => {
      const expanded = expandedOps.has(op.id);
      const devOn = getPermVal(op.id, 'development');
      const stgOn = getPermVal(op.id, 'staging');
      const prdOn = getPermVal(op.id, 'production');
      const opExceptions = exceptions.filter((e) => op.id in e.overrides);

      const envBadge = (label: string, on: boolean, color: string) =>
        React.createElement('span', {
          style: { fontSize: 10, fontFamily: 'monospace', padding: '2px 7px', borderRadius: 10, fontWeight: 500, background: on ? `rgba(${color},0.12)` : 'rgba(139,148,158,0.08)', color: on ? `rgb(${color})` : 'var(--nxai-status-neutral, #9ca3af)' },
        }, `${label} ${on ? '✓' : '✗'}`);

      return React.createElement('div', {
        key: op.id,
        style: { background: 'var(--nxai-card-bg, #21262d)', border: `1px solid ${expanded ? 'rgba(59,130,246,0.45)' : 'var(--nxai-card-border, #30363d)'}`, borderRadius: 8, overflow: 'hidden', marginBottom: 8, cursor: 'pointer' },
        onClick: () => this.handleOpCardToggle(op.id),
      },
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 14, padding: '13px 16px' } },
          React.createElement('div', { style: { width: 34, height: 34, borderRadius: 8, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, background: `rgba(${op.color},0.12)`, color: `rgb(${op.color})` } }, op.icon),
          React.createElement('div', { style: { flex: 1 } },
            React.createElement('div', { style: { fontSize: 13, fontWeight: 600 } }, op.label),
            React.createElement('div', { style: { fontSize: 11, color: 'var(--nxai-card-sub, #6b7280)', marginTop: 1 } }, op.sub),
          ),
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 } },
            envBadge('Dev', devOn, '81,187,123'),
            envBadge('Stg', stgOn, '251,191,36'),
            envBadge('Prd', prdOn, prdOn ? '81,187,123' : '248,113,113'),
            opExceptions.length > 0 ? React.createElement('span', { style: { fontSize: 10, fontFamily: 'monospace', padding: '2px 8px', background: 'rgba(59,130,246,0.12)', border: '1px solid rgba(59,130,246,0.3)', color: '#3b82f6', borderRadius: 3 } }, `${opExceptions.length} exception${opExceptions.length !== 1 ? 's' : ''}`) : null,
            React.createElement('span', { style: { color: 'var(--nxai-status-neutral, #9ca3af)', fontSize: 11, transition: 'transform 0.15s', transform: expanded ? 'rotate(90deg)' : 'none', display: 'inline-block' } }, '▶'),
          ),
        ),
        expanded ? React.createElement('div', {
          style: { borderTop: '1px solid var(--nxai-card-border, #30363d)', padding: 16, background: 'rgba(255,255,255,0.01)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 },
          onClick: (e: React.MouseEvent) => e.stopPropagation(),
        },
          React.createElement('div', null,
            React.createElement('div', { style: { fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' as const, color: 'var(--nxai-card-sub, #6b7280)', marginBottom: 10 } }, 'Default by environment'),
            ...(['development', 'staging', 'production'] as const).map((env) => {
              const dotColor = env === 'development' ? '#51BB7B' : env === 'staging' ? '#fbbf24' : '#f87171';
              const val = getPermVal(op.id, env);
              return React.createElement('div', {
                key: env,
                style: { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 11px', background: 'var(--nxai-code-bg, #1f1f1f)', border: '1px solid var(--nxai-card-border, #30363d)', borderRadius: 6, marginBottom: 6 },
              },
                React.createElement('div', { style: { width: 7, height: 7, borderRadius: '50%', background: dotColor, flexShrink: 0 } }),
                React.createElement('span', { style: { flex: 1, fontSize: 12, fontWeight: 500, textTransform: 'capitalize' as const } }, env),
                renderToggle(val, (v) => this.handleOperationToggle(op.id, env, v)),
              );
            }),
          ),
          React.createElement('div', null,
            React.createElement('div', { style: { fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' as const, color: 'var(--nxai-card-sub, #6b7280)', marginBottom: 10 } }, 'Site exceptions'),
            opExceptions.length === 0
              ? React.createElement('div', { style: { fontSize: 12, color: 'var(--nxai-status-neutral, #9ca3af)', fontStyle: 'italic' as const, marginBottom: 8 } }, 'No exceptions — all sites follow global')
              : opExceptions.map((exc) =>
                  React.createElement('div', {
                    key: `${exc.installName}-${exc.environment}`,
                    style: { display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', background: 'var(--nxai-code-bg, #1f1f1f)', border: '1px solid var(--nxai-card-border, #30363d)', borderRadius: 6, marginBottom: 6, fontSize: 12 },
                  },
                    React.createElement('span', { style: { flex: 1, fontWeight: 500 } }, exc.installName),
                    React.createElement('span', { style: { fontSize: 10, color: 'var(--nxai-card-sub, #6b7280)' } }, exc.environment),
                    React.createElement('span', { style: { fontSize: 10, fontFamily: 'monospace', color: exc.overrides[op.id] ? '#51BB7B' : '#f87171' } }, exc.overrides[op.id] ? 'allow ↑' : 'block ↓'),
                    React.createElement('span', {
                      style: { color: 'var(--nxai-status-neutral, #9ca3af)', cursor: 'pointer', marginLeft: 4, fontSize: 12 },
                      onClick: (e: React.MouseEvent) => { e.stopPropagation(); this.handleSiteExceptionRemove(exc.installName, exc.environment); },
                    }, '✕'),
                  ),
                ),
            // Inline add form with install search
            addingException?.op === op.id
              ? React.createElement('div', {
                  style: { background: 'var(--nxai-code-bg, #1f1f1f)', border: '1px solid rgba(59,130,246,0.4)', borderRadius: 6, padding: '10px 12px' },
                  onClick: (e: React.MouseEvent) => e.stopPropagation(),
                },
                  // Search input
                  React.createElement('input', {
                    type: 'text',
                    placeholder: 'Search installs…',
                    value: installSearch,
                    autoFocus: true,
                    onChange: (e: any) => { const v = e.target.value; this.setState({ installSearch: v }); },
                    style: { width: '100%', fontSize: 12, padding: '6px 8px', background: 'var(--nxai-card-bg, #21262d)', border: '1px solid var(--nxai-card-border, #30363d)', borderRadius: 4, color: 'var(--nxai-card-text, #e6edf3)', fontFamily: 'inherit', marginBottom: 6 },
                  }),
                  // Filtered install list
                  React.createElement('div', {
                    style: { maxHeight: 160, overflowY: 'auto' as const, display: 'flex', flexDirection: 'column' as const, gap: 2, marginBottom: 8 },
                  },
                    (() => {
                      const q = installSearch.toLowerCase();
                      const filtered = wpeInstalls
                        .filter((i) => !q || i.installName.toLowerCase().includes(q) || i.primaryDomain.toLowerCase().includes(q))
                        .slice(0, 30);
                      if (filtered.length === 0) {
                        return [React.createElement('div', { key: 'empty', style: { fontSize: 11, color: 'var(--nxai-status-neutral, #9ca3af)', padding: '6px 4px', fontStyle: 'italic' as const } }, 'No installs found')];
                      }
                      return filtered.map((inst) => {
                        const isSelected = addingException.installName === inst.installName;
                        const envColor = inst.environment === 'production' ? '#f87171' : inst.environment === 'staging' ? '#fbbf24' : '#51BB7B';
                        return React.createElement('div', {
                          key: inst.installName,
                          style: {
                            display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', borderRadius: 4, cursor: 'pointer',
                            background: isSelected ? 'rgba(59,130,246,0.15)' : 'transparent',
                            border: isSelected ? '1px solid rgba(59,130,246,0.4)' : '1px solid transparent',
                          },
                          onClick: () => this.setState((prev) => ({
                            addingException: prev.addingException ? { ...prev.addingException, installName: inst.installName, environment: inst.environment } : null,
                          })),
                        },
                          React.createElement('div', { style: { width: 6, height: 6, borderRadius: '50%', background: envColor, flexShrink: 0 } }),
                          React.createElement('span', { style: { flex: 1, fontSize: 12, fontWeight: 500 } }, inst.installName),
                          React.createElement('span', { style: { fontSize: 10, color: 'var(--nxai-card-sub, #6b7280)' } }, inst.environment),
                          isSelected ? React.createElement('span', { style: { fontSize: 10, color: '#3b82f6' } }, '✓') : null,
                        );
                      });
                    })(),
                  ),
                  // Selected + allow/block + actions
                  React.createElement('div', { style: { borderTop: '1px solid var(--nxai-card-border, #30363d)', paddingTop: 8, display: 'flex', alignItems: 'center', gap: 8 } },
                    addingException.installName
                      ? React.createElement('span', { style: { fontSize: 11, color: 'var(--nxai-card-text)', flex: 1 } },
                          React.createElement('strong', null, addingException.installName),
                          ' · ',
                          React.createElement('span', { style: { color: 'var(--nxai-card-sub, #6b7280)' } }, addingException.environment),
                        )
                      : React.createElement('span', { style: { fontSize: 11, color: 'var(--nxai-status-neutral, #9ca3af)', flex: 1, fontStyle: 'italic' as const } }, 'Select an install above'),
                    React.createElement('label', { style: { display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, cursor: 'pointer' } },
                      React.createElement('input', {
                        type: 'checkbox', checked: addingException.allowing,
                        onChange: (e: any) => { const v = e.target.checked; this.setState((prev) => ({ addingException: prev.addingException ? { ...prev.addingException, allowing: v } : null })); },
                      }),
                      React.createElement('span', { style: { color: addingException.allowing ? '#51BB7B' : '#f87171' } }, addingException.allowing ? 'Allow' : 'Block'),
                    ),
                    React.createElement('button', {
                      style: { fontSize: 11, padding: '4px 10px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 4, cursor: addingException.installName ? 'pointer' : 'not-allowed', opacity: addingException.installName ? 1 : 0.5, fontFamily: 'inherit' },
                      disabled: !addingException.installName,
                      onClick: (e: React.MouseEvent) => {
                        e.stopPropagation();
                        if (!addingException.installName) return;
                        this.handleSiteExceptionToggle(addingException.installName, addingException.environment, op.id as WpeOperation, addingException.allowing);
                        this.setState({ addingException: null, installSearch: '' });
                      },
                    }, 'Save'),
                    React.createElement('button', {
                      style: { fontSize: 11, padding: '4px 10px', background: 'none', border: '1px solid var(--nxai-card-border, #30363d)', borderRadius: 4, cursor: 'pointer', color: 'var(--nxai-card-sub, #6b7280)', fontFamily: 'inherit' },
                      onClick: (e: React.MouseEvent) => { e.stopPropagation(); this.setState({ addingException: null, installSearch: '' }); },
                    }, 'Cancel'),
                  ),
                )
              : React.createElement('button', {
                  style: { display: 'flex', alignItems: 'center', gap: 6, padding: '7px 10px', background: 'none', border: '1px dashed var(--nxai-card-border, #30363d)', borderRadius: 6, fontSize: 12, color: 'var(--nxai-card-sub, #6b7280)', cursor: 'pointer', width: '100%', fontFamily: 'inherit' },
                  onClick: (e: React.MouseEvent) => { e.stopPropagation(); this.setState({ addingException: { op: op.id, installName: '', environment: 'production', allowing: true } }); },
                }, '＋ Add site exception'),
          ),
        ) : null,
      );
    };

    const acctCard = wpeAccounts.length > 0 ? React.createElement('div', {
      style: { background: 'var(--nxai-card-bg, #21262d)', border: '1px solid var(--nxai-card-border, #30363d)', borderRadius: 8, overflow: 'hidden', marginBottom: 6 },
    },
      React.createElement('div', {
        style: { display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', cursor: 'pointer' },
        onClick: () => this.setState((prev) => ({ acctScopeExpanded: !prev.acctScopeExpanded })),
      },
        React.createElement('div', { style: { width: 32, height: 32, borderRadius: 8, background: 'rgba(59,130,246,0.12)', border: '1px solid rgba(59,130,246,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, flexShrink: 0 } }, '🏢'),
        React.createElement('div', { style: { flex: 1 } },
          React.createElement('div', { style: { fontSize: 13, fontWeight: 600 } }, 'Included Accounts'),
          React.createElement('div', { style: { fontSize: 11, color: 'var(--nxai-card-sub, #6b7280)', marginTop: 1 } }, 'These accounts are visible in Nexus and included in all operations'),
        ),
        React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap' as const, gap: 4, justifyContent: 'flex-end' as const, maxWidth: 260 } },
          ...wpeAccounts.slice(0, 5).map((a) => {
            const on = allIncluded || includedIds.includes(a.id);
            return React.createElement('span', {
              key: a.id,
              style: { fontSize: 10, padding: '2px 8px', borderRadius: 10, fontWeight: 500, background: on ? 'rgba(81,187,123,0.12)' : 'rgba(139,148,158,0.08)', color: on ? '#51BB7B' : 'var(--nxai-status-neutral, #9ca3af)', border: on ? '1px solid rgba(81,187,123,0.3)' : '1px solid var(--nxai-card-border, #30363d)', cursor: 'pointer' },
              onClick: (e: React.MouseEvent) => { e.stopPropagation(); this.handleAccountScopeToggle(a.id, !on); },
            }, a.nickname ?? a.name ?? a.id);
          }),
          wpeAccounts.length > 5 ? React.createElement('span', { style: { fontSize: 10, color: 'var(--nxai-card-sub, #6b7280)', padding: '2px 4px' } }, `+${wpeAccounts.length - 5}`) : null,
        ),
        React.createElement('span', { style: { color: 'var(--nxai-status-neutral, #9ca3af)', fontSize: 11, marginLeft: 8, flexShrink: 0 } }, acctScopeExpanded ? '▼' : '▶'),
      ),
      acctScopeExpanded ? React.createElement('div', {
        style: { borderTop: '1px solid var(--nxai-card-border, #30363d)', padding: '14px 16px', background: 'rgba(255,255,255,0.01)', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 },
      },
        ...wpeAccounts.map((a) => {
          const on = allIncluded || includedIds.includes(a.id);
          return React.createElement('div', {
            key: a.id,
            style: { display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', background: on ? 'var(--nxai-code-bg, #1f1f1f)' : 'rgba(255,255,255,0.01)', border: '1px solid var(--nxai-card-border, #30363d)', borderRadius: 6, cursor: 'pointer', opacity: on ? 1 : 0.45, fontSize: 12 },
            onClick: () => this.handleAccountScopeToggle(a.id, !on),
          },
            React.createElement('div', { style: { width: 8, height: 8, borderRadius: '50%', background: on ? '#51BB7B' : 'var(--nxai-status-neutral, #9ca3af)', flexShrink: 0 } }),
            React.createElement('span', { style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const } }, a.nickname ?? a.name ?? a.id),
            React.createElement('span', { style: { color: on ? '#51BB7B' : 'var(--nxai-status-neutral, #9ca3af)', fontSize: 11, flexShrink: 0 } }, on ? '✓' : '✗'),
          );
        }),
      ) : null,
    ) : null;

    return React.createElement('div', { style: sectionStyle },
      React.createElement('div', { style: labelStyle }, 'WP Engine Access'),
      React.createElement('div', { style: descStyle }, 'Control which accounts and operations Nexus can use across your WP Engine environments.'),
      React.createElement('div', { style: { marginTop: 12 } },
        acctCard,
        wpeAccounts.length > 0 ? React.createElement('div', { style: { height: 14, borderLeft: '1px solid var(--nxai-card-border, #30363d)', marginLeft: 10, marginBottom: 4 } }) : null,
        React.createElement('div', { style: { fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' as const, color: 'var(--nxai-card-sub, #6b7280)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 } },
          React.createElement('span', null, 'Operation Permissions'),
          React.createElement('span', { style: { flex: 1, height: 1, background: 'var(--nxai-card-border, #30363d)' } }),
        ),
        ...OPERATIONS.map(renderOpCard),
        React.createElement('div', {
          style: { display: 'flex', alignItems: 'flex-start', gap: 8, padding: '10px 14px', background: 'rgba(81,187,123,0.05)', border: '1px solid rgba(81,187,123,0.2)', borderRadius: 6, fontSize: 12, color: 'rgba(81,187,123,0.8)', marginTop: 8, lineHeight: '1.5' },
        },
          React.createElement('span', null, '📖'),
          React.createElement('span', null,
            React.createElement('strong', null, 'Read metadata'),
            ' (installs, domains, SSL, usage) is always permitted and cannot be disabled.',
          ),
        ),
      ),
    );
  }

  handleWpeRefreshAutoEnabledToggle = (): void => {
    this.setState((prev) => {
      const next = { ...prev.settings, wpeRefreshAutoEnabled: prev.settings.wpeRefreshAutoEnabled === false ? true : false };
      this.notifyChange(next);
      return { settings: next };
    });
  };

  handleOpCardToggle = (op: string): void => {
    this.setState((prev) => {
      const expandedOps = new Set(prev.expandedOps);
      if (expandedOps.has(op)) { expandedOps.delete(op); } else { expandedOps.add(op); }
      return { expandedOps };
    });
  };

  handleOperationToggle = (operation: WpeOperation, env: WpeEnv, value: boolean): void => {
    this.setState((prev) => {
      const perms = { ...(prev.settings.wpeOperationPermissions ?? {}) };
      perms[operation] = {
        ...WPE_OPERATION_DEFAULTS[operation],
        ...(perms[operation] ?? {}),
        [env]: value,
      };
      const next = { ...prev.settings, wpeOperationPermissions: perms };
      this.notifyChange(next);
      return { settings: next };
    });
  };

  handleSiteExceptionToggle = (installName: string, environment: string, operation: WpeOperation, value: boolean): void => {
    this.setState((prev) => {
      const exceptions = [...(prev.settings.wpeSiteExceptions ?? [])];
      const idx = exceptions.findIndex((e) => e.installName === installName && e.environment === environment);
      if (idx >= 0) {
        exceptions[idx] = { ...exceptions[idx], overrides: { ...exceptions[idx].overrides, [operation]: value } };
      } else {
        exceptions.push({ installName, environment, overrides: { [operation]: value } });
      }
      const next = { ...prev.settings, wpeSiteExceptions: exceptions };
      this.notifyChange(next);
      return { settings: next };
    });
  };

  handleSiteExceptionRemove = (installName: string, environment: string): void => {
    this.setState((prev) => {
      const exceptions = (prev.settings.wpeSiteExceptions ?? []).filter(
        (e) => !(e.installName === installName && e.environment === environment),
      );
      const next = { ...prev.settings, wpeSiteExceptions: exceptions };
      this.notifyChange(next);
      return { settings: next };
    });
  };

  handleAccountScopeToggle = (accountId: string, included: boolean): void => {
    this.setState((prev) => {
      const allIds = this.state.wpeAccounts.map((a) => a.id);
      const current: string[] = prev.settings.wpeAccountFilter ?? allIds;
      const updated = included
        ? [...new Set([...current, accountId])]
        : current.filter((id) => id !== accountId);
      const next = { ...prev.settings, wpeAccountFilter: updated };
      this.notifyChange(next);
      return { settings: next };
    });
  };

  handleAccountScopeSelectAll = (includeAll: boolean): void => {
    this.setState((prev) => {
      const next = { ...prev.settings, wpeAccountFilter: includeAll ? null : [] };
      this.notifyChange(next);
      return { settings: next };
    });
  };

  handleProviderChange = (e: React.ChangeEvent<HTMLSelectElement>): void => {
    const providerId = e.target.value as AIProvider;
    this.setState((prev) => {
      const next = { ...prev.settings, aiProvider: providerId, aiModel: '' as any };
      this.notifyChange(next);
      return { settings: next, models: [], keyInput: '', keySaved: false, keyIsSet: false };
    }, () => {
      this.fetchModels(providerId);
      if (providerId) this.loadStoredKey(providerId);
    });
  };

  handleModelChange = (e: React.ChangeEvent<HTMLSelectElement>): void => {
    const model = e.target.value;
    this.setState((prev) => {
      const next = { ...prev.settings, aiModel: model };
      this.notifyChange(next);
      return { settings: next };
    });
  };

  handleKeyInputChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    this.setState({ keyInput: e.target.value, keySaved: false, keyIsSet: false });
  };

  handleSaveKey = async (): Promise<void> => {
    const { keyInput, keyIsSet, settings } = this.state;
    const providerId = settings.aiProvider;
    if (!providerId || !keyInput.trim()) return;
    // If the displayed value is the masked key (already saved, unchanged), skip the IPC call
    if (keyIsSet) return;

    await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.SAVE_API_KEY, providerId, keyInput.trim());
    if (!this.mounted) return;

    this.setState((prev) => ({
      keyStatus: { ...prev.keyStatus, [providerId]: 'unchecked' },
      keySaved: true,
      keyIsSet: true,
    }));
  };

  handleValidateKey = async (): Promise<void> => {
    const { keyInput, keyIsSet, settings } = this.state;
    const providerId = settings.aiProvider;
    if (!providerId || !keyInput.trim()) return;
    // Cannot validate the masked preview — user must enter a new key
    if (keyIsSet) return;

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

  // -----------------------------------------------------------------------
  // WPE Credentials Handlers
  // -----------------------------------------------------------------------

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
        // Clear credentials
        await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.WPE_CLEAR_API_CREDENTIALS);
        if (!this.mounted) return;
        this.setState({
          wpeCredentialsConfigured: false,
          wpeUsername: '',
          wpePassword: '',
          wpeUsernameInput: '',
          wpePasswordInput: '',
          wpePendingClear: false,
          wpeCredsSaved: true,
        });
      } else if (wpeUsernameInput.trim() && wpePasswordInput.trim()) {
        // Save credentials
        await this.props.electron.ipcRenderer.invoke(
          IPC_CHANNELS.WPE_SET_API_CREDENTIALS,
          wpeUsernameInput.trim(),
          wpePasswordInput.trim(),
        );
        if (!this.mounted) return;
        this.setState({
          wpeCredentialsConfigured: true,
          wpeUsername: wpeUsernameInput.trim(),
          wpePassword: wpePasswordInput.trim(),
          wpeCredsSaved: true,
        });
      }
    } catch (err: any) {
      // Error handling - could show error message
      if (!this.mounted) return;
      this.setState({ wpeCredsSaved: false });
    }
  };

  toggleSection = (sectionId: string): void => {
    this.setState((prev) => {
      const next = new Set(prev.expandedSections);
      if (next.has(sectionId)) {
        next.delete(sectionId);
      } else {
        next.add(sectionId);
      }
      return { expandedSections: next };
    });
  };

  /** Render a collapsible section header with chevron */
  renderSectionHeader(sectionId: string, title: string): React.ReactElement {
    const expanded = this.state.expandedSections.has(sectionId);
    return React.createElement('div', {
      onClick: () => this.toggleSection(sectionId),
      style: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        cursor: 'pointer',
        padding: '10px 0',
        borderBottom: expanded ? 'none' : '1px solid rgba(128,128,128,0.15)',
        marginBottom: expanded ? '4px' : '16px',
        userSelect: 'none' as const,
      },
    },
      React.createElement('span', {
        style: { fontSize: '15px', fontWeight: 600 },
      }, title),
      React.createElement('span', {
        style: { fontSize: '12px', opacity: 0.6 },
      }, expanded ? '\u25be' : '\u25b8'),
    );
  }

  // -----------------------------------------------------------------------
  // Chat Section Render
  // -----------------------------------------------------------------------

  renderChatSection(): React.ReactNode {
    const { settings, providers, models, loadingModels, keyStatus, keyInput, keySaved, keyIsSet } = this.state;
    const currentProvider = providers.find((p) => p.id === settings.aiProvider);
    const currentStatus = settings.aiProvider ? (keyStatus[settings.aiProvider] ?? 'unchecked') : 'unchecked';

    const statusColor = currentStatus === 'valid' ? UI_COLORS.STATUS_RUNNING
      : currentStatus === 'invalid' ? UI_COLORS.STATUS_ERROR
      : currentStatus === 'checking' ? UI_COLORS.WPE_BRAND
      : 'var(--nxai-status-neutral, #9ca3af)';

    const statusLabel = currentStatus === 'valid' ? 'Valid'
      : currentStatus === 'invalid' ? 'Invalid'
      : currentStatus === 'checking' ? 'Checking...'
      : 'Not checked';

    return React.createElement('div', { style: sectionStyle },
      React.createElement('div', { style: labelStyle }, 'AI Credentials'),
      React.createElement('div', { style: descStyle },
        'Choose the AI provider for Nexus AI features, e.g. Site Finder. Each WordPress site can use a different provider — configure per-site via the site\'s Nexus AI section.',
      ),

      // Provider dropdown
      React.createElement('div', { style: rowStyle },
        React.createElement('span', { style: { fontSize: '13px', fontWeight: 500, minWidth: '70px', /* color inherited */ } }, 'Provider'),
        React.createElement('select', {
          value: settings.aiProvider || '',
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
      settings.aiProvider ? React.createElement('div', { style: rowStyle },
        React.createElement('span', { style: { fontSize: '13px', fontWeight: 500, minWidth: '70px', /* color inherited */ } }, 'Model'),
        loadingModels
          ? React.createElement('span', { style: { fontSize: '13px', opacity: 0.7 } }, 'Loading models...')
          : React.createElement('select', {
              value: settings.aiModel || '',
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
          React.createElement('span', { style: { fontSize: '13px', fontWeight: 500, minWidth: '70px', /* color inherited */ } }, 'API Key'),
          React.createElement('input', {
            // When keyIsSet the displayed value is the masked representation (e.g. sk-ant-api0...xxxx)
            // Show as readable text so the user can see it is set. When typing a new key use password.
            type: keyIsSet ? 'text' : 'password',
            value: keyInput,
            onChange: this.handleKeyInputChange,
            placeholder: keyIsSet ? '' : 'Enter API key...',
            className: 'nexus-password-input',
            readOnly: keyIsSet,
            style: {
              ...inputStyle,
              flex: 1,
              maxWidth: '350px',
              opacity: keyIsSet ? 0.7 : 1,
              cursor: keyIsSet ? 'default' : 'text',
            },
          }),
          // When key is set show a Change button; otherwise show Apply
          keyIsSet
            ? React.createElement('button', {
                style: btnSmallStyle,
                onClick: () => this.setState({ keyInput: '', keySaved: false, keyIsSet: false }),
              }, 'Change')
            : React.createElement('button', {
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
            disabled: !keyInput.trim() || keyIsSet || currentStatus === 'checking',
          }, 'Check Key'),
        ),

        // Security indicator shown when a key is stored
        keyIsSet ? React.createElement('div', {
          style: { display: 'flex', alignItems: 'center', gap: '6px', marginLeft: '80px', marginBottom: '4px' },
        },
          React.createElement('span', { style: { fontSize: '11px', opacity: 0.6 } }, 'Key is encrypted and stored securely'),
        ) : null,

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

  // -----------------------------------------------------------------------
  // WPE Credentials Section Render
  // -----------------------------------------------------------------------

  renderWpeCredsSection(): React.ReactNode {
    const {
      wpeCredentialsConfigured,
      wpeUsernameInput,
      wpePasswordInput,
      wpePendingClear,
      wpeCredsSaved,
    } = this.state;

    const hasChanges = wpePendingClear ||
      (wpeUsernameInput.trim() !== '' && wpePasswordInput.trim() !== '');

    const statusColor = wpeCredentialsConfigured ? UI_COLORS.STATUS_RUNNING : 'var(--nxai-status-neutral, #9ca3af)';
    const statusLabel = wpeCredentialsConfigured ? 'Configured' : 'Not configured';

    return React.createElement('div', { style: sectionStyle },
      React.createElement('div', { style: labelStyle }, 'WP Engine API Credentials'),
      React.createElement('div', { style: descStyle },
        'Store WP Engine API credentials for backup creation. WP Engine\'s backup endpoint requires basic authentication (not OAuth). Credentials are stored encrypted using OS-level encryption.',
      ),

      // Status indicator
      React.createElement('div', {
        style: { display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '12px' },
      },
        React.createElement('span', { style: dotStyle(statusColor) }),
        React.createElement('span', {
          style: { fontSize: '13px', color: statusColor, fontWeight: 500 },
        }, statusLabel),
      ),

      // Username input
      React.createElement('div', { style: rowStyle },
        React.createElement('span', { style: { fontSize: '13px', fontWeight: 500, minWidth: '90px' } }, 'Username'),
        React.createElement('input', {
          type: 'text',
          value: wpeUsernameInput,
          onChange: this.handleWpeUsernameChange,
          placeholder: 'API username',
          className: 'nexus-password-input',
          style: {
            ...inputStyle,
            flex: 1,
            maxWidth: '350px',
          },
        }),
      ),

      // Password input
      React.createElement('div', { style: { ...rowStyle, marginBottom: '16px' } },
        React.createElement('span', { style: { fontSize: '13px', fontWeight: 500, minWidth: '90px' } }, 'Password'),
        React.createElement('input', {
          type: 'password',
          value: wpePasswordInput,
          onChange: this.handleWpePasswordChange,
          placeholder: 'API password',
          className: 'nexus-password-input',
          style: {
            ...inputStyle,
            flex: 1,
            maxWidth: '350px',
          },
        }),
      ),

      // Action buttons
      React.createElement('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } },
        React.createElement('button', {
          style: {
            ...btnSmallStyle,
            ...(hasChanges && !wpeCredsSaved ? { backgroundColor: UI_COLORS.WPE_BRAND, color: '#fff', border: 'none' } : {}),
          },
          onClick: this.handleWpeApplyCredentials,
          disabled: !hasChanges || wpeCredsSaved,
        }, wpeCredsSaved ? 'Saved' : 'Apply'),
        React.createElement('button', {
          style: btnSmallStyle,
          onClick: this.handleWpeClearCredentials,
          disabled: !wpeCredentialsConfigured && wpeUsernameInput === '' && wpePasswordInput === '',
        }, 'Clear'),
        wpeCredsSaved ? React.createElement('span', {
          style: { fontSize: '12px', color: UI_COLORS.STATUS_RUNNING, marginLeft: '4px' },
        }, wpePendingClear ? '✓ Credentials cleared' : '✓ Credentials saved') : null,
      ),

      // Help text
      React.createElement('div', {
        style: { fontSize: '12px', opacity: 0.7, marginTop: '12px', lineHeight: 1.4 },
      },
        'Get your API credentials from ',
        React.createElement('a', {
          href: 'https://my.wpengine.com',
          target: '_blank',
          style: { color: UI_COLORS.WPE_BRAND, textDecoration: 'underline' },
        }, 'my.wpengine.com'),
        '. These are different from your WP Engine login — you must generate API credentials specifically for programmatic access.',
      ),
    );
  }


  render(): React.ReactNode {
    const { settings, sites, loading, expandedSections } = this.state;

    if (loading) {
      return React.createElement('div', {
        style: { padding: '24px', opacity: 0.7 },
      }, 'Loading preferences...');
    }

    const divider = React.createElement('hr', {
      style: { border: 'none', borderTop: '1px solid', opacity: 0.15, margin: '8px 0 16px' },
    });

    // -----------------------------------------------------------------------
    // Section 1: AI Provider (always expanded by default)
    // -----------------------------------------------------------------------
    const aiProviderExpanded = expandedSections.has('ai-provider');
    const section1 = React.createElement('div', { style: sectionStyle },
      this.renderSectionHeader('ai-provider', 'AI Provider'),
      aiProviderExpanded ? React.createElement('div', null,
        this.renderChatSection(),
      ) : null,
    );

    // -----------------------------------------------------------------------
    // Section 2: Local AI Gateway (collapsed by default)
    // -----------------------------------------------------------------------
    const gatewayExpanded = expandedSections.has('gateway');
    const section2 = React.createElement('div', { style: sectionStyle },
      this.renderSectionHeader('gateway', 'Local AI Gateway'),
      gatewayExpanded ? React.createElement('div', null,
        React.createElement('div', { style: descStyle },
          'When enabled, all AI requests from WordPress sites are proxied through the Local AI Gateway, which routes them to your configured AI provider above.',
        ),
        React.createElement('label', {
          style: checkboxRowStyle,
          title: 'Route all WordPress AI plugin requests through the Local AI Gateway running on this machine.',
        },
          React.createElement('input', {
            type: 'checkbox',
            checked: !!((settings as any).useLocalGateway),
            onChange: this.handleGatewayToggle,
            style: { width: '16px', height: '16px', cursor: 'pointer' },
          }),
          React.createElement('span', { style: { fontSize: '14px' } },
            'Route WordPress AI requests through Local AI Gateway',
          ),
        ),
      ) : null,
    );

    // -----------------------------------------------------------------------
    // Section 3: Auto-Indexing (collapsed by default)
    // -----------------------------------------------------------------------
    const indexingExpanded = expandedSections.has('auto-indexing');
    const section3 = React.createElement('div', { style: sectionStyle },
      this.renderSectionHeader('auto-indexing', 'Auto-Indexing'),
      indexingExpanded ? React.createElement('div', null,
        React.createElement('div', { style: descStyle },
          'When enabled, site content is automatically indexed for AI search when a site starts.',
        ),
        React.createElement('label', {
          style: checkboxRowStyle,
          title: 'Automatically create a searchable index when each site starts.',
        },
          React.createElement('input', {
            type: 'checkbox',
            checked: settings.autoIndex,
            onChange: this.handleAutoIndexToggle,
            style: { width: '16px', height: '16px', cursor: 'pointer' },
          }),
          React.createElement('span', { style: { fontSize: '14px' } }, 'Automatically index sites when started'),
        ),

        settings.autoIndex
          ? React.createElement('div', { style: { marginTop: '12px' } },
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
                      React.createElement('span', { style: { fontSize: '13px' } }, site.name),
                      React.createElement('span', {
                        style: {
                          fontSize: '11px',
                          color: site.status === 'running' ? UI_COLORS.STATUS_RUNNING : 'inherit',
                          opacity: site.status === 'running' ? 1 : 0.7,
                          marginLeft: '4px',
                        },
                      }, `(${site.status})`),
                    ),
                  ),
            )
          : null,
      ) : null,
    );

    // -----------------------------------------------------------------------
    // Section 4: WP Engine (collapsed by default)
    // -----------------------------------------------------------------------
    const wpeExpanded = expandedSections.has('wpe');
    const section4 = React.createElement('div', { style: sectionStyle },
      this.renderSectionHeader('wpe', 'WP Engine'),
      wpeExpanded ? React.createElement('div', null,
        // Unified WPE Access Control (accounts + operation permissions)
        this.renderWpeAccessControlSection(),

        divider,

        // WPE API Credentials
        this.renderWpeCredsSection(),

        divider,

        // Auto-Sync WP Engine Metadata
        React.createElement('div', { style: sectionStyle },
          React.createElement('div', { style: labelStyle }, 'Auto-Sync WP Engine Metadata'),
          React.createElement('div', { style: descStyle },
            'Automatically sync WP Engine site metadata (plugins, WP version, PHP version) on startup and on a schedule.',
          ),
          React.createElement('label', {
            style: checkboxRowStyle,
            title: 'Periodically pull the latest metadata from all linked WP Engine accounts.',
          },
            React.createElement('input', {
              type: 'checkbox',
              checked: settings.wpeSyncAutoEnabled !== false,
              onChange: () => {
                this.setState((prev) => {
                  const next = { ...prev.settings, wpeSyncAutoEnabled: prev.settings.wpeSyncAutoEnabled === false ? true : false };
                  this.notifyChange(next);
                  return { settings: next };
                });
              },
              style: { width: '16px', height: '16px', cursor: 'pointer' },
            }),
            React.createElement('span', { style: { fontSize: '14px' } }, 'Enable auto-sync'),
          ),
          settings.wpeSyncAutoEnabled !== false
            ? React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginTop: '10px' } },
                React.createElement('span', { style: { fontSize: '14px' } }, 'Sync every'),
                React.createElement('input', {
                  type: 'number',
                  min: 1,
                  max: 168,
                  value: settings.wpeSyncIntervalHours ?? 8,
                  onChange: this.handleWpeSyncIntervalChange,
                  title: 'How often (in hours) to automatically fetch WP Engine metadata.',
                  style: {
                    width: '64px',
                    padding: '4px 8px',
                    fontSize: '14px',
                    borderRadius: '4px',
                    border: '1px solid var(--color-border-primary, #ccc)',
                    textAlign: 'center' as const,
                  },
                }),
                React.createElement('span', { style: { fontSize: '14px' } }, 'hours'),
                React.createElement('span', { style: { fontSize: '12px', opacity: 0.6, marginLeft: '4px' } }, '(1–168)'),
              )
            : null,
        ),

        divider,

        // Auto-Update WP Engine Site Info
        React.createElement('div', { style: sectionStyle },
          React.createElement('div', { style: labelStyle }, 'Auto-Update WP Engine Site Info'),
          React.createElement('div', { style: descStyle },
            'Periodically re-scans WP Engine installs via SSH WP-CLI to update plugins, themes, site URL, admin email, and post count. Changes take effect on the next Local restart.',
          ),
          React.createElement('label', {
            style: checkboxRowStyle,
            title: 'Use SSH + WP-CLI to fetch the latest plugin list, themes, and site details from WP Engine.',
          },
            React.createElement('input', {
              type: 'checkbox',
              checked: settings.wpeRefreshAutoEnabled !== false,
              onChange: this.handleWpeRefreshAutoEnabledToggle,
              style: { width: '16px', height: '16px', cursor: 'pointer' },
            }),
            React.createElement('span', { style: { fontSize: '14px' } }, 'Enable automatic WP Engine site info updates'),
          ),
          settings.wpeRefreshAutoEnabled !== false
            ? React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginTop: '10px' } },
                React.createElement('span', { style: { fontSize: '14px' } }, 'Update every'),
                React.createElement('input', {
                  type: 'number',
                  min: 1,
                  max: 168,
                  value: settings.wpeRefreshIntervalHours ?? 24,
                  onChange: this.handleWpeRefreshIntervalChange,
                  title: 'How often (in hours) to re-scan WP Engine installs via SSH.',
                  style: {
                    width: '64px',
                    padding: '4px 8px',
                    fontSize: '14px',
                    borderRadius: '4px',
                    border: '1px solid var(--color-border-primary, #ccc)',
                    textAlign: 'center' as const,
                  },
                }),
                React.createElement('span', { style: { fontSize: '14px' } }, 'hours'),
                React.createElement('span', { style: { fontSize: '12px', opacity: 0.6, marginLeft: '4px' } }, '(1–168)'),
              )
            : null,
        ),

        divider,

        // Refresh Offline Sites
        React.createElement('div', { style: sectionStyle },
          React.createElement('div', { style: labelStyle }, 'Refresh Offline Sites'),
          React.createElement('div', { style: descStyle },
            'Periodically re-scans halted local sites via filesystem to keep their metadata fresh. Running sites are updated automatically when started. Changes take effect on the next Local restart.',
          ),
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
            React.createElement('span', { style: { fontSize: '14px' } }, 'Refresh offline sites every'),
            React.createElement('input', {
              type: 'number',
              min: 1,
              max: 168,
              value: settings.haltedSiteRefreshIntervalHours ?? 24,
              onChange: this.handleHaltedRefreshIntervalChange,
              title: 'How often (in hours) to scan halted sites for metadata changes.',
              style: {
                width: '64px',
                padding: '4px 8px',
                fontSize: '14px',
                borderRadius: '4px',
                border: '1px solid var(--color-border-primary, #ccc)',
                textAlign: 'center' as const,
              },
            }),
            React.createElement('span', { style: { fontSize: '14px' } }, 'hours'),
            React.createElement('span', { style: { fontSize: '12px', opacity: 0.6, marginLeft: '4px' } }, '(1–168)'),
          ),
        ),
      ) : null,
    );

    return React.createElement('div', { style: { padding: '24px' } },
      React.createElement('style', null, `
        .nexus-password-input {
          -webkit-text-fill-color: unset !important;
        }
      `),
      section1,
      section2,
      section3,
      section4,
    );
  }
}
