import type { LocalServicesBridge } from '../mcp/local-services-bridge';
import { createLogger } from '../logging/Logger';
import { WpeSshTransport } from '../transport/WpeSshTransport';

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
): Promise<{ success: boolean; steps: ExecuteStep[] }> {
  const steps: ExecuteStep[] = [];
  let allOk = true;

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
      if (cleanCommand.startsWith('rm ')) {
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
