import { IPC_CHANNELS } from '../../../common/constants';

export type ScopeSiteEnv = 'production' | 'staging' | 'development' | 'local';
/**
 * 'External' (SSH-registered hosts, graph.db `source='external'`) is a real platform value the
 * v2 site picker's tab bar expects, but there is no renderer-reachable IPC/GraphQL query for
 * external hosts yet (unlike WPE_GET_SYNCED_SITES / GET_SITES below) — a known gap, not an
 * oversight. Until one exists, fetchScopeSites never produces a 'External' row and that tab
 * always reads 0.
 */
export type ScopeSitePlatform = 'WP Engine' | 'Local' | 'External';

export interface ScopeSite {
  id: string;
  name: string;
  environment: ScopeSiteEnv;
  platform: ScopeSitePlatform;
  /**
   * Unix ms. For WP Engine sites this comes straight through from the synced graph.db row. For
   * local sites it is graph.db's `sites.created_at` too, but it means "first time Nexus indexed
   * this site" rather than "when the site was created in Local" — a site that predates indexing,
   * or has never been indexed at all, has no row and so no value here. Never fabricate a value:
   * an unknown creation time must read as "can't compute drift", not "no drift".
   */
  createdAt?: number;
}

/**
 * The single source of truth for "every site an agent could be scoped to" — WP Engine installs
 * plus local sites, normalized into one shape. Was previously duplicated near-identically in
 * AgentRunModal.loadSites() and AgentWorkspaceSettings.loadScopeSites(); both now call this
 * instead. Deliberately client-side (two existing IPC round-trips, merged here) rather than a
 * new server-side sites.search endpoint — see docs/design/agent-site-picker/README.md's Scale &
 * performance section for what a real server-side implementation would need once fleet size
 * makes the client-side approach impractical.
 */
export async function fetchScopeSites(electron: any): Promise<ScopeSite[]> {
  const ipc = electron?.ipcRenderer;
  if (!ipc) return [];

  const sites: ScopeSite[] = [];

  try {
    const wpeResult = await ipc.invoke(IPC_CHANNELS.WPE_GET_SYNCED_SITES).catch(() => null);
    for (const s of (wpeResult?.sites ?? [])) {
      if (!s?.name) continue;
      // `nexus host remove` and install deletion soft-delete (is_active=0); a dead install
      // offered for scoping or GA4 binding is a target nothing can run against. Absence of the
      // field is an older payload shape, not deletion.
      if (s.is_active === false) continue;
      sites.push({
        id: s.id || s.name,
        name: s.name,
        environment: (s.environment || 'production') as ScopeSiteEnv,
        platform: 'WP Engine',
        createdAt: typeof s.created_at === 'number' ? s.created_at : undefined,
      });
    }
  } catch { /* WPE not connected — local sites alone are a valid fleet */ }

  try {
    const localSites: any[] = await ipc.invoke(IPC_CHANNELS.GET_SITES).catch(() => []);
    for (const s of (localSites ?? [])) {
      // sentinel-* are security-sentinel's own forensic sandboxes — never a valid scan target.
      if (!s?.name || s.name.startsWith('sentinel-')) continue;
      sites.push({
        id: s.id || s.name,
        name: s.name,
        environment: 'local',
        platform: 'Local',
        createdAt: typeof s.createdAt === 'number' ? s.createdAt : undefined,
      });
    }
  } catch { /* ignore */ }

  sites.sort((a, b) => a.name.localeCompare(b.name));
  return sites;
}

/**
 * log-processor's site scope is a subset of "the fleet" that isn't meaningful the way it is for
 * security-sentinel: an install is processable only if it has apache-style objects in the
 * account's connected S3 bucket, which the nightly cron re-checks before doing anything (see
 * agents/log-processor/agent.ts's run()). So Run Now offers only installs with logs, not the full
 * fleet fetchScopeSites() returns — an ineligible target would produce a run that reads nothing.
 *
 * `id` here is the install NAME, not fetchScopeSites()'s usual graph.db id — the whole model
 * joins on the install name embedded in each log filename, so using the name as `id` lets
 * `scope.siteIds` round-trip through this agent's runtime with zero extra resolution step. This
 * is a deliberate, agent-local exception to the id convention; the generic SitePicker only
 * requires `id` to be a stable unique string, not a particular id scheme.
 *
 * Cross-references fetchScopeSites() purely for display (environment/platform/createdAt). An
 * install in the bucket with no fleet match is deliberately NOT dropped here — it is still a fact
 * about what the bucket holds — but the Sites tab surfaces that case as a grey informational line
 * rather than a row, because it cannot be switched on.
 */
export async function fetchConnectedLogSites(electron: any): Promise<ScopeSite[]> {
  const ipc = electron?.ipcRenderer;
  if (!ipc) return [];

  const connectedNames: string[] = await ipc.invoke(IPC_CHANNELS.AGENT_LOG_PROCESSOR_CONNECTED_SITES).catch(() => []);
  if (!connectedNames?.length) return [];

  const fleet = await fetchScopeSites(electron);
  const byName = new Map(fleet.map(s => [s.name, s]));

  return connectedNames
    .filter((name): name is string => typeof name === 'string' && name.length > 0)
    .map(name => {
      const match = byName.get(name);
      return {
        id: name,
        name,
        environment: match?.environment ?? 'production',
        platform: match?.platform ?? 'WP Engine',
        createdAt: match?.createdAt,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Single dispatch point Settings and Run Now both call — "which sites can this agent be scoped
 * to" is not the same question for every agent (see fetchConnectedLogSites' doc), and this is
 * where that per-agent difference lives instead of being duplicated at each call site.
 */
export async function fetchSitesForAgent(agentId: string, electron: any): Promise<ScopeSite[]> {
  if (agentId === 'log-processor') return fetchConnectedLogSites(electron);
  return fetchScopeSites(electron);
}
