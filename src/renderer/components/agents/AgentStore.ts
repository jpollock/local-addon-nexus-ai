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
 * 'explicit' with an empty siteIds scans nothing, deliberately. The alternative, treating
 * "nothing configured" as "scan everything", is the exact shape of the bug that had
 * security-sentinel sweeping 375 sites every 15 minutes with nobody having chosen anything.
 */
export interface AgentScanScope {
  mode: 'explicit' | 'all';
  siteIds: string[];
}

export interface AgentSettings {
  enabled: boolean;
  scheduleEnabled: boolean;
  cadence: string;  // '*/15 * * * *' | '0 * * * *' | '0 */6 * * *' | '0 0 * * *' | '0 0 * * 0'
  eventsEnabled: boolean;
  subscribedEvents: Record<string, boolean>;
  scanScope: AgentScanScope;
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
}

const DEFAULT_STATE: AgentState = {
  statuses: [],
  selectedAgentId: null,
  activityEvents: [],
  autonomyById: {},
  agentSettings: {},
  expandedEvents: {},
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

  setIpcSyncer(fn: (settings: Record<string, AgentSettings>) => void): void {
    this.ipcSyncer = fn;
    // Send current settings immediately on registration
    fn(this.buildSyncPayload());
  }

  /** Merge agentSettings with autonomyById so the main process gets a single unified view. */
  private buildSyncPayload(): Record<string, AgentSettings> {
    const merged: Record<string, AgentSettings> = { ...this.state.agentSettings };
    for (const [id, autonomy] of Object.entries(this.state.autonomyById)) {
      merged[id] = { ...(merged[id] ?? { enabled: true, scheduleEnabled: true, eventsEnabled: true }), autonomy } as any;
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
    // In v1, pending count comes from activity events with status='review' referencing this agent
    const pending = this.state.activityEvents.filter(
      e => e.agentId === agentId && e.status === 'review'
    ).length;
    return pending > 0 ? 'action' : 'ok';
  }

  getDefaultSettings(agentId: string): AgentSettings {
    return {
      enabled: true,
      scheduleEnabled: true,
      cadence: '*/15 * * * *',
      eventsEnabled: true,
      subscribedEvents: {},
      // Opt-in. No site is scanned on a schedule until the user picks it, or picks "every site".
      // The main process applies the same rule independently (resolveScanScope in the agent) —
      // this default is the UI's view of it, not the enforcement.
      scanScope: { mode: 'explicit', siteIds: [] },
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
}

export const agentStore = new AgentStore();
