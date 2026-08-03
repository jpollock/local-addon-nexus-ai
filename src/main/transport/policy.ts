/**
 * Command policy for remote execution.
 *
 * The MCP and GraphQL paths enforce DIFFERENT rules today: MCP applies a
 * 14-command whitelist plus a 5-entry blocklist; GraphQL applies a 4-entry
 * blocklist and no whitelist. That divergence is real and load-bearing — the
 * CLI relies on operations the MCP whitelist forbids, and five MCP tools have
 * remote paths that can never succeed because of it.
 *
 * Spec 0 PRESERVES the divergence. Unifying it is a separate spec with its own
 * decisions. Do not "tidy" these two constants into one.
 */

import type { SiteTransport } from './types';

export interface CommandPolicy {
  /** Substring/prefix blocklist, matched against the joined lowercase command. */
  blocked: string[];
  /** Optional whitelist of `"<arg0> <arg1>"` pairs. Absent means no whitelist. */
  allowed?: Set<string>;
}

export const MCP_REMOTE_POLICY: CommandPolicy = {
  blocked: ['eval', 'eval-file', 'shell', 'db query', 'db cli'],
  allowed: new Set([
    'plugin list', 'plugin install', 'plugin activate', 'plugin deactivate', 'plugin update',
    'theme list',
    'core version',
    'user list',
    'option get',
    'site health',
    'post list', 'post get', 'post-type list',
  ]),
};

export const GRAPHQL_REMOTE_POLICY: CommandPolicy = {
  blocked: ['db query', 'eval', 'eval-file', 'shell'],
};

/** Returns null when permitted, or a human-readable reason when refused. */
export function checkCommand(args: string[], policy: CommandPolicy): string | null {
  const joined = args.join(' ').toLowerCase();

  for (const blocked of policy.blocked) {
    if (joined.startsWith(blocked) || joined.includes(` ${blocked}`)) return blocked;
  }

  if (policy.allowed && args.length >= 2) {
    const command = `${args[0]} ${args[1]}`.toLowerCase();
    if (!policy.allowed.has(command)) {
      return `Command "${command}" not allowed for remote execution. Use local WP-CLI for advanced operations.`;
    }
  }

  return null;
}

/**
 * Wrap a transport so runWpCli enforces a command policy.
 *
 * The refused result is byte-identical to what remote-exec.ts's wrapper
 * returned, INCLUDING the nested-quote message a whitelist miss produces
 * (`Command "Command "core update" not allowed…" is blocked…`). That reads
 * like a bug and is not one to fix here: callers format it into their own
 * error text, so changing it changes user-visible output. Spec 0 is a
 * zero-behavior-change refactor.
 *
 * Only runWpCli is gated. deleteRemoteFile is Sentinel's deliberate WP-CLI
 * bypass and was never covered by the old wrapper.
 */
export function withPolicy(transport: SiteTransport, policy: CommandPolicy): SiteTransport {
  return {
    kind: transport.kind,
    siteRef: transport.siteRef,
    supports: (cap) => transport.supports(cap),
    probe: () => transport.probe(),
    deleteRemoteFile: (p) => transport.deleteRemoteFile(p),
    async runWpCli(args, opts) {
      const blocked = checkCommand(args, policy);
      if (blocked) {
        return {
          stdout: `Command "${blocked}" is blocked for security reasons on remote sites.`,
          success: false,
        };
      }
      return transport.runWpCli(args, opts);
    },
  };
}
