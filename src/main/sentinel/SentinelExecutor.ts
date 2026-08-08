import type { LocalServicesBridge } from '../mcp/local-services-bridge';
import type { RegistryStorage } from '../content/IndexRegistry';
import { createLogger } from '../logging/Logger';
import { WpeSshTransport } from '../transport/WpeSshTransport';
import { isOperationAllowed, getEffectiveSettings } from '../mcp/utils/operation-permissions';
import { lookupCachedWpeInstall } from '../mcp/modules/wp-cli/remote-exec';

const logger = createLogger('SentinelExecutor');

export interface ExecuteStep {
  command: string;
  ok: boolean;
  durationMs: number;
  error?: string;
}

export async function executeSentinelCommands(
  installName: string,
  commands: string[],
  localServices: LocalServicesBridge,
  registryStorage: RegistryStorage,
): Promise<{ success: boolean; steps: ExecuteStep[] }> {
  const steps: ExecuteStep[] = [];
  let allOk = true;

  // Resolved once per run — same install, same environment for every command
  // in the batch. Mirrors `resolveTransport`/`resolveTarget`'s existing gate
  // for WP Engine installs (see `remote-exec.ts`'s "direct install name"
  // branch, which `lookupCachedWpeInstall` is shared from): permission check
  // happens before either the raw-SSH `rm` path or the WP-CLI path is
  // allowed to run.
  const settings = getEffectiveSettings(registryStorage);
  const cachedInstall = lookupCachedWpeInstall(installName, registryStorage);
  const environment = cachedInstall?.environment ?? 'production';

  for (const command of commands) {
    const start = Date.now();

    // Strip inline comments before processing
    const cleanCommand = command.replace(/\s+#.*$/, '').trim();

    // Skip full-line comments and blank lines
    if (cleanCommand.startsWith('#') || cleanCommand === '') {
      steps.push({ command, ok: true, durationMs: 0 });
      continue;
    }

    // Computed once per command — both branches below key off it, and the
    // gate check under each needs to match the branch it guards.
    const isRm = cleanCommand.startsWith('rm ');

    try {
      if (isRm && !isOperationAllowed('delete', environment, settings, `wpe:${installName}`)) {
        steps.push({
          command,
          ok: false,
          durationMs: Date.now() - start,
          error: `Operation blocked: file deletion is not permitted on "${environment}" environments. `
            + 'Adjust in Nexus AI → Settings → WP Engine Access.',
        });
        allOk = false;
      } else if (isRm) {
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
        // Gated on 'wpcli' (the write-capable check, refused on production by
        // default), not 'wpcli_read' — deliberately conservative. Sentinel
        // remediation commands are LLM-composed and can include mutating
        // WP-CLI (e.g. `option update`, `plugin deactivate`) alongside reads,
        // and this function has no way to distinguish the two per-command, so
        // every non-rm command is held to the stricter check.
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
