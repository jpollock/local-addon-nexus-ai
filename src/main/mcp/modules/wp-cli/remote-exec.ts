import { McpToolResult, NexusServices, LocalSiteInfo } from '../../types';
import { WpCliResult, WpeInstallInfo } from '../../local-services-bridge';
import { resolveSite } from '../../site-resolver';
import { error } from './preflight';

// ---------------------------------------------------------------------------
// Command Security (blocklist + whitelist)
// ---------------------------------------------------------------------------

const BLOCKED_COMMANDS = ['eval', 'eval-file', 'shell', 'db query', 'db cli'];

// Allowed WP-CLI commands for remote execution (whitelist approach)
const ALLOWED_REMOTE_COMMANDS = new Set([
  // Plugin management
  'plugin list',
  'plugin install',
  'plugin activate',
  'plugin deactivate',
  'plugin update',
  // Theme management
  'theme list',
  // Core
  'core version',
  // Users
  'user list',
  // Options
  'option get',
  // Site health
  'site health',
  // Post management (Phase 2: WPE content sync)
  'post list',
  'post get',
  'post-type list',
]);

export function isBlockedCommand(args: string[]): string | null {
  const joined = args.join(' ').toLowerCase();

  // Check blocklist (legacy - eval, shell, etc.)
  for (const blocked of BLOCKED_COMMANDS) {
    if (joined.startsWith(blocked) || joined.includes(` ${blocked}`)) {
      return blocked;
    }
  }

  // Check whitelist for remote commands
  if (args.length >= 2) {
    const command = `${args[0]} ${args[1]}`.toLowerCase();
    if (!ALLOWED_REMOTE_COMMANDS.has(command)) {
      return `Command "${command}" not allowed for remote execution. Use local WP-CLI for advanced operations.`;
    }
  }

  return null;
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
 */
export async function resolveTarget(
  args: Record<string, unknown>,
  services: NexusServices,
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

    // Resolve install_name: it could be a local site name (look up its WPE connection)
    // or a direct WPE install name. Try local site first.
    const site = resolveSite(installName, services.siteData);
    if (site) {
      const installInfo = await services.localServices.resolveWpeInstall(site.id);
      if (installInfo) {
        return { type: 'remote', installName: installInfo.installName, installInfo };
      }
      return error(
        `Site "${installName}" is not connected to WP Engine. ` +
        'Use Local\'s Connect UI to link it first.',
      );
    }

    // Not a local site — treat install_name as a direct WPE install name
    return {
      type: 'remote',
      installName,
      installInfo: {
        installName,
        installId: '',
        remoteSiteId: '',
        primaryDomain: `${installName}.wpengine.com`,
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
// Remote Execution
// ---------------------------------------------------------------------------

/**
 * Execute a WP-CLI command on a remote WPE install via SSH.
 */
export async function remoteWpCliRun(
  installName: string,
  args: string[],
  services: NexusServices,
): Promise<WpCliResult> {
  // Security: check for blocked commands
  const blocked = isBlockedCommand(args);
  if (blocked) {
    return {
      stdout: `Command "${blocked}" is blocked for security reasons on remote sites.`,
      success: false,
    };
  }

  return services.localServices!.remoteWpCliRun(installName, args);
}
