import type { NexusSettings, WpeOperationPermissions, RemoteOperationPermissions, RemoteSiteException } from '../../../common/types';
import { STORAGE_KEYS } from '../../../common/constants';

type Operation = 'pull' | 'wpcli_read' | 'wpcli' | 'push' | 'delete';
type EnvKey = 'development' | 'staging' | 'production';

/**
 * Whether the remote permission gate applies to a site with this host.
 *
 * Local sites are exempt by design. The gate exists to bound blast radius on
 * machines the user does not control; a Local site has Local's own UI
 * confirmations. This is the guarantee that makes "block writes on WPE
 * development installs" safe to configure: it cannot leak into local work.
 *
 * Unknown hosts are gated — fail closed.
 */
export function isGatedHost(host: string | undefined): boolean {
  return host !== 'local';
}

export const DEFAULT_OPERATION_PERMISSIONS: Record<Operation, Record<EnvKey, boolean>> = {
  pull:       { development: true,  staging: true,  production: true  },
  wpcli_read: { development: true,  staging: true,  production: true  }, // read-only SSH: plugin list, core version, user list, etc.
  wpcli:      { development: true,  staging: true,  production: false }, // write SSH: plugin install/update/activate, core update, etc.
  push:       { development: true,  staging: true,  production: false }, // also covers purge-cache, update-install
  delete:     { development: false, staging: false,  production: false }, // true destructive: delete-install/site, promote-environment
};

/**
 * Check if an operation is permitted on a given remote target environment.
 *
 * Resolution order:
 *   1. Site exception for (targetRef, environment) — if present, wins
 *   2. remoteOperationPermissions[operation][environment] — if set
 *   3. DEFAULT_OPERATION_PERMISSIONS[operation][environment]
 *
 * Undefined or unrecognised environments are treated as 'production' (safe default).
 *
 * SCOPING: only call this for sites where isGatedHost(host) is true. Local
 * sites are exempt by design — see isGatedHost. Routing a local site through
 * this function would let a user's WPE lockdown block their own local work,
 * which is the exact failure this split prevents.
 *
 * @param operation   The operation type to check
 * @param environment The install environment string (e.g. 'production')
 * @param settings    Current NexusSettings
 * @param targetRef   Target reference ('wpe:<installName>', 'ssh:<alias>' or
 *                    'ssh:<alias>/<site>'); bare install names auto-prefixed with 'wpe:'.
 *                    An `ssh:<alias>/<site>` ref also matches an exception keyed at the
 *                    bare connection level, so a connection-wide rule covers every site
 *                    under it and a per-site rule overrides it.
 */
/**
 * fixes-082526 phase 4 · install → WPE account id, injected from index.ts
 * (the gate stays dependency-free: the intelligence seam's law translation
 * imports this module, so it must never pull storage or electron itself).
 * Unregistered + exclusions configured = writes fail closed: an account the
 * platform cannot establish is not one it can prove included.
 */
let installAccountResolver: ((installName: string) => string | undefined) | undefined;

export function setInstallAccountResolver(
  fn: ((installName: string) => string | undefined) | undefined
): void {
  installAccountResolver = fn;
}

/** The resolver index.ts registers: the WPE install cache's accountId column. */
export function installAccountFromCache(storage: {
  get(key: string): unknown;
}): (installName: string) => string | undefined {
  return (installName) => {
    try {
      const cache = storage.get(STORAGE_KEYS.WPE_INSTALL_CACHE) as {
        installs?: Array<{ installName?: string; install_name?: string; accountId?: string }>;
      } | null;
      const hit = (cache?.installs ?? []).find(
        (i) => (i.installName ?? i.install_name) === installName
      );
      // A pre-phase-4 cache row carries no accountId: undefined, never a guess
      // — the caller fails closed while exclusions exist, and a re-sync fills it.
      return typeof hit?.accountId === 'string' && hit.accountId ? hit.accountId : undefined;
    } catch {
      return undefined;
    }
  };
}

/** The operations the account bound covers. `pull` is a write for scope purposes — the sheet's own first example is "Copy a site down". */
const ACCOUNT_BOUND_WRITES = new Set<Operation>(['pull', 'wpcli', 'push', 'delete']);

export function isOperationAllowed(
  operation: 'pull' | 'wpcli_read' | 'wpcli' | 'push' | 'delete',
  environment: string | undefined,
  settings: Pick<NexusSettings,
    'remoteOperationPermissions' | 'remoteSiteExceptions' |
    'wpeOperationPermissions' | 'wpeSiteExceptions' | 'wpeWriteExcludedAccounts'>,
  targetRef?: string,
): boolean {
  const env = normaliseEnv(environment);

  // Phase 4 · THE ACCOUNT WRITE BOUND, before everything — an excluded
  // account is excluded WHOLE (§6), so no per-site allow exception below may
  // punch through it. Applies to WPE-shaped targets alone: ssh/local refs
  // are governed by their own machinery, and a write with no target ref is
  // outside the dimension's reach (documented in the packet spec).
  const excludedAccounts = settings.wpeWriteExcludedAccounts ?? [];
  if (excludedAccounts.length > 0 && ACCOUNT_BOUND_WRITES.has(operation) && targetRef) {
    const ref = targetRef.includes(':') ? targetRef : `wpe:${targetRef}`;
    if (ref.startsWith('wpe:')) {
      const account = installAccountResolver?.(ref.slice(4));
      // Unknown account (no resolver yet, stale cache, unknown install) fails
      // CLOSED while exclusions exist: unprovable-included is not included.
      if (account === undefined || excludedAccounts.includes(account)) return false;
    }
  }
  const exceptions = settings.remoteSiteExceptions?.length
    ? settings.remoteSiteExceptions
    : (settings.wpeSiteExceptions as any as RemoteSiteException[] | undefined);
  const perms = settings.remoteOperationPermissions
    && Object.keys(settings.remoteOperationPermissions).length
    ? settings.remoteOperationPermissions
    : settings.wpeOperationPermissions;

  // 1. Site exception wins if targetRef provided and exception exists
  if (targetRef && exceptions?.length) {
    // Auto-prefix bare install names with 'wpe:' for backward compatibility
    const normalizedRef = targetRef.includes(':') ? targetRef : `wpe:${targetRef}`;
    const match = (ref: string) => exceptions.find(
      (e: any) => (e.targetRef ?? `wpe:${e.installName}`) === ref && e.environment === env,
    );
    // Specific wins, connection-level is the fallback. An external target is
    // now `ssh:<alias>/<site>`, but the Settings UI writes (and every exception
    // created before the connection/site split carries) a bare `ssh:<alias>`.
    // Matching is exact string equality, so without this a user's existing
    // exception silently stops applying — and a *denying* one fails OPEN.
    const refs = [normalizedRef];
    if (normalizedRef.startsWith('ssh:') && normalizedRef.includes('/')) {
      refs.push(normalizedRef.slice(0, normalizedRef.indexOf('/')));
    }
    // The first candidate that actually rules on THIS operation wins — not
    // merely the first that exists. A per-site exception covering only `pull`
    // must not shadow a connection-level `wpcli` denial into fall-through.
    const exc = refs.map(match).find((e) => e && operation in e.overrides);
    if (exc && operation in exc.overrides) {
      const override = (exc.overrides as any)[operation];
      return override !== undefined ? override : DEFAULT_OPERATION_PERMISSIONS[operation][env];
    }
  }

  // 2. Per-operation setting
  const perOp = perms?.[operation];
  if (perOp && env in perOp) {
    const val = (perOp as any)[env];
    return val !== undefined ? val : DEFAULT_OPERATION_PERMISSIONS[operation][env];
  }

  // 3. Defaults
  return DEFAULT_OPERATION_PERMISSIONS[operation][env];
}

/** Normalise environment string to one of the three known values. Unknown → 'production'. */
function normaliseEnv(env: string | undefined): EnvKey {
  if (env === 'development' || env === 'staging') return env;
  return 'production'; // safe default — production is most restrictive
}

/** How locked down each environment is. Mirrors DEFAULT_OPERATION_PERMISSIONS. */
const ENV_RESTRICTIVENESS: Record<EnvKey, number> = {
  development: 0,
  staging: 1,
  production: 2,
};

/**
 * The most restrictive of several environment labels, ordered
 * development < staging < production.
 *
 * WHY THIS EXISTS: an external SSH host has *two* environment labels, and they
 * come from different places. One is registered by `nexus host add --env`; the
 * other is the suffix on the target string the caller composes freshly on every
 * command (`ssh:<alias>@development`). Gating on the target alone means a host
 * deliberately registered as `production` becomes writable the moment someone
 * types a different suffix — `wpcli` is refused on production and allowed on
 * development by default, so the label *is* the write gate. Taking the more
 * restrictive of the two makes the registered label a floor a suffix cannot
 * lower, while still letting a caller voluntarily address a development host
 * as production.
 *
 * `undefined` entries are IGNORED rather than normalised, and that distinction
 * matters: an unregistered alias contributes no opinion, so its target
 * environment governs exactly as it did before. A *present* but unrecognised
 * value still normalises to 'production' (fail closed), as does the
 * all-undefined case.
 */
export function mostRestrictiveEnvironment(...envs: Array<string | undefined>): EnvKey {
  const stated = envs.filter((e): e is string => e !== undefined);
  if (stated.length === 0) return 'production';
  return stated
    .map(normaliseEnv)
    .reduce((a, b) => (ENV_RESTRICTIVENESS[b] > ENV_RESTRICTIVENESS[a] ? b : a));
}

/**
 * Convert legacy wpeAllowedEnvironments to WpeOperationPermissions.
 * Returns undefined if no migration needed (no legacy setting, or already migrated).
 */
export function migrateFromLegacyEnvFilter(
  settings: Pick<NexusSettings, 'wpeAllowedEnvironments' | 'wpeOperationPermissions'>,
): WpeOperationPermissions | undefined {
  if (!settings.wpeAllowedEnvironments) return undefined;
  if (settings.wpeOperationPermissions) return undefined;

  const allowedEnvs = settings.wpeAllowedEnvironments;
  const productionAllowed = allowedEnvs.includes('production');
  const stagingAllowed = allowedEnvs.includes('staging');
  const devAllowed = allowedEnvs.includes('development');

  return {
    pull:       { development: true,        staging: true,           production: true },
    wpcli_read: { development: true,        staging: true,           production: true }, // read ops always allowed
    wpcli:      { development: devAllowed,  staging: stagingAllowed, production: productionAllowed },
    push:       { development: devAllowed,  staging: stagingAllowed, production: productionAllowed },
    delete:     { development: false,       staging: false,          production: false },
  };
}

/**
 * Migrates WPE-named permission settings to remote-scoped ones.
 *
 * Modelled on migrateFromLegacyEnvFilter: returns undefined for a key when
 * there is nothing to migrate, and never overwrites already-migrated settings.
 * Exceptions gain a target ref so they can address an ssh: host as well as a
 * WPE install.
 */
export function migrateWpePermissionSettings(
  settings: Pick<NexusSettings,
    'wpeOperationPermissions' | 'wpeSiteExceptions' |
    'remoteOperationPermissions' | 'remoteSiteExceptions'>,
): { remoteOperationPermissions?: RemoteOperationPermissions; remoteSiteExceptions?: RemoteSiteException[] } {
  const out: {
    remoteOperationPermissions?: RemoteOperationPermissions;
    remoteSiteExceptions?: RemoteSiteException[];
  } = {};

  if (!settings.remoteOperationPermissions && settings.wpeOperationPermissions) {
    out.remoteOperationPermissions = settings.wpeOperationPermissions;
  }

  if (!settings.remoteSiteExceptions && settings.wpeSiteExceptions?.length) {
    out.remoteSiteExceptions = settings.wpeSiteExceptions.map((e: any) => ({
      targetRef: e.targetRef ?? `wpe:${e.installName}`,
      environment: e.environment,
      overrides: e.overrides,
    }));
  }

  return out;
}

/**
 * Get settings with all legacy permission formats migrated to remote-scoped ones.
 * Use this instead of reading registryStorage directly at enforcement points.
 */
export function getEffectiveSettings(
  registryStorage: { get(key: string): unknown } | null | undefined,
): Pick<NexusSettings,
  'wpeOperationPermissions' | 'wpeSiteExceptions' |
  'remoteOperationPermissions' | 'remoteSiteExceptions'> {
  const raw = (registryStorage?.get(STORAGE_KEYS.SETTINGS) ?? {}) as NexusSettings;

  // Legacy env-filter migration runs first: it produces the WPE-shaped
  // permissions that the remote-scoped migration below then carries forward.
  const legacyMigrated = migrateFromLegacyEnvFilter(raw);
  const withLegacy = legacyMigrated
    ? { ...raw, wpeOperationPermissions: legacyMigrated }
    : raw;

  const remote = migrateWpePermissionSettings(withLegacy);
  return { ...withLegacy, ...remote };
}
