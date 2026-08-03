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
 * @param targetRef   Target reference ('wpe:<installName>' or 'ssh:<alias>'); bare install names auto-prefixed with 'wpe:'
 */
export function isOperationAllowed(
  operation: 'pull' | 'wpcli_read' | 'wpcli' | 'push' | 'delete',
  environment: string | undefined,
  settings: Pick<NexusSettings,
    'remoteOperationPermissions' | 'remoteSiteExceptions' |
    'wpeOperationPermissions' | 'wpeSiteExceptions'>,
  targetRef?: string,
): boolean {
  const env = normaliseEnv(environment);
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
    const exc = exceptions.find(
      (e: any) => (e.targetRef ?? `wpe:${e.installName}`) === normalizedRef && e.environment === env,
    );
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
