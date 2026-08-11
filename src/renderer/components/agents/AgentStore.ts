export interface AgentInfo {
  id: string;
  name: string;
  initial: string;
  accent: string;
  tagline: string;
  autonomyLabel: string;
  schedule: string;
  kpis: Array<{ label: string; val: string; color?: string }>;
  mini: Array<{ label: string; val: string; color?: string }>;
  scope: string[];
}

export interface AgentStatus {
  name: string;
  version: string;
  description: string | null;
  cronExpression: string | null;
  lastRunAt: number | null;
  lastRunStatus: string | null;
  lastRunDurationMs: number | null;
  lastRunError: string | null;
  supportsFullRun: boolean;
  allowsProduction: boolean;
  effect: 'readonly' | 'writes';
  producesApprovals: boolean;
  producesReports: boolean;
  /** False = this agent is not per-site: no picker, and Run Now performs exactly one run. */
  siteScoped: boolean;
  /** What the agent itself declares it needs. Empty when the query predates this field. */
  credentials?: AgentCredentialDecl[];
}

/** Straight from the agent definition — never a renderer-side constant. */
export interface AgentCredentialDecl {
  provider: string;
  type?: string;
  scopes?: string[];
  optional?: boolean;
  reason?: string | null;
}

export interface AgentRunRecord {
  id: string;
  agentName: string;
  startedAt: number;
  finishedAt: number;
  status: 'success' | 'error' | 'timeout';
  error?: string;
  summary?: string;
  findingsCount: number;
  logFile?: string;
  reportFile?: string;
}

export interface RemediationPlan {
  site?: string;
  [key: string]: any;
}

export interface Finding {
  [key: string]: any;
}

export interface ActivityEvent {
  id: string;
  agentId: string;
  day: string;
  time: string;
  type: 'Action' | 'Alert' | 'Report' | 'Info';
  status: 'review' | 'auto' | 'done' | 'info' | 'dismissed';
  text: string;
  sub: string;
  ref?: string;
  siteName?: string;   // primary site this event is about (for report lookup)
  count?: number;
  children?: string[];
  plan?: RemediationPlan;       // structured remediation plan from AgentResult
  findings?: Finding[];         // structured findings from AgentResult
  summary?: string;             // free-text Site Content Report from AgentResult.summary
}

/**
 * Which sites a *scheduled* run may touch. A run the user targets directly — Run Now, or an
 * event naming one install — is not constrained by this.
 *
 * Always an explicit list, never a live rule — a site added to the account after this was saved
 * is never auto-included (see the drift banner in the picker UI). An empty siteIds scans
 * nothing, deliberately: the alternative, treating "nothing configured" as "scan everything", is
 * the exact shape of the bug that had security-sentinel sweeping 375 sites every 15 minutes with
 * nobody having chosen anything. There used to be a second, legacy `AgentScanScope` shape with a
 * live `mode: 'all'` — removed 2026-08-07 when "Every site" was retired from the picker UI for
 * contradicting this same explicit-list model. `AgentWorkspaceSettings` still reads that legacy
 * on-disk shape as a one-time migration fallback when `scope` itself is absent.
 */
export interface AgentScope {
  siteIds: string[];
}

export interface AgentSavedScope {
  name: string;
  siteIds: string[];
}

export interface AgentSettings {
  enabled: boolean;
  scheduleEnabled: boolean;
  cadence: string;  // '*/15 * * * *' | '0 * * * *' | '0 */6 * * *' | '0 0 * * *' | '0 0 * * 0'
  /**
   * Unix ms of the moment the user actually picked `cadence`. Absent means `cadence` is the value
   * getDefaultSettings seeded, which nobody chose — and the scheduler then runs the agent's own
   * manifest schedule instead. Only an explicit choice outranks the agent author.
   */
  cadenceSetAt?: number;
  eventsEnabled: boolean;
  subscribedEvents: Record<string, boolean>;
  /** Persistent scope for scheduled runs and event triggers, shared by both, and the same field
   * Run Now prefills from — see AgentScope. */
  scope: AgentScope;
  /** Named scopes saved for quick re-application in the picker. Per-agent, not shared (v1). */
  savedScopes?: AgentSavedScope[];
  /** Unix ms timestamp of the last time `scope` was edited. Required to compute drift. */
  scopeUpdatedAt?: number;
  /**
   * Write the full prompt and response of every model call to a transcript sidecar. Off by
   * default: prompts carry site content, so this is opt-in for the agent you are debugging.
   */
  transcripts?: boolean;
  /**
   * Per-agent log level override. Absent means use the global level. Overrides work in both
   * directions: raising one agent to DEBUG while the rest stay at INFO, or lowering a noisy agent
   * to ERROR while the rest stay at DEBUG.
   */
  logLevel?: 'ERROR' | 'WARN' | 'INFO' | 'DEBUG';
}

export interface AgentState {
  statuses: AgentStatus[];          // from agentStatus GraphQL query
  selectedAgentId: string | null;
  // homeTab is managed locally in AgentConsoleTab component state
  activityEvents: ActivityEvent[];
  autonomyById: Record<string, 'suggest' | 'ask' | 'auto'>;
  agentSettings: Record<string, AgentSettings>;
  expandedEvents: Record<string, boolean>;
  // runningAgents: managed locally in AgentWorkspace component state
  pendingBySource: Record<string, number>;  // from GET_INBOX, not persisted
  pendingLoaded: boolean;  // true once a successful GET_INBOX lands, not persisted
}

const DEFAULT_STATE: AgentState = {
  statuses: [],
  selectedAgentId: null,
  activityEvents: [],
  autonomyById: {},
  agentSettings: {},
  expandedEvents: {},
  pendingBySource: {},
  pendingLoaded: false,
};

const PERSIST_KEY = 'nexus-ai:agent-store-v1';

function loadPersisted(): Partial<AgentState> {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(PERSIST_KEY) : null;
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return {
      agentSettings:  parsed.agentSettings  || {},
      autonomyById:   parsed.autonomyById   || {},
      activityEvents: parsed.activityEvents || [],
    };
  } catch { return {}; }
}

function savePersisted(state: AgentState): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(PERSIST_KEY, JSON.stringify({
        agentSettings:  state.agentSettings,
        autonomyById:   state.autonomyById,
        activityEvents: state.activityEvents.slice(0, 100), // keep last 100
      }));
    }
  } catch {}
}

class AgentStore {
  private state: AgentState = { ...DEFAULT_STATE, ...loadPersisted() };
  private listeners = new Set<() => void>();
  private ipcSyncer: ((settings: Record<string, AgentSettings>) => void) | null = null;
  /** True once main's persisted settings have been adopted — see hydrateFromMain. */
  private hydrated = false;

  /**
   * Adopt what the main process has actually persisted.
   *
   * The renderer is the only writer of agent settings but never had a reader, so its
   * localStorage copy was treated as truth and pushed over the disk file on mount. When the two
   * disagreed — cleared browser storage, a new profile, an agent added since — the guess won.
   *
   * Disk wins for every agent it knows about. Anything the main process has never heard of keeps
   * whatever the renderer has, so an unsaved in-flight edit is not discarded.
   */
  hydrateFromMain(persisted: Record<string, Partial<AgentSettings>> | null | undefined): void {
    if (!persisted) { this.hydrated = true; return; }
    const merged: Record<string, AgentSettings> = { ...this.state.agentSettings };
    const autonomy: Record<string, any> = { ...this.state.autonomyById };
    for (const [id, saved] of Object.entries(persisted)) {
      merged[id] = { ...this.getDefaultSettings(id), ...(merged[id] ?? {}), ...saved } as AgentSettings;
      if ((saved as any)?.autonomy) autonomy[id] = (saved as any).autonomy;
    }
    this.hydrated = true;
    // Straight assignment, not setState: setState would push this right back at main, and the
    // point is that main just told US.
    this.state = { ...this.state, agentSettings: merged, autonomyById: autonomy };
    savePersisted(this.state);
    this.listeners.forEach(fn => fn());
  }

  setIpcSyncer(fn: (settings: Record<string, AgentSettings>) => void): void {
    this.ipcSyncer = fn;
    // Only echo state back to main once we know it is not a guess. Pushing here unconditionally
    // is what let stale localStorage overwrite the persisted file on mount.
    if (this.hydrated) fn(this.buildSyncPayload());
  }

  /** Merge agentSettings with autonomyById so the main process gets a single unified view. */
  private buildSyncPayload(): Record<string, AgentSettings> {
    const merged: Record<string, AgentSettings> = { ...this.state.agentSettings };
    for (const [id, autonomy] of Object.entries(this.state.autonomyById)) {
      // Same reasoning as getDefaultSettings: an agent known only by its autonomy value has
      // never had its triggers configured, so they are off.
      merged[id] = { ...(merged[id] ?? { enabled: true, scheduleEnabled: false, eventsEnabled: false }), autonomy } as any;
    }
    return merged;
  }

  getState(): AgentState { return this.state; }

  setState(patch: Partial<AgentState>): void {
    this.state = { ...this.state, ...patch };
    if ('agentSettings' in patch || 'autonomyById' in patch || 'activityEvents' in patch) savePersisted(this.state);
    if (('agentSettings' in patch || 'autonomyById' in patch) && this.ipcSyncer) this.ipcSyncer(this.buildSyncPayload());
    this.listeners.forEach(fn => fn());
  }

  subscribe(fn: () => void): void   { this.listeners.add(fn); }
  unsubscribe(fn: () => void): void { this.listeners.delete(fn); }

  // Derive status: disabled > needs-review > healthy
  getAgentDerivedStatus(agentId: string): 'disabled' | 'action' | 'ok' {
    const settings = this.state.agentSettings[agentId];
    if (settings && !settings.enabled) return 'disabled';
    // Pending count comes from the inbox store, not activityEvents
    const pending = this.state.pendingBySource[agentId] ?? 0;
    return pending > 0 ? 'action' : 'ok';
  }

  getDefaultSettings(agentId: string): AgentSettings {
    // An agent nobody has configured must not start ITSELF. `enabled: true` keeps it usable
    // from chat and Run Now; the two automatic triggers are off until the user turns them on.
    // These used to be `true`, and because getOrInitSettings seeds them into state — which
    // immediately pushes to main and writes to disk — merely opening the agents tab could
    // re-enable a 15-minute cron on an agent that had been switched off. Mirrors
    // seedAgentDefaultsIfMissing in ipc-handlers; the two must stay in agreement.
    return {
      enabled: true,
      scheduleEnabled: false,
      cadence: '*/15 * * * *',
      eventsEnabled: false,
      subscribedEvents: {},
      // Opt-in. No site is scanned on a schedule until the user picks it in the site scope
      // picker. The main process applies the same rule independently (resolveScanScope in the
      // agent) — this default is the UI's view of it, not the enforcement.
      scope: { siteIds: [] },
    };
  }

  getOrInitSettings(agentId: string): AgentSettings {
    if (!this.state.agentSettings[agentId]) {
      this.setState({
        agentSettings: {
          ...this.state.agentSettings,
          [agentId]: this.getDefaultSettings(agentId),
        },
      });
    }
    return this.state.agentSettings[agentId];
  }

  /**
   * Replace the agent list, always sorted by name.
   *
   * The `agentStatus` query returns agents in whatever order the registry scanned their
   * directories, which is neither stable nor meaningful — the hub grid reshuffled between loads.
   * Sorting here rather than in the grid means every consumer of `statuses` gets the same order
   * for free, and a new surface cannot forget to sort.
   */
  setStatuses(statuses: AgentStatus[]): void {
    this.setState({
      statuses: [...statuses].sort((a, b) => a.name.localeCompare(b.name)),
    });
  }

  /** Merge a patch into one agent's settings. The Settings panel has always done this inline;
   * it lives here so a second editing surface (log-processor's Sites tab) writes the same field
   * the same way instead of reaching into `agentSettings` itself. */
  updateSettings(agentId: string, patch: Partial<AgentSettings>): void {
    const current = this.getOrInitSettings(agentId);
    this.setState({
      agentSettings: { ...this.state.agentSettings, [agentId]: { ...current, ...patch } },
    });
  }
}

export const agentStore = new AgentStore();
