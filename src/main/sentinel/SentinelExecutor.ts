import type { LocalServicesBridge } from '../mcp/local-services-bridge';
import { createLogger } from '../logging/Logger';

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

    // Skip comments
    if (command.trim().startsWith('#') || command.trim() === '') {
      steps.push({ command, ok: true, durationMs: 0 });
      continue;
    }

    try {
      if (command.startsWith('rm ')) {
        // File deletion via wp eval (safer than raw rm in WPE environment)
        const filePath = command.replace(/^rm\s+(-\S+\s+)*/, '').trim();
        const safePath = filePath.replace(/'/g, "\\'");
        const result = await localServices.remoteWpCliRun(installName, [
          'eval',
          `unlink(ABSPATH . '${safePath}'); echo file_exists(ABSPATH . '${safePath}') ? 'failed' : 'deleted';`,
        ]);
        const ok = result.success && (result.stdout ?? '').includes('deleted');
        steps.push({
          command,
          ok: !!ok,
          durationMs: Date.now() - start,
          error: ok ? undefined : (result.stdout ?? result.stderr ?? 'Failed'),
        });
        if (!ok) allOk = false;
      } else {
        // Standard WP-CLI command
        const args = command.split(/\s+/);
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
