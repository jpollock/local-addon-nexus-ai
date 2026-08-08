import type { LocalServicesBridge } from '../mcp/local-services-bridge';
import { createLogger } from '../logging/Logger';
import { WpeSshTransport } from '../transport/WpeSshTransport';
import { isOperationAllowed, getEffectiveSettings } from '../mcp/utils/operation-permissions';
import { STORAGE_KEYS } from '../../common/constants';

const logger = createLogger('SentinelExecutor');

export interface ExecuteStep {
  command: string;
  ok: boolean;
  durationMs: number;
  error?: string;
}

// Minimal shape `getEffectiveSettings` needs — matches its own parameter type
// so this module does not have to import the full `RegistryStorage` class.
type RegistryStorageLike = { get(key: string): unknown } | null | undefined;

/**
 * Resolves the environment a WPE install is registered under, the same way
 * `resolveTarget`'s "direct install name" branch does (`remote-exec.ts`):
 * look it up in the cached WPE install list, defaulting to 'production' when
 * unknown. Sentinel remediation always addresses installs by name directly —
 * there is no linked-local-site path here.
 */
function resolveInstallEnvironment(installName: string, registryStorage: RegistryStorageLike): string {
  const wpeCache = registryStorage?.get(STORAGE_KEYS.WPE_INSTALL_CACHE) as {
    installs: Array<{ installName?: string; install_name?: string; environment: string }>;
  } | null;
  const cachedInstall = wpeCache?.installs?.find(
    (i: any) => (i.installName ?? i.install_name) === installName,
  );
  return cachedInstall?.environment ?? 'production';
}

export async function executeSentinelCommands(
  installName: string,
  commands: string[],
  localServices: LocalServicesBridge,
  registryStorage?: RegistryStorageLike,
): Promise<{ success: boolean; steps: ExecuteStep[] }> {
  const steps: ExecuteStep[] = [];
  let allOk = true;

  // Resolved once per run — same install, same environment for every command
  // in the batch. Mirrors `resolveTransport`/`resolveTarget`'s existing gate
  // for WP Engine installs (see `remote-exec.ts`): permission check happens
  // before either the raw-SSH `rm` path or the WP-CLI path is allowed to run.
  const settings = getEffectiveSettings(registryStorage);
  const environment = resolveInstallEnvironment(installName, registryStorage);

  for (const command of commands) {
    const start = Date.now();

    // Strip inline comments before processing
    const cleanCommand = command.replace(/\s+#.*$/, '').trim();

    // Skip full-line comments and blank lines
    if (cleanCommand.startsWith('#') || cleanCommand === '') {
      steps.push({ command, ok: true, durationMs: 0 });
      continue;
    }

    try {
      if (cleanCommand.startsWith('rm ') && !isOperationAllowed('delete', environment, settings, `wpe:${installName}`)) {
        steps.push({
          command,
          ok: false,
          durationMs: Date.now() - start,
          error: `Operation blocked: file deletion is not permitted on "${environment}" environments. `
            + 'Adjust in Nexus AI → Settings → WP Engine Access.',
        });
        allOk = false;
      } else if (cleanCommand.startsWith('rm ')) {
        // Use raw SSH file deletion — WP-CLI always loads MU plugins (even with
        // --skip-plugins), so any webshell in mu-plugins/ poisons wp eval.
        // Direct rm over SSH bypasses WordPress entirely.
        const relPath = cleanCommand.replace(/^rm\s+(-\S+\s+)*/, '').trim();
        const nasPath = `/nas/content/live/${installName}/${relPath}`;
        const result = await new WpeSshTransport(installName).deleteRemoteFile(nasPath);
        const ok = result.success;
        steps.push({
          command,
          ok,
          durationMs: Date.now() - start,
          error: ok ? undefined : result.output.slice(0, 300),
        });
        if (!ok) allOk = false;
      } else if (!isOperationAllowed('wpcli', environment, settings, `wpe:${installName}`)) {
        steps.push({
          command,
          ok: false,
          durationMs: Date.now() - start,
          error: `Operation blocked: WP-CLI is not permitted on "${environment}" environments. `
            + 'Adjust in Nexus AI → Settings → WP Engine Access.',
        });
        allOk = false;
      } else {
        // Standard WP-CLI command
        // Strip leading 'wp' — generateCommands includes it but remoteWpCliRun adds it too
        const rawArgs = cleanCommand.split(/\s+/);
        const args = rawArgs[0] === 'wp' ? rawArgs.slice(1) : rawArgs;
        const result = await localServices.remoteWpCliRun(installName, args);
        const ok = result.success;
        steps.push({
          command,
          ok,
          durationMs: Date.now() - start,
          error: ok ? undefined : (result.stderr ?? result.stdout ?? 'Failed'),
        });
        if (!ok) allOk = false;
      }
    } catch (err: any) {
      steps.push({ command, ok: false, durationMs: Date.now() - start, error: err.message });
      allOk = false;
    }

    const last = steps[steps.length - 1];
    logger.info(`[SentinelExecutor] ${command.slice(0, 60)} — ${last.ok ? 'ok' : 'FAILED'} (${last.durationMs}ms)`);
  }

  return { success: allOk, steps };
}
