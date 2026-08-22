import { McpToolResult, NexusServices, LocalSiteInfo } from '../../types';
import { WpCliResult, WpeInstallInfo } from '../../local-services-bridge';
import { resolveLocalSite } from '../../site-resolver';
import { error } from './preflight';
import { isOperationAllowed, getEffectiveSettings } from '../../utils/operation-permissions';
import { STORAGE_KEYS } from '../../../../common/constants';

// ---------------------------------------------------------------------------
// Command Security (moved to src/main/transport/policy.ts)
// ---------------------------------------------------------------------------
// BLOCKED_COMMANDS, ALLOWED_REMOTE_COMMANDS, and isBlockedCommand have been
// replaced by REMOTE_POLICY and checkCommand in the transport layer.

// ---------------------------------------------------------------------------
// WPE Install Cache Lookup
// ---------------------------------------------------------------------------

export interface CachedWpeInstall {
  installName?: string;
  install_name?: string;
  environment: string;
  installId?: string;
  install_id?: string;
}

/**
 * Looks up a WPE install by name in the cached install list
 * (`STORAGE_KEYS.WPE_INSTALL_CACHE`), the same cache both `resolveTarget`
 * below and `SentinelExecutor` key their environment gate off of. Shared here
 * so there is exactly one place this lookup — and its `installName` /
 * `install_name` field fallback — is written; see the "one router, one
 * policy" rule in CLAUDE.md. Callers derive `environment` themselves via
 * `cachedInstall?.environment ?? 'production'` (the safe default for an
 * install this cache doesn't know about).
 */
export function lookupCachedWpeInstall(
  installName: string,
  registryStorage: { get(key: string): unknown } | null | undefined,
): CachedWpeInstall | undefined {
  const wpeCache = registryStorage?.get(STORAGE_KEYS.WPE_INSTALL_CACHE) as {
    installs: CachedWpeInstall[];
    syncedAt: number;
  } | null;
  return wpeCache?.installs?.find(
    (i) => (i.installName ?? i.install_name) === installName,
  );
}

// ---------------------------------------------------------------------------
// Target Resolution
// ---------------------------------------------------------------------------

export interface LocalTarget {
  type: 'local';
  site: LocalSiteInfo;
}

export interface RemoteTarget {
  type: 'remote';
  installName: string;
  installInfo: WpeInstallInfo;
}

export type ResolvedTarget = LocalTarget | RemoteTarget;

/**
 * Resolves tool args to either a local site or a remote WPE install.
 *
 * - If `install_name` is provided, resolves via CAPI to get the install name.
 * - If `site` is provided, resolves as a local site.
 * - Returns an error result if neither is valid.
 *
 * `install_name_explicit: true` says the caller already knows the target is a
 * WP Engine install, so the local-site lookup below is skipped and the name is
 * used literally. Only `resolveTargetArgs` sets it, for a `wpe:`-prefixed
 * target or a bare name it has already resolved in the graph DB. Callers that
 * pass a bare `install_name` — every MCP tool — are unaffected: there the
 * argument really can be either, and local-first is the right default.
 */
export async function resolveTarget(
  args: Record<string, unknown>,
  services: NexusServices,
  operation: 'wpcli_read' | 'wpcli' = 'wpcli',
): Promise<ResolvedTarget | McpToolResult> {
  const installName = args.install_name as string | undefined;
  const installNameIsExplicit = args.install_name_explicit === true;
  const siteQuery = args.site as string | undefined;

  if (installName) {
    // Remote target: install_name provided directly
    if (!services.localServices) {
      return error('Local services not available.');
    }

    if (!services.localServices.isCAPIAvailable()) {
      return error('WP Engine API (CAPI) not available. Authenticate with WP Engine first.');
    }

    if (!services.localServices.isSSHKeyAvailable()) {
      return error(
        'SSH key not found. Connect a site to WP Engine through Local\'s UI at least once to generate the key.',
      );
    }

    // Read user settings for operation permissions (with legacy migration applied)
    const settings = getEffectiveSettings((services as any).registryStorage);

    // Resolve install_name: it could be a local site name (look up its WPE connection)
    // or a direct WPE install name. Try local site first — unless the caller
    // already established it is an install, in which case a local site that
    // happens to share the name must not hijack the target.
    const site = installNameIsExplicit ? null : resolveLocalSite(installName, services.siteData, services.graphService);
    if (site) {
      const installInfo = await services.localServices.resolveWpeInstall(site.id);
      if (installInfo) {
        // Linked-site path: environment is known from installInfo
        const environment = installInfo.environment ?? 'production';
        if (!isOperationAllowed(operation, environment, settings, `wpe:${installInfo.installName}`)) {
          return error(
            `Operation blocked: WP-CLI is not permitted on "${environment}" environments. ` +
            `Adjust in Nexus AI → Settings → WP Engine Access.`,
          );
        }
        return { type: 'remote', installName: installInfo.installName, installInfo };
      }
      return error(
        `Site "${installName}" is not connected to WP Engine. ` +
        'Use Local\'s Connect UI to link it first.',
      );
    }

    // Not a local site — treat install_name as a direct WPE install name.
    // Look up environment from WPE install cache; default to 'production' when unknown (safe default).
    const cachedInstall = lookupCachedWpeInstall(installName, services.registryStorage);
    const environment = cachedInstall?.environment ?? 'production';

    if (!isOperationAllowed(operation, environment, settings, `wpe:${installName}`)) {
      return error(
        `Operation blocked: WP-CLI is not permitted on "${environment}" environments. ` +
        `Adjust in Nexus AI → Settings → WP Engine Access.`,
      );
    }

    return {
      type: 'remote',
      installName,
      installInfo: {
        installName,
        installId: cachedInstall?.installId ?? cachedInstall?.install_id ?? '',
        remoteSiteId: '',
        primaryDomain: `${installName}.wpengine.com`,
        environment,
      },
    };
  }

  if (siteQuery) {
    const site = resolveLocalSite(siteQuery, services.siteData, services.graphService);
    if (!site) {
      return error(`Site "${siteQuery}" not found.`);
    }
    return { type: 'local', site };
  }

  return error('Either "site" (for local) or "install_name" (for remote WPE) is required.');
}

// ---------------------------------------------------------------------------
// Remote Execution (moved to WpeSshTransport)
// ---------------------------------------------------------------------------
// The remoteWpCliRun wrapper has been removed. Use WpeSshTransport directly
// or call via localServices.remoteWpCliRun which delegates to it.
