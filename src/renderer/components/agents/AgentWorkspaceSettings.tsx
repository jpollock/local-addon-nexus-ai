import * as React from 'react';
import { agentStore, AgentSettings } from './AgentStore';
import { IPC_CHANNELS } from '../../../common/constants';

interface SettingsProps {
  agentId: string;
  electron?: any;
}

interface GoogleConnection {
  id: string;
  accountLabel: string;
  status: string;
}

interface ScopeSite {
  id: string;
  name: string;
  environment: string;   // 'production' | 'staging' | 'development' | 'local'
}

interface SettingsState {
  settings: AgentSettings;
  googleConnection: GoogleConnection | null;
  connectingGoogle: boolean;
  confirmRemove: boolean;
  scopeSites: ScopeSite[];
  scopeLoading: boolean;
  scopeExpanded: boolean;
  scopeSearch: string;
}

const CADENCE_OPTIONS = [
  { label: 'Every 15 minutes', value: '*/15 * * * *' },
  { label: 'Hourly',           value: '0 * * * *' },
  { label: 'Every 6 hours',    value: '0 */6 * * *' },
  { label: 'Daily',            value: '0 0 * * *' },
  { label: 'Weekly',           value: '0 0 * * 0' },
];

// Event catalog per agent — in production, fetched from agent definition
const EVENT_CATALOG: Record<string, Array<{ id: string; label: string; description: string }>> = {
  'security-sentinel': [
    { id: 'wpe:sync.completed',   label: 'WPE sync completed',    description: 'Triggers after the 4-hour metadata sync refreshes plugin/user data for an install' },
    { id: 'wp:plugin.activated',  label: 'Plugin activated',      description: 'Triggers when a plugin is activated on any local site' },
    { id: 'wp:user.created',      label: 'User account created',  description: 'Triggers when a new user account is created on any local site' },
  ],
};

const AUTONOMY_OPTIONS = [
  { value: 'suggest', label: 'Suggest only',     desc: 'The agent surfaces findings but takes no action — no sandbox is created, no files are touched.' },
  { value: 'ask',     label: 'Act, then ask',    desc: 'The agent scans for threats but stops before executing any remediation. You review the plan and approve before anything is deleted or modified — even in the sandbox.' },
  { value: 'auto',    label: 'Fully autonomous', desc: 'The agent detects, clones a sandbox, runs full remediation, and verifies — then waits for your approval before pushing to production. Use with caution.' },
];

class ToggleSwitch extends React.Component<{ checked: boolean; onChange: (v: boolean) => void }> {
  render() {
    const { checked, onChange } = this.props;
    return React.createElement('div', {
      className: `ag-toggle ag-toggle--${checked ? 'on' : 'off'}`,
      onClick: () => onChange(!checked),
      role: 'switch',
      'aria-checked': checked,
    },
      React.createElement('div', { className: 'ag-toggle__knob' }),
    );
  }
}

// Agents that declare Google credentials — drives whether the Connections card shows
const AGENTS_WITH_GOOGLE_CREDENTIALS = new Set(['seo-insights']);
const GSC_SCOPES = ['https://www.googleapis.com/auth/webmasters.readonly'];

export class AgentWorkspaceSettings extends React.Component<SettingsProps, SettingsState> {
  state: SettingsState = {
    settings: agentStore.getOrInitSettings(this.props.agentId),
    googleConnection: null,
    connectingGoogle: false,
    confirmRemove: false,
    scopeSites: [],
    scopeLoading: false,
    scopeExpanded: false,
    scopeSearch: '',
  };
  private unsubscribe!: () => void;
  private credEventHandler?: (...args: any[]) => void;

  componentDidMount() {
    const update = () => this.setState({ settings: agentStore.getOrInitSettings(this.props.agentId) });
    agentStore.subscribe(update);
    this.unsubscribe = () => agentStore.unsubscribe(update);

    this.loadScopeSites();

    // Load Google connection status if this agent uses Google credentials
    if (AGENTS_WITH_GOOGLE_CREDENTIALS.has(this.props.agentId)) {
      this.loadGoogleStatus();
      // React to credential changes pushed from main
      const IPC_CHANNELS = (window as any).__nexusIpcChannels;
      const credEventChannel = 'nexus-ai:credential:event';
      this.credEventHandler = () => this.loadGoogleStatus();
      this.props.electron?.ipcRenderer?.on(credEventChannel, this.credEventHandler);
    }
  }

  componentWillUnmount() {
    this.unsubscribe();
    if (this.credEventHandler) {
      this.props.electron?.ipcRenderer?.removeListener('nexus-ai:credential:event', this.credEventHandler);
    }
  }

  private async loadGoogleStatus() {
    try {
      const result = await this.props.electron?.ipcRenderer?.invoke('nexus-ai:credential:status');
      const connections: GoogleConnection[] = result?.connections ?? [];
      const google = connections.find((c: any) => c.provider === 'google' && c.status !== 'revoked') ?? null;
      this.setState({ googleConnection: google });
    } catch { /* Local not running */ }
  }

  private async connectGoogle() {
    this.setState({ connectingGoogle: true });
    try {
      await this.props.electron?.ipcRenderer?.invoke('nexus-ai:credential:connect', {
        provider: 'google',
        agentId: this.props.agentId,
        siteId: '',
        scopes: GSC_SCOPES,
      });
    } catch { /* handled by credential event */ } finally {
      this.setState({ connectingGoogle: false });
    }
  }

  private async disconnectGoogle() {
    const { googleConnection } = this.state;
    if (!googleConnection) return;
    try {
      await this.props.electron?.ipcRenderer?.invoke('nexus-ai:credential:disconnect', {
        connectionId: googleConnection.id,
      });
      this.setState({ googleConnection: null });
    } catch { /* ignore */ }
  }

  /**
   * Both WPE installs and local sites. Local's own registry holds only local sites, which is
   * why site groups could not be reused for this — they resolve through siteData.getSites().
   */
  private async loadScopeSites() {
    const ipc = this.props.electron?.ipcRenderer;
    if (!ipc) return;
    this.setState({ scopeLoading: true });

    const sites: ScopeSite[] = [];
    try {
      const wpeResult = await ipc.invoke(IPC_CHANNELS.WPE_GET_SYNCED_SITES).catch(() => null);
      for (const s of (wpeResult?.sites || [])) {
        if (!s?.name) continue;
        sites.push({ id: s.id || s.name, name: s.name, environment: s.environment || 'production' });
      }
    } catch { /* WPE not connected — local sites alone are a valid fleet */ }

    try {
      const localSites: any[] = await ipc.invoke(IPC_CHANNELS.GET_SITES).catch(() => []);
      for (const s of (localSites || [])) {
        // sentinel-* are this agent's own forensic sandboxes; never offer them as scan targets.
        if (!s?.name || s.name.startsWith('sentinel-')) continue;
        sites.push({ id: s.id || s.name, name: s.name, environment: 'local' });
      }
    } catch { /* ignore */ }

    sites.sort((a, b) => a.name.localeCompare(b.name));
    this.setState({ scopeSites: sites, scopeLoading: false });
  }

  private toggleScopeSite(id: string) {
    const scope = this.state.settings.scanScope ?? { mode: 'explicit' as const, siteIds: [] };
    const next = new Set(scope.siteIds);
    next.has(id) ? next.delete(id) : next.add(id);
    this.updateSettings({ scanScope: { mode: 'explicit', siteIds: [...next] } });
  }

  private renderScanScope() {
    const { scopeSites, scopeLoading, scopeExpanded, scopeSearch } = this.state;
    const scope = this.state.settings.scanScope ?? { mode: 'explicit' as const, siteIds: [] };
    const selected = new Set(scope.siteIds);
    const isAll = scope.mode === 'all';

    const wpeCount = scopeSites.filter(s => s.environment !== 'local').length;
    const prodCount = scopeSites.filter(s => s.environment === 'production').length;

    const modeButton = (mode: 'explicit' | 'all', label: string) =>
      React.createElement('button', {
        key: mode,
        onClick: () => this.updateSettings({
          scanScope: { mode, siteIds: mode === 'all' ? scope.siteIds : scope.siteIds },
        }),
        style: {
          background: (scope.mode === mode) ? 'var(--ag-teal)' : 'var(--ag-bg-elevated)',
          color: (scope.mode === mode) ? 'var(--ag-on-teal)' : 'var(--ag-text-primary)',
          border: '1px solid var(--ag-border-control)', borderRadius: 7,
          padding: '5px 12px', fontSize: 12.5, cursor: 'pointer', fontWeight: 500,
        },
      }, label);

    const filtered = scopeSearch
      ? scopeSites.filter(s => s.name.toLowerCase().includes(scopeSearch.toLowerCase()))
      : scopeSites;

    return React.createElement('div', { style: { marginBottom: 14 } },
      React.createElement('div', { style: { fontSize: 13.5, color: 'var(--ag-text-primary)', marginBottom: 6 } },
        'Sites scanned on a schedule'),
      React.createElement('div', { style: { display: 'flex', gap: 8, marginBottom: 8 } },
        modeButton('explicit', 'Only selected sites'),
        modeButton('all', 'Every site'),
      ),

      // "Every site" states the actual cost rather than a vague caution — the numbers are known.
      isAll && React.createElement('div', {
        style: {
          fontSize: 12, color: 'var(--ag-text-faint)', background: 'var(--ag-bg-elevated)',
          borderRadius: 7, padding: '8px 10px', lineHeight: 1.5,
        },
      }, `Every scheduled run will scan all ${scopeSites.length} known site(s)` +
         (wpeCount ? ` — ${wpeCount} WP Engine (${prodCount} production), ${scopeSites.length - wpeCount} local` : '') +
         `. Deep investigations are capped at 3 per run; anything beyond that is deferred to the next run.`),

      !isAll && React.createElement('div', null,
        React.createElement('div', {
          style: { fontSize: 12, color: selected.size === 0 ? 'var(--ag-amber, #d89614)' : 'var(--ag-text-faint)', marginBottom: 6 },
        }, scopeLoading
            ? 'Loading sites…'
            : selected.size === 0
              ? `No sites selected — scheduled runs will scan nothing. ${scopeSites.length} site(s) available.`
              : `${selected.size} of ${scopeSites.length} site(s) selected.`),

        React.createElement('button', {
          onClick: () => this.setState({ scopeExpanded: !scopeExpanded }),
          style: {
            background: 'var(--ag-bg-elevated)', border: '1px solid var(--ag-border-control)',
            borderRadius: 7, padding: '5px 12px', fontSize: 12.5,
            color: 'var(--ag-text-primary)', cursor: 'pointer', fontWeight: 500,
          },
        }, scopeExpanded ? 'Done choosing' : 'Choose sites…'),

        scopeExpanded && React.createElement('div', { style: { marginTop: 8 } },
          React.createElement('input', {
            value: scopeSearch,
            placeholder: `Search ${scopeSites.length} sites…`,
            onChange: (e: any) => this.setState({ scopeSearch: e.target.value }),
            style: {
              width: '100%', boxSizing: 'border-box', marginBottom: 8,
              background: 'var(--ag-bg-elevated)', border: '1px solid var(--ag-border-control)',
              borderRadius: 7, padding: '6px 10px', fontSize: 12.5, color: 'var(--ag-text-primary)',
            },
          }),
          React.createElement('div', {
            style: {
              maxHeight: 260, overflowY: 'auto', border: '1px solid var(--ag-border-control)',
              borderRadius: 7,
            },
          },
            ...filtered.slice(0, 400).map(s => React.createElement('div', {
              key: s.id,
              onClick: () => this.toggleScopeSite(s.id),
              style: {
                display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px',
                cursor: 'pointer', fontSize: 12.5, color: 'var(--ag-text-primary)',
                background: selected.has(s.id) ? 'var(--ag-bg-elevated)' : 'transparent',
              },
            },
              React.createElement('span', null, selected.has(s.id) ? '☑' : '☐'),
              React.createElement('span', { style: { flex: 1 } }, s.name),
              React.createElement('span', {
                style: { fontSize: 11, color: s.environment === 'production' ? 'var(--ag-amber, #d89614)' : 'var(--ag-text-faint)' },
              }, s.environment),
            )),
            filtered.length > 400 && React.createElement('div', {
              style: { padding: '6px 10px', fontSize: 11.5, color: 'var(--ag-text-faint)' },
            }, `${filtered.length - 400} more — refine the search to see them.`),
            filtered.length === 0 && React.createElement('div', {
              style: { padding: '6px 10px', fontSize: 12, color: 'var(--ag-text-faint)' },
            }, 'No sites match.'),
          ),
        ),
      ),
    );
  }

  private updateSettings(patch: Partial<AgentSettings>) {
    const next = { ...this.state.settings, ...patch };
    agentStore.setState({
      agentSettings: { ...agentStore.getState().agentSettings, [this.props.agentId]: next },
    });
  }

  private cycleCadence() {
    const { cadence } = this.state.settings;
    const idx = CADENCE_OPTIONS.findIndex(o => o.value === cadence);
    const next = CADENCE_OPTIONS[(idx + 1) % CADENCE_OPTIONS.length];
    this.updateSettings({ cadence: next.value });
  }

  private getRunSummary(): string {
    const { settings } = this.state;
    if (!settings.enabled) return 'Disabled — not running';
    const parts: string[] = [];
    const cadence = CADENCE_OPTIONS.find(o => o.value === settings.cadence);
    if (settings.scheduleEnabled && cadence) parts.push(`Runs ${cadence.label.toLowerCase()}`);
    const catalog = EVENT_CATALOG[this.props.agentId] || [];
    const subCount = catalog.filter(e => settings.subscribedEvents[e.id] !== false).length;
    if (settings.eventsEnabled && subCount > 0) parts.push(`responds to ${subCount} event${subCount !== 1 ? 's' : ''}`);
    parts.push('ad-hoc');
    return parts.join(' · ');
  }

  private renderCard(children: React.ReactNode, dimmed = false) {
    return React.createElement('div', {
      style: {
        background: 'var(--ag-bg-card)', border: '1px solid var(--ag-border)', borderRadius: 12,
        padding: '20px 22px', marginBottom: 12, opacity: dimmed ? 0.45 : 1,
        pointerEvents: dimmed ? 'none' : 'auto',
        transition: 'opacity 0.15s',
      },
    }, children);
  }

  private renderConnectionsCard() {
    const { googleConnection, connectingGoogle } = this.state;
    const isConnected = !!googleConnection;
    return this.renderCard(
      React.createElement('div', null,
        // Header
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 } },
          React.createElement('div', null,
            React.createElement('div', { style: { fontSize: 13.5, fontWeight: 600, color: 'var(--ag-text-primary)' } }, 'Connected Accounts'),
            React.createElement('div', { style: { fontSize: 12.5, color: 'var(--ag-text-muted)', marginTop: 3 } },
              'Connect Google Search Console to unlock demand analysis (T1)',
            ),
          ),
        ),
        // Google row
        React.createElement('div', {
          style: { display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 8, background: 'var(--ag-bg-elevated)', border: '1px solid var(--ag-border-subtle)' },
        },
          // Google icon placeholder
          React.createElement('div', {
            style: { width: 28, height: 28, borderRadius: 6, background: isConnected ? 'rgba(66,133,244,0.12)' : 'var(--ag-bg-card)', border: '1px solid var(--ag-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0 },
          }, 'G'),
          React.createElement('div', { style: { flex: 1 } },
            React.createElement('div', { style: { fontSize: 13, fontWeight: 500, color: 'var(--ag-text-primary)' } }, 'Google Search Console'),
            React.createElement('div', { style: { fontSize: 12, color: isConnected ? 'var(--ag-green)' : 'var(--ag-text-muted)', marginTop: 2 } },
              isConnected ? `Connected · ${googleConnection!.accountLabel}` : 'Not connected',
            ),
          ),
          isConnected
            ? React.createElement('button', {
                onClick: () => this.disconnectGoogle(),
                style: { padding: '6px 14px', background: 'transparent', border: '1px solid var(--ag-border)', borderRadius: 6, fontSize: 12, color: 'var(--ag-text-muted)', cursor: 'pointer' },
              }, 'Disconnect')
            : React.createElement('button', {
                onClick: () => this.connectGoogle(),
                disabled: connectingGoogle,
                style: { padding: '6px 14px', background: 'var(--ag-teal)', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600, color: '#0d1117', cursor: connectingGoogle ? 'wait' : 'pointer', opacity: connectingGoogle ? 0.7 : 1 },
              }, connectingGoogle ? 'Connecting…' : 'Connect Google'),
        ),
      ),
    );
  }

  render() {
    const { settings } = this.state;
    const { agentId } = this.props;
    const catalog = EVENT_CATALOG[agentId] || [];
    const currentAutonomy = agentStore.getState().autonomyById[agentId] || 'ask';

    return React.createElement('div', { style: { maxWidth: 680 } },

      // Card 1: Enable + Run now
      this.renderCard(
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 16 } },
          React.createElement(ToggleSwitch, {
            checked: settings.enabled,
            onChange: (v) => this.updateSettings({ enabled: v }),
          }),
          React.createElement('div', { style: { flex: 1 } },
            React.createElement('div', { style: { fontSize: 15, fontWeight: 600, color: 'var(--ag-text-primary)', marginBottom: 2 } },
              settings.enabled ? 'Agent enabled' : 'Agent disabled',
            ),
            React.createElement('div', { style: { fontSize: 12.5, color: 'var(--ag-text-secondary)' } },
              settings.enabled
                ? 'Running via its configured triggers below. Toggle off to stop all scheduled, event, and ad-hoc runs — and to revoke MCP/CLI tool access.'
                : 'Agent will not run on any trigger, and its tools are unavailable via MCP/CLI until re-enabled.',
            ),
          ),
          React.createElement('button', {
            disabled: !settings.enabled,
            style: {
              background: settings.enabled ? 'var(--ag-teal)' : 'var(--ag-bg-elevated)',
              color: settings.enabled ? 'var(--ag-on-teal)' : 'var(--ag-text-faint)',
              border: 'none', borderRadius: 8, padding: '8px 18px',
              fontSize: 13, fontWeight: 600, cursor: settings.enabled ? 'pointer' : 'not-allowed',
              display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0,
            },
          }, '▶ Run now'),
        ),
      ),

      // Card 2: How this agent runs
      this.renderCard(
        React.createElement('div', null,
          React.createElement('div', { style: { fontSize: 14.5, fontWeight: 600, color: 'var(--ag-text-primary)', marginBottom: 16 } }, 'How this agent runs'),

          // On a schedule
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 } },
            React.createElement(ToggleSwitch, { checked: settings.scheduleEnabled, onChange: (v) => this.updateSettings({ scheduleEnabled: v }) }),
            React.createElement('div', { style: { flex: 1 } },
              React.createElement('div', { style: { fontSize: 13.5, color: 'var(--ag-text-primary)' } }, 'On a schedule'),
            ),
            React.createElement('button', {
              onClick: () => this.cycleCadence(),
              style: {
                background: 'var(--ag-bg-elevated)', border: '1px solid var(--ag-border-control)',
                borderRadius: 7, padding: '5px 12px', fontSize: 12.5, color: 'var(--ag-text-primary)',
                cursor: 'pointer', fontWeight: 500,
              },
            }, CADENCE_OPTIONS.find(o => o.value === settings.cadence)?.label || 'Every 15 minutes'),
          ),

          // Which sites the schedule may touch. Shown only when a schedule is on — it constrains
          // scheduled runs, not Run Now, and offering it otherwise implies it gates everything.
          settings.scheduleEnabled && this.renderScanScope(),

          // Respond to events
          React.createElement('div', { style: { marginBottom: 14 } },
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: settings.eventsEnabled ? 12 : 0 } },
              React.createElement(ToggleSwitch, {
                checked: settings.eventsEnabled,
                onChange: (v) => this.updateSettings({ eventsEnabled: v }),
              }),
              React.createElement('div', { style: { fontSize: 13.5, color: 'var(--ag-text-primary)' } }, 'Respond to events'),
            ),
            settings.eventsEnabled && React.createElement('div', { style: { paddingLeft: 52 } },
              ...catalog.map(evt => {
                const isSubscribed = settings.subscribedEvents[evt.id] !== false;
                return React.createElement('div', {
                  key: evt.id,
                  onClick: () => this.updateSettings({
                    subscribedEvents: { ...settings.subscribedEvents, [evt.id]: !isSubscribed },
                  }),
                  style: {
                    display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10, cursor: 'pointer',
                  },
                },
                  React.createElement('div', {
                    className: `ag-checkbox ${isSubscribed ? 'ag-checkbox--checked' : ''}`,
                    style: { marginTop: 2 },
                  }, isSubscribed ? '✓' : ''),
                  React.createElement('div', null,
                    React.createElement('div', { style: { fontSize: 13, color: 'var(--ag-text-primary)', marginBottom: 2 } }, evt.label),
                    React.createElement('div', { style: { fontSize: 12, color: 'var(--ag-text-secondary)' } }, evt.description),
                  ),
                );
              }),
            ),
          ),

          // Ad-hoc (always on)
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 12 } },
            React.createElement('div', {
              style: { width: 40, height: 23, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ag-text-muted)', fontSize: 11 },
            }, '—'),
            React.createElement('div', { style: { flex: 1, fontSize: 13.5, color: 'var(--ag-text-primary)' } }, 'Ad-hoc'),
            React.createElement('div', { style: { fontSize: 12, color: 'var(--ag-text-muted)' } }, 'Via Run now button'),
          ),

        ),
        !settings.enabled,
      ),

      // Card 3: Autonomy
      this.renderCard(
        React.createElement('div', null,
          React.createElement('div', { style: { fontSize: 14.5, fontWeight: 600, color: 'var(--ag-text-primary)', marginBottom: 12 } }, 'Autonomy level'),
          ...AUTONOMY_OPTIONS.map(opt => {
            const selected = currentAutonomy === opt.value;
            return React.createElement('div', {
              key: opt.value,
              onClick: () => agentStore.setState({
                autonomyById: { ...agentStore.getState().autonomyById, [agentId]: opt.value as any },
              }),
              style: {
                display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 14px', borderRadius: 10,
                cursor: 'pointer', marginBottom: 8,
                background: selected ? 'rgba(53,208,197,0.08)' : 'transparent',
                border: `1px solid ${selected ? 'rgba(53,208,197,0.4)' : 'transparent'}`,
                transition: 'background 0.12s, border-color 0.12s',
              },
            },
              // Radio dot
              React.createElement('div', {
                style: {
                  width: 16, height: 16, borderRadius: '50%', flexShrink: 0, marginTop: 2,
                  border: `2px solid ${selected ? 'var(--ag-teal)' : 'var(--ag-border)'}`,
                  background: selected ? 'var(--ag-teal)' : 'transparent',
                  transition: 'background 0.12s, border-color 0.12s',
                },
              }),
              React.createElement('div', null,
                React.createElement('div', { style: { fontSize: 13.5, fontWeight: 500, color: 'var(--ag-text-primary)', marginBottom: 3 } }, opt.label),
                React.createElement('div', { style: { fontSize: 12.5, color: 'var(--ag-text-secondary)' } }, opt.desc),
              ),
            );
          }),
        ),
        !settings.enabled,
      ),
      // Connections card — only for agents that declare Google credentials
      AGENTS_WITH_GOOGLE_CREDENTIALS.has(agentId) && this.renderConnectionsCard(),

      // Danger zone — remove agent
      React.createElement('div', {
        style: {
          background: 'var(--ag-bg-card)', border: '1px solid rgba(242,102,110,0.3)',
          borderRadius: 12, padding: '20px 22px', marginBottom: 12,
        },
      },
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
          React.createElement('div', null,
            React.createElement('div', { style: { fontSize: 13.5, fontWeight: 600, color: 'var(--ag-text-primary)' } }, 'Remove agent'),
            React.createElement('div', { style: { fontSize: 12.5, color: 'var(--ag-text-secondary)', marginTop: 3 } },
              'Permanently deletes this agent and all its data from your machine.',
            ),
          ),
          this.state.confirmRemove
            ? React.createElement('div', { style: { display: 'flex', gap: 8 } },
                React.createElement('button', {
                  onClick: async () => {
                    await this.props.electron?.ipcRenderer?.invoke(IPC_CHANNELS.AGENT_REMOVE, { agentId });
                    this.setState({ confirmRemove: false });
                  },
                  style: {
                    background: '#f2666e', color: '#fff', border: 'none', borderRadius: 8,
                    padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                  },
                }, 'Yes, remove'),
                React.createElement('button', {
                  onClick: () => this.setState({ confirmRemove: false }),
                  style: {
                    background: 'none', border: '1px solid var(--ag-border)', borderRadius: 8,
                    padding: '8px 14px', fontSize: 13, color: 'var(--ag-text-muted)', cursor: 'pointer',
                  },
                }, 'Cancel'),
              )
            : React.createElement('button', {
                onClick: () => this.setState({ confirmRemove: true }),
                style: {
                  background: 'none', border: '1px solid rgba(242,102,110,0.5)', borderRadius: 8,
                  padding: '8px 16px', fontSize: 13, fontWeight: 600, color: '#f2666e', cursor: 'pointer',
                },
              }, 'Remove…'),
        ),
      ),
    );
  }
}
