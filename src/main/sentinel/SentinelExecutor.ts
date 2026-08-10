import * as path from 'path';
import * as os from 'os';
import { spawn } from 'child_process';
import type { LocalServicesBridge } from '../mcp/local-services-bridge';
import { createLogger } from '../logging/Logger';
import { describeRemoteFailure, REMOTE_SSH_TIMEOUT_MS } from '../mcp/utils/remoteFailure';

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
    const startedAt = Date.now();
    const proc = spawn('ssh', sshArgs, { stdio: ['ignore', 'pipe', 'pipe'], timeout: REMOTE_SSH_TIMEOUT_MS });
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    proc.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
      if (code === 0) { resolve({ success: true, stdout }); return; }
      // Remediation runs against production, so "it failed" is not a good enough answer. Lead
      // with the real reason — a timeout, a signal, an exit code — rather than whichever stream
      // happened to be non-empty, which reported OpenSSH's post-quantum advisory as the cause of
      // every failure on hosts that emit it.
      resolve({
        success: false,
        stdout: describeRemoteFailure({
          code, signal, stderr: stderr || stdout,
          elapsedMs: Date.now() - startedAt, timeoutMs: REMOTE_SSH_TIMEOUT_MS,
        }),
      });
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
