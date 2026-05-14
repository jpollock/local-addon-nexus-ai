/**
 * wpe_wait_for_ssh — reliably detect when a WPE install is SSH-ready.
 *
 * CAPI's status="active" is unreliable for SSH readiness — the install
 * appears active in CAPI before SSH/rsync infrastructure is ready.
 * The only reliable test is to actually attempt an SSH connection.
 *
 * Polls `wp cli info` (lightest WP-CLI command, no WordPress bootstrap)
 * every 30 seconds until it succeeds, or times out after max_minutes.
 */
import { McpToolHandler } from '../../types';
import { requireLocalServices, capiError } from './helpers';
import { isOperationAllowed } from '../../utils/operation-permissions';
import { STORAGE_KEYS } from '../../../../common/constants';
import type { NexusSettings } from '../../../../common/types';

export const waitForSshHandler: McpToolHandler = {
  definition: {
    name: 'wpe_wait_for_ssh',
    description:
      'Wait until a WP Engine install is actually ready for SSH/push operations. ' +
      'CAPI status="active" is NOT sufficient — SSH infrastructure needs additional warmup. ' +
      'This tool probes the install via SSH every 30 seconds and returns only when SSH succeeds. ' +
      'Use this after wpe_create_install before any push or WP-CLI operation. ' +
      'Typically succeeds within 3–8 minutes of install creation.',
    inputSchema: {
      type: 'object',
      properties: {
        install_name: {
          type: 'string',
          description: 'WPE install slug (e.g. "nexusdemo24") — used as the SSH hostname.',
        },
        max_minutes: {
          type: 'number',
          description: 'Maximum minutes to wait before giving up. Default: 10.',
        },
      },
      required: ['install_name'],
    },
    isAvailable: (services) => requireLocalServices(services),
  },

  async execute(args, services) {
    const installName = args.install_name as string;
    const maxMinutes = (args.max_minutes as number) ?? 10;
    const maxMs = maxMinutes * 60 * 1000;
    const pollIntervalMs = 30000;
    const started = Date.now();
    let attempts = 0;

    // Check operation permissions before attempting SSH
    const settings = ((services as any).registryStorage?.get(STORAGE_KEYS.SETTINGS) ?? {}) as NexusSettings;
    const cache = (services as any).registryStorage?.get(STORAGE_KEYS.WPE_INSTALL_CACHE) as { installs?: Array<{ installName?: string; install_name?: string; environment?: string }> } | null;
    const cachedInstall = cache?.installs?.find((i: any) => (i.installName ?? i.install_name) === installName);
    const environment = cachedInstall?.environment ?? 'production';
    if (!isOperationAllowed('wpcli', environment, settings, installName)) {
      return {
        content: [{
          type: 'text' as const,
          text: `Operation blocked: this operation is not permitted on "${environment}" environments. ` +
            `Adjust in Nexus Preferences → WP Engine → WP Engine Access.`,
        }],
        isError: true,
      };
    }

    while (Date.now() - started < maxMs) {
      attempts++;
      const elapsed = Math.round((Date.now() - started) / 1000);

      try {
        // wp cli info: no WordPress bootstrap, just returns WP-CLI version info
        const result = await services.localServices!.remoteWpCliRun(installName, ['cli', 'info']);

        if (result.success && result.stdout) {
          const totalSeconds = Math.round((Date.now() - started) / 1000);
          return {
            content: [{
              type: 'text' as const,
              text: `✅ SSH ready for "${installName}" after ${totalSeconds}s (${attempts} probe${attempts === 1 ? '' : 's'}).\n\n` +
                `Safe to push, run WP-CLI, or link this install.\n\n` +
                `WP-CLI info:\n${result.stdout.trim()}`,
            }],
          };
        }
      } catch {
        // SSH failed — not ready yet
      }

      const remaining = Math.round((maxMs - (Date.now() - started)) / 1000);
      if (remaining <= 0) break;

      // Wait before next probe (but don't wait longer than remaining time)
      await new Promise((r) => setTimeout(r, Math.min(pollIntervalMs, remaining * 1000)));
    }

    const totalSeconds = Math.round((Date.now() - started) / 1000);
    return {
      content: [{
        type: 'text' as const,
        text: `⏰ Timed out waiting for SSH on "${installName}" after ${totalSeconds}s (${attempts} probe${attempts === 1 ? '' : 's'}).\n\n` +
          `The install may still be provisioning. Try again in a few minutes, ` +
          `or check the WPE portal at my.wpengine.com to confirm the install status.\n\n` +
          `You can retry with: wpe_wait_for_ssh install_name="${installName}" max_minutes=${maxMinutes + 5}`,
      }],
      isError: true,
    };
  },
};
