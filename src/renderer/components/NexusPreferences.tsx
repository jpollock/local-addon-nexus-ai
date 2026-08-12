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
  // External SSH Hosts — host-key trust-on-first-use only
  hostKeyCheckAlias: string;
  hostKeyCheckResult: null | { ok: boolean; failureKind?: string; detail?: string; remedy?: string; fingerprint?: string; keyType?: string };
  hostKeyCheckedAlias: string;
  hostKeyTrusting: boolean;
  hostKeyChecking: boolean;
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
    hostKeyCheckAlias: '',
    hostKeyCheckResult: null,
    hostKeyCheckedAlias: '',
    hostKeyTrusting: false,
    hostKeyChecking: false,
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
      const settings = await ipc.invoke(IPC_CHANNELS.GET_SETTINGS);
      if (!this.mounted) return;
      this.setState({
        settings: settings ?? { autoIndex: true, excludedSiteIds: [] },
        loading: false,
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
  // External SSH Hosts — host-key trust-on-first-use only
  // (Host list, Add Host wizard, and root-mode controls have moved to Settings)
  // -----------------------------------------------------------------------

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

  /** Renders the "External SSH Hosts" section body: only the host-key
   *  trust-on-first-use check/approve UI. The host list, Add Host wizard,
   *  and root-mode controls have all moved to Settings. */
  renderExternalHostsSection(): React.ReactNode {
    return React.createElement('div', null,
      React.createElement('div', { style: descStyle },
        'To approve a new external host the first time you connect to it, enter the SSH alias from your ~/.ssh/config and check its host key.',
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

    // This panel is NOT the settings home, so it must not carry the settings
    // home's footer: rendered here, "everything is here, with one exception …
    // Local → Preferences → Nexus AI" asserted that everything was configurable
    // on the very screen it was pointing away from, and never named the actual
    // destination. It points TO Settings instead, and says why this one thing
    // stayed behind.
    const pointer = React.createElement('div', {
      style: {
        padding: '12px 16px',
        marginBottom: 16,
        background: 'rgba(59,130,246,0.06)',
        border: '1px solid rgba(59,130,246,0.2)',
        borderRadius: 6,
        fontSize: 12,
        lineHeight: 1.5,
        color: 'var(--nxai-card-sub, #6b7280)',
      },
    },
      'Everything else Nexus can be configured with now lives in ',
      React.createElement('span', { style: { color: 'var(--nxai-card-text, #111827)', fontWeight: 700 } }, 'Nexus AI → Settings'),
      '. Only external SSH hosts stay here, because approving a new host the first time you connect to it must not be reachable from anything but Local itself.',
    );

    return React.createElement('div', { style: { padding: '24px', maxWidth: '600px', boxSizing: 'border-box' as const } },
      React.createElement('style', null, `
        .nexus-password-input { -webkit-text-fill-color: unset !important; }
      `),
      pointer,
      section6,
    );
  }
}
