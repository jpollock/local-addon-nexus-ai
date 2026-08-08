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
  /**
   * True when this connection's remote user is root and the user has chosen
   * to pass --allow-root on every WP-CLI command rather than switch to a
   * non-root alias. Detected by probeHostMultiIssue's 'rootUser' issue;
   * this field is the Nexus-side decision recorded in response to it.
   */
  allowRoot?: boolean;
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
 * Merge a profile in and return the stored result.
 *
 * `firstSeenAt` is preserved from any existing record — it answers "when did
 * this host enter the fleet", which a later sighting must not overwrite.
 * `wpCliPath` is only replaced when the incoming profile supplies it: a
 * sighting that never probed for the binary must not erase what registration
 * discovered. `allowRoot` is preserved the same way: a sighting that never
 * re-probed root status must not erase what was previously recorded.
 *
 * This function is connection-scoped only — it has no `source` /
 * registration-vs-sighting parameter. `environment` used to live on this
 * profile and be gated by such a parameter, but a connection can have
 * multiple sites, each with its own environment, so that field — and the
 * registration-vs-sighting protection it needs — moved to the site level:
 * `nexusHostAdd` (registration) computes `environment ?? existingSite?.
 * environment ?? 'production'` before calling `graphService.upsertSite`, and
 * `maybeUpsertExternalSite` (the lazy sighting in `ToolRegistry.call()`)
 * always passes the existing row's `environment` back unchanged. A `source`
 * parameter used to exist here to express the same idea at the connection
 * level, but nothing in this function ever read it — it was accepted and
 * discarded at every one of its three call sites. It has been removed rather
 * than left as a doc comment describing protection this function does not
 * provide.
 *
 * The merged profile is returned so a caller can write a matching `sites` row
 * without re-deriving values the merge may have overridden.
 */
export function upsertExternalProfile(
  storage: Storage,
  profile: ExternalConnectionProfile,
): ExternalConnectionProfile {
  const all = readAll(storage);
  const existing = all[profile.alias];
  const merged: ExternalConnectionProfile = {
    ...profile,
    firstSeenAt: existing?.firstSeenAt ?? profile.firstSeenAt,
    wpCliPath: profile.wpCliPath ?? existing?.wpCliPath,
    allowRoot: profile.allowRoot ?? existing?.allowRoot,
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
