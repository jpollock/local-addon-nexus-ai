import { rollUpSystemHealth, HealthSignal, SystemHealth, SystemHealthInputs } from './SystemHealth';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface SystemHealthDeps {
  /** Agents with their last run outcome. */
  getAgents: () => Promise<Array<{ id: string; lastRunStatus: string | null; lastRunAt: number | null }>>;
  /**
   * Active sites with their last successful sync.
   *
   * `refreshEnabled` says whether background refresh is even supposed to be
   * happening for that site (e.g. `wpeSyncAutoEnabled` /
   * `externalRefreshAutoEnabled`, both default `false`). It is deliberately
   * explicit here rather than inferred from the site's source string, so the
   * caller building this array must consciously decide it per row instead of
   * the gatherer guessing.
   *
   * A site with `refreshEnabled: false` is excluded from the staleness
   * assessment entirely — nobody promised to refresh it, so a null or old
   * `lastSyncAt` on it is neither `degraded` nor evidence of anything. Only
   * `refreshEnabled: true` rows are checked against `DAY_MS`. If every row is
   * `refreshEnabled: false`, the gatherer reports `unknown` (background
   * refresh is off, so freshness cannot be verified) rather than `ok` (a
   * false green — nothing is checking) or `degraded` (a false red — the user
   * chose this, it is not a fault).
   */
  getSyncAges: () => Array<{ id: string; lastSyncAt: number | null; refreshEnabled: boolean }>;
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
  // A throwing `now` must not escape this function unguarded — every other
  // failure path returns `unknown` via `guard`, and this is the one place an
  // exception could otherwise leak out uncaught.
  let now: number;
  try {
    now = (deps.now ?? Date.now)();
  } catch {
    now = Date.now();
  }

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
    // `null` means "registered but has never reported a run" — not the same
    // as a successful run, and must not read as ok. Mirrors the zero-agents
    // case above: Nexus genuinely does not know yet, which is `unknown`, not
    // `degraded` (nothing is wrong) and not `ok` (nothing was verified).
    const neverRun = agents.filter((a) => a.lastRunStatus === null);
    if (neverRun.length > 0) {
      return {
        state: 'unknown',
        reason: neverRun.length === 1
          ? `${neverRun[0].id} has not reported a run yet`
          : `${neverRun.length} agents have not reported a run yet`,
      };
    }
    return { state: 'ok', reason: null };
  }, 'agent run status');

  const syncStaleness = await guard(async () => {
    const rows = deps.getSyncAges();
    if (rows.length === 0) return { state: 'unknown', reason: 'No sites to check' };
    const enabled = rows.filter((r) => r.refreshEnabled);
    if (enabled.length === 0) {
      return {
        state: 'unknown',
        reason: `Background refresh is off for all ${rows.length} sites`,
      };
    }
    const never = enabled.filter((r) => !r.lastSyncAt).length;
    const stale = enabled.filter((r) => r.lastSyncAt && now - r.lastSyncAt > DAY_MS).length;
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
