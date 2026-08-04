/**
 * WP-CLI command resolvers — nexusWpCommand and nexusWpPluginList.
 *
 * THIS IS THE ONLY IMPLEMENTATION. resolvers.ts spreads the object this factory
 * returns into its Mutation map; it no longer carries copies of these two
 * resolvers.
 *
 * It used to. This module held a second nexusWpCommand with its own four-item
 * blocklist, its own target resolution, and neither an audit call nor a
 * permission gate — dead, because createResolvers in resolvers.ts wins module
 * resolution for './graphql/resolvers', but dead code that would have landed
 * silently the day the in-progress resolver split completed. CLAUDE.md's rule
 * for the sibling case (resolvers/wpe.ts) is to keep the duplicate in sync;
 * having one implementation is strictly better than remembering to.
 *
 * Both resolvers route every target type — local, WP Engine, external SSH —
 * through resolveTransport, which owns target resolution, the command policy
 * and the environment gate. Neither resolveTransport nor ToolRegistry.call()'s
 * chokepoint audits this path, so both resolvers write their own
 * auditDirectOperation entry on every outcome.
 *
 * BOTH audit, including nexusWpPluginList, which is a pure read. That is a
 * deliberate exception to "read-only resolvers must not be audited"
 * (auditDirectOperation.ts). The rule exists to stop high-volume reads swamping
 * operation-audit.log; these two resolvers are one entry per typed CLI command,
 * they are the CLI's only direct route to a production WP Engine install or an
 * arbitrary SSH host, and nexusWpCommand already audits reads such as
 * `core version` for the same reason. Do not generalise the exception: a read
 * that runs in a loop, or from a UI poll, still must not be audited.
 */

import type { NexusServices } from '../../types/nexus-services';
import type { ResolverParent } from '../resolver-utils';
import { withQueue } from '../resolver-utils';
import { auditDirectOperation } from '../../audit/auditDirectOperation';
import { classifyWpCliOp } from '../../transport/classify';
import { resolveTargetArgs } from '../../transport/resolveTargetArgs';
import { resolveTransport } from '../../transport';
import type { SiteRef } from '../../transport';

/**
 * The one argv nexusWpPluginList runs, on every target type.
 *
 * `--fields` is not decoration: `wp plugin list --format=json` returns only
 * name/status/update/version, and the GraphQL response shape promises `name`
 * (the plugin *title*) and `update`. Local sites used to get those from Local's
 * own getPlugins API; asking WP-CLI for them keeps the response identical
 * across all three transports. `auto_update` is deliberately absent — it needs
 * WP-CLI 2.5+, and an unknown field makes the whole command fail rather than
 * degrade, so it stays null exactly as it already did on both old branches.
 */
const PLUGIN_LIST_ARGV = [
  'plugin', 'list', '--format=json',
  '--fields=name,title,version,status,update_version',
];

/** Turn two common WPE SSH failures into something the user can act on. */
function annotatePluginListFailure(raw: string, siteRef: SiteRef): string {
  if (siteRef.kind !== 'wpe') return raw;
  if (raw.includes('Could not resolve hostname')) {
    return `Cannot connect to WPE install "${siteRef.installName}". `
      + 'The install name may be incorrect or the install may not exist. '
      + `SSH hostname attempted: ${siteRef.installName}.ssh.wpengine.net`;
  }
  if (raw.includes('Permission denied')) {
    return 'SSH authentication failed. Verify your WP Engine SSH key is set up correctly in Local.';
  }
  return raw;
}

export function createWpCliResolvers(services: NexusServices) {
  return {
    /**
     * Run any WP-CLI command on a site (local, WP Engine, or external SSH host).
     */
    nexusWpCommand: async (_parent: ResolverParent, { target, command }: { target: string; command: string[] }) => {
      return withQueue(async () => {
        // One router for every target type. This resolver used to hand-roll
        // target resolution, a command blocklist and two permission-gate
        // calls; all three now live in resolveTransport, which is why an
        // ssh: target works here at all.
        const operation = classifyWpCliOp(command);

        // The resolved identity, recorded in the audit entry once it is known.
        // `target` alone cannot carry it: a bare name that falls back to a WP
        // Engine install reads identically to a local site name, which would
        // make arbitrary WP-CLI on production indistinguishable from a local
        // run — the highest-blast-radius direct-call path in the addon, and
        // the one whose argv is withheld. Absent on the paths where nothing
        // was resolved, which is itself accurate.
        let resolved: SiteRef | undefined;
        const audit = (outcome: 'success' | 'failure', err?: string) =>
          auditDirectOperation(services, {
            operation: 'cli.wp.command',
            target,
            parameters: { target, command, ...(resolved ? { resolved } : {}) },
            outcome,
            error: err,
          });

        try {
          if (!services.localServices) {
            audit('failure', 'Local services not available');
            return { success: false, error: 'Local services not available', stdout: '', stderr: '', exitCode: 1 };
          }

          const args = resolveTargetArgs(target, services);
          const transport = await resolveTransport(args, services, operation);
          if ('content' in transport) {
            const msg = (transport.content?.[0] as { text?: string } | undefined)?.text ?? 'Target could not be resolved';
            audit('failure', msg);
            return { success: false, error: msg, stdout: '', stderr: '', exitCode: 1 };
          }
          resolved = transport.siteRef;

          const result = await transport.runWpCli(command);
          // WpCliResult carries stdout + success always, and stderr/exitCode
          // optionally (local-services-bridge.ts:17-23 — "Not always present").
          // Transports that spawn ssh fold their error text into stdout, so
          // fall back to it rather than reporting an empty failure.
          const okRun = result.success || result.exitCode === 0;
          const failText = result.stderr || result.stdout || 'Command failed';
          audit(okRun ? 'success' : 'failure', okRun ? undefined : failText);
          return {
            success: okRun,
            error: okRun ? null : failText,
            stdout: result.stdout ?? '',
            stderr: result.stderr ?? '',
            exitCode: result.exitCode ?? (okRun ? 0 : 1),
          };
        } catch (e: any) {
          const msg = e?.message ?? String(e);
          audit('failure', msg);
          return { success: false, error: msg, stdout: '', stderr: '', exitCode: 1 };
        }
      });
    },

    /**
     * List plugins on a site — local, WP Engine, or an external SSH host.
     *
     * Same router as nexusWpCommand. This resolver used to hand-roll target
     * resolution and its own isOperationAllowed call with an environment
     * derived from the target suffix, and it knew only two target types: an
     * `ssh:` target fell through the `local` branch into the WPE `else`,
     * where `installName` is undefined, and threw "Cannot read properties of
     * undefined (reading 'split')". `nexus wp plugin list <ssh-target>
     * --json` reaches it directly (wp.ts:31 skips the MCP path for --json),
     * as does the plain form whenever the MCP server is down.
     */
    nexusWpPluginList: async (_parent: ResolverParent, { target }: { target: string }) => {
      return withQueue(async () => {
        // `plugin list` is a read on every surface; the gate inside
        // resolveTransport is given the same classification the CLI route
        // computes for it.
        const operation = classifyWpCliOp(PLUGIN_LIST_ARGV);

        let resolved: SiteRef | undefined;
        const audit = (outcome: 'success' | 'failure', err?: string) =>
          auditDirectOperation(services, {
            operation: 'cli.wp.plugin.list',
            target,
            parameters: { target, ...(resolved ? { resolved } : {}) },
            outcome,
            error: err,
          });

        try {
          if (!services.localServices) {
            audit('failure', 'Local services not available');
            return { success: false, error: 'Local services not available', plugins: [] };
          }

          const args = resolveTargetArgs(target, services);
          const transport = await resolveTransport(args, services, operation);
          if ('content' in transport) {
            const msg = (transport.content?.[0] as { text?: string } | undefined)?.text ?? 'Target could not be resolved';
            audit('failure', msg);
            return { success: false, error: msg, plugins: [] };
          }
          resolved = transport.siteRef;

          const result = await transport.runWpCli(PLUGIN_LIST_ARGV);
          if (!result.success && result.exitCode !== 0) {
            // Both SSH transports fold their error text into stdout.
            const raw = result.stdout || result.stderr || 'Failed to list plugins';
            const msg = annotatePluginListFailure(raw, transport.siteRef);
            audit('failure', msg);
            return { success: false, error: msg, plugins: [] };
          }

          let parsed: any[];
          try {
            parsed = JSON.parse(result.stdout || '[]');
          } catch {
            audit('failure', 'Failed to parse plugin list JSON');
            return { success: false, error: 'Failed to parse plugin list JSON', plugins: [] };
          }

          audit('success');
          return {
            success: true,
            plugins: parsed.map((p: any) => ({
              name: p.title || p.name,
              slug: p.name,
              status: p.status,
              version: p.version,
              update: p.update_version || null,
              autoUpdate: p.auto_update ?? null,
            })),
          };
        } catch (e: any) {
          const msg = e?.message ?? String(e);
          audit('failure', msg);
          return { success: false, error: msg, plugins: [] };
        }
      });
    },
  };
}
