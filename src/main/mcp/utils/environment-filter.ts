import type { NexusSettings } from '../../../common/types';

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
