import * as React from 'react';
import { agentStore, AgentSettings, AgentCredentialDecl } from './AgentStore';
import { IPC_CHANNELS } from '../../../common/constants';
import type { NexusSettings } from '../../../common/types';
import { fetchSitesForAgent, ScopeSite } from './fetchScopeSites';
import { SitePicker, selectedProductionCount, productionWarningVerb } from './SitePicker';
import { effectiveCadenceExpression, describeCron } from './effectiveCadence';
import {
  hasAcknowledgedAgentDataDisclosure,
  acknowledgeAgentDataDisclosure,
  shouldShowAgentDataDisclosure,
} from './agentDataDisclosure';

interface SettingsProps {
  agentId: string;
  electron?: any;
  /** From this agent's AgentStatus. Undefined while status is still loading upstream. */
  allowsProduction?: boolean;
  /**
   * The agent's own cron, from AgentStatus. This is what runs unless the user picks a cadence,
   * so every schedule label here derives from it — labelling `settings.cadence` alone stated a
   * schedule the scheduler never used.
   */
  cronExpression?: string | null;
  effect?: 'readonly' | 'writes';
  /** Gates the Autonomy level card — its copy is security-sentinel's own remediation model, not
   * generic, and it sets a value (settings.autonomy) only security-sentinel's runtime reads. */
  producesApprovals?: boolean;
  /** The agent's own credential declarations, from AgentStatus. Drives whether a connect card
   * appears and which scopes it requests — never a list kept here. */
  credentials?: AgentCredentialDecl[];
  /** True for agents whose Sites tab owns `scope.siteIds` directly (log-processor). Settings then
   * shows one line pointing there instead of a second, competing site list. */
  scopeLivesInSitesTab?: boolean;
  /** Opens the Sites tab. Only meaningful alongside scopeLivesInSitesTab. */
  onOpenSitesTab?: () => void;
  /** How many sites this agent actually covers — the same derived set the Sites tab's badge uses.
   * Passed in rather than recomputed, so the two surfaces cannot disagree. */
  sitesTabCount?: number;
  /** What a row is called, and what having one is called, for this agent. */
  sitesTabNoun?: string;
  sitesTabVerb?: string;
  siteScoped?: boolean;
}

interface GoogleConnection {
  id: string;
  accountLabel: string;
  status: string;
}

interface SettingsState {
  settings: AgentSettings;
  /** ALL of this provider's usable connections — multiple Google accounts (2026-08-26). */
  googleConnections: GoogleConnection[];
  connectingGoogle: boolean;
  confirmRemove: boolean;
  scopeSites: ScopeSite[];
  scopeLoading: boolean;
  scopeExpanded: boolean;
  /** Non-null while the picker is open — edits happen here first; Save commits, Cancel discards. */
  scopeDraftSelection: Set<string> | null;
  driftDismissed: boolean;
  /** Global settings, loaded once on mount to read logLevel for the override control. */
  globalSettings: NexusSettings | null;
  /** Non-null while the one-time "agents send data to your provider" disclosure is open (P0-5). */
  showDataDisclosure: boolean;
  /**
   * Phase 3 (fixes-082526, agent-addressed grants): the Govern matrix rows,
   * for THIS agent's grants section. null = not loaded or record-keeping is
   * down — the section states the absence rather than rendering an empty
   * granted-nothing list.
   */
  governRows: GovernRowLike[] | null;
}

/**
 * The row fields this surface reads, structurally — the seam is imported for
 * TYPES ONLY elsewhere in this tree (see GovernSection's header for why a
 * value import of intelligence-host pulls better-sqlite3 into the renderer).
 */
interface GovernRowLike {
  capability: string;
  label: string;
  documentLine: string;
  holders: string[];
  acts: Record<string, { eventId: string; issuedAt: string }>;
  chip: string;
  state: string;
}

const CADENCE_OPTIONS = [
  { label: 'Every 15 minutes', value: '*/15 * * * *', every: 'every 15 minutes' },
  { label: 'Hourly',           value: '0 * * * *',    every: 'every hour' },
  { label: 'Every 6 hours',    value: '0 */6 * * *',  every: 'every 6 hours' },
  { label: 'Daily',            value: '0 0 * * *',    every: 'every day' },
  { label: 'Weekly',           value: '0 0 * * 0',    every: 'every week' },
];

/**
 * Per-agent cadence floor (fixes-082526 Tier A 7). security-sentinel's every
 * run is a production-scale Tier 2/3 investigation; the 2026-08 incident had
 * it sweeping 375 sites every 15 minutes because this picker offered the
 * interval. The floor is per-agent, not global — content-shaped agents
 * legitimately run at 15 minutes.
 */
const CADENCE_FLOOR: Record<string, string[]> = {
  'security-sentinel': ['*/15 * * * *'],
};

export function cadenceOptionsFor(agentId: string): typeof CADENCE_OPTIONS {
  const barred = CADENCE_FLOOR[agentId];
  return barred ? CADENCE_OPTIONS.filter((o) => !barred.includes(o.value)) : CADENCE_OPTIONS;
}

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
/**
 * What a Google connection is *for*, per scope. The scope strings come from the agent's own
 * declaration; this only turns them into something a human can consent to.
 *
 * This replaced a hardcoded `AGENTS_WITH_GOOGLE_CREDENTIALS = {'seo-insights'}` plus a
 * `GSC_SCOPES` constant. That pairing meant a second Google agent got no connect button at all,
 * and would have been handed Search Console scopes if it ever did — authorising the wrong API.
 */
const GOOGLE_SCOPE_LABELS: Record<string, string> = {
  'https://www.googleapis.com/auth/webmasters.readonly': 'Google Search Console',
  'https://www.googleapis.com/auth/analytics.readonly': 'Google Analytics',
};

function googleScopeSummary(scopes: string[]): string {
  const named = scopes.map(s => GOOGLE_SCOPE_LABELS[s]).filter(Boolean);
  if (named.length === 0) return 'Google';
  return Array.from(new Set(named)).join(' · ');
}

export class AgentWorkspaceSettings extends React.Component<SettingsProps, SettingsState> {
  state: SettingsState = {
    settings: agentStore.getOrInitSettings(this.props.agentId),
    googleConnections: [],
    connectingGoogle: false,
    confirmRemove: false,
    scopeSites: [],
    scopeLoading: false,
    scopeExpanded: false,
    scopeDraftSelection: null,
    driftDismissed: false,
    globalSettings: null,
    showDataDisclosure: false,
    governRows: null,
  };
  private unsubscribe!: () => void;
  private credEventHandler?: (...args: any[]) => void;

  componentDidMount() {
    const update = () => this.setState({ settings: agentStore.getOrInitSettings(this.props.agentId) });
    agentStore.subscribe(update);
    this.unsubscribe = () => agentStore.unsubscribe(update);

    this.loadScopeSites();
    this.loadGlobalSettings();
    void this.loadGovernRows();

    // Load Google connection status if this agent uses Google credentials
    if (this.googleDecl()) {
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

  /** The agent's Google declaration, if it has one. Single source for both the gate and scopes. */
  private googleDecl(): AgentCredentialDecl | undefined {
    return (this.props.credentials ?? []).find(c => c.provider === 'google');
  }

  private async loadGlobalSettings() {
    if (!this.props.electron?.ipcRenderer) return;
    try {
      const settings = await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.GET_SETTINGS);
      this.setState({ globalSettings: settings ?? null });
    } catch { /* Local not running */ }
  }

  private async loadGoogleStatus() {
    try {
      const result = await this.props.electron?.ipcRenderer?.invoke('nexus-ai:credential:status', {
        provider: 'google',
        agentId: this.props.agentId,
      });
      // The GRANTED list, not the machine list — the grant is the reach boundary, and another
      // agent's connection rendered here reads as "this agent can use it", which is false.
      const connections: GoogleConnection[] = result?.grantedConnections ?? [];
      this.setState({
        googleConnections: connections.filter((c: any) => c.provider === 'google' && c.status !== 'revoked'),
      });
    } catch { /* Local not running */ }
  }

  private async connectGoogle() {
    this.setState({ connectingGoogle: true });
    try {
      await this.props.electron?.ipcRenderer?.invoke('nexus-ai:credential:connect', {
        provider: 'google',
        agentId: this.props.agentId,
        siteId: '',
        // Verbatim from the agent — asking for more than it declared is over-authorising, and
        // asking for the wrong API's scope fails at the first call.
        scopes: this.googleDecl()?.scopes ?? [],
      });
    } catch { /* handled by credential event */ } finally {
      this.setState({ connectingGoogle: false });
    }
  }

  /** Disconnect ONE account; the others stand — each connection is its own decision. */
  private async disconnectGoogle(connectionId: string) {
    try {
      await this.props.electron?.ipcRenderer?.invoke('nexus-ai:credential:disconnect', {
        connectionId,
      });
      this.setState((prev) => ({
        googleConnections: prev.googleConnections.filter((c) => c.id !== connectionId),
      }));
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
      return React.createElement('span', { style: { color: 'var(--ag-picker-danger)' } }, `Every site on the account, including ${p} in production`);
    }
    if (p === 0) {
      return React.createElement('span', { style: { color: 'var(--ag-text-primary)' } }, `${n} site${n === 1 ? '' : 's'} — no production`);
    }
    return React.createElement('span', { style: { color: 'var(--ag-picker-danger)' } },
      n === 1 ? `1 site, in production` : `${n} sites, ${p} of them in production`);
  }

  /**
   * The Settings-tab stand-in for the scope editor, for agents whose Sites tab owns coverage.
   *
   * The count comes from the caller, not from `scope.siteIds`, because the two agents decide
   * coverage differently: log-processor's switches write that field, while web-analytics has no
   * scope at all — a GA4 binding *is* the opt-in. Reading the field directly reported "nothing
   * switched on" for an agent that was, in fact, running.
   */
  /**
   * Stand-in for the scope editor for an agent that declares siteScoped:false. Its run() reads
   * neither ctx.event's site nor settings.scope, so a picker here would write a field nothing
   * consumes — the same "two lists answering one question" failure renderScopeElsewhereLine
   * exists to avoid.
   */
  private renderNotSiteScopedLine() {
    return React.createElement('div', {
      style: {
        marginBottom: 14, padding: '11px 14px', borderRadius: 10,
        background: 'var(--ag-bg-inset)', border: '1px solid var(--ag-border-subtle)',
        fontSize: 13, color: 'var(--ag-text-secondary)',
      },
    }, 'This agent is not scoped to sites — each run performs the same fleet-wide checks.');
  }

  /**
   * Stand-in for the schedule row for an agent whose manifest declares no cron trigger.
   *
   * Such an agent cannot be put on one. `AgentScheduler.register()` returns before scheduling
   * anything when `cronTriggers.length === 0`, and `effectiveCadenceExpression` refuses to let a
   * stored cadence conjure a schedule that was never built.
   *
   * Note what this row is NOT for. security-sentinel was in this state, and the fix was to give
   * it a real cron trigger, not to keep offering controls here — an agent a user wants on a timer
   * needs one declared in its own `triggers` array in `agents/<name>/agent.js`, which is the only
   * place the runtime looks. This row is the honest answer for an agent genuinely built without
   * one.
   *
   * So the toggle and the cadence button are ABSENT here rather than disabled. Both wrote real,
   * persisted settings — `scheduleEnabled`, and `cadence`/`cadenceSetAt` straight onto disk —
   * that nothing downstream could read, while the label beside them kept reading "Not scheduled"
   * however many times it was clicked. A control that saves a value nobody reads is worse than no
   * control: it reports success at the one thing it cannot do.
   */
  private renderNoScheduleLine(hasEvents: boolean) {
    return React.createElement('div', {
      style: {
        marginBottom: 14, padding: '11px 14px', borderRadius: 10,
        background: 'var(--ag-bg-inset)', border: '1px solid var(--ag-border-subtle)',
        fontSize: 13, color: 'var(--ag-text-secondary)',
      },
    }, hasEvents
      ? 'Not on a schedule — this agent declares no timer. It runs on the events below, and whenever you press Run now.'
      : 'Not on a schedule — this agent declares no timer. It runs only when you press Run now.');
  }

  private renderScopeElsewhereLine() {
    const count = this.props.sitesTabCount ?? this.currentScopeSiteIds().length;
    const noun = this.props.sitesTabNoun ?? 'install';
    const verb = this.props.sitesTabVerb ?? 'switched on';
    return React.createElement('div', {
      style: {
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        marginBottom: 14, padding: '11px 14px', borderRadius: 10,
        background: 'var(--ag-bg-inset)', border: '1px solid var(--ag-border-subtle)',
      },
    },
      React.createElement('div', { style: { fontSize: 13, color: 'var(--ag-text-secondary)' } },
        count === 0
          ? `No ${noun}s are ${verb} yet — nothing will run on this schedule.`
          : `${count} ${noun}${count === 1 ? '' : 's'} ${verb}. Each scheduled run makes one pass per ${noun}.`,
      ),
      React.createElement('button', {
        onClick: () => this.props.onOpenSitesTab?.(),
        style: {
          flexShrink: 0, background: 'transparent', border: '1px solid var(--ag-border-control)',
          borderRadius: 8, padding: '6px 13px', fontSize: 12.5, fontWeight: 600,
          color: 'var(--ag-text-primary)', cursor: 'pointer',
        },
      }, 'Open Sites'),
    );
  }

  private renderScanScope() {
    const { scopeSites, scopeLoading, scopeExpanded, scopeDraftSelection, driftDismissed, settings } = this.state;
    const selectedIds = new Set(this.currentScopeSiteIds());
    const selectedSites = scopeSites.filter(s => selectedIds.has(s.id));
    const drifted = this.getDriftedSites();
    const allowsProduction = this.props.allowsProduction ?? true;
    const effect = this.props.effect ?? 'writes';
    const effectiveCron = effectiveCadenceExpression(settings, this.props.cronExpression);
    const cadence = effectiveCron ? describeCron(effectiveCron).toLowerCase() : 'on the configured schedule';

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
            style: { fontSize: 13, fontWeight: 700, color: 'var(--ag-picker-bg-page)', background: 'var(--ag-picker-warning)', border: 'none', borderRadius: 8, padding: '6px 12px', cursor: 'pointer' },
          }, `Review ${drifted.length}`),
          React.createElement('button', {
            onClick: () => this.setState({ driftDismissed: true }),
            style: { fontSize: 13, fontWeight: 600, color: 'var(--ag-picker-text-dim)', background: 'transparent', border: 'none', cursor: 'pointer' },
          }, 'Dismiss'),
        ),
      ),

      React.createElement('div', { style: { display: 'flex', justifyContent: 'flex-end' } },
        React.createElement('button', {
          onClick: scopeExpanded ? this.cancelScopeEdit : this.openScopeEditor,
          style: {
            background: scopeExpanded ? 'transparent' : 'var(--ag-picker-teal)',
            color: scopeExpanded ? 'var(--ag-picker-text-dim)' : 'var(--ag-picker-bg-page)',
            border: scopeExpanded ? '1px solid var(--ag-picker-control-border)' : 'none',
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
          React.createElement('span', { style: { flex: 1, fontSize: 13, fontWeight: 600, color: draftProdCount > 0 ? 'var(--ag-picker-danger)' : 'transparent' } },
            draftProdCount > 0
              ? `${draftProdCount} live production site${draftProdCount === 1 ? '' : 's'} will be ${productionWarningVerb(effect)} ${cadence}.`
              : ' ',
          ),
          React.createElement('button', {
            onClick: this.cancelScopeEdit,
            style: { fontSize: 14, fontWeight: 600, color: 'var(--ag-picker-text-dim)', background: 'transparent', border: '1px solid var(--ag-picker-control-border)', borderRadius: 9, padding: '9px 16px', cursor: 'pointer' },
          }, 'Cancel'),
          React.createElement('button', {
            onClick: this.saveScopeEdit,
            style: {
              fontSize: 14, fontWeight: 700, color: 'var(--ag-picker-bg-page)', border: 'none', borderRadius: 9, padding: '9px 16px', cursor: 'pointer',
              background: draftProdCount > 0 ? 'var(--ag-picker-danger)' : 'var(--ag-picker-teal)',
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

  // P0-5 (b): the first time a user enables ANY agent, disclose once that agents send site data to
  // the configured AI provider on their schedule — agents have no persistent surface like chat's
  // footer. Enabling is deferred until they acknowledge; disabling and every later enable are
  // silent.
  private handleToggleEnabled = (v: boolean): void => {
    if (shouldShowAgentDataDisclosure(v, hasAcknowledgedAgentDataDisclosure())) {
      this.setState({ showDataDisclosure: true });
      return;
    }
    this.updateSettings({ enabled: v });
  };

  private confirmEnableAfterDisclosure = (): void => {
    acknowledgeAgentDataDisclosure();
    this.setState({ showDataDisclosure: false });
    this.updateSettings({ enabled: true });
  };

  private cancelEnableDisclosure = (): void => {
    this.setState({ showDataDisclosure: false });
  };

  private cycleCadence() {
    const { cadence } = this.state.settings;
    // Filtered per agent: a stored floor-breaking cadence (the seeded */15)
    // misses findIndex and the cycle lands on the first legal option.
    const options = cadenceOptionsFor(this.props.agentId);
    const idx = options.findIndex(o => o.value === cadence);
    const next = options[(idx + 1) % options.length];
    // `cadenceSetAt` is what gives this value authority over the agent's own manifest schedule.
    // Every agent carries a seeded `cadence` from getDefaultSettings that nobody picked; without
    // this stamp the scheduler cannot tell those apart from a real choice, and honouring them
    // would silently move agents to schedules their users never asked for.
    this.updateSettings({ cadence: next.value, cadenceSetAt: Date.now() });
  }

  private cycleLogLevel() {
    const LOG_LEVEL_OPTIONS: Array<'ERROR' | 'WARN' | 'INFO' | 'DEBUG' | undefined> = [
      undefined, 'ERROR', 'WARN', 'INFO', 'DEBUG',
    ];
    const current = this.state.settings.logLevel;
    const idx = LOG_LEVEL_OPTIONS.indexOf(current);
    const nextIdx = (idx + 1) % LOG_LEVEL_OPTIONS.length;
    this.updateSettings({ logLevel: LOG_LEVEL_OPTIONS[nextIdx] });
  }

  private formatLogLevel(): string {
    const agentLevel = this.state.settings.logLevel;
    const globalLevel = this.state.globalSettings?.logLevel ?? 'INFO';
    if (agentLevel === undefined) {
      return `Inherit (${globalLevel})`;
    }
    return agentLevel;
  }

  private getRunSummary(): string {
    const { settings } = this.state;
    if (!settings.enabled) return 'Disabled — not running';
    const parts: string[] = [];
    const summaryCron = effectiveCadenceExpression(settings, this.props.cronExpression);
    if (settings.scheduleEnabled && summaryCron) parts.push(`Runs ${describeCron(summaryCron).toLowerCase()}`);
    const catalog = EVENT_CATALOG[this.props.agentId] || [];
    const subCount = catalog.filter(e => settings.subscribedEvents[e.id] !== false).length;
    if (settings.eventsEnabled && subCount > 0) parts.push(`responds to ${subCount} event${subCount !== 1 ? 's' : ''}`);
    parts.push('ad-hoc');
    return parts.join(' · ');
  }

  /** Phase 3 · load the Govern matrix for the grants section. */
  private loadGovernRows = async (): Promise<void> => {
    try {
      const matrix = await this.props.electron?.ipcRenderer?.invoke('nexus-ai:govern:matrix');
      this.setState({ governRows: matrix?.rows ?? null });
    } catch {
      this.setState({ governRows: null });
    }
  };

  /**
   * Phase 3 · this agent's own grant act. The IPC returns the refreshed
   * matrix, so the rows on screen are the rows the gate now applies.
   */
  private async handleGrantToggle(capability: string, grant: boolean): Promise<void> {
    try {
      const result = await this.props.electron?.ipcRenderer?.invoke('nexus-ai:govern:set-grant', {
        capability,
        grant,
        grantee: this.props.agentId,
      });
      if (result?.matrix?.rows) this.setState({ governRows: result.matrix.rows });
      else await this.loadGovernRows();
    } catch {
      await this.loadGovernRows();
    }
  }

  /**
   * Phase 3 · "Procedures this agent may run" — the door target the
   * permissions-pane ruling names: the decision changes INSIDE the agent.
   * One row per capability the registry serves; the switch is THIS agent's
   * own (grantee, capability) grant; a held row cites the agent's OWN act
   * (`acts[agentId]`), never another holder's.
   */
  private renderGrantsSection(): React.ReactNode {
    const { agentId } = this.props;
    const rows = this.state.governRows;

    if (!rows) {
      return this.renderCard(
        React.createElement('div', null,
          React.createElement('div', { style: { fontSize: 14, fontWeight: 600, color: 'var(--ag-text-primary)', marginBottom: 4 } },
            'Procedures this agent may run'),
          React.createElement('div', { style: { fontSize: 12.5, color: 'var(--ag-text-secondary)' } },
            'Grant records are unavailable — background record-keeping is not running. ' +
            'Grants cannot be shown or changed until it recovers.'),
        ),
      );
    }

    return this.renderCard(
      React.createElement('div', null,
        React.createElement('div', { style: { fontSize: 14, fontWeight: 600, color: 'var(--ag-text-primary)', marginBottom: 2 } },
          'Procedures this agent may run'),
        React.createElement('div', { style: { fontSize: 12.5, color: 'var(--ag-text-secondary)', marginBottom: 12 } },
          'An agent holds only what you grant it here. Each grant is recorded as its own act, ' +
          'and the platform refuses the agent by name anywhere it acts without one.'),
        ...rows.map((row) => {
          const held = row.holders.includes(agentId);
          const act = row.acts[agentId];
          return React.createElement('div', {
            key: row.capability,
            'data-agent-grant-row': row.capability,
            'data-held': held,
            style: {
              display: 'flex', alignItems: 'flex-start', gap: 12,
              padding: '10px 0', borderTop: '1px solid var(--ag-border)',
            },
          },
            React.createElement(ToggleSwitch, {
              checked: held,
              onChange: (v: boolean) => { void this.handleGrantToggle(row.capability, v); },
            }),
            React.createElement('div', { style: { flex: 1, minWidth: 0 } },
              React.createElement('div', { style: { fontSize: 13, fontWeight: 600, color: 'var(--ag-text-primary)' } }, row.label),
              React.createElement('div', { style: { fontFamily: 'ui-monospace, monospace', fontSize: 10.5, color: 'var(--ag-text-faint)' } },
                row.documentLine),
              held && act
                ? React.createElement('div', { style: { fontSize: 11, color: 'var(--ag-text-secondary)', marginTop: 2 } },
                    `granted to this agent · ${act.eventId} · ${act.issuedAt}`)
                : null,
            ),
          );
        }),
      ),
    );
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
    const { googleConnections, connectingGoogle } = this.state;
    const isConnected = googleConnections.length > 0;
    const decl = this.googleDecl();
    const productName = googleScopeSummary(decl?.scopes ?? []);
    return this.renderCard(
      React.createElement('div', null,
        // Header
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 } },
          React.createElement('div', null,
            React.createElement('div', { style: { fontSize: 13.5, fontWeight: 600, color: 'var(--ag-text-primary)' } }, 'Connected Accounts'),
            React.createElement('div', { style: { fontSize: 12.5, color: 'var(--ag-text-muted)', marginTop: 3 } },
              // The agent's own `reason` — it is what the user is being asked to consent to, so it
              // has to be the agent's words, not a label picked here.
              decl?.reason || `Connect ${productName} so this agent can read your data`,
            ),
          ),
        ),
        // One row PER connected account (2026-08-26): a second client's GA can
        // live under a second Google login, and each connection disconnects
        // on its own. The empty state keeps the original single row.
        ...(isConnected
          ? googleConnections.map((conn) => React.createElement('div', {
              key: conn.id,
              'data-google-connection': conn.id,
              style: { display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 8, background: 'var(--ag-bg-elevated)', border: '1px solid var(--ag-border-subtle)', marginBottom: 8 },
            },
              React.createElement('div', {
                style: { width: 28, height: 28, borderRadius: 6, background: 'rgba(66,133,244,0.12)', border: '1px solid var(--ag-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0 },
              }, 'G'),
              React.createElement('div', { style: { flex: 1 } },
                React.createElement('div', { style: { fontSize: 13, fontWeight: 500, color: 'var(--ag-text-primary)' } }, productName),
                React.createElement('div', { style: { fontSize: 12, color: 'var(--ag-green)', marginTop: 2 } },
                  `Connected · ${conn.accountLabel}`),
              ),
              React.createElement('button', {
                onClick: () => this.disconnectGoogle(conn.id),
                style: { padding: '6px 14px', background: 'transparent', border: '1px solid var(--ag-border)', borderRadius: 6, fontSize: 12, color: 'var(--ag-text-muted)', cursor: 'pointer' },
              }, 'Disconnect'),
            ))
          : [React.createElement('div', {
              key: 'empty',
              style: { display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 8, background: 'var(--ag-bg-elevated)', border: '1px solid var(--ag-border-subtle)' },
            },
              React.createElement('div', {
                style: { width: 28, height: 28, borderRadius: 6, background: 'var(--ag-bg-card)', border: '1px solid var(--ag-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0 },
              }, 'G'),
              React.createElement('div', { style: { flex: 1 } },
                React.createElement('div', { style: { fontSize: 13, fontWeight: 500, color: 'var(--ag-text-primary)' } }, productName),
                React.createElement('div', { style: { fontSize: 12, color: 'var(--ag-text-muted)', marginTop: 2 } }, 'Not connected'),
              ),
            )]),
        // The connect flow always creates a NEW connection, so the button is
        // never hidden by having one already — that hiding WAS the
        // single-account assumption on this card.
        React.createElement('div', { style: { marginTop: isConnected ? 4 : 10 } },
          React.createElement('button', {
            onClick: () => this.connectGoogle(),
            disabled: connectingGoogle,
            'data-google-connect': true,
            style: { padding: '6px 14px', background: 'var(--ag-teal)', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600, color: 'var(--ag-on-teal)', cursor: connectingGoogle ? 'wait' : 'pointer', opacity: connectingGoogle ? 0.7 : 1 },
          }, connectingGoogle ? 'Connecting…' : (isConnected ? 'Connect another Google account' : 'Connect Google account')),
        ),
      ),
    );
  }

  private renderDataDisclosure() {
    return React.createElement(
      'div',
      {
        style: {
          position: 'fixed', inset: 0, zIndex: 1000,
          background: 'rgba(0,0,0,0.45)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', padding: 20,
        },
        onClick: this.cancelEnableDisclosure,
      },
      React.createElement(
        'div',
        {
          onClick: (e: React.MouseEvent) => e.stopPropagation(),
          style: {
            maxWidth: 460, background: 'var(--ag-surface, #1c222b)',
            border: '1px solid var(--ag-border, #28303a)', borderRadius: 12,
            padding: '22px 24px', boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
          },
        },
        React.createElement('div', {
          style: { fontSize: 16, fontWeight: 700, color: 'var(--ag-text-primary)', marginBottom: 10 },
        }, 'Agents send data to your AI provider'),
        React.createElement('div', {
          style: { fontSize: 13.5, color: 'var(--ag-text-secondary)', lineHeight: 1.55, marginBottom: 6 },
        }, 'When enabled, this agent runs on its schedule and sends your site data to your configured AI provider. Personal data (emails, IP addresses) is masked before anything is sent.'),
        React.createElement('div', {
          style: { fontSize: 11.5, color: 'var(--ag-text-secondary)', opacity: 0.75, marginBottom: 18 },
        }, "You'll only see this once."),
        React.createElement(
          'div',
          { style: { display: 'flex', justifyContent: 'flex-end', gap: 10 } },
          React.createElement('button', {
            onClick: this.cancelEnableDisclosure,
            style: {
              padding: '8px 14px', borderRadius: 8, fontSize: 13, cursor: 'pointer',
              background: 'transparent', color: 'var(--ag-text-secondary)',
              border: '1px solid var(--ag-border, #28303a)',
            },
          }, 'Cancel'),
          React.createElement('button', {
            onClick: this.confirmEnableAfterDisclosure,
            style: {
              padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
              background: 'var(--ag-accent, #2dbdd1)', color: '#08222a', border: 'none',
            },
          }, 'Enable agent'),
        ),
      ),
    );
  }

  render() {
    const { settings } = this.state;
    const { agentId } = this.props;
    const catalog = EVENT_CATALOG[agentId] || [];
    const currentAutonomy = agentStore.getState().autonomyById[agentId] || 'ask';
    // Whether this agent can be scheduled at all — see renderNoScheduleLine.
    const hasManifestCron = (this.props.cronExpression ?? '').trim() !== '';

    return React.createElement('div', { style: { maxWidth: 680 } },

      // P0-5 (b): one-time disclosure shown when first enabling an agent.
      this.state.showDataDisclosure ? this.renderDataDisclosure() : null,

      // Card 1: Enable + Run now
      this.renderCard(
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 16 } },
          React.createElement(ToggleSwitch, {
            checked: settings.enabled,
            onChange: (v) => this.handleToggleEnabled(v),
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

          // On a schedule — offered only to an agent that has one. An agent with no cron trigger
          // in its manifest gets the sentence instead of the controls; see renderNoScheduleLine.
          hasManifestCron
            ? React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 } },
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
                }, (() => {
                  // The button shows what actually runs, so an untouched agent reads its manifest
                  // schedule rather than a cadence nobody picked. Clicking still cycles the picker.
                  // `hasManifestCron` guarantees this is never the null branch.
                  const expr = effectiveCadenceExpression(settings, this.props.cronExpression);
                  return expr ? describeCron(expr) : 'Not scheduled';
                })()),
              )
            : this.renderNoScheduleLine(catalog.length > 0),

          // Which sites the schedule may touch. Shown only when a schedule is on — it constrains
          // scheduled runs, not Run Now, and offering it otherwise implies it gates everything.
          //
          // An agent with a Sites tab owns its scope there instead. Two lists answering "which
          // sites run" is the specific failure handoff_log_sources_v3/DECISIONS.md §2 documents:
          // every state that reconciles them is an apology for a state that should never have
          // been representable. One line pointing at the real control, never a second copy of it.
          // `hasManifestCron` as well as the toggle: a no-cron agent can still carry a stale
          // `scheduleEnabled: true` from before the toggle was withdrawn, and "which sites the
          // schedule may touch" beneath "this agent declares no timer" answers a question the
          // row above just said does not exist.
          hasManifestCron && settings.scheduleEnabled && (
            !(this.props.siteScoped ?? true)
              ? this.renderNotSiteScopedLine()
              : this.props.scopeLivesInSitesTab
                ? this.renderScopeElsewhereLine()
                : this.renderScanScope()
          ),

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

      // Card 3: Autonomy — AUTONOMY_OPTIONS' copy ("clones a sandbox", "pushing to production")
      // is security-sentinel's own remediation model, not a generic concept every agent shares.
      // ctx.autonomy is read only by security-sentinel/agent.js; log-processor and seo-insights
      // never reference it at all, so showing this card for them was a dead control with
      // actively misleading copy. Gated on producesApprovals — the same "does this agent have a
      // gated action to pause on" capability, not a separate flag, since the two have coincided
      // for every agent so far and a real decoupling need can introduce its own field later.
      // Phase 3 (fixes-082526): the agent's own grants — the door target.
      this.renderGrantsSection(),

      (this.props.producesApprovals ?? true) && this.renderCard(
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
      !!this.googleDecl() && this.renderConnectionsCard(),

      // Observability card — transcripts toggle and log level override
      this.renderCard(
        React.createElement('div', null,
          React.createElement('div', { style: { fontSize: 14.5, fontWeight: 600, color: 'var(--ag-text-primary)', marginBottom: 16 } }, 'Observability'),

          // Transcripts toggle
          React.createElement('div', { style: { display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 18 } },
            React.createElement(ToggleSwitch, {
              checked: settings.transcripts ?? false,
              onChange: (v) => this.updateSettings({ transcripts: v }),
            }),
            React.createElement('div', { style: { flex: 1 } },
              React.createElement('div', { style: { fontSize: 13.5, color: 'var(--ag-text-primary)', marginBottom: 3 } }, 'Write transcripts'),
              React.createElement('div', { style: { fontSize: 12.5, color: 'var(--ag-text-secondary)', lineHeight: 1.5 } },
                'Records the full prompt and response of every model call this agent makes. Prompts carry site content, findings, and whatever the agent puts in them — this is off by default and per-agent rather than global for that reason. Transcripts are redacted with the same masking as the logs, kept 3 days, and capped per run, but redaction is a backstop, not a guarantee.',
              ),
            ),
          ),

          // Log level override
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 12 } },
            React.createElement('div', { style: { flex: 1 } },
              React.createElement('div', { style: { fontSize: 13.5, color: 'var(--ag-text-primary)', marginBottom: 3 } }, 'Log level'),
              React.createElement('div', { style: { fontSize: 12.5, color: 'var(--ag-text-secondary)' } },
                'Override the global log level for this agent. Useful for raising one agent to DEBUG while the rest stay at INFO, or lowering a noisy agent to ERROR.',
              ),
            ),
            React.createElement('button', {
              onClick: () => this.cycleLogLevel(),
              style: {
                background: 'var(--ag-bg-elevated)', border: '1px solid var(--ag-border-control)',
                borderRadius: 7, padding: '5px 12px', fontSize: 12.5, color: 'var(--ag-text-primary)',
                cursor: 'pointer', fontWeight: 500,
              },
            }, this.formatLogLevel()),
          ),
        ),
        !settings.enabled,
      ),

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
                    background: 'var(--ag-picker-danger)', color: 'var(--ag-picker-on-teal)', border: 'none', borderRadius: 8,
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
                  padding: '8px 16px', fontSize: 13, fontWeight: 600, color: 'var(--ag-picker-danger)', cursor: 'pointer',
                },
              }, 'Remove…'),
        ),
      ),
    );
  }
}
