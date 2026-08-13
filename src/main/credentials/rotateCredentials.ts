/**
 * Credential rotation orchestration (P1-7).
 *
 * Lazy-by-default (see docs/planning/2026-08-12-creds-rotate-design.md):
 *   1. If a new key value is supplied, set it in the vault (which bumps the credential version).
 *   2. Re-sync the RUNNING local sites configured for this provider — they hold the old key and
 *      are reachable now. Stopped sites self-heal on their next start (siteStarted →
 *      autoSyncCredentials reads the current key), so they are reported as stale, not failed.
 *   3. Gateway sites need no per-site sync — the gateway reads the vault live.
 *
 * Returns an honest report (synced now / stale / gateway), never an all-or-nothing exit.
 */
import type { NexusServices } from '../mcp/types';
import { STORAGE_KEYS } from '../../common/constants';
import { KeyVault } from '../security/KeyVault';
import { autoSyncCredentials } from '../mcp/modules/wp-connector/auto-sync';
import { computeRotationStatus } from './rotationStatus';

export interface RotateReport {
  success: boolean;
  error?: string;
  targetVersion: number;
  /** Site names synced to the current version now. */
  synced: string[];
  /** Site names still behind — stopped sites that will sync on next start. */
  stale: string[];
  /** Gateway site names — auto-rotated (no per-site key). */
  gateway: string[];
}

export interface RotateOptions {
  /** New key value to set first (bumps the version). Omit to re-propagate the current key. */
  key?: string;
  /** Also start stopped stale sites, sync them, then restore their stopped state. Side-effectful. */
  force?: boolean;
}

// Bounded retry after starting a site, to ride out the MySQL-startup race (siteStarted fires
// before the DB is ready). autoSyncCredentials skips gracefully when the DB isn't up, so we
// re-attempt until the site's version advances or we give up.
const FORCE_MAX_ATTEMPTS = 8;
const FORCE_RETRY_MS = 2000;

export async function rotateCredentials(
  services: NexusServices,
  provider: string,
  opts: RotateOptions = {},
): Promise<RotateReport> {
  const storage = (services as any).registryStorage;
  const localServices = (services as any).localServices;
  const siteData = (services as any).siteData;
  const logger = (services as any).logger ?? { info() {}, warn() {}, error() {}, debug() {} };

  try {
    // 1. Set the new key if provided — bumps the credential version.
    if (opts.key) {
      new KeyVault(storage, STORAGE_KEYS.API_KEYS).setKey(provider, opts.key);
    }

    const sites = (siteData?.getSites?.() ?? {}) as Record<string, { name?: string }>;
    const statuses = (localServices?.getAllSiteStatuses?.() ?? {}) as Record<string, string>;
    const configs = (storage.get(STORAGE_KEYS.SITE_AI_CONFIG) ?? {}) as Record<string, any>;

    // 2. Re-sync running, non-gateway sites configured for this provider.
    for (const [siteId, cfg] of Object.entries(configs)) {
      if (!cfg || cfg.provider !== provider || cfg.useLocalGateway) continue;
      if (statuses[siteId] !== 'running') continue;
      await autoSyncCredentials(siteId, sites[siteId]?.name ?? siteId, localServices, storage, logger);
    }

    // 3. Force: start the still-stale STOPPED sites, sync them, restore their stopped state.
    if (opts.force) {
      const stopped = computeRotationStatus(storage, provider).stale.filter((id) => statuses[id] !== 'running');
      if (stopped.length > 0) {
        await localServices?.startSites?.(stopped);
        for (const id of stopped) {
          for (let attempt = 0; attempt < FORCE_MAX_ATTEMPTS; attempt++) {
            await autoSyncCredentials(id, sites[id]?.name ?? id, localServices, storage, logger);
            if (computeRotationStatus(storage, provider).current.includes(id)) break;
            if (attempt < FORCE_MAX_ATTEMPTS - 1) await new Promise((r) => setTimeout(r, FORCE_RETRY_MS));
          }
        }
        // Restore: these sites were stopped before we touched them.
        await localServices?.stopSites?.(stopped);
      }
    }

    // 4. Honest report from the final state.
    const status = computeRotationStatus(storage, provider);
    const nameFor = (id: string) => sites[id]?.name ?? id;
    return {
      success: true,
      targetVersion: status.targetVersion,
      synced: status.current.map(nameFor),
      stale: status.stale.map(nameFor),
      gateway: status.gateway.map(nameFor),
    };
  } catch (err: any) {
    return { success: false, error: err?.message ?? String(err), targetVersion: 0, synced: [], stale: [], gateway: [] };
  }
}
