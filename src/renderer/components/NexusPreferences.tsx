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
import { injectThemeVars } from '../utils/theme';
import { rendererGql } from '../utils/rendererGql';
import { ExternalHostAddWizard } from './settings/ExternalHostAddWizard';
import type { SshConfigHostLike } from './settings/ExternalHostAddWizard';

// ---------------------------------------------------------------------------
// Host-key probe timeout
// ---------------------------------------------------------------------------

/**
 * Must stay in sync with `probeExternalHost`'s documented sequential worst
 * case (~155s: 5s config dump + 6x20s steps + 30s discovery — see the
 * docblock in src/main/external/probeExternalHost.ts), with
 * HOST_PROBE_CLIENT_TIMEOUT_MS in src/cli/commands/host.ts (the CLI's own
 * copy), and with the identical constant in
 * src/renderer/components/settings/ExternalHostAddWizard.tsx. Duplicated
 * rather than imported because none of these three surfaces export it; if you
 * raise one, raise all three. rendererGql's own default (10s) is sized for
 * ordinary queries, not a remote SSH probe, so this call must pass its own
 * timeout explicitly.
 */
const HOST_PROBE_CLIENT_TIMEOUT_MS = 210000;

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
  accessExpanded: boolean;
  excludedExpanded: boolean;
  addingException: { op: string; installName: string; environment: string; allowing: boolean } | null;
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
  // External SSH Hosts
  externalHosts: Array<{ alias: string; site: string; environment: string; domain: string }>;
  /** Connection info for every alias in ~/.ssh/config, including already-
   *  registered ones -- LIST_SSH_CONFIG_HOSTS is the only source that carries
   *  user/hostname/port, so this is joined against externalHosts by alias to
   *  render "user@host:port · from ~/.ssh/config" in the host list. */
  sshConfigHosts: SshConfigHostLike[];
  hostKeyCheckAlias: string;
  hostKeyCheckResult: null | { ok: boolean; failureKind?: string; detail?: string; remedy?: string; fingerprint?: string; keyType?: string };
  hostKeyCheckedAlias: string;
  hostKeyTrusting: boolean;
  hostKeyChecking: boolean;
  showAddHostWizard: boolean;
  /** Alias whose inline Manage row (root-mode toggle) is currently expanded, or null. */
  manageAlias: string | null;
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
  overflowWrap: 'break-word',
  wordBreak: 'break-word',
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

// Matches Local's FlySelect visual style: appearance:none + custom green chevron SVG
const SELECT_CHEVRON_SVG = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='8' viewBox='0 0 14 8'%3E%3Cpath d='M1 1l6 6 6-6' stroke='%2351bb7b' stroke-width='2' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`;

const selectStyle: React.CSSProperties = {
  appearance: 'none' as const,
  WebkitAppearance: 'none' as const,
  padding: '7px 32px 7px 10px',
  fontSize: '13px',
  borderRadius: '4px',
  border: '1px solid #d1d5db',
  outline: 'none',
  width: '100%',
  maxWidth: '350px',
  cursor: 'pointer',
  background: `white ${SELECT_CHEVRON_SVG} no-repeat right 10px center`,
  color: '#111827',
  fontFamily: 'inherit',
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
  background: 'var(--nxai-input-bg, transparent)',
  color: 'inherit',
};

const btnSmallStyle: React.CSSProperties = {
  padding: '6px 12px',
  borderRadius: '6px',
  border: '1px solid var(--nxai-card-border, #30363d)',
  background: 'var(--nxai-card-bg, transparent)',
  color: 'inherit',
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

// ---------------------------------------------------------------------------
// External SSH Hosts styles — distinct names from rowStyle/cardStyle above
// since those are already used (with a different shape) by the chat/WPE/AWS
// sections. Matches SettingsTab.tsx's original visual language for the host
// list rows (bordered list rows + a right-hand control column), not this
// file's own row/card conventions.
// ---------------------------------------------------------------------------

const hostRowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', borderBottom: '1px solid var(--nxai-card-border, #30363d)',
};
const hostRowLabelStyle: React.CSSProperties = { flex: 1, padding: '10px 13px' };
const hostRowTitleStyle: React.CSSProperties = { fontSize: 12 };
const hostRowSubStyle: React.CSSProperties = { fontSize: 11, opacity: 0.45, marginTop: 2 };
const hostRowControlStyle: React.CSSProperties = {
  padding: '10px 13px', borderLeft: '1px solid var(--nxai-card-border, #30363d)',
  background: 'rgba(128,128,128,0.04)', display: 'flex', alignItems: 'center', gap: 6,
};
const hostCardStyle: React.CSSProperties = {
  border: '1px solid var(--nxai-card-border, #30363d)', borderRadius: 8, overflow: 'hidden',
  marginBottom: 16, background: 'var(--nxai-card-bg, #21262d)',
};

const WPE_OPERATION_DEFAULTS = {
  pull:       { development: true,  staging: true,  production: true  },
  wpcli_read: { development: true,  staging: true,  production: true  },
  wpcli:      { development: true,  staging: true,  production: false },
  push:       { development: true,  staging: true,  production: false },
  delete:     { development: false, staging: false, production: false },
} as const;

type WpeOperation = keyof typeof WPE_OPERATION_DEFAULTS;
type WpeEnv = 'development' | 'staging' | 'production';

export class NexusPreferences extends React.Component<NexusPreferencesProps, NexusPreferencesState> {
  private mounted = false;
  // Bumped at the start of every checkHostKey() call. Lets a call that
  // resolves late (superseded by a newer one) tell whether it is still the
  // most recent in-flight request before touching hostKeyChecking — otherwise
  // a stale response arriving after a newer check has already started would
  // clear the flag out from under that newer, still-running check.
  private hostKeyCheckSeq = 0;

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
    accessExpanded: true,
    excludedExpanded: false,
    addingException: null,
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
    externalHosts: [],
    sshConfigHosts: [],
    hostKeyCheckAlias: '',
    hostKeyCheckResult: null,
    hostKeyCheckedAlias: '',
    hostKeyTrusting: false,
    hostKeyChecking: false,
    showAddHostWizard: false,
    manageAlias: null,
  };

  componentDidMount(): void {
    this.mounted = true;
    injectThemeVars();
    this.fetchData();
  }

  componentWillUnmount(): void {
    this.mounted = false;
  }

  fetchData = async (): Promise<void> => {
    const ipc = this.props.electron.ipcRenderer;
    try {
      const [settings, sites, providers, keyStatus, wpeCredsStatus, wpeAccounts, wpeInstalls, awsStatus, externalHosts, sshConfigHosts] = await Promise.all([
        ipc.invoke(IPC_CHANNELS.GET_SETTINGS),
        ipc.invoke(IPC_CHANNELS.GET_SITES),
        ipc.invoke(IPC_CHANNELS.GET_PROVIDERS),
        ipc.invoke(IPC_CHANNELS.GET_API_KEY_STATUS),
        ipc.invoke(IPC_CHANNELS.WPE_GET_API_CREDENTIALS_STATUS),
        ipc.invoke(IPC_CHANNELS.GET_WPE_ACCOUNTS).catch(() => []),
        ipc.invoke(IPC_CHANNELS.GET_WPE_INSTALLS_CACHE).catch(() => []),
        ipc.invoke(IPC_CHANNELS.CREDENTIAL_API_KEY_STATUS, { provider: 'aws' }).catch(() => null),
        ipc.invoke(IPC_CHANNELS.GET_EXTERNAL_HOSTS).catch(() => []),
        ipc.invoke(IPC_CHANNELS.LIST_SSH_CONFIG_HOSTS).catch(() => ({ success: false, hosts: [] })),
      ]);
      if (!this.mounted) return;
      const awsStatusTyped = awsStatus as { connections: Array<{ id: string; label: string; status: string }> } | null;
      const activeAws = awsStatusTyped?.connections?.find((c: any) => c.status === 'active');
      const revokedAws = awsStatusTyped?.connections?.find((c: any) => c.status === 'revoked');
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
        awsConnected: !!activeAws,
        awsRevoked: !activeAws && !!revokedAws,
        awsLabel: activeAws?.label ?? revokedAws?.label ?? '',
        awsConnectionId: activeAws?.id ?? revokedAws?.id ?? '',
        externalHosts: Array.isArray(externalHosts) ? externalHosts : [],
        sshConfigHosts: Array.isArray((sshConfigHosts as any)?.hosts) ? (sshConfigHosts as any).hosts : [],
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

  /** Save settings immediately via IPC — use for inline forms (exceptions, account filter)
   *  where users expect "Save" to persist without hitting the outer Apply button. */
  saveNow = async (settings: NexusSettings): Promise<void> => {
    try {
      await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.UPDATE_SETTINGS, settings);
    } catch {
      // Best-effort — the Apply button flow is still the fallback
    }
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

  handleLocalContentIndexIntervalChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const hours = Math.max(0, Math.min(168, parseInt(e.target.value, 10) || 0));
    this.setState(prev => ({
      settings: { ...prev.settings, localContentIndexIntervalHours: hours },
    }));
  };

  handleLocalContentIndexAutoEnabledChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    this.setState(prev => ({
      settings: { ...prev.settings, localContentIndexAutoEnabled: e.target.checked },
    }));
  };

  // -----------------------------------------------------------------------
  // External SSH Hosts — host list, host-key trust-on-first-use, Add Host wizard
  // -----------------------------------------------------------------------

  /** Re-fetches just the external-host-list data. Used by the wizard's
   *  onClose/onCompleted so the newly-registered (or unchanged) host list is
   *  current without re-running the rest of fetchData's fetches. */
  reloadExternalHosts = async (): Promise<void> => {
    const ipc = this.props.electron.ipcRenderer;
    const [externalHosts, sshConfigHosts] = await Promise.all([
      ipc.invoke(IPC_CHANNELS.GET_EXTERNAL_HOSTS).catch(() => []),
      ipc.invoke(IPC_CHANNELS.LIST_SSH_CONFIG_HOSTS).catch(() => ({ success: false, hosts: [] })),
    ]);
    if (!this.mounted) return;
    this.setState({
      externalHosts: Array.isArray(externalHosts) ? externalHosts : [],
      sshConfigHosts: Array.isArray((sshConfigHosts as any)?.hosts) ? (sshConfigHosts as any).hosts : [],
    });
  };

  private groupedExternalHosts(): Array<{ alias: string; sites: Array<{ site: string; environment: string; domain: string }>; connection: string | null }> {
    const byAlias = new Map<string, Array<{ site: string; environment: string; domain: string }>>();
    for (const h of this.state.externalHosts) {
      const arr = byAlias.get(h.alias) ?? [];
      arr.push({ site: h.site, environment: h.environment, domain: h.domain });
      byAlias.set(h.alias, arr);
    }
    return Array.from(byAlias.entries()).map(([alias, sites]) => {
      const cfg = this.state.sshConfigHosts.find(c => c.alias === alias);
      const connection = cfg
        ? `${cfg.user ? cfg.user + '@' : ''}${cfg.hostname}${cfg.port ? ':' + cfg.port : ''} · from ~/.ssh/config`
        : null;
      return { alias, sites, connection };
    });
  }

  openAddHostWizard = (): void => {
    this.setState({ showAddHostWizard: true });
  };

  closeAddHostWizard = async (): Promise<void> => {
    this.setState({ showAddHostWizard: false });
    await this.reloadExternalHosts();
  };

  completeAddHostWizard = async (_alias: string): Promise<void> => {
    this.setState({ showAddHostWizard: false });
    await this.reloadExternalHosts();
  };

  toggleManageAlias = (alias: string): void => {
    this.setState(prev => ({ manageAlias: prev.manageAlias === alias ? null : alias }));
  };

  handleSetRootMode = async (alias: string, allowRoot: boolean): Promise<void> => {
    try {
      await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.SET_EXTERNAL_HOST_ROOT_MODE, alias, allowRoot);
    } catch {
      // Best-effort -- Manage stays open (see renderManagePopover) so the user can retry.
    }
  };

  /**
   * GET_EXTERNAL_HOSTS carries no last-check timestamp or outcome (see
   * src/main/ipc-handlers.ts's handler -- it selects only name/account_id/
   * environment/domain from the sites table), so a genuine three-state dot
   * (verified/config-changed/last-check-failed, per BEHAVIOR.md §3) is not
   * buildable from data this plan added. This is the documented, deliberate
   * fallback: a simple two-state dot keyed on whether the alias still
   * resolves in ~/.ssh/config (LIST_SSH_CONFIG_HOSTS), which is the one
   * piece of "is something wrong" signal actually available today.
   */
  private hostStatusDot(alias: string): React.ReactNode {
    const stillConfigured = this.state.sshConfigHosts.some(c => c.alias === alias);
    const color = stillConfigured ? 'var(--nxai-status-ok, #3fb950)' : 'var(--nxai-status-warn, #d29922)';
    const title = stillConfigured ? 'Alias found in ~/.ssh/config' : 'Alias missing from ~/.ssh/config';
    return React.createElement('div', {
      title,
      style: { width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 },
    });
  }

  renderManagePopover(alias: string): React.ReactNode {
    return React.createElement('div', { style: { display: 'flex', gap: 6, alignItems: 'center' } },
      React.createElement('button', {
        onClick: () => this.handleSetRootMode(alias, true),
        style: { fontSize: 11, padding: '3px 8px', borderRadius: 4 },
      }, 'Allow root'),
      React.createElement('button', {
        onClick: () => this.handleSetRootMode(alias, false),
        style: { fontSize: 11, padding: '3px 8px', borderRadius: 4 },
      }, 'Disallow root'),
      React.createElement('button', {
        onClick: () => this.toggleManageAlias(alias),
        style: { fontSize: 11, padding: '3px 8px', borderRadius: 4 },
      }, 'Done'),
    );
  }

  renderExternalHostRow(row: { alias: string; sites: Array<{ site: string; environment: string; domain: string }>; connection: string | null }): React.ReactNode {
    const siteCountLabel = `${row.sites.length} site${row.sites.length === 1 ? '' : 's'}`;
    return React.createElement('div', { key: row.alias, style: hostRowStyle },
      React.createElement('div', { style: hostRowLabelStyle },
        React.createElement('div', { style: { ...hostRowTitleStyle, fontWeight: 700 } }, row.alias),
        React.createElement('div', { style: hostRowSubStyle },
          row.connection ?? 'Connection info unavailable — run `nexus host test ' + row.alias + '`.'),
        React.createElement('div', { style: hostRowSubStyle }, siteCountLabel),
      ),
      React.createElement('div', { style: { ...hostRowControlStyle, gap: 10 } },
        this.hostStatusDot(row.alias),
        this.state.manageAlias === row.alias
          ? this.renderManagePopover(row.alias)
          : React.createElement('button', {
              onClick: () => this.toggleManageAlias(row.alias),
              style: { fontSize: 12, padding: '4px 10px', borderRadius: 4 },
            }, 'Manage'),
      ),
    );
  }

  // ── Host key trust-on-first-use ──────────────────────────────────────────

  async checkHostKey(): Promise<void> {
    // Capture the alias being checked NOW, before the await. If the input
    // changes (or a newer check is kicked off) before this resolves, this
    // response is stale and must be discarded rather than overwrite a newer
    // result — see the in-flight-race note in the task-6 review.
    const alias = this.state.hostKeyCheckAlias.trim();
    if (!alias) return;
    const mySeq = ++this.hostKeyCheckSeq;
    this.setState({ hostKeyCheckResult: null, hostKeyCheckedAlias: '', hostKeyChecking: true });
    const isStale = () => this.state.hostKeyCheckAlias.trim() !== alias;
    try {
      const data = await rendererGql<{ nexusHostProbe: { success: boolean; error: string | null; report: any } }>(`
        mutation($alias: String!) {
          nexusHostProbe(alias: $alias) {
            success error
            report { ok alias failure { kind detail remedy fingerprint keyType } }
          }
        }
      `, { alias }, HOST_PROBE_CLIENT_TIMEOUT_MS);
      if (!this.mounted || isStale()) {
        // A stale/discarded response must not leave the button stuck on
        // "Checking…" forever. But only clear the flag if no newer check has
        // started since this one — if it has, that newer call already owns
        // hostKeyChecking and this stale resolution must not clobber it.
        if (this.mounted && this.hostKeyCheckSeq === mySeq) this.setState({ hostKeyChecking: false });
        return;
      }
      const report = data.nexusHostProbe.report;
      if (!report) {
        this.setState({
          hostKeyCheckResult: { ok: false, detail: data.nexusHostProbe.error ?? 'No report returned.' },
          hostKeyCheckedAlias: alias,
          hostKeyChecking: false,
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
        hostKeyChecking: false,
      });
    } catch (e: any) {
      if (!this.mounted || isStale()) return;
      this.setState({ hostKeyCheckResult: { ok: false, detail: e?.message ?? String(e) }, hostKeyCheckedAlias: alias, hostKeyChecking: false });
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
    // Send the exact fingerprint that was displayed and visually verified —
    // not just the alias. The main-process handler compares this against a
    // FRESH capture and refuses to trust a different key, so the human's
    // verification of this specific fingerprint can't be silently bypassed
    // by a connection that lands on a different host key between clicks.
    const expectedFingerprint = this.state.hostKeyCheckResult?.fingerprint;
    if (!expectedFingerprint) return;
    this.setState({ hostKeyTrusting: true });
    try {
      const result = await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.TRUST_EXTERNAL_HOST_KEY, alias, expectedFingerprint);
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

  /** Renders the "External SSH Hosts" section body: host list, Add a host
   *  button, host-key trust-on-first-use check/approve UI, and (when open)
   *  the Add Host wizard overlay. */
  renderExternalHostsSection(): React.ReactNode {
    return React.createElement('div', null,
      React.createElement('div', { style: descStyle },
        'Register a WordPress install reached over SSH — a shared host, a VPS, anything that is neither Local nor WP Engine.',
      ),
      React.createElement('div', { style: { marginBottom: 10 } },
        this.groupedExternalHosts().length === 0
          ? React.createElement('div', { style: { fontSize: 12, color: 'var(--nxai-card-sub, #6b7280)', padding: '4px 0 10px' } },
              'No external hosts registered yet.')
          : React.createElement('div', { style: hostCardStyle },
              ...this.groupedExternalHosts().map(row => this.renderExternalHostRow(row)),
            ),
        React.createElement('button', {
          onClick: this.openAddHostWizard,
          style: { fontSize: 12, padding: '5px 12px', borderRadius: 4, marginTop: 6 },
        }, 'Add a host'),
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
            disabled: this.state.hostKeyChecking,
            onClick: () => this.checkHostKey(),
            style: { fontSize: 12, padding: '4px 10px', borderRadius: 4 },
          }, this.state.hostKeyChecking ? 'Checking…' : 'Check'),
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
      this.state.showAddHostWizard
        ? React.createElement(ExternalHostAddWizard, {
            electron: this.props.electron,
            onClose: this.closeAddHostWizard,
            onCompleted: this.completeAddHostWizard,
            // The wizard now owns its own Step 2 -> Step 3 transition
            // (see ExternalHostAddWizard.advanceToStep3); this section has
            // nothing further to do on this notification.
            onProbeClean: () => {},
          })
        : null,
    );
  }

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

  renderSectionHeader(sectionId: string, title: string): React.ReactElement {
    const expanded = this.state.expandedSections.has(sectionId);
    return React.createElement('div', {
      onClick: () => this.toggleSection(sectionId),
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        cursor: 'pointer',
        padding: '10px 0',
        marginBottom: expanded ? '4px' : '16px',
        userSelect: 'none' as const,
      },
    },
      React.createElement('span', {
        style: { fontSize: '10px', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.1em', color: 'var(--nxai-card-sub, #6b7280)', whiteSpace: 'nowrap' as const },
      }, title),
      React.createElement('div', {
        style: { flex: 1, height: 1, background: 'rgba(128,128,128,0.15)' },
      }),
      React.createElement('span', {
        style: { fontSize: '9px', opacity: 0.5 },
      }, expanded ? '▾' : '▸'),
    );
  }

  render(): React.ReactNode {
    const { settings, loading, expandedSections } = this.state;

    if (loading) {
      return React.createElement('div', { style: { padding: '24px', opacity: 0.7 } }, 'Loading preferences...');
    }

    // Section 6: External SSH Hosts
    const section6 = React.createElement('div', { style: sectionStyle },
      this.renderSectionHeader('external-hosts', 'External SSH Hosts'),
      expandedSections.has('external-hosts')
        ? this.renderExternalHostsSection()
        : null,
    );

    // Note: Auto-Indexing, Sync Schedule, WPE Access & Permissions, AI Provider,
    // Local AI Gateway, and Chat History have all moved to the Nexus AI Settings
    // tab. Only External SSH Hosts and the trust-on-first-use host-key approval
    // remain here, because that approval must not be reachable from anything but
    // Local itself (it is deliberately IPC-only, never GraphQL).

    return React.createElement('div', { style: { padding: '24px', maxWidth: '600px', boxSizing: 'border-box' as const } },
      React.createElement('style', null, `
        .nexus-password-input { -webkit-text-fill-color: unset !important; }
      `),
      section6,
    );
  }
}
