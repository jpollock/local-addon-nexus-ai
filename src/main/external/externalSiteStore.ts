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
 * Why a profile is being written.
 *
 * - `'registration'` — `nexus host add`. The user named this host's
 *   environment on purpose (or accepted the default for a host that has none),
 *   so the incoming label wins. This is the only way to relabel a host.
 * - `'sighting'` — the lazy upsert in `ToolRegistry.call()`. It knows only the
 *   suffix on the target string of whatever command happened to run, and
 *   `nexus wp core version ssh:prod-box@development` is a *permitted read* on
 *   every environment. Letting that write the label would permanently relabel
 *   a production host as development, in the profile and in the fleet UI, as a
 *   side effect of a successful read.
 *
 * The default is `'sighting'` deliberately: a call site that forgets to say
 * gets the conservative behaviour rather than the destructive one.
 */
export type ProfileWriteSource = 'registration' | 'sighting';

/**
 * Merge a profile in and return the stored result.
 *
 * `firstSeenAt` is preserved from any existing record — it answers "when did
 * this host enter the fleet", which a later sighting must not overwrite.
 * `wpPath` and `wpCliPath` are only replaced when the incoming profile supplies
 * them: a command run without --path, or a sighting that never probed for the
 * binary, must not erase what registration discovered.
 * `environment` is protected by the same reasoning and needed it most — see
 * ProfileWriteSource. It is the write gate (`resolveTransport` gates on the
 * more restrictive of it and the target's), so a sighting that could lower it
 * would be a permission downgrade, not just a wrong label.
 *
 * The merged profile is returned so a caller can write a matching `sites` row
 * without re-deriving values the merge may have overridden.
 */
export function upsertExternalProfile(
  storage: Storage,
  profile: ExternalSiteProfile,
  source: ProfileWriteSource = 'sighting',
): ExternalSiteProfile {
  const all = readAll(storage);
  const existing = all[profile.alias];
  const merged: ExternalSiteProfile = {
    ...profile,
    firstSeenAt: existing?.firstSeenAt ?? profile.firstSeenAt,
    wpPath: profile.wpPath ?? existing?.wpPath,
    wpCliPath: profile.wpCliPath ?? existing?.wpCliPath,
    environment: source === 'registration'
      ? profile.environment
      : (existing?.environment ?? profile.environment),
  };
  all[profile.alias] = merged;
  storage.set(STORAGE_KEYS.EXTERNAL_SITE_PROFILES, all);
  return merged;
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
