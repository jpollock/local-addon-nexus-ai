import type { NexusSettings } from '../../../common/types';
import { STORAGE_KEYS } from '../../../common/constants';

export const DEFAULT_WPE_ALLOWED_ENVIRONMENTS: ReadonlyArray<'staging' | 'development'> = [
  'staging',
  'development',
];

/**
 * Returns true if the WPE install environment is permitted by the user's settings.
 *
 * Default (no setting): staging + development only. Production is opt-in.
 * Treats undefined/unknown environments as 'production' (safe default).
 */
export function isWpeEnvironmentAllowed(
  environment: string | undefined,
  settings: Pick<NexusSettings, 'wpeAllowedEnvironments'>,
): boolean {
  const allowed: readonly string[] =
    settings.wpeAllowedEnvironments ?? DEFAULT_WPE_ALLOWED_ENVIRONMENTS;
  const env = (environment ?? 'production').toLowerCase();
  return allowed.map((e) => e.toLowerCase()).includes(env);
}

/**
 * Check if an SSH/WP-CLI operation on a WPE install is allowed by the environment filter.
 * Returns null if allowed, or an error message string if blocked.
 *
 * Call this in any code that calls remoteWpCliRun without going through resolveTarget.
 */
export function checkWpeInstallEnvironmentAccess(
  installName: string,
  registryStorage: { get(key: string): unknown } | null | undefined,
): string | null {
  const settings = (registryStorage?.get(STORAGE_KEYS.SETTINGS) ?? {}) as { wpeAllowedEnvironments?: ('production' | 'staging' | 'development')[] };
  const cache = registryStorage?.get(STORAGE_KEYS.WPE_INSTALL_CACHE) as
    { installs?: Array<{ installName?: string; install_name?: string; environment?: string }> } | null;
  const cached = cache?.installs?.find(
    (i: any) => (i.installName ?? i.install_name) === installName,
  );
  const environment = cached?.environment ?? 'production';

  if (!isWpeEnvironmentAllowed(environment, settings)) {
    return (
      `Remote WP-CLI is not allowed on "${environment}" environments. ` +
      `Enable production access in Nexus Preferences → WP Engine Environment Access, ` +
      `or target a staging/development install instead.`
    );
  }
  return null;
}

/**
 * Check if an operation on a WPE install with a KNOWN environment string is allowed.
 * Use this when you already have the environment from a CAPI response or install data.
 * Returns null if allowed, or an error message string if blocked.
 */
export function checkKnownEnvironmentAccess(
  environment: string | undefined,
  registryStorage: { get(key: string): unknown } | null | undefined,
): string | null {
  const settings = (registryStorage?.get(STORAGE_KEYS.SETTINGS) ?? {}) as { wpeAllowedEnvironments?: ('production' | 'staging' | 'development')[] };
  if (!isWpeEnvironmentAllowed(environment, settings)) {
    const env = environment ?? 'production';
    return (
      `Operation blocked: "${env}" environments are not enabled in Nexus. ` +
      `Enable production access in Nexus Preferences → WP Engine Environment Access, ` +
      `or target a staging/development install instead.`
    );
  }
  return null;
}
