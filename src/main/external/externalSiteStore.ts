import { STORAGE_KEYS } from '../../common/constants';

/** Minimal surface of Local's RegistryStorage that this module needs. */
interface Storage {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
}

export interface ExternalConnectionProfile {
  /** ~/.ssh/config Host alias. The credential path — no key material is stored. */
  alias: string;
  /**
   * Absolute path to WP-CLI, stored only when it is NOT on the remote's
   * non-interactive PATH. Shared by every site under this connection unless a
   * site overrides it. Undefined means plain `wp` works.
   */
  wpCliPath?: string;
  firstSeenAt: number;
  lastSeenAt: number;
}

/** Stable connection id. A site's own id (see externalSiteId) embeds this plus the site slug. */
export function externalSiteId(alias: string, site: string): string {
  return `ssh:${alias}/${site}`;
}

function readAll(storage: Storage): Record<string, ExternalConnectionProfile> {
  return (storage.get(STORAGE_KEYS.EXTERNAL_SITE_PROFILES) as Record<string, ExternalConnectionProfile>) ?? {};
}

export function getExternalProfile(storage: Storage, alias: string): ExternalConnectionProfile | null {
  return readAll(storage)[alias] ?? null;
}

export function listExternalProfiles(storage: Storage): ExternalConnectionProfile[] {
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
 * `wpCliPath` is only replaced when the incoming profile supplies it: a
 * sighting that never probed for the binary must not erase what registration
 * discovered.
 *
 * `environment` used to live here and be described as this type's write gate.
 * It no longer does — a connection can have multiple sites, each with its own
 * environment, so that field (and the sighting-vs-registration protection it
 * needed) moves to the site level in a later task. This function now merges
 * only connection-scoped fields.
 *
 * The merged profile is returned so a caller can write a matching `sites` row
 * without re-deriving values the merge may have overridden.
 */
export function upsertExternalProfile(
  storage: Storage,
  profile: ExternalConnectionProfile,
  source: ProfileWriteSource = 'sighting',
): ExternalConnectionProfile {
  const all = readAll(storage);
  const existing = all[profile.alias];
  const merged: ExternalConnectionProfile = {
    ...profile,
    firstSeenAt: existing?.firstSeenAt ?? profile.firstSeenAt,
    wpCliPath: profile.wpCliPath ?? existing?.wpCliPath,
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
