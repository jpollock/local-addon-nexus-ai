import { spawn } from 'child_process';
import * as path from 'path';
import * as os from 'os';
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
    let resolved = false;
    const proc = spawn('ssh', args, { stdio: ['ignore', 'pipe', 'pipe'], timeout: timeoutMs });
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    // Both 'close' and 'error' fire on a spawn failure; the first to fire wins.
    proc.on('close', (code) => {
      if (!resolved) { resolved = true; resolve({ code, stdout, stderr }); }
    });
    proc.on('error', (err: Error) => {
      if (!resolved) { resolved = true; resolve({ code: null, stdout: '', stderr: '', spawnError: err.message }); }
    });
  });

export interface ResolvedSshConfig {
  hostname: string;
  user: string;
  port: string;
  /** First path when ssh -G reports a space-separated list — the file ssh itself would write to. */
  userKnownHostsFile: string;
  /**
   * First path when ssh -G reports a space-separated list. Undefined when
   * ssh -G reports none (the alias has no IdentityFile configured) — callers
   * needing an interpolated value must fall back to a generic placeholder
   * themselves rather than assuming one is always present.
   */
  identityFile?: string;
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
  const knownHostsField = fields.get('userknownhostsfile');
  const userKnownHostsFile = knownHostsField
    ? knownHostsField.split(/\s+/)[0]
    : path.join(os.homedir(), '.ssh', 'known_hosts');
  const identityFileField = fields.get('identityfile');
  const identityFile = identityFileField ? identityFileField.split(/\s+/)[0] : undefined;
  return {
    hostname: fields.get('hostname') || alias,
    user: fields.get('user') || '',
    port: fields.get('port') || '22',
    userKnownHostsFile,
    identityFile,
  };
}
