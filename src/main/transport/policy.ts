/**
 * Command policy for remote execution — ONE policy for every remote target.
 *
 * This was three constants: MCP's 14-command whitelist plus blocklist, a
 * GraphQL blocklist with no consumers, and a blocklist-only external policy.
 * They are unified here on blocklist-only. Two reasons, both measured:
 *
 *  - Unifying UPWARD onto the whitelist would break 8 of the 17 CLI commands
 *    on WP Engine (theme activate, core update, db export, db import,
 *    search-replace, post create/update/delete). That is a capability
 *    regression for existing users.
 *  - The whitelist protected less than it appeared to. No MCP tool accepts an
 *    arbitrary command array — every tool emits a fixed command shape, and the
 *    one free-form tool (wp_eval) is in the blocklist below. So removing the
 *    whitelist grants agents exactly five tools (core update, theme activate,
 *    post create/update/delete) — capabilities a human at the CLI already had.
 *
 * IF A FUTURE MCP TOOL EVER ACCEPTS A FREE-FORM COMMAND ARRAY, that second
 * reason dies and the whitelist question must be reopened.
 *
 * What still protects production is the permission gate, not this list:
 * wpcli/push are refused on production and delete is refused everywhere
 * (DEFAULT_OPERATION_PERMISSIONS, mcp/utils/operation-permissions.ts).
 */

import type { SiteTransport } from './types';

export interface CommandPolicy {
  /** Substring/prefix blocklist, matched against the joined lowercase command. */
  blocked: string[];
  /** Optional whitelist of `"<arg0> <arg1>"` pairs. Absent means no whitelist. */
  allowed?: Set<string>;
}

export const REMOTE_POLICY: CommandPolicy = {
  blocked: ['eval', 'eval-file', 'shell', 'db query', 'db cli'],
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
