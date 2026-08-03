import type { NexusServices, McpToolResult } from '../mcp/types';
import { resolveTarget } from '../mcp/modules/wp-cli/remote-exec';
import type { SiteTransport } from './types';
import { WpeSshTransport } from './WpeSshTransport';
import { LocalTransport } from './LocalTransport';
import { withPolicy, MCP_REMOTE_POLICY } from './policy';

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
  const target = await resolveTarget(args as any, services, operation as any);
  if ('content' in target) return target;

  if (target.type === 'remote') {
    // MCP's whitelist applied HERE, not in each tool. Local transports are
    // deliberately ungated: the old wrapper only ever ran on the remote branch.
    return withPolicy(new WpeSshTransport(target.installName), MCP_REMOTE_POLICY);
  }
  return new LocalTransport(target.site.id, target.site.name, services.localServices!);
}
