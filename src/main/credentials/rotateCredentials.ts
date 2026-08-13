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

export async function rotateCredentials(
  services: NexusServices,
  provider: string,
  key?: string,
): Promise<RotateReport> {
  const storage = (services as any).registryStorage;
  const localServices = (services as any).localServices;
  const siteData = (services as any).siteData;
  const logger = (services as any).logger ?? { info() {}, warn() {}, error() {}, debug() {} };

  try {
    // 1. Set the new key if provided — bumps the credential version.
    if (key) {
      new KeyVault(storage, STORAGE_KEYS.API_KEYS).setKey(provider, key);
    }

    // 2. Re-sync running, non-gateway sites configured for this provider.
    const sites = (siteData?.getSites?.() ?? {}) as Record<string, { name?: string }>;
    const statuses = (localServices?.getAllSiteStatuses?.() ?? {}) as Record<string, string>;
    const configs = (storage.get(STORAGE_KEYS.SITE_AI_CONFIG) ?? {}) as Record<string, any>;

    for (const [siteId, cfg] of Object.entries(configs)) {
      if (!cfg || cfg.provider !== provider || cfg.useLocalGateway) continue;
      if (statuses[siteId] !== 'running') continue;
      const name = sites[siteId]?.name ?? siteId;
      await autoSyncCredentials(siteId, name, localServices, storage, logger);
    }

    // 3. Honest report from the post-sync state.
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
