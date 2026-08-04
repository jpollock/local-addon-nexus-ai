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
  /**
   * Absolute path to WP-CLI, stored only when it is NOT on the remote's
   * non-interactive PATH. Undefined means plain `wp` works. Discovered by the
   * registration probe; without persisting it, every later command repeats the
   * same "wp: command not found" the probe already diagnosed.
   */
  wpCliPath?: string;
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
 * `wpPath` and `wpCliPath` are only replaced when the incoming profile supplies
 * them: a command run without --path, or a sighting that never probed for the
 * binary, must not erase what registration discovered.
 */
export function upsertExternalProfile(storage: Storage, profile: ExternalSiteProfile): void {
  const all = readAll(storage);
  const existing = all[profile.alias];
  all[profile.alias] = {
    ...profile,
    firstSeenAt: existing?.firstSeenAt ?? profile.firstSeenAt,
    wpPath: profile.wpPath ?? existing?.wpPath,
    wpCliPath: profile.wpCliPath ?? existing?.wpCliPath,
  };
  storage.set(STORAGE_KEYS.EXTERNAL_SITE_PROFILES, all);
}

/**
 * Forget a host. Returns false when the alias was not registered, and writes
 * nothing in that case — a no-op must not rewrite the whole record.
 */
export function removeExternalProfile(storage: Storage, alias: string): boolean {
  const all = readAll(storage);
  if (!(alias in all)) return false;
  delete all[alias];
  storage.set(STORAGE_KEYS.EXTERNAL_SITE_PROFILES, all);
  return true;
}
