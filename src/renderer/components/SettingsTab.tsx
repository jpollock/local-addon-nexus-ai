/**
 * SettingsTab — Operational configuration for Nexus AI.
 *
 * Contains settings moved out of Preferences:
 *   - Auto-Indexing (on/off + excluded sites)
 *   - Sync Schedule (local content index interval, WPE sync intervals)
 *   - WPE Access & Permissions (allowed environments + operations)
 *
 * Class-based, React.createElement only — no JSX, no hooks.
 */
import * as React from 'react';
import { IPC_CHANNELS } from '../../common/constants';
import { injectThemeVars } from '../utils/theme';
import { rendererGql } from '../utils/rendererGql';
import type { NexusSettings } from '../../common/types';

// ---------------------------------------------------------------------------
// WPE permission constants (shared with NexusPreferences)
// ---------------------------------------------------------------------------

const WPE_OPERATION_DEFAULTS = {
  pull:       { development: true,  staging: true,  production: true  },
  wpcli_read: { development: true,  staging: true,  production: true  },
  wpcli:      { development: true,  staging: true,  production: false },
  push:       { development: true,  staging: true,  production: false },
  delete:     { development: false, staging: false, production: false },
} as const;

type WpeOperation = keyof typeof WPE_OPERATION_DEFAULTS;
type WpeEnv = 'development' | 'staging' | 'production';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SiteItem { id: string; name: string; status: string; }
interface WpeAccount { id: string; name: string; nickname?: string; }
interface WpeInstall { installName: string; environment: string; primaryDomain: string; }

interface SettingsTabProps {
  electron: any;
}

interface SettingsTabState {
  settings: NexusSettings | null;
  sites: SiteItem[];
  wpeAccounts: WpeAccount[];
  wpeInstalls: WpeInstall[];
  externalHosts: Array<{ alias: string; site: string; environment: string; domain: string }>;
  loading: boolean;
  excludedExpanded: boolean;
  accessExpanded: boolean;
  expandedOps: Set<string>;
  installSearch: string;
  addingException: { op: string; targetRef: string; environment: string; allowing: boolean } | null;
  hostKeyCheckAlias: string;
  hostKeyCheckResult: null | { ok: boolean; failureKind?: string; detail?: string; remedy?: string; fingerprint?: string; keyType?: string };
  hostKeyCheckedAlias: string;
  hostKeyTrusting: boolean;
}

// ---------------------------------------------------------------------------
// Shared styles (match NexusPreferences aesthetic)
// ---------------------------------------------------------------------------

const rowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', borderBottom: '1px solid var(--nxai-card-border, #30363d)',
};
const rowLabelStyle: React.CSSProperties = { flex: 1, padding: '10px 13px' };
const rowTitleStyle: React.CSSProperties = { fontSize: 12 };
const rowSubStyle: React.CSSProperties = { fontSize: 11, opacity: 0.45, marginTop: 2 };
const rowControlStyle: React.CSSProperties = {
  padding: '10px 13px', borderLeft: '1px solid var(--nxai-card-border, #30363d)',
  background: 'rgba(128,128,128,0.04)', display: 'flex', alignItems: 'center', gap: 6,
};
const numInputStyle: React.CSSProperties = {
  width: 48, textAlign: 'center', padding: '4px 6px', fontSize: 12, borderRadius: 4,
  border: '1px solid rgba(128,128,128,0.25)', background: 'var(--nxai-input-bg, transparent)',
  color: 'inherit', outline: 'none',
};
const unitStyle: React.CSSProperties = { fontSize: 11, opacity: 0.5 };
const cardStyle: React.CSSProperties = {
  border: '1px solid var(--nxai-card-border, #30363d)', borderRadius: 8, overflow: 'hidden',
  marginBottom: 16, background: 'var(--nxai-card-bg, #21262d)',
};
const sectionHeaderStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em',
  color: 'var(--nxai-card-sub, #6b7280)', marginBottom: 12, marginTop: 24,
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export class SettingsTab extends React.Component<SettingsTabProps, SettingsTabState> {
  private mounted = false;

  state: SettingsTabState = {
    settings: null,
    sites: [],
    wpeAccounts: [],
    wpeInstalls: [],
    externalHosts: [],
    loading: true,
    excludedExpanded: false,
    accessExpanded: false,
    expandedOps: new Set(),
    installSearch: '',
    addingException: null,
    hostKeyCheckAlias: '',
    hostKeyCheckResult: null,
    hostKeyCheckedAlias: '',
    hostKeyTrusting: false,
  };

  componentDidMount(): void {
    this.mounted = true;
    injectThemeVars();
    this.loadAll();
  }

  componentWillUnmount(): void {
    this.mounted = false;
  }

  async loadAll(): Promise<void> {
    const ipc = this.props.electron.ipcRenderer;
    const [settings, sitesResult, accounts, installs, externalHosts] = await Promise.all([
      ipc.invoke(IPC_CHANNELS.GET_SETTINGS).catch(() => null),
      ipc.invoke(IPC_CHANNELS.GET_SITES).catch(() => ({ sites: [] })),
      ipc.invoke(IPC_CHANNELS.GET_WPE_ACCOUNTS).catch(() => []),
      ipc.invoke(IPC_CHANNELS.GET_WPE_INSTALLS_CACHE).catch(() => []),
      ipc.invoke(IPC_CHANNELS.GET_EXTERNAL_HOSTS).catch(() => []),
    ]);
    if (!this.mounted) return;
    this.setState({
      settings: settings ?? { autoIndex: true, excludedSiteIds: [] } as any,
      sites: sitesResult?.sites ?? [],
      wpeAccounts: Array.isArray(accounts) ? accounts : [],
      wpeInstalls: Array.isArray(installs) ? installs : [],
      externalHosts: Array.isArray(externalHosts) ? externalHosts : [],
      loading: false,
    });
  }

  // ── Host key trust-on-first-use ──────────────────────────────────────────

  async checkHostKey(): Promise<void> {
    // Capture the alias being checked NOW, before the await. If the input
    // changes (or a newer check is kicked off) before this resolves, this
    // response is stale and must be discarded rather than overwrite a newer
    // result — see the in-flight-race note in the task-6 review.
    const alias = this.state.hostKeyCheckAlias.trim();
    if (!alias) return;
    this.setState({ hostKeyCheckResult: null, hostKeyCheckedAlias: '' });
    const isStale = () => this.state.hostKeyCheckAlias.trim() !== alias;
    try {
      const data = await rendererGql<{ nexusHostProbe: { success: boolean; error: string | null; report: any } }>(`
        mutation($alias: String!) {
          nexusHostProbe(alias: $alias) {
            success error
            report { ok alias failure { kind detail remedy fingerprint keyType } }
          }
        }
      `, { alias });
      if (!this.mounted || isStale()) return;
      const report = data.nexusHostProbe.report;
      if (!report) {
        this.setState({
          hostKeyCheckResult: { ok: false, detail: data.nexusHostProbe.error ?? 'No report returned.' },
          hostKeyCheckedAlias: alias,
        });
        return;
      }
      this.setState({
        hostKeyCheckResult: {
          ok: report.ok,
          failureKind: report.failure?.kind,
          detail: report.failure?.detail,
          remedy: report.failure?.remedy,
          fingerprint: report.failure?.fingerprint,
          keyType: report.failure?.keyType,
        },
        // Prefer the alias the server actually resolved and echoed back
        // (report.alias) over the locally-captured variable, but either is
        // safe here since both were fixed before this await began — neither
        // is re-read from live state.
        hostKeyCheckedAlias: report.alias || alias,
      });
    } catch (e: any) {
      if (!this.mounted || isStale()) return;
      this.setState({ hostKeyCheckResult: { ok: false, detail: e?.message ?? String(e) }, hostKeyCheckedAlias: alias });
    }
  }

  async approveHostKey(): Promise<void> {
    // Use the alias the displayed fingerprint was actually checked for, not
    // whatever is currently typed in the input — the human verified THIS
    // fingerprint, for THIS alias, and approval must never silently target a
    // different host than what was shown on screen.
    const alias = this.state.hostKeyCheckedAlias.trim();
    if (!alias) return;
    if (this.state.hostKeyCheckAlias.trim() !== alias) return; // stale — button should be disabled, but guard anyway
    this.setState({ hostKeyTrusting: true });
    try {
      const result = await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.TRUST_EXTERNAL_HOST_KEY, alias);
      if (!this.mounted) return;
      if (result.success) {
        this.setState({
          hostKeyCheckResult: { ok: true, detail: `Trusted. Run 'nexus host add ${alias}' to finish registration.` },
          hostKeyTrusting: false,
        });
      } else {
        this.setState({ hostKeyCheckResult: { ok: false, detail: result.error }, hostKeyTrusting: false });
      }
    } catch (e: any) {
      if (this.mounted) this.setState({ hostKeyCheckResult: { ok: false, detail: e?.message ?? String(e) }, hostKeyTrusting: false });
    }
  }

  // ── Settings persistence ─────────────────────────────────────────────────

  saveSetting(patch: Partial<NexusSettings>): void {
    if (!this.state.settings) return;
    const next = { ...this.state.settings, ...patch };
    this.setState({ settings: next });
    this.props.electron.ipcRenderer
      .invoke(IPC_CHANNELS.UPDATE_SETTINGS, patch)
      .catch(() => {});
  }

  /** remoteSiteExceptions if present, else the deprecated wpeSiteExceptions — same fallback
   *  order operation-permissions.ts's own read path already uses on the backend. */
  private getEffectiveExceptions(): import('../../common/types').RemoteSiteException[] {
    const s = this.state.settings;
    if (!s) return [];
    if (s.remoteSiteExceptions?.length) return s.remoteSiteExceptions;
    if (s.wpeSiteExceptions?.length) {
      return s.wpeSiteExceptions.map(e => ({ targetRef: `wpe:${e.installName}`, environment: e.environment, overrides: e.overrides }));
    }
    return [];
  }

  private getEffectivePermissions(): import('../../common/types').RemoteOperationPermissions {
    const s = this.state.settings;
    if (!s) return {};
    if (s.remoteOperationPermissions && Object.keys(s.remoteOperationPermissions).length) {
      return s.remoteOperationPermissions;
    }
    return s.wpeOperationPermissions ?? {};
  }

  // ── Auto-indexing handlers ───────────────────────────────────────────────

  handleAutoIndexToggle = (): void => {
    this.saveSetting({ autoIndex: !this.state.settings?.autoIndex });
  };

  handleSiteExclusionToggle = (siteId: string): void => {
    const current = this.state.settings?.excludedSiteIds ?? [];
    const next = current.includes(siteId)
      ? current.filter(id => id !== siteId)
      : [...current, siteId];
    this.saveSetting({ excludedSiteIds: next });
  };

  handleLocalContentIndexAutoEnabledChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    this.saveSetting({ localContentIndexAutoEnabled: e.target.checked });
  };

  handleLocalContentIndexIntervalChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const val = Math.max(0, Math.min(168, parseInt(e.target.value, 10) || 0));
    this.saveSetting({ localContentIndexIntervalHours: val });
  };

  // ── Sync schedule handlers ───────────────────────────────────────────────

  handleWpeSyncAutoEnabledChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    this.saveSetting({ wpeSyncAutoEnabled: e.target.checked });
  };

  handleWpeSyncIntervalChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const val = parseInt(e.target.value, 10);
    const hours = isNaN(val) || val < 1 ? 1 : val > 168 ? 168 : val;
    this.saveSetting({ wpeSyncIntervalHours: hours });
  };

  handleWpeRefreshAutoEnabledChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    this.saveSetting({ wpeRefreshAutoEnabled: e.target.checked });
  };

  handleWpeRefreshIntervalChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const val = parseInt(e.target.value, 10);
    const hours = isNaN(val) || val < 1 ? 1 : val > 168 ? 168 : val;
    this.saveSetting({ wpeRefreshIntervalHours: hours });
  };

  handleHaltedRefreshIntervalChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const val = parseInt(e.target.value, 10);
    const hours = isNaN(val) || val < 1 ? 1 : val > 168 ? 168 : val;
    this.saveSetting({ haltedSiteRefreshIntervalHours: hours });
  };

  handleWpeContentIndexAutoEnabledChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    this.saveSetting({ wpeContentIndexAutoEnabled: e.target.checked });
  };

  handleWpeContentIndexIntervalChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const val = parseInt(e.target.value, 10);
    const hours = isNaN(val) || val < 1 ? 1 : val > 168 ? 168 : val;
    this.saveSetting({ wpeContentIndexIntervalHours: hours });
  };

  handleExternalRefreshAutoEnabledChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    this.saveSetting({ externalRefreshAutoEnabled: e.target.checked });
  };

  handleExternalRefreshIntervalChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const val = parseInt(e.target.value, 10);
    const hours = isNaN(val) || val < 1 ? 1 : val > 168 ? 168 : val;
    this.saveSetting({ externalRefreshIntervalHours: hours });
  };

  // ── WPE Access handlers ──────────────────────────────────────────────────

  handleOpCardToggle = (op: string): void => {
    this.setState(prev => {
      const expandedOps = new Set(prev.expandedOps);
      if (expandedOps.has(op)) expandedOps.delete(op); else expandedOps.add(op);
      return { expandedOps };
    });
  };

  handleOperationToggle = (operation: WpeOperation, env: WpeEnv, value: boolean): void => {
    const perms = { ...this.getEffectivePermissions() };
    perms[operation] = {
      ...WPE_OPERATION_DEFAULTS[operation],
      ...(perms[operation] ?? {}),
      [env]: value,
    };
    this.saveSetting({ remoteOperationPermissions: perms });
  };

  handleSiteExceptionToggle = (targetRef: string, environment: string, operation: WpeOperation, value: boolean): void => {
    const exceptions = [...this.getEffectiveExceptions()];
    const idx = exceptions.findIndex(e => e.targetRef === targetRef && e.environment === environment);
    if (idx >= 0) {
      exceptions[idx] = { ...exceptions[idx], overrides: { ...exceptions[idx].overrides, [operation]: value } };
    } else {
      exceptions.push({ targetRef, environment, overrides: { [operation]: value } });
    }
    this.saveSetting({ remoteSiteExceptions: exceptions });
  };

  handleSiteExceptionRemove = (targetRef: string, environment: string): void => {
    const exceptions = this.getEffectiveExceptions().filter(
      e => !(e.targetRef === targetRef && e.environment === environment),
    );
    const patch: Partial<NexusSettings> = { remoteSiteExceptions: exceptions };
    // If this leaves the array empty AND the only reason it wasn't already empty was the
    // deprecated key, clear that too — otherwise the fallback in getEffectiveExceptions
    // (and the real permission gate, which uses the identical fallback) resurrects the
    // exception this action was meant to remove.
    if (exceptions.length === 0 && this.state.settings?.wpeSiteExceptions?.length) {
      patch.wpeSiteExceptions = [];
    }
    this.saveSetting(patch);
  };

  handleAccountScopeToggle = (accountId: string, included: boolean): void => {
    const allIds = this.state.wpeAccounts.map(a => a.id);
    const current: string[] = this.state.settings?.wpeAccountFilter ?? allIds;
    const updated = included
      ? [...new Set([...current, accountId])]
      : current.filter(id => id !== accountId);
    this.saveSetting({ wpeAccountFilter: updated });
  };

  // ── Section renders ──────────────────────────────────────────────────────

  renderAutoIndexingSection(): React.ReactNode {
    const { settings, sites, excludedExpanded } = this.state;
    if (!settings) return null;

    return React.createElement('div', { style: cardStyle },
      // Auto-index toggle row
      React.createElement('label', {
        style: { ...rowStyle, borderBottom: settings.autoIndex && sites.length > 0 ? '1px solid var(--nxai-card-border, #30363d)' : 'none', cursor: 'pointer', padding: '10px 13px', display: 'flex', alignItems: 'center', gap: 10 },
      },
        React.createElement('input', {
          type: 'checkbox',
          checked: settings.autoIndex,
          onChange: this.handleAutoIndexToggle,
          style: { width: 16, height: 16, cursor: 'pointer' },
        }),
        React.createElement('div', null,
          React.createElement('div', { style: rowTitleStyle }, 'Automatically index sites when started'),
          React.createElement('div', { style: rowSubStyle }, 'Creates searchable content index when a local site starts.'),
        ),
      ),

      // Excluded sites accordion (only if autoIndex=true and sites exist)
      settings.autoIndex && sites.length > 0
        ? React.createElement('div', null,
            React.createElement('div', {
              style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 13px', cursor: 'pointer', userSelect: 'none' as const, background: 'rgba(128,128,128,0.04)' },
              onClick: () => this.setState(prev => ({ excludedExpanded: !prev.excludedExpanded })),
            },
              React.createElement('span', { style: { fontSize: 13 } }, 'Excluded sites'),
              React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
                React.createElement('span', { style: { fontSize: 11, opacity: 0.5 } },
                  settings.excludedSiteIds.length > 0 ? `${settings.excludedSiteIds.length} excluded` : 'none excluded',
                ),
                React.createElement('span', { style: { fontSize: 9, opacity: 0.5, display: 'inline-block', transform: excludedExpanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' } }, '▶'),
              ),
            ),
            excludedExpanded
              ? React.createElement('div', {
                  style: { borderTop: '1px solid var(--nxai-card-border, #30363d)', padding: '10px 13px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px' },
                },
                  ...sites.map(site =>
                    React.createElement('label', {
                      key: site.id,
                      style: { display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', cursor: 'pointer' },
                    },
                      React.createElement('input', {
                        type: 'checkbox',
                        checked: settings.excludedSiteIds.includes(site.id),
                        onChange: () => this.handleSiteExclusionToggle(site.id),
                        style: { width: 14, height: 14, cursor: 'pointer' },
                      }),
                      React.createElement('span', { style: { fontSize: 13 } }, site.name),
                      React.createElement('span', { style: { fontSize: 11, opacity: 0.45, marginLeft: 2 } }, `(${site.status})`),
                    ),
                  ),
                )
              : null,
          )
        : null,
    );
  }

  renderSyncScheduleSection(): React.ReactNode {
    const { settings } = this.state;
    if (!settings) return null;

    const sublabel = (text: string) => React.createElement('div', {
      style: { fontSize: 11, fontWeight: 700, color: 'var(--nxai-card-sub, #6b7280)', textTransform: 'uppercase' as const, letterSpacing: '.05em', marginBottom: 8, marginTop: 16 },
    }, text);

    return React.createElement('div', null,
      sublabel('Local Sites'),
      React.createElement('div', { style: cardStyle },
        React.createElement('div', { style: rowStyle },
          React.createElement('div', { style: rowLabelStyle },
            React.createElement('div', { style: rowTitleStyle }, 'Content index interval'),
            React.createElement('div', { style: rowSubStyle }, 'Auto-starts halted sites, indexes content, then stops. 0 = manual only.'),
          ),
          React.createElement('div', { style: rowControlStyle },
            React.createElement('input', {
              type: 'checkbox',
              checked: settings.localContentIndexAutoEnabled ?? false,
              onChange: this.handleLocalContentIndexAutoEnabledChange,
              title: 'Enable automatic content indexing',
            }),
            React.createElement('input', {
              type: 'number', min: 0, max: 168,
              value: settings.localContentIndexIntervalHours ?? 8,
              onChange: this.handleLocalContentIndexIntervalChange,
              disabled: !(settings.localContentIndexAutoEnabled ?? false),
              style: { ...numInputStyle, opacity: (settings.localContentIndexAutoEnabled ?? false) ? 1 : 0.4 },
            }),
            React.createElement('span', { style: unitStyle }, 'hrs'),
          ),
        ),
        React.createElement('div', { style: { ...rowStyle, borderBottom: 'none' } },
          React.createElement('div', { style: rowLabelStyle },
            React.createElement('div', { style: rowTitleStyle }, 'Offline site scan'),
            React.createElement('div', { style: rowSubStyle }, 'Filesystem scan for halted sites — updates WP version and plugin list.'),
          ),
          React.createElement('div', { style: rowControlStyle },
            React.createElement('span', { style: { width: 13, display: 'inline-block' } }),
            React.createElement('input', {
              type: 'number', min: 1, max: 168,
              value: settings.haltedSiteRefreshIntervalHours ?? 24,
              onChange: this.handleHaltedRefreshIntervalChange,
              style: numInputStyle,
            }),
            React.createElement('span', { style: unitStyle }, 'hrs'),
          ),
        ),
      ),

      (() => {
        const { wpeAccounts } = this.state;
        if (wpeAccounts.length === 0) return null;
        const accountFilter = settings.wpeAccountFilter;
        const allAccountIds = wpeAccounts.map(a => a.id);
        const includedIds: string[] = accountFilter ?? allAccountIds;
        const allIncluded = !accountFilter || includedIds.length === allAccountIds.length;
        return React.createElement('div', { style: { marginBottom: 14 } },
          React.createElement('div', { style: { display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 } },
            React.createElement('span', { style: { fontSize: 10, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.08em', color: 'var(--nxai-card-sub, #6b7280)' } }, 'WP Engine accounts'),
            React.createElement('span', { style: { fontSize: 11, color: 'var(--nxai-card-sub, #6b7280)' } }, '— included accounts are synced and refreshed on the schedule below'),
          ),
          React.createElement('div', {
            style: { display: 'flex', flexWrap: 'wrap' as const, gap: 5, padding: '9px 12px', background: 'var(--nxai-card-bg, #21262d)', border: '1px solid var(--nxai-card-border, #30363d)', borderRadius: 7, maxHeight: 110, overflowY: 'auto' as const },
          },
            ...wpeAccounts.map(a => {
              const on = allIncluded || includedIds.includes(a.id);
              return React.createElement('span', {
                key: a.id,
                title: on ? 'Click to exclude this account' : 'Click to include this account',
                style: { fontSize: 11, padding: '3px 8px', borderRadius: 4, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, userSelect: 'none' as const, background: on ? 'rgba(81,187,123,0.12)' : 'rgba(128,128,128,0.06)', color: on ? '#51BB7B' : 'var(--nxai-status-neutral, #9ca3af)', border: on ? '1px solid rgba(81,187,123,0.3)' : '1px dashed var(--nxai-card-border, #30363d)', opacity: on ? 1 : 0.6 },
                onClick: (e: React.MouseEvent) => { e.stopPropagation(); this.handleAccountScopeToggle(a.id, !on); },
              },
                React.createElement('span', { style: { fontSize: 9 } }, on ? '✓' : '✗'),
                a.nickname ?? a.name ?? a.id,
              );
            }),
          ),
        );
      })(),

      sublabel('WP Engine Installs'),
      React.createElement('div', { style: cardStyle },
        React.createElement('div', { style: rowStyle },
          React.createElement('div', { style: rowLabelStyle },
            React.createElement('div', { style: rowTitleStyle }, 'Metadata sync'),
            React.createElement('div', { style: rowSubStyle }, 'Fetches wp_version, plugins, users via SSH for each install. Opens one SSH connection per install — production excluded by default (see WPE Access below).'),
          ),
          React.createElement('div', { style: rowControlStyle },
            React.createElement('input', {
              type: 'checkbox',
              checked: settings.wpeSyncAutoEnabled ?? false,
              onChange: this.handleWpeSyncAutoEnabledChange,
              title: 'Enable automatic WPE metadata sync',
            }),
            React.createElement('input', {
              type: 'number', min: 1, max: 168,
              value: settings.wpeSyncIntervalHours ?? 8,
              onChange: this.handleWpeSyncIntervalChange,
              disabled: !(settings.wpeSyncAutoEnabled ?? false),
              style: { ...numInputStyle, opacity: (settings.wpeSyncAutoEnabled ?? false) ? 1 : 0.4 },
            }),
            React.createElement('span', { style: unitStyle }, 'hrs'),
          ),
        ),
        React.createElement('div', { style: rowStyle },
          React.createElement('div', { style: rowLabelStyle },
            React.createElement('div', { style: rowTitleStyle }, 'Site info updates'),
            React.createElement('div', { style: rowSubStyle }, 'URL, admin email, post count via SSH WP-CLI. Also uses one SSH connection per install.'),
          ),
          React.createElement('div', { style: rowControlStyle },
            React.createElement('input', {
              type: 'checkbox',
              checked: settings.wpeRefreshAutoEnabled ?? false,
              onChange: this.handleWpeRefreshAutoEnabledChange,
              title: 'Enable automatic WPE site info refresh',
            }),
            React.createElement('input', {
              type: 'number', min: 1, max: 168,
              value: settings.wpeRefreshIntervalHours ?? 24,
              onChange: this.handleWpeRefreshIntervalChange,
              disabled: !(settings.wpeRefreshAutoEnabled ?? false),
              style: { ...numInputStyle, opacity: (settings.wpeRefreshAutoEnabled ?? false) ? 1 : 0.4 },
            }),
            React.createElement('span', { style: unitStyle }, 'hrs'),
          ),
        ),
        React.createElement('div', { style: { ...rowStyle, borderBottom: 'none' } },
          React.createElement('div', { style: rowLabelStyle },
            React.createElement('div', { style: rowTitleStyle }, 'Content index for WPE'),
            React.createElement('div', { style: rowSubStyle }, 'Indexes post content for semantic search. Runs Metadata sync automatically in the same SSH session — no extra connection cost.'),
          ),
          React.createElement('div', { style: rowControlStyle },
            React.createElement('input', {
              type: 'checkbox',
              checked: settings.wpeContentIndexAutoEnabled ?? false,
              onChange: this.handleWpeContentIndexAutoEnabledChange,
              title: 'Enable automatic WPE content indexing',
            }),
            React.createElement('input', {
              type: 'number', min: 1, max: 168,
              value: settings.wpeContentIndexIntervalHours ?? 24,
              onChange: this.handleWpeContentIndexIntervalChange,
              disabled: !(settings.wpeContentIndexAutoEnabled ?? false),
              style: { ...numInputStyle, opacity: (settings.wpeContentIndexAutoEnabled ?? false) ? 1 : 0.4 },
            }),
            React.createElement('span', { style: unitStyle }, 'hrs'),
          ),
        ),
      ),

      sublabel('External SSH Hosts'),
      React.createElement('div', { style: { marginBottom: 6 } },
        this.state.externalHosts.length === 0
          ? React.createElement('div', { style: { fontSize: 12, color: 'var(--nxai-card-sub, #6b7280)', padding: '4px 0 10px' } },
              'No external hosts registered. Run `nexus host add <alias>` from the CLI.')
          : React.createElement('div', {
              style: { display: 'flex', flexWrap: 'wrap' as const, gap: 5, padding: '9px 12px', background: 'var(--nxai-card-bg, #21262d)', border: '1px solid var(--nxai-card-border, #30363d)', borderRadius: '7px 7px 0 0', borderBottom: 'none' },
            },
              ...this.state.externalHosts.map(h =>
                React.createElement('span', {
                  key: `${h.alias}/${h.site}`,
                  title: `${h.domain || h.alias} — ${h.environment}`,
                  style: { fontSize: 11, padding: '3px 8px', borderRadius: 4, display: 'flex', alignItems: 'center', gap: 4, background: 'rgba(128,128,128,0.06)', color: 'var(--nxai-status-neutral, #9ca3af)', border: '1px dashed var(--nxai-card-border, #30363d)' },
                }, `${h.alias}/${h.site}`),
              ),
            ),
      ),
      React.createElement('div', { style: { marginBottom: 10 } },
        React.createElement('div', { style: { display: 'flex', gap: 6, marginBottom: 6 } },
          React.createElement('input', {
            type: 'text',
            placeholder: 'alias to check',
            value: this.state.hostKeyCheckAlias,
            onChange: (e: any) => this.setState({ hostKeyCheckAlias: e.target.value }),
            style: { flex: 1, fontSize: 12, padding: '4px 8px', background: 'var(--nxai-card-bg, #21262d)', border: '1px solid var(--nxai-card-border, #30363d)', borderRadius: 4, color: 'inherit' },
          }),
          React.createElement('button', {
            onClick: () => this.checkHostKey(),
            style: { fontSize: 12, padding: '4px 10px', borderRadius: 4 },
          }, 'Check'),
        ),
        this.state.hostKeyCheckResult && React.createElement('div', {
          style: { fontSize: 12, padding: '8px 10px', background: 'var(--nxai-card-bg, #21262d)', border: '1px solid var(--nxai-card-border, #30363d)', borderRadius: 4 },
        },
          this.state.hostKeyCheckResult.ok
            ? React.createElement('div', {}, this.state.hostKeyCheckResult.detail || 'Already reachable — no key approval needed.')
            : this.state.hostKeyCheckResult.failureKind === 'host-key-unknown' && this.state.hostKeyCheckResult.fingerprint
              ? (() => {
                  // The Approve button must only ever act on the fingerprint the
                  // human actually saw. If the alias input has been edited since
                  // this result was fetched, the displayed fingerprint no longer
                  // corresponds to what's typed — the button must not render, so
                  // it can never be clicked for a host whose key was never shown.
                  const staleAlias = this.state.hostKeyCheckAlias.trim() !== this.state.hostKeyCheckedAlias;
                  return React.createElement('div', {},
                    React.createElement('div', {}, `${this.state.hostKeyCheckResult.keyType} ${this.state.hostKeyCheckResult.fingerprint}`),
                    staleAlias
                      ? React.createElement('div', { style: { marginTop: 6, opacity: 0.6 } }, 'Alias changed since this check — check again to approve.')
                      : React.createElement('div', { style: { display: 'flex', gap: 6, marginTop: 6 } },
                          React.createElement('button', {
                            disabled: this.state.hostKeyTrusting,
                            onClick: () => this.approveHostKey(),
                            style: { fontSize: 12, padding: '4px 10px', borderRadius: 4 },
                          }, 'Approve'),
                          React.createElement('button', {
                            onClick: () => this.setState({ hostKeyCheckResult: null, hostKeyCheckedAlias: '' }),
                            style: { fontSize: 12, padding: '4px 10px', borderRadius: 4 },
                          }, 'Dismiss'),
                        ),
                  );
                })()
              : React.createElement('div', {}, this.state.hostKeyCheckResult.remedy || this.state.hostKeyCheckResult.detail),
        ),
      ),
      React.createElement('div', { style: { ...cardStyle, borderTopLeftRadius: this.state.externalHosts.length ? 0 : 8, borderTopRightRadius: this.state.externalHosts.length ? 0 : 8 } },
        React.createElement('div', { style: { ...rowStyle, borderBottom: 'none' } },
          React.createElement('div', { style: rowLabelStyle },
            React.createElement('div', { style: rowTitleStyle }, 'Metadata refresh for external hosts'),
            React.createElement('div', { style: rowSubStyle }, 'Off by default. Nexus does not SSH into a third-party host on a timer unless you ask it to.'),
          ),
          React.createElement('div', { style: rowControlStyle },
            React.createElement('input', {
              type: 'checkbox',
              checked: settings.externalRefreshAutoEnabled ?? false,
              onChange: this.handleExternalRefreshAutoEnabledChange,
              title: 'Enable automatic external host metadata refresh',
            }),
            React.createElement('input', {
              type: 'number', min: 1, max: 168,
              value: settings.externalRefreshIntervalHours ?? 24,
              onChange: this.handleExternalRefreshIntervalChange,
              disabled: !(settings.externalRefreshAutoEnabled ?? false),
              style: { ...numInputStyle, opacity: (settings.externalRefreshAutoEnabled ?? false) ? 1 : 0.4 },
            }),
            React.createElement('span', { style: unitStyle }, 'hrs'),
          ),
        ),
      ),
    );
  }

  renderWpeAccessSection(): React.ReactNode {
    const { settings, wpeInstalls, expandedOps, addingException, installSearch, accessExpanded } = this.state;
    if (!settings) return null;

    const perms = this.getEffectivePermissions();
    const exceptions = this.getEffectiveExceptions();

    const getPermVal = (op: WpeOperation, env: WpeEnv): boolean => {
      const custom = (perms as any)[op]?.[env];
      return custom !== undefined ? custom : WPE_OPERATION_DEFAULTS[op][env];
    };

    const OPERATIONS: Array<{ id: WpeOperation; label: string; sub: string; icon: string; scope: 'wpe' | 'both' }> = [
      { id: 'pull',       label: 'Pull to local',              sub: 'Download files + database from WPE',                              icon: '⬇', scope: 'wpe' },
      { id: 'wpcli_read', label: 'WP-CLI over SSH (Read)',     sub: 'plugin list, core version, user list — read-only SSH commands',   icon: '⌨', scope: 'both' },
      { id: 'wpcli',      label: 'WP-CLI over SSH (Write)',    sub: 'plugin install/update, core update — modifying SSH commands',     icon: '⌨', scope: 'both' },
      { id: 'push',       label: 'Push to WPE',                sub: 'Overwrite remote with local files and DB',                        icon: '⬆', scope: 'wpe' },
      { id: 'delete',     label: 'Delete / Promote',           sub: 'Irreversible CAPI operations',                                    icon: '🗑', scope: 'wpe' },
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

    const blockedForWrite = !getPermVal('wpcli', 'production');
    const blockedForPush = !getPermVal('push', 'production');
    const blockedForDelete = !getPermVal('delete', 'production');
    const summaryParts: string[] = [];
    const blockedItems: string[] = [];
    if (blockedForWrite) blockedItems.push('SSH write');
    if (blockedForPush) blockedItems.push('push');
    if (blockedForDelete) blockedItems.push('delete');
    if (blockedItems.length > 0) summaryParts.push(`production blocked for ${blockedItems.join(' & ')}`);
    const headerSummary = summaryParts.join(' · ');

    const envPill = (label: string, on: boolean) =>
      React.createElement('span', {
        style: { fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4, letterSpacing: '0.02em', background: on ? 'rgba(81,187,123,0.12)' : 'rgba(248,113,113,0.12)', color: on ? '#51BB7B' : '#f87171' },
      }, label);

    const renderOpCard = (op: typeof OPERATIONS[number]): React.ReactNode => {
      const expanded = expandedOps.has(op.id);
      const devOn = getPermVal(op.id, 'development');
      const stgOn = getPermVal(op.id, 'staging');
      const prdOn = getPermVal(op.id, 'production');
      const opExceptions = exceptions.filter(e => op.id in e.overrides);
      const scopeChip = React.createElement('span', {
        style: {
          fontSize: 9, fontWeight: 700, letterSpacing: '0.05em', padding: '1px 6px', borderRadius: 4, textTransform: 'uppercase' as const, flexShrink: 0,
          background: op.scope === 'both' ? 'rgba(90,169,230,0.14)' : 'rgba(224,164,88,0.14)',
          color: op.scope === 'both' ? '#5aa9e6' : '#e0a458',
        },
      }, op.scope === 'both' ? 'WPE + SSH' : 'WPE only');

      return React.createElement('div', {
        key: op.id,
        style: { border: '1px solid var(--nxai-card-border, #30363d)', borderRadius: 7, overflow: 'hidden', marginBottom: 5, opacity: op.scope === 'wpe' ? 0.6 : 1 },
      },
        React.createElement('div', {
          style: { display: 'flex', alignItems: 'center', gap: 11, padding: '10px 13px', background: 'var(--nxai-card-bg, #21262d)', cursor: 'pointer' },
          onClick: () => this.handleOpCardToggle(op.id),
        },
          React.createElement('div', { style: { width: 28, height: 28, borderRadius: 7, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, background: 'rgba(128,128,128,0.08)' } }, op.icon),
          React.createElement('div', { style: { flex: 1, minWidth: 0 } },
            React.createElement('div', { style: { fontSize: 13, fontWeight: 600 } }, op.label),
            React.createElement('div', { style: { fontSize: 11, color: 'var(--nxai-card-sub, #6b7280)', marginTop: 1 } }, op.sub),
          ),
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 } },
            scopeChip,
            envPill('Dev', devOn),
            envPill('Stg', stgOn),
            envPill('Prd', prdOn),
            opExceptions.length > 0
              ? React.createElement('span', { style: { fontSize: 10, color: '#0ECAD4', background: 'rgba(14,202,212,0.08)', border: '1px solid rgba(14,202,212,0.18)', borderRadius: 10, padding: '2px 7px' } },
                  `${opExceptions.length} exception${opExceptions.length !== 1 ? 's' : ''}`)
              : null,
            React.createElement('span', { style: { color: 'var(--nxai-status-neutral, #9ca3af)', fontSize: 9, display: 'inline-block', transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' } }, '▶'),
          ),
        ),
        expanded ? React.createElement('div', {
          style: { background: 'var(--nxai-code-bg, #1f1f1f)', borderTop: '1px solid var(--nxai-card-border, #30363d)', padding: '14px 15px' },
          onClick: (e: React.MouseEvent) => e.stopPropagation(),
        },
          React.createElement('div', { style: { fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' as const, color: 'var(--nxai-card-sub, #6b7280)', marginBottom: 9 } }, 'Default by environment'),
          ...(['development', 'staging', 'production'] as const).map(env => {
            const dotColor = env === 'development' ? '#51BB7B' : env === 'staging' ? '#fbbf24' : '#f87171';
            const val = getPermVal(op.id, env);
            return React.createElement('div', {
              key: env,
              style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 0', borderBottom: env !== 'production' ? '1px solid var(--nxai-card-border, #30363d)' : 'none' },
            },
              React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 } },
                React.createElement('div', { style: { width: 7, height: 7, borderRadius: '50%', background: dotColor, flexShrink: 0 } }),
                React.createElement('span', { style: { textTransform: 'capitalize' as const } }, env),
              ),
              renderToggle(val, v => this.handleOperationToggle(op.id, env, v)),
            );
          }),
          React.createElement('div', { style: { height: 1, background: 'var(--nxai-card-border, #30363d)', margin: '13px 0' } }),
          React.createElement('div', { style: { fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' as const, color: 'var(--nxai-card-sub, #6b7280)', marginBottom: 9 } }, 'Site exceptions'),
          opExceptions.length === 0
            ? React.createElement('div', { style: { fontSize: 12, color: 'var(--nxai-status-neutral, #9ca3af)', marginBottom: 8 } }, 'No exceptions — all sites follow global defaults.')
            : React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 5, marginBottom: 8 } },
                ...opExceptions.map(exc =>
                  React.createElement('div', {
                    key: `${exc.targetRef}-${exc.environment}`,
                    style: { display: 'flex', alignItems: 'center', gap: 7, background: 'var(--nxai-card-bg, #21262d)', borderRadius: 6, padding: '6px 10px', fontSize: 12 },
                  },
                    React.createElement('span', { style: { fontWeight: 500 } }, exc.targetRef),
                    React.createElement('span', { style: { fontSize: 10, color: 'var(--nxai-card-sub, #6b7280)', background: 'rgba(128,128,128,0.1)', borderRadius: 4, padding: '1px 6px' } }, exc.environment),
                    React.createElement('span', { style: { fontSize: 10, fontWeight: 700, color: exc.overrides[op.id] ? '#51BB7B' : '#f87171' } }, exc.overrides[op.id] ? 'allow' : 'block'),
                    React.createElement('span', { style: { flex: 1 } }),
                    React.createElement('span', {
                      style: { color: 'var(--nxai-status-neutral, #9ca3af)', cursor: 'pointer', fontSize: 14, padding: '0 3px', lineHeight: 1 },
                      onClick: (e: React.MouseEvent) => { e.stopPropagation(); this.handleSiteExceptionRemove(exc.targetRef, exc.environment); },
                    }, '×'),
                  ),
                ),
              ),
          addingException?.op === op.id
            ? React.createElement('div', {
                style: { background: 'var(--nxai-card-bg, #21262d)', border: '1px solid rgba(59,130,246,0.4)', borderRadius: 6, padding: '10px 12px' },
                onClick: (e: React.MouseEvent) => e.stopPropagation(),
              },
                React.createElement('input', {
                  type: 'text', placeholder: 'Search installs and SSH hosts…', value: installSearch, autoFocus: true,
                  onChange: (e: any) => this.setState({ installSearch: e.target.value }),
                  style: { width: '100%', fontSize: 12, padding: '6px 8px', background: 'var(--nxai-code-bg, #1f1f1f)', border: '1px solid var(--nxai-card-border, #30363d)', borderRadius: 4, color: 'var(--nxai-card-text, #e6edf3)', fontFamily: 'inherit', marginBottom: 6 },
                }),
                React.createElement('div', { style: { maxHeight: 180, overflowY: 'auto' as const, display: 'flex', flexDirection: 'column' as const, gap: 2, marginBottom: 8 } },
                  (() => {
                    const q = installSearch.toLowerCase();
                    const wpeMatches = wpeInstalls.filter(i => !q || i.installName.toLowerCase().includes(q) || i.primaryDomain.toLowerCase().includes(q)).slice(0, 30);
                    const externalMatches = this.state.externalHosts.filter(h => !q || h.alias.toLowerCase().includes(q) || h.site.toLowerCase().includes(q) || h.domain.toLowerCase().includes(q)).slice(0, 30);

                    const renderPick = (targetRef: string, label: string, environment: string, kind: 'wpe' | 'ssh') => {
                      const isSelected = addingException?.targetRef === targetRef;
                      const envColor = environment === 'production' ? '#f87171' : environment === 'staging' ? '#fbbf24' : '#51BB7B';
                      return React.createElement('div', {
                        key: targetRef,
                        style: { display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', borderRadius: 4, cursor: 'pointer', background: isSelected ? 'rgba(59,130,246,0.15)' : 'transparent', border: isSelected ? '1px solid rgba(59,130,246,0.4)' : '1px solid transparent' },
                        onClick: () => this.setState(prev => ({ addingException: prev.addingException ? { ...prev.addingException, targetRef, environment } : null })),
                      },
                        React.createElement('div', { style: { width: 6, height: 6, borderRadius: '50%', background: envColor, flexShrink: 0 } }),
                        React.createElement('span', { style: { flex: 1, fontSize: 12, fontWeight: 500 } }, label),
                        React.createElement('span', {
                          style: { fontSize: 9, fontWeight: 700, letterSpacing: '0.05em', padding: '1px 5px', borderRadius: 3, textTransform: 'uppercase' as const, background: kind === 'wpe' ? 'rgba(224,164,88,0.14)' : 'rgba(90,169,230,0.16)', color: kind === 'wpe' ? '#e0a458' : '#5aa9e6' },
                        }, kind),
                        React.createElement('span', { style: { fontSize: 10, color: 'var(--nxai-card-sub, #6b7280)' } }, environment),
                        isSelected ? React.createElement('span', { style: { fontSize: 10, color: '#3b82f6' } }, '✓') : null,
                      );
                    };
                    const groupLabel = (text: string) => React.createElement('div', {
                      key: `grp-${text}`,
                      style: { fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase' as const, color: 'var(--nxai-card-sub, #6b7280)', padding: '6px 4px 2px' },
                    }, text);

                    if (wpeMatches.length === 0 && externalMatches.length === 0) {
                      return [React.createElement('div', { key: 'empty', style: { fontSize: 11, color: 'var(--nxai-status-neutral, #9ca3af)', padding: '6px 4px', fontStyle: 'italic' as const } }, 'No installs or hosts found')];
                    }
                    const out: React.ReactNode[] = [];
                    if (wpeMatches.length > 0) {
                      out.push(groupLabel('WP Engine installs'));
                      out.push(...wpeMatches.map(i => renderPick(`wpe:${i.installName}`, i.installName, i.environment, 'wpe')));
                    }
                    if (externalMatches.length > 0) {
                      out.push(groupLabel('External SSH hosts'));
                      out.push(...externalMatches.map(h => renderPick(`ssh:${h.alias}/${h.site}`, `${h.alias}/${h.site}`, h.environment, 'ssh')));
                    }
                    return out;
                  })(),
                ),
                React.createElement('div', { style: { borderTop: '1px solid var(--nxai-card-border, #30363d)', paddingTop: 8, display: 'flex', alignItems: 'center', gap: 8 } },
                  addingException?.targetRef
                    ? React.createElement('span', { style: { fontSize: 11, flex: 1 } },
                        React.createElement('strong', null, addingException.targetRef),
                        ' · ',
                        React.createElement('span', { style: { color: 'var(--nxai-card-sub, #6b7280)' } }, addingException.environment),
                      )
                    : React.createElement('span', { style: { fontSize: 11, color: 'var(--nxai-status-neutral, #9ca3af)', flex: 1, fontStyle: 'italic' as const } }, 'Select an install or host above'),
                  React.createElement('label', { style: { display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, cursor: 'pointer' } },
                    React.createElement('input', {
                      type: 'checkbox', checked: addingException?.allowing ?? true,
                      onChange: (e: any) => { const v = e.target.checked; this.setState(prev => ({ addingException: prev.addingException ? { ...prev.addingException, allowing: v } : null })); },
                    }),
                    React.createElement('span', { style: { color: (addingException?.allowing ?? true) ? '#51BB7B' : '#f87171' } }, (addingException?.allowing ?? true) ? 'Allow' : 'Block'),
                  ),
                  React.createElement('button', {
                    style: { fontSize: 11, padding: '4px 10px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 4, cursor: addingException?.targetRef ? 'pointer' : 'not-allowed', opacity: addingException?.targetRef ? 1 : 0.5, fontFamily: 'inherit' },
                    disabled: !addingException?.targetRef,
                    onClick: (e: React.MouseEvent) => {
                      e.stopPropagation();
                      if (!addingException?.targetRef) return;
                      this.handleSiteExceptionToggle(addingException.targetRef, addingException.environment, op.id as WpeOperation, addingException.allowing);
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
                style: { background: 'none', border: 'none', fontSize: 12, color: '#0ECAD4', cursor: 'pointer', padding: '3px 0', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 5 },
                onClick: (e: React.MouseEvent) => { e.stopPropagation(); this.setState({ addingException: { op: op.id, targetRef: '', environment: 'production', allowing: true } }); },
              }, '+ Add site exception'),
        ) : null,
      );
    };

    return React.createElement('div', {
      style: { border: '1px solid var(--nxai-card-border, #30363d)', borderRadius: 8, overflow: 'hidden', marginBottom: 14 },
    },
      React.createElement('div', {
        style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 14px', background: 'var(--nxai-card-bg, #21262d)', cursor: 'pointer', userSelect: 'none' as const },
        onClick: () => this.setState(prev => ({ accessExpanded: !prev.accessExpanded })),
      },
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          React.createElement('span', { style: { fontSize: 13, fontWeight: 600 } }, 'Access & Permissions'),
          React.createElement('span', { style: { fontSize: 10, background: 'rgba(128,128,128,0.1)', color: 'var(--nxai-card-sub, #6b7280)', borderRadius: 4, padding: '2px 6px' } }, 'Advanced'),
        ),
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          React.createElement('span', { style: { fontSize: 11, color: 'var(--nxai-card-sub, #6b7280)' } }, headerSummary),
          React.createElement('span', { style: { fontSize: 9, color: 'var(--nxai-status-neutral, #9ca3af)', display: 'inline-block', transform: accessExpanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' } }, '▶'),
        ),
      ),
      accessExpanded ? React.createElement('div', {
        style: { borderTop: '1px solid var(--nxai-card-border, #30363d)', padding: 16, background: 'rgba(255,255,255,0.01)' },
      },
        React.createElement('div', { style: { fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' as const, color: 'var(--nxai-card-sub, #6b7280)', marginBottom: 9 } }, 'Operation Permissions'),
        ...OPERATIONS.map(renderOpCard),
        React.createElement('div', {
          style: { display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 11px', background: 'rgba(14,202,212,0.05)', border: '1px solid rgba(14,202,212,0.12)', borderRadius: 6, fontSize: 11, color: 'var(--nxai-muted, #6aacb0)', lineHeight: '1.55', marginTop: 12 },
        },
          React.createElement('span', null, 'ℹ'),
          React.createElement('span', null,
            React.createElement('strong', null, 'Read-only operations'),
            ' (installs, domains, SSL, usage metadata) are always permitted and cannot be disabled.',
          ),
        ),
      ) : null,
    );
  }

  // ── Main render ───────────────────────────────────────────────────────────

  render(): React.ReactNode {
    const { loading } = this.state;

    if (loading) {
      return React.createElement('div', {
        style: { padding: 24, color: 'var(--nxai-card-sub, #6b7280)', fontSize: 13 },
      }, 'Loading settings…');
    }

    const sectionHeader = (title: string) =>
      React.createElement('div', { style: sectionHeaderStyle }, title);

    return React.createElement('div', { style: { padding: '20px 24px', overflowY: 'auto' as const } },
      sectionHeader('Auto-Indexing'),
      this.renderAutoIndexingSection(),
      sectionHeader('Sync Schedule'),
      this.renderSyncScheduleSection(),
      sectionHeader('Access & Permissions'),
      this.renderWpeAccessSection(),
    );
  }
}
