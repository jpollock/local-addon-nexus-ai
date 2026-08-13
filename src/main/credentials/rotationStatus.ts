/**
 * Credential rotation status (P1-7).
 *
 * Pure over storage: classifies each LOCAL site configured for a provider by whether it still
 * holds an older key. Only local sites hold the provider key in their `wp_options` (the sync path
 * is local-first); gateway sites read the vault live and so are never stale. See
 * docs/planning/2026-08-12-creds-rotate-design.md.
 */
import type { RegistryStorage } from '../content/IndexRegistry';
import { STORAGE_KEYS } from '../../common/constants';
import { credentialVersion } from '../security/KeyVault';

export interface RotationStatus {
  /** The credential version sites should be synced to. */
  targetVersion: number;
  /** Non-gateway sites behind the target — they still hold an older key. */
  stale: string[];
  /** Non-gateway sites synced to the target. */
  current: string[];
  /** Gateway sites — no per-site key; auto-rotated when the vault key changes. */
  gateway: string[];
}

export function computeRotationStatus(storage: RegistryStorage, providerId: string): RotationStatus {
  const targetVersion = credentialVersion(storage, providerId);
  const configs = (storage.get(STORAGE_KEYS.SITE_AI_CONFIG) ?? {}) as Record<string, any>;

  const stale: string[] = [];
  const current: string[] = [];
  const gateway: string[] = [];

  for (const [siteId, cfg] of Object.entries(configs)) {
    if (!cfg || cfg.provider !== providerId) continue;
    if (cfg.useLocalGateway) { gateway.push(siteId); continue; }
    const synced = typeof cfg.syncedCredVersion === 'number' ? cfg.syncedCredVersion : 0;
    if (synced < targetVersion) stale.push(siteId);
    else current.push(siteId);
  }

  return { targetVersion, stale, current, gateway };
}
