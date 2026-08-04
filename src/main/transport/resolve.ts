import type { NexusServices, McpToolResult } from '../mcp/types';
import { resolveTarget } from '../mcp/modules/wp-cli/remote-exec';
import type { SiteTransport } from './types';
import { WpeSshTransport } from './WpeSshTransport';
import { LocalTransport } from './LocalTransport';
import { withPolicy, MCP_REMOTE_POLICY, EXTERNAL_REMOTE_POLICY } from './policy';
import { parseTarget } from '../../common/target';
import { error } from '../mcp/modules/wp-cli/preflight';
import { isOperationAllowed, getEffectiveSettings } from '../mcp/utils/operation-permissions';
import { ExternalSshTransport } from './ExternalSshTransport';
import { getExternalProfile } from '../external/externalSiteStore';

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

    // Same gate as WP Engine installs, keyed on an ssh: target ref.
    const settings = getEffectiveSettings((services as any).registryStorage);
    if (!isOperationAllowed(operation as any, parsed.environment, settings, `ssh:${parsed.alias}`)) {
      return error(
        `Operation blocked: not permitted on "${parsed.environment}" environments. `
        + `Adjust in Nexus AI → Settings → WP Engine Access.`,
      );
    }

    // Registration (nexus host add) stores what the probe discovered. Reading it
    // back here is the whole point: otherwise a registered host still needs
    // --path on every command. An explicit wp_path wins — the user meant it.
    const storage = (services as any).registryStorage;
    const profile = storage ? getExternalProfile(storage, parsed.alias) : null;
    const explicitPath = typeof args.wp_path === 'string' ? args.wp_path : undefined;
    const wpPath = explicitPath ?? profile?.wpPath;
    return withPolicy(
      new ExternalSshTransport(parsed.alias, wpPath, profile?.wpCliPath),
      EXTERNAL_REMOTE_POLICY,
    );
  }

  const target = await resolveTarget(args as any, services, operation as any);
  if ('content' in target) return target;

  if (target.type === 'remote') {
    // MCP's whitelist applied HERE, not in each tool. Local transports are
    // deliberately ungated: the old wrapper only ever ran on the remote branch.
    return withPolicy(new WpeSshTransport(target.installName), MCP_REMOTE_POLICY);
  }
  return new LocalTransport(target.site.id, target.site.name, services.localServices!);
}
