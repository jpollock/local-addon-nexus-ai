import * as React from 'react';
import { agentStore, AgentSettings } from './AgentStore';
import { IPC_CHANNELS } from '../../../common/constants';
import { fetchSitesForAgent, ScopeSite } from './fetchScopeSites';
import { SitePicker, selectedProductionCount, productionWarningVerb } from './SitePicker';

interface SettingsProps {
  agentId: string;
  electron?: any;
  /** From this agent's AgentStatus. Undefined while status is still loading upstream. */
  allowsProduction?: boolean;
  effect?: 'readonly' | 'writes';
}

interface GoogleConnection {
  id: string;
  accountLabel: string;
  status: string;
}

interface SettingsState {
  settings: AgentSettings;
  googleConnection: GoogleConnection | null;
  connectingGoogle: boolean;
  confirmRemove: boolean;
  scopeSites: ScopeSite[];
  scopeLoading: boolean;
  scopeExpanded: boolean;
  /** Non-null while the picker is open — edits happen here first; Save commits, Cancel discards. */
  scopeDraftSelection: Set<string> | null;
  driftDismissed: boolean;
}

const CADENCE_OPTIONS = [
  { label: 'Every 15 minutes', value: '*/15 * * * *', every: 'every 15 minutes' },
  { label: 'Hourly',           value: '0 * * * *',    every: 'every hour' },
  { label: 'Every 6 hours',    value: '0 */6 * * *',  every: 'every 6 hours' },
  { label: 'Daily',            value: '0 0 * * *',    every: 'every day' },
  { label: 'Weekly',           value: '0 0 * * 0',    every: 'every week' },
];

function formatLastEdited(updatedAt?: number): string {
  if (!updatedAt) return 'Not yet saved';
  const days = Math.floor((Date.now() - updatedAt) / 86_400_000);
  if (days <= 0) return 'Last edited today';
  if (days === 1) return 'Last edited yesterday';
  return `Last edited ${days} days ago`;
}

// Event catalog per agent — in production, fetched from agent definition
//
// security-sentinel used to also list 'wpe:sync.completed' here. Removed 2026-08-06: that
// trigger let WpeRefreshScheduler's automated fleet-wide refresh cycle (opt-in,
// wpeRefreshAutoEnabled) silently launch a full Tier 2/3 investigation — fresh sandbox site
// included — per stale WPE install per cycle, with no user action at all. The agent no longer
// subscribes to it (see agents/security-sentinel/agent.js's triggers list); offering to
// subscribe here would be a UI control for a trigger that does nothing.
const EVENT_CATALOG: Record<string, Array<{ id: string; label: string; description: string }>> = {
  'security-sentinel': [
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
    scopeDraftSelection: null,
    driftDismissed: false,
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
   * Both WPE installs and local sites for most agents. Local's own registry holds only local
   * sites, which is why site groups could not be reused for this — they resolve through
   * siteData.getSites(). Some agents (log-processor) get a different, narrower site source —
   * see fetchSitesForAgent's doc.
   */
  private async loadScopeSites() {
    if (!this.props.electron?.ipcRenderer) return;
    this.setState({ scopeLoading: true });
    const sites = await fetchSitesForAgent(this.props.agentId, this.props.electron);
    this.setState({ scopeSites: sites, scopeLoading: false });
  }

  /**
   * "Every site" mode is retired (2026-08-07): it was a live rule that silently absorbed any
   * site added to the account, which is exactly what an explicit-list scope exists to rule out
   * — the two concepts contradicted each other under one toggle. An agent whose settings still
   * carry legacy `mode: 'all'` data reads here as "currently every known site", so nothing it
   * scans changes at the moment of this migration; the very next Save writes an explicit list
   * (mode: 'explicit') and the account is fully migrated.
   */
  /**
   * `scope` is the single field Settings and Run Now both read/write (see AgentStore.ts's
   * AgentScope doc). The `scanScope` fallback below reads on-disk data from before this field
   * was unified — settings persisted with the old `{mode, siteIds}` shape while `scope` was
   * absent, so a not-yet-migrated install doesn't silently revert to "scan nothing" on first
   * load post-upgrade. `mode: 'all'` has no equivalent under the current explicit-list model and
   * reads as "no sites selected" rather than fabricating a full site list.
   */
  private currentScopeSiteIds(): string[] {
    const { scope, scanScope } = this.state.settings as AgentSettings & { scanScope?: { mode: string; siteIds: string[] } };
    if (scope) return scope.siteIds;
    if (scanScope && scanScope.mode !== 'all') return scanScope.siteIds ?? [];
    return [];
  }

  /** Sites created after this scope was last edited — a permanent property of an explicit-list
   * model, not a bug: a scope never auto-includes anything added after it was set. Fires for any
   * site with a known createdAt — WPE always, local sites once first indexed (see
   * fetchScopeSites' ScopeSite.createdAt doc for what "created" means for each). An unindexed
   * local site has no createdAt and is silently excluded, never flagged. */
  private getDriftedSites(): ScopeSite[] {
    const scopeUpdatedAt = this.state.settings.scopeUpdatedAt;
    if (!scopeUpdatedAt) return [];
    const currentIds = new Set(this.currentScopeSiteIds());
    return this.state.scopeSites.filter(s =>
      typeof s.createdAt === 'number' && s.createdAt > scopeUpdatedAt && !currentIds.has(s.id));
  }

  private openScopeEditor = (): void => {
    this.setState({ scopeExpanded: true, scopeDraftSelection: new Set(this.currentScopeSiteIds()) });
  };

  private cancelScopeEdit = (): void => {
    this.setState({ scopeExpanded: false, scopeDraftSelection: null });
  };

  private saveScopeEdit = (): void => {
    const draft = this.state.scopeDraftSelection;
    if (!draft) return;
    this.updateSettings({
      scope: { siteIds: [...draft] },
      scopeUpdatedAt: Date.now(),
    });
    this.setState({ scopeExpanded: false, scopeDraftSelection: null });
  };

  /** The four scope-sentence forms from the v2 design — resting-state summary of the saved
   * scope. "All sites" collapses into "mixed" when nothing is in production, since "including 0
   * in production" reads as a bug report, not a status. */
  private renderScopeSentence(selectedSites: ScopeSite[], total: number) {
    const n = selectedSites.length;
    const p = selectedSites.filter(s => s.environment === 'production').length;

    if (n === 0) {
      return React.createElement('span', { style: { color: 'var(--ag-text-primary)' } }, 'No sites selected — this agent will not run.');
    }
    if (n === total && total > 0 && p > 0) {
      return React.createElement('span', { style: { color: '#ff8a95' } }, `Every site on the account, including ${p} in production`);
    }
    if (p === 0) {
      return React.createElement('span', { style: { color: 'var(--ag-text-primary)' } }, `${n} site${n === 1 ? '' : 's'} — no production`);
    }
    return React.createElement('span', { style: { color: '#ff8a95' } },
      n === 1 ? `1 site, in production` : `${n} sites, ${p} of them in production`);
  }

  private renderScanScope() {
    const { scopeSites, scopeLoading, scopeExpanded, scopeDraftSelection, driftDismissed, settings } = this.state;
    const selectedIds = new Set(this.currentScopeSiteIds());
    const selectedSites = scopeSites.filter(s => selectedIds.has(s.id));
    const drifted = this.getDriftedSites();
    const allowsProduction = this.props.allowsProduction ?? true;
    const effect = this.props.effect ?? 'writes';
    const cadence = CADENCE_OPTIONS.find(o => o.value === settings.cadence)?.every ?? 'on the configured schedule';

    const draftProdCount = scopeDraftSelection ? selectedProductionCount(scopeSites, scopeDraftSelection) : 0;

    return React.createElement('div', { style: { marginBottom: 14 } },
      // Eyebrow + scope sentence — the resting state; the site list is a detail the user
      // opens, never the default presentation.
      React.createElement('div', {
        style: { fontSize: 12, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ag-text-faint)', marginBottom: 4 },
      }, 'SITES IN SCOPE'),
      React.createElement('div', { style: { fontSize: 16, lineHeight: 1.5, marginBottom: 4 } },
        scopeLoading ? React.createElement('span', { style: { color: 'var(--ag-text-primary)' } }, 'Loading sites…')
          : this.renderScopeSentence(selectedSites, scopeSites.length),
      ),
      React.createElement('div', { style: { fontSize: 13, color: 'var(--ag-text-faint)', marginBottom: 10 } },
        `${formatLastEdited(settings.scopeUpdatedAt)} · shared by the schedule and event triggers`),

      // Drift banner — sites added to the account after this scope was last saved. Because
      // scopes are explicit lists, drift is a permanent property of the model, not a bug.
      !scopeExpanded && drifted.length > 0 && !driftDismissed && React.createElement('div', {
        style: {
          background: 'rgba(240,181,46,0.08)', border: '1px solid rgba(240,181,46,0.28)', borderRadius: 11,
          padding: '12px 16px', marginBottom: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        },
      },
        React.createElement('span', { style: { fontSize: 13, color: 'var(--ag-text-secondary)' } },
          `${drifted.length} site${drifted.length === 1 ? '' : 's'} were added to the account after this scope was set. They are not being scanned.`),
        React.createElement('div', { style: { display: 'flex', gap: 10, flexShrink: 0 } },
          React.createElement('button', {
            onClick: this.openScopeEditor,
            style: { fontSize: 13, fontWeight: 700, color: '#0b0e14', background: '#f0b52e', border: 'none', borderRadius: 8, padding: '6px 12px', cursor: 'pointer' },
          }, `Review ${drifted.length}`),
          React.createElement('button', {
            onClick: () => this.setState({ driftDismissed: true }),
            style: { fontSize: 13, fontWeight: 600, color: '#9aa4b2', background: 'transparent', border: 'none', cursor: 'pointer' },
          }, 'Dismiss'),
        ),
      ),

      React.createElement('div', { style: { display: 'flex', justifyContent: 'flex-end' } },
        React.createElement('button', {
          onClick: scopeExpanded ? this.cancelScopeEdit : this.openScopeEditor,
          style: {
            background: scopeExpanded ? 'transparent' : '#35e0c5',
            color: scopeExpanded ? '#9aa4b2' : '#0b0e14',
            border: scopeExpanded ? '1px solid #2a3441' : 'none',
            borderRadius: 9, padding: '9px 16px', fontSize: 14, fontWeight: 700, cursor: 'pointer',
          },
        }, scopeExpanded ? 'Close list' : 'Edit sites'),
      ),

      // Picker opens inline, never in a modal — the scope only makes sense next to the trigger
      // that consumes it, and a modal implies a one-off choice, which is what Run Now is.
      scopeExpanded && scopeDraftSelection && React.createElement('div', { style: { marginTop: 12 } },
        React.createElement(SitePicker, {
          sites: scopeSites,
          selection: scopeDraftSelection,
          onChange: (next: Set<string>) => this.setState({ scopeDraftSelection: next }),
          allowsProduction,
        }),
        React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginTop: 12 } },
          React.createElement('span', { style: { flex: 1, fontSize: 13, fontWeight: 600, color: draftProdCount > 0 ? '#ff8a95' : 'transparent' } },
            draftProdCount > 0
              ? `${draftProdCount} live production site${draftProdCount === 1 ? '' : 's'} will be ${productionWarningVerb(effect)} ${cadence}.`
              : ' ',
          ),
          React.createElement('button', {
            onClick: this.cancelScopeEdit,
            style: { fontSize: 14, fontWeight: 600, color: '#9aa4b2', background: 'transparent', border: '1px solid #2a3441', borderRadius: 9, padding: '9px 16px', cursor: 'pointer' },
          }, 'Cancel'),
          React.createElement('button', {
            onClick: this.saveScopeEdit,
            style: {
              fontSize: 14, fontWeight: 700, color: '#0b0e14', border: 'none', borderRadius: 9, padding: '9px 16px', cursor: 'pointer',
              background: draftProdCount > 0 ? '#ff8a95' : '#35e0c5',
            },
          }, `Save ${scopeDraftSelection.size} site${scopeDraftSelection.size === 1 ? '' : 's'}`),
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
