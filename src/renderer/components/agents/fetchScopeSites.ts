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
   * Unix ms. Present for WP Engine sites (comes straight through from the synced graph.db row).
   * Not currently available for local sites — GET_SITES has no creation-time field — so drift
   * detection only ever fires for WPE sites until that gap is closed. Never fabricate a value
   * here: an unknown creation time must read as "can't compute drift", not "no drift".
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
        // No creation-time field available from GET_SITES today — left undefined on purpose.
      });
    }
  } catch { /* ignore */ }

  sites.sort((a, b) => a.name.localeCompare(b.name));
  return sites;
}
