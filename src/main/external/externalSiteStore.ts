import { STORAGE_KEYS } from '../../common/constants';

/** Minimal surface of Local's RegistryStorage that this module needs. */
interface Storage {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
}

export interface ExternalSiteProfile {
  /** ~/.ssh/config Host alias. The credential path — no key material is stored. */
  alias: string;
  /** WordPress root, passed as --path. Absent means WP-CLI searches from the login dir. */
  wpPath?: string;
  environment: 'production' | 'staging' | 'development';
  firstSeenAt: number;
  lastSeenAt: number;
}

/** Stable site id for an external host. Distinct from any Local site id or WPE install name. */
export function externalSiteId(alias: string): string {
  return `ssh:${alias}`;
}

function readAll(storage: Storage): Record<string, ExternalSiteProfile> {
  return (storage.get(STORAGE_KEYS.EXTERNAL_SITE_PROFILES) as Record<string, ExternalSiteProfile>) ?? {};
}

export function getExternalProfile(storage: Storage, alias: string): ExternalSiteProfile | null {
  return readAll(storage)[alias] ?? null;
}

export function listExternalProfiles(storage: Storage): ExternalSiteProfile[] {
  return Object.values(readAll(storage));
}

/**
 * Merge a profile in.
 *
 * `firstSeenAt` is preserved from any existing record — it answers "when did
 * this host enter the fleet", which a later sighting must not overwrite.
 * `wpPath` is only replaced when the incoming profile supplies one: a command
 * run without --path must not erase a path already discovered.
 */
export function upsertExternalProfile(storage: Storage, profile: ExternalSiteProfile): void {
  const all = readAll(storage);
  const existing = all[profile.alias];
  all[profile.alias] = {
    ...profile,
    firstSeenAt: existing?.firstSeenAt ?? profile.firstSeenAt,
    wpPath: profile.wpPath ?? existing?.wpPath,
  };
  storage.set(STORAGE_KEYS.EXTERNAL_SITE_PROFILES, all);
}
