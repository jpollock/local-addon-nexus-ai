import { McpToolResult, NexusServices, LocalSiteInfo } from '../../types';
import { WpCliResult, WpeInstallInfo } from '../../local-services-bridge';
import { resolveSite } from '../../site-resolver';
import { error } from './preflight';
import { isOperationAllowed, getEffectiveSettings } from '../../utils/operation-permissions';
import { STORAGE_KEYS } from '../../../../common/constants';

// ---------------------------------------------------------------------------
// Command Security (moved to src/main/transport/policy.ts)
// ---------------------------------------------------------------------------
// BLOCKED_COMMANDS, ALLOWED_REMOTE_COMMANDS, and isBlockedCommand have been
// replaced by REMOTE_POLICY and checkCommand in the transport layer.

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
 */
export async function resolveTarget(
  args: Record<string, unknown>,
  services: NexusServices,
  operation: 'wpcli_read' | 'wpcli' = 'wpcli',
): Promise<ResolvedTarget | McpToolResult> {
  const installName = args.install_name as string | undefined;
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
    // or a direct WPE install name. Try local site first.
    const site = resolveSite(installName, services.siteData);
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
    const wpeCache = services.registryStorage?.get(STORAGE_KEYS.WPE_INSTALL_CACHE) as { installs: Array<{ installName?: string; install_name?: string; environment: string; installId?: string; install_id?: string }>; syncedAt: number } | null;
    const cachedInstall = wpeCache?.installs?.find(
      (i: any) => (i.installName ?? i.install_name) === installName
    );
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
    const site = resolveSite(siteQuery, services.siteData);
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
