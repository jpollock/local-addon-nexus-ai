/**
 * WP-CLI command resolvers — nexusWpCommand, nexusWpPluginList.
 *
 * Security note: certain WP-CLI commands are blocked on remote (WPE) sites.
 */

import type { NexusServices } from '../../types/nexus-services';
import { parseTarget, resolveSite } from '../resolver-utils';
import type { ResolverParent } from '../resolver-utils';

/** WP-CLI commands blocked on remote (WPE) sites for security reasons. */
const BLOCKED_REMOTE_COMMANDS = ['db query', 'eval', 'eval-file', 'shell'];

export function createWpCliResolvers(services: NexusServices) {
  return {
    /**
     * Run any WP-CLI command on a site (local or WPE).
     * Certain commands are blocked on remote sites.
     */
    nexusWpCommand: async (_parent: ResolverParent, { target, command }: { target: string; command: string[] }) => {
      try {
        if (!services.localServices) {
          return { success: false, error: 'Local services not available', stdout: '', stderr: '', exitCode: 1 };
        }

        const parsed = parseTarget(target);

        // Block sensitive commands on remote WPE sites
        const commandStr = command.join(' ');
        if (parsed.type === 'wpe' && BLOCKED_REMOTE_COMMANDS.some(cmd => commandStr.startsWith(cmd))) {
          return {
            success: false,
            error: `Command "${commandStr}" is blocked on remote sites for security reasons.`,
            stdout: '',
            stderr: '',
            exitCode: 1,
          };
        }

        if (parsed.type === 'local') {
          const site = resolveSite(parsed.siteName!, services.siteData);
          if (!site) {
            return { success: false, error: `Site not found: ${parsed.siteName}`, stdout: '', stderr: '', exitCode: 1 };
          }

          const status = services.localServices!.getSiteStatus(site.id);
          if (status !== 'running') {
            return {
              success: false,
              error: `Site "${site.name}" is ${status}. Start it first.`,
              stdout: '',
              stderr: '',
              exitCode: 1,
            };
          }

          const result = await services.localServices.wpCliRun(site.id, command);

          return {
            success: result.success || result.exitCode === 0,
            error: result.success ? null : (result.stderr || 'Command failed'),
            stdout: result.stdout || '',
            stderr: result.stderr || '',
            exitCode: result.exitCode || 0,
          };
        }

        // WPE site via SSH
        const installNameOnly = parsed.installName!.split('/').pop() || parsed.installName!;

        if (!services.localServices.isSSHKeyAvailable()) {
          return {
            success: false,
            error: "WP Engine SSH key not found. Connect to WP Engine via Local's UI first.",
            stdout: '',
            stderr: '',
            exitCode: 1,
          };
        }

        const result = await services.localServices.remoteWpCliRun(installNameOnly, command);

        return {
          success: result.success,
          error: result.success ? null : (result.stdout || result.stderr || 'Command failed'),
          stdout: result.stdout || '',
          stderr: result.stderr || '',
          exitCode: result.success ? 0 : 1,
        };
      } catch (error: any) {
        return { success: false, error: error.message, stdout: '', stderr: '', exitCode: 1 };
      }
    },

    /**
     * List plugins on a site (local or WPE via SSH).
     */
    nexusWpPluginList: async (_parent: ResolverParent, { target }: { target: string }) => {
      try {
        if (!services.localServices) {
          return { success: false, error: 'Local services not available', plugins: [] };
        }

        const parsed = parseTarget(target);

        if (parsed.type === 'local') {
          const site = resolveSite(parsed.siteName!, services.siteData);
          if (!site) {
            return { success: false, error: `Site not found: ${parsed.siteName}`, plugins: [] };
          }

          const status = services.localServices!.getSiteStatus(site.id);
          if (status !== 'running') {
            return {
              success: false,
              error: `Site "${site.name}" is ${status}. Start it first.`,
              plugins: [],
            };
          }

          const plugins = await services.localServices.getPlugins(site.id);

          return {
            success: true,
            plugins: plugins.map((p: any) => ({
              name: p.title || p.name,
              slug: p.name,
              status: p.status,
              version: p.version,
              update: p.update_version || null,
              autoUpdate: null,
            })),
          };
        }

        // WPE site via SSH
        const installNameOnly = parsed.installName!.split('/').pop() || parsed.installName!;

        if (!services.localServices.isSSHKeyAvailable()) {
          return {
            success: false,
            error: "WP Engine SSH key not found. Connect to WP Engine via Local's UI first to generate the SSH key.",
            plugins: [],
          };
        }

        const wpCliResult = await services.localServices.remoteWpCliRun(
          installNameOnly,
          ['plugin', 'list', '--format=json']
        );

        if (!wpCliResult.success) {
          let errorMsg = wpCliResult.stdout || 'Failed to list plugins on WPE install';

          if (errorMsg.includes('Could not resolve hostname')) {
            errorMsg = `Cannot connect to WPE install "${installNameOnly}". ` +
                      `The install name may be incorrect or the install may not exist. ` +
                      `SSH hostname attempted: ${installNameOnly}.ssh.wpengine.net`;
          } else if (errorMsg.includes('Permission denied')) {
            errorMsg = 'SSH authentication failed. Verify your WP Engine SSH key is set up correctly in Local.';
          }

          return { success: false, error: errorMsg, plugins: [] };
        }

        try {
          const plugins = JSON.parse(wpCliResult.stdout || '[]');
          return {
            success: true,
            plugins: plugins.map((p: any) => ({
              name: p.title || p.name,
              slug: p.name,
              status: p.status,
              version: p.version,
              update: p.update_version || null,
              autoUpdate: p.auto_update || null,
            })),
          };
        } catch {
          return { success: false, error: 'Failed to parse plugin list response', plugins: [] };
        }
      } catch (error: any) {
        return { success: false, error: error.message, plugins: [] };
      }
    },
  };
}
