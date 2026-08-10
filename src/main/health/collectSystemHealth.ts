import { rollUpSystemHealth, HealthSignal, SystemHealth, SystemHealthInputs } from './SystemHealth';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface SystemHealthDeps {
  /** Agents with their last run outcome. */
  getAgents: () => Promise<Array<{ id: string; lastRunStatus: string | null; lastRunAt: number | null }>>;
  /**
   * Active sites with their last successful sync.
   *
   * NOTE: this collector compares `lastSyncAt` against a single flat
   * threshold (`DAY_MS`) for every row. It has no per-source refresh
   * interval and no way to tell "this source's scheduler is disabled"
   * (e.g. `wpeSyncAutoEnabled` / `externalRefreshAutoEnabled`, both
   * default `false`) apart from "this source is enabled but has never
   * synced" — both show up here as `lastSyncAt: null`. A scheduler that
   * is off is not a failure, but with the current shape of this array
   * the gatherer below cannot distinguish the two and will report
   * `degraded` for both. Whoever implements `getSyncAges` (Task 10) must
   * either exclude sites whose source scheduler is disabled before
   * returning them, or this interface needs a field (e.g. `schedulerEnabled`)
   * so the gatherer can report `unknown` instead of `degraded` for them.
   * Flagged per the Task 9 brief's instruction; not fixed here because
   * fixing it requires information this interface does not carry.
   */
  getSyncAges: () => Array<{ id: string; lastSyncAt: number | null }>;
  /** Configured connections and whether their credential currently works. */
  getCredentialStates: () => Promise<Array<{ name: string; ok: boolean }>>;
  /** Event queue counts. */
  getEventStats: () => Promise<{ failed: number; pending: number }>;
  now?: () => number;
}

async function guard(fn: () => Promise<HealthSignal>, label: string): Promise<HealthSignal> {
  try {
    return await fn();
  } catch {
    return { state: 'unknown', reason: `Could not read ${label}` };
  }
}

export async function collectSystemHealth(deps: SystemHealthDeps): Promise<SystemHealth> {
  const now = (deps.now ?? Date.now)();

  const agentRuns = await guard(async () => {
    const agents = await deps.getAgents();
    if (agents.length === 0) return { state: 'unknown', reason: 'No agents reported a run' };
    const failed = agents.filter((a) => a.lastRunStatus === 'failed');
    if (failed.length > 0) {
      return {
        state: 'failing',
        reason: failed.length === 1
          ? `${failed[0].id} failed on its last run`
          : `${failed.length} agents failed on their last run`,
      };
    }
    return { state: 'ok', reason: null };
  }, 'agent run status');

  const syncStaleness = await guard(async () => {
    const rows = deps.getSyncAges();
    if (rows.length === 0) return { state: 'unknown', reason: 'No sites to check' };
    const never = rows.filter((r) => !r.lastSyncAt).length;
    const stale = rows.filter((r) => r.lastSyncAt && now - r.lastSyncAt > DAY_MS).length;
    if (never > 0) return { state: 'degraded', reason: `${never} sites have never been checked` };
    if (stale > 0) return { state: 'degraded', reason: `${stale} sites not checked in over a day` };
    return { state: 'ok', reason: null };
  }, 'sync freshness');

  const credentials = await guard(async () => {
    const creds = await deps.getCredentialStates();
    const broken = creds.filter((c) => !c.ok);
    if (broken.length > 0) {
      return { state: 'failing', reason: `${broken.map((c) => c.name).join(', ')} needs reconnecting` };
    }
    return { state: 'ok', reason: null };
  }, 'credential status');

  const eventQueue = await guard(async () => {
    const stats = await deps.getEventStats();
    if (stats.failed > 0) return { state: 'failing', reason: `${stats.failed} site events failed` };
    if (stats.pending > 10) return { state: 'degraded', reason: `${stats.pending} site events waiting` };
    return { state: 'ok', reason: null };
  }, 'site event queue');

  const inputs: SystemHealthInputs = { agentRuns, syncStaleness, credentials, eventQueue };
  return rollUpSystemHealth(inputs);
}
