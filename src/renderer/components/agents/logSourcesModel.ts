import { IPC_CHANNELS } from '../../../common/constants';
import { fetchScopeSites, ScopeSite, ScopeSiteEnv } from './fetchScopeSites';

/**
 * The one derived set behind log-processor's Sites tab.
 *
 * handoff_log_sources_v3/BEHAVIOR.md §4 is blunt about why this module exists: the tab badge, the
 * agent header line, the schedule sub-line, the table footnote and the Run now enabled state must
 * all be computed from ONE set — installs that have apache-style objects in the bucket AND are
 * switched on. Every contradiction the design review turned up came from a consumer keeping its
 * own copy of one of those numbers. Gate the value, not each consumer.
 */

export interface LogBucket {
  bucket: string;
  region: string;
  prefix: string;
  lastScannedAt: number | null;
}

/** One install found in the bucket. Comes from log-processor's install_scan cache. */
export interface LogInstall {
  site: string;
  objectCount: number;
  bytes: number;
  oldestObjectAt: string | null;
  newestObjectAt: string | null;
  sampleKey: string | null;
  lastSyncedAt: number | null;
}

export interface AwsCredential {
  connected: boolean;
  /** The IAM ARN the credential validated as — shown so the user can tell which key is in use. */
  label?: string;
  createdAt?: string;
}

export interface LogSourcesState {
  bucket: LogBucket | null;
  /** Installs with objects in the bucket. May include ids that are not on this WP Engine account. */
  installs: LogInstall[];
  /** WP Engine installs Local already knows about — the other side of the filename join. */
  fleet: ScopeSite[];
  aws: AwsCredential;
}

export const EMPTY_LOG_SOURCES: LogSourcesState = {
  bucket: null, installs: [], fleet: [], aws: { connected: false },
};

export async function loadLogSources(electron: any): Promise<LogSourcesState> {
  const ipc = electron?.ipcRenderer;
  if (!ipc) return EMPTY_LOG_SOURCES;

  const [state, fleet, creds] = await Promise.all([
    ipc.invoke(IPC_CHANNELS.AGENT_LOG_PROCESSOR_STATE).catch(() => null),
    fetchScopeSites(electron).catch(() => [] as ScopeSite[]),
    ipc.invoke(IPC_CHANNELS.CREDENTIAL_API_KEY_STATUS, { provider: 'aws' }).catch(() => null),
  ]);

  const active = (creds?.connections ?? []).find((c: any) => c?.status === 'active');
  return {
    bucket: state?.bucket ?? null,
    installs: state?.installs ?? [],
    // WP Engine only: the join is against install ids, and a Local site has no S3 access log.
    fleet: (fleet ?? []).filter(s => s.platform === 'WP Engine'),
    aws: active ? { connected: true, label: active.label, createdAt: active.createdAt } : { connected: false },
  };
}

export interface LogSiteRow {
  name: string;
  environment: ScopeSiteEnv;
  /** Has apache-style objects in the bucket. False rows cannot be switched on (BEHAVIOR.md §5). */
  hasLogs: boolean;
  objectCount: number;
  newestObjectAt: string | null;
  sampleKey: string | null;
  lastSyncedAt: number | null;
  /** In `scope.siteIds` AND eligible. A scoped id with no objects never reads as on. */
  on: boolean;
}

/**
 * One row per install on the account, joined to the bucket by exact name. An install with no
 * objects still gets a row — "None in this bucket" is a fact worth showing, and hiding it would
 * make the account look smaller than it is.
 */
export function deriveLogSiteRows(state: LogSourcesState, scopeIds: string[]): LogSiteRow[] {
  const scope = new Set(scopeIds);
  const byName = new Map(state.installs.map(i => [i.site, i]));
  return state.fleet.map(f => {
    const found = byName.get(f.name);
    const hasLogs = !!found && found.objectCount > 0;
    return {
      name: f.name,
      environment: f.environment,
      hasLogs,
      objectCount: found?.objectCount ?? 0,
      newestObjectAt: found?.newestObjectAt ?? null,
      sampleKey: found?.sampleKey ?? null,
      lastSyncedAt: found?.lastSyncedAt ?? null,
      on: hasLogs && scope.has(f.name),
    };
  }).sort((a, b) => {
    // Installs with logs first, then alphabetical. On a 500-install account the handful that
    // actually have objects would otherwise be scattered through the All installs view and
    // effectively lost.
    if (a.hasLogs !== b.hasLogs) return a.hasLogs ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Installs whose logs are in the bucket but which are not on this WP Engine account. Shown as a
 * grey informational line, never a warning — it explains an object-count gap and there is nothing
 * for the user to fix (BEHAVIOR.md §3).
 */
export function deriveOrphans(state: LogSourcesState): LogInstall[] {
  const known = new Set(state.fleet.map(f => f.name));
  return state.installs.filter(i => i.objectCount > 0 && !known.has(i.site));
}

/** The set. Every count and enabled-state on the surface comes from here. */
export function runnableSiteIds(rows: LogSiteRow[]): string[] {
  return rows.filter(r => r.on).map(r => r.name);
}

/**
 * Renderer-side mirror of `normalizeLogPrefix` in agents/log-processor/access-logs.ts, used only
 * to show the user what the agent will store before they submit.
 *
 * Deliberately duplicated rather than imported: agent modules are copied standalone into Local's
 * agents directory and are not part of the renderer bundle, and pulling one in would drag the S3
 * client with it. `tests/unit/renderer/logSourcesModel.test.ts` asserts the two implementations
 * agree over a shared table of inputs, so the copy cannot drift unnoticed.
 */
export function normalizeLogPrefix(raw: string | undefined | null): string {
  const trimmed = (raw ?? '').trim().replace(/^\/+/, '');
  if (trimmed === '') return '';
  return trimmed.endsWith('/') ? trimmed : trimmed + '/';
}

export function formatRelative(ts: number | null | undefined): string | null {
  if (!ts) return null;
  const mins = Math.floor((Date.now() - ts) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
