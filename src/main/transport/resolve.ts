import type { NexusServices, McpToolResult } from '../mcp/types';
import { resolveTarget } from '../mcp/modules/wp-cli/remote-exec';
import type { SiteTransport } from './types';
import { WpeSshTransport } from './WpeSshTransport';
import { LocalTransport } from './LocalTransport';
import { withPolicy, REMOTE_POLICY } from './policy';
import { parseTarget } from '../../common/target';
import { error } from '../mcp/modules/wp-cli/preflight';
import {
  isOperationAllowed, getEffectiveSettings, mostRestrictiveEnvironment,
} from '../mcp/utils/operation-permissions';
import { ExternalSshTransport } from './ExternalSshTransport';
import { getExternalProfile } from '../external/externalSiteStore';
import { findExternalSites } from '../mcp/site-resolver';

/**
 * Resolve MCP tool args to a transport. Delegates target resolution (and
 * therefore the environment gate, SSH-key check and CAPI lookup) to the
 * existing resolveTarget so none of that behavior moves in Spec 0.
 *
 * Returns an McpToolResult when resolution fails, matching resolveTarget's
 * existing contract — callers keep using `if ('content' in x) return x`.
 */
export async function resolveTransport(
  args: Record<string, unknown>,
  services: NexusServices,
  operation: string,
): Promise<SiteTransport | McpToolResult> {
  // External SSH hosts arrive as an undeclared `ssh_target` arg from the CLI.
  // Handled before resolveTarget so no existing local/WPE resolution runs and
  // therefore none of it can regress. The arg is intentionally absent from every
  // tool's inputSchema in this milestone; Plan B promotes it.
  const sshTarget = typeof args.ssh_target === 'string' ? args.ssh_target : undefined;
  if (sshTarget) {
    let parsed;
    try {
      parsed = parseTarget(sshTarget);
    } catch (e: any) {
      return error(e?.message ?? `Invalid SSH target: ${sshTarget}`);
    }
    if (parsed.type !== 'external' || !parsed.alias) {
      return error(`Not an external SSH target: ${sshTarget}. Expected ssh:alias@environment`);
    }

    // The connection profile carries reachability metadata only (wpCliPath).
    // Everything per-site — environment, wp_path — lives on the site row now,
    // because one connection can host several installs.
    const storage = (services as any).registryStorage;
    const connectionProfile = storage ? getExternalProfile(storage, parsed.alias) : null;

    // Resolve the SITE **before** the gate runs. Same ordering requirement as
    // the profile lookup this replaces, and for the same reason: the registered
    // environment (now per-site) is half of what the gate decides on. When this
    // lookup sat below the gate, a host registered --env production stayed
    // writable when addressed as ssh:<alias>@development.
    const graphService = (services as any).graphService;
    const db = graphService?.getDb?.();
    const sites = findExternalSites(
      db, parsed.alias, parsed.site, 'id, name, environment, wp_path, wp_cli_path',
    );

    let resolvedSite: {
      id: string; name: string; environment: string | null;
      wp_path: string | null; wp_cli_path: string | null;
    };
    if (parsed.site && sites.length === 1) {
      resolvedSite = sites[0];
    } else if (parsed.site) {
      // Unreachable while (account_id, name) is de-facto unique, but an
      // unordered LIMIT-1 on a multi-row result is a coin toss, not a lookup —
      // decline instead. Zero and many are distinct messages.
      if (sites.length === 0) {
        return error(`No site "${parsed.site}" registered on connection "${parsed.alias}".`);
      }
      return error(
        `"${parsed.alias}" has ${sites.length} sites named "${parsed.site}" — cannot resolve. `
        + `Remove the duplicate with \`nexus host remove\` and re-register.`,
      );
    } else if (sites.length === 0) {
      return error(
        `Connection "${parsed.alias}" has no registered sites. `
        + `Run \`nexus host add ${parsed.alias}\`.`,
      );
    } else if (sites.length > 1) {
      const names = sites.map(
        (s: any) => `ssh:${parsed.alias}/${s.name}@${s.environment ?? 'production'}`,
      );
      return error(
        `"${parsed.alias}" has ${sites.length} registered sites — specify which one: `
        + names.join(', '),
      );
    } else {
      resolvedSite = sites[0];
    }

    // Same gate as WP Engine installs, keyed on an ssh: target ref — but on the
    // more restrictive of the label the SITE was registered with and the one the
    // caller typed. See mostRestrictiveEnvironment for why the target string
    // alone cannot be trusted.
    // `?? undefined` is load-bearing: sqlite hands back NULL for an unlabelled
    // site, and mostRestrictiveEnvironment only filters `undefined` — a raw null
    // normalises to "production" and would silently gate every unlabelled site
    // as production regardless of the target. Unspecified must contribute
    // nothing, exactly as an absent profile field used to.
    const gatedEnv = mostRestrictiveEnvironment(
      parsed.environment, resolvedSite.environment ?? undefined,
    );
    const settings = getEffectiveSettings(storage);
    if (!isOperationAllowed(
      operation as any, gatedEnv, settings, `ssh:${parsed.alias}/${resolvedSite.name}`,
    )) {
      const registeredNote = resolvedSite.environment && gatedEnv !== parsed.environment
        ? ` '${parsed.alias}/${resolvedSite.name}' is registered as `
          + `"${resolvedSite.environment}", which is what applies.`
        : '';
      return error(
        `Operation blocked: not permitted on "${gatedEnv}" environments.${registeredNote} `
        + `Adjust in Nexus AI → Settings → WP Engine Access.`,
      );
    }

    // An explicit wp_path wins — the user meant it. Otherwise the site's own
    // stored path, then nothing (WP-CLI searches from the login dir).
    const explicitPath = typeof args.wp_path === 'string' ? args.wp_path : undefined;
    const wpPath = explicitPath ?? resolvedSite.wp_path ?? undefined;
    const wpCliPath = resolvedSite.wp_cli_path ?? connectionProfile?.wpCliPath;
    return withPolicy(
      new ExternalSshTransport(parsed.alias, wpPath, wpCliPath),
      REMOTE_POLICY,
    );
  }

  const target = await resolveTarget(args as any, services, operation as any);
  if ('content' in target) return target;

  if (target.type === 'remote') {
    // Every remote target gets the same blocklist-only policy. Local transports
    // are deliberately ungated: the old wrapper only ever ran on the remote branch.
    return withPolicy(new WpeSshTransport(target.installName), REMOTE_POLICY);
  }
  return new LocalTransport(target.site.id, target.site.name, services.localServices!);
}
