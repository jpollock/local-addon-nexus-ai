import * as path from 'path';
import * as os from 'os';
import { spawn } from 'child_process';
import type { LocalServicesBridge } from '../mcp/local-services-bridge';
import { createLogger } from '../logging/Logger';

const logger = createLogger('SentinelExecutor');

export interface ExecuteStep {
  command: string;
  ok: boolean;
  durationMs: number;
  error?: string;
}

// Raw SSH execution — bypasses WP-CLI entirely.
// Required for MU-plugin webshell deletion: wp eval still loads MU plugins,
// so the webshell runs before unlink() and poisons every subsequent command.
async function remoteSshRaw(installName: string, sshCommand: string): Promise<{ success: boolean; stdout: string }> {
  const userDataPath = (process as any).electronPaths?.userDataPath
    ?? path.join(os.homedir(), 'Library', 'Application Support', 'Local');
  const sshKeyPath = path.join(userDataPath, 'ssh', 'wpe-connect');
  const username = `local+ssh+${installName}`;
  const host     = `${installName}.ssh.wpengine.net`;

  const sshArgs = [
    '-F', '/dev/null',
    '-o', 'IdentitiesOnly=yes',
    '-o', 'PubkeyAcceptedKeyTypes=+ssh-rsa',
    '-o', 'ServerAliveInterval=60',
    '-o', 'ServerAliveCountMax=120',
    '-o', 'StrictHostKeyChecking=accept-new',
    '-o', 'ControlMaster=auto',
    '-o', 'ControlPath=/tmp/ssh-nexus-%C',
    '-o', 'ControlPersist=30s',
    '-i', sshKeyPath,
    `${username}@${host}`,
    sshCommand,
  ];

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    const proc = spawn('ssh', sshArgs, { stdio: ['ignore', 'pipe', 'pipe'], timeout: 35000 });
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    proc.on('close', (code: number | null) => {
      resolve({ success: code === 0, stdout: stdout || stderr });
    });
    proc.on('error', (err: Error) => {
      resolve({ success: false, stdout: err.message });
    });
  });
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
        const escapedPath = `'${nasPath.replace(/'/g, "'\\''")}'`;
        const result = await remoteSshRaw(installName, `rm -f ${escapedPath}`);
        const ok = result.success;
        steps.push({
          command,
          ok,
          durationMs: Date.now() - start,
          error: ok ? undefined : result.stdout.slice(0, 300),
        });
        if (!ok) allOk = false;
      } else {
        // Standard WP-CLI command
        const args = cleanCommand.split(/\s+/);
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
