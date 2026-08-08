import { spawn } from 'child_process';
import type { WpCliResult } from '../mcp/local-services-bridge';
import type {
  DeleteResult, ProbeResult, RunOpts, SiteRef, SiteTransport, TransportKind,
} from './types';
import {
  buildWpCliCommand, buildWpeSshArgs, escapeShellArg, WPE_SSH_TIMEOUT_MS,
} from './ssh-args';

type RawSshResult = { code: number | null; stdout: string; stderr: string; spawnError?: string };

function runSsh(installName: string, remoteCommand: string): Promise<RawSshResult> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    const proc = spawn('ssh', buildWpeSshArgs(installName, remoteCommand), {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: WPE_SSH_TIMEOUT_MS,
    });
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    proc.on('close', (code) => resolve({ code, stdout, stderr }));
    proc.on('error', (err: Error) => resolve({ code: null, stdout: '', stderr: '', spawnError: err.message }));
  });
}

export class WpeSshTransport implements SiteTransport {
  readonly kind: TransportKind = 'wpe-ssh';
  readonly siteRef: SiteRef;

  constructor(private readonly installName: string) {
    this.siteRef = { kind: 'wpe', installName };
  }

  async runWpCli(args: string[], opts?: RunOpts): Promise<WpCliResult> {
    const res = await runSsh(this.installName, buildWpCliCommand(args, opts));
    if (res.spawnError !== undefined) return { stdout: res.spawnError, success: false };
    if (res.code === 0) return { stdout: res.stdout, success: true };
    // Legacy shape: prefer stderr, fall back to the exit code.
    return { stdout: res.stderr || `SSH exited with code ${res.code}`, success: false };
  }

  async deleteRemoteFile(absolutePath: string): Promise<DeleteResult> {
    const res = await runSsh(this.installName, `rm -f ${escapeShellArg(absolutePath)}`);
    if (res.spawnError !== undefined) return { success: false, output: res.spawnError };
    // Legacy shape: prefer stdout — deliberately the opposite of runWpCli.
    return { success: res.code === 0, output: res.stdout || res.stderr };
  }

  async probe(): Promise<ProbeResult> {
    const res = await this.runWpCli(['cli', 'version']);
    return res.success
      ? { reachable: true, wpCliVersion: (res.stdout ?? '').trim() }
      : { reachable: false, detail: res.stdout ?? undefined };
  }
}
