import { spawn } from 'child_process';
import { buildSshConfigDumpArgs } from '../transport/ssh-args';

export interface RawSshResult {
  code: number | null;
  stdout: string;
  stderr: string;
  spawnError?: string;
}

/**
 * Spawn ssh with an exact argv and collect the result.
 *
 * Injected rather than mocked so tests can assert the argv itself — the escaping
 * of a --path value is only visible there.
 */
export type SshExec = (args: string[], timeoutMs: number) => Promise<RawSshResult>;

export const defaultSshExec: SshExec = (args, timeoutMs) =>
  new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    const proc = spawn('ssh', args, { stdio: ['ignore', 'pipe', 'pipe'], timeout: timeoutMs });
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    proc.on('close', (code) => resolve({ code, stdout, stderr }));
    proc.on('error', (err: Error) =>
      resolve({ code: null, stdout: '', stderr: '', spawnError: err.message }));
  });

export interface ResolvedSshConfig {
  hostname: string;
  user: string;
  port: string;
}

export const SSH_CONFIG_DUMP_TIMEOUT_MS = 5000;

/**
 * What ssh will actually use for this alias.
 *
 * RESOLUTION, NOT VALIDATION. `ssh -G` exits 0 for an alias in no config file,
 * echoing the alias back as hostname with the local username and port 22, so a
 * successful call proves nothing about whether the alias is configured. Its job
 * is to make the ssh-copy-id remedy correct; connectivity is the real gate.
 */
export async function resolveSshConfig(
  alias: string,
  exec: SshExec = defaultSshExec,
): Promise<ResolvedSshConfig> {
  const res = await exec(buildSshConfigDumpArgs(alias), SSH_CONFIG_DUMP_TIMEOUT_MS);
  const fields = new Map<string, string>();
  for (const line of res.stdout.split('\n')) {
    const m = /^\s*(\S+)\s+(.*)$/.exec(line);
    if (m) {
      const key = m[1].toLowerCase();
      if (!fields.has(key)) fields.set(key, m[2].trim());
    }
  }
  return {
    hostname: fields.get('hostname') || alias,
    user: fields.get('user') || '',
    port: fields.get('port') || '22',
  };
}
