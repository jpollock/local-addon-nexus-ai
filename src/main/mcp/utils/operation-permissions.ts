import type { NexusSettings, WpeOperationPermissions } from '../../../common/types';
import { STORAGE_KEYS } from '../../../common/constants';

type Operation = 'pull' | 'wpcli_read' | 'wpcli' | 'push' | 'delete';
type EnvKey = 'development' | 'staging' | 'production';

export const DEFAULT_OPERATION_PERMISSIONS: Record<Operation, Record<EnvKey, boolean>> = {
  pull:       { development: true,  staging: true,  production: true  },
  wpcli_read: { development: true,  staging: true,  production: true  }, // read-only SSH: plugin list, core version, user list, etc.
  wpcli:      { development: true,  staging: true,  production: false }, // write SSH: plugin install/update/activate, core update, etc.
  push:       { development: true,  staging: true,  production: false }, // also covers purge-cache, update-install
  delete:     { development: false, staging: false,  production: false }, // true destructive: delete-install/site, promote-environment
};

/**
 * Check if an operation is permitted on a given WPE install environment.
 *
 * Resolution order:
 *   1. Site exception for (installName, environment) — if present, wins
 *   2. wpeOperationPermissions[operation][environment] — if set
 *   3. DEFAULT_OPERATION_PERMISSIONS[operation][environment]
 *
 * Undefined or unrecognised environments are treated as 'production' (safe default).
 *
 * @param operation   The operation type to check
 * @param environment The install environment string (e.g. 'production')
 * @param settings    Current NexusSettings
 * @param installName WPE install name; required to apply site exceptions
 */
export function isOperationAllowed(
  operation: 'pull' | 'wpcli_read' | 'wpcli' | 'push' | 'delete',
  environment: string | undefined,
  settings: Pick<NexusSettings, 'wpeOperationPermissions' | 'wpeSiteExceptions'>,
  installName?: string,
): boolean {
  const env = normaliseEnv(environment);

  // 1. Site exception wins if installName provided and exception exists
  if (installName && settings.wpeSiteExceptions?.length) {
    const exc = settings.wpeSiteExceptions.find(
      (e) => e.installName === installName && e.environment === env,
    );
    if (exc && operation in exc.overrides) {
      const override = exc.overrides[operation];
      return override !== undefined ? override : DEFAULT_OPERATION_PERMISSIONS[operation][env];
    }
  }

  // 2. Per-operation setting
  const perOp = settings.wpeOperationPermissions?.[operation];
  if (perOp && env in perOp) {
    const val = perOp[env as EnvKey];
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
 * Get settings with legacy wpeAllowedEnvironments migrated to wpeOperationPermissions.
 * Use this instead of reading registryStorage directly at enforcement points.
 */
export function getEffectiveSettings(
  registryStorage: { get(key: string): unknown } | null | undefined,
): Pick<NexusSettings, 'wpeOperationPermissions' | 'wpeSiteExceptions'> {
  const raw = (registryStorage?.get(STORAGE_KEYS.SETTINGS) ?? {}) as NexusSettings;
  const migrated = migrateFromLegacyEnvFilter(raw);
  if (migrated) {
    return { ...raw, wpeOperationPermissions: migrated };
  }
  return raw;
}
