import { spawn } from 'child_process';
import type { WpCliResult } from '../mcp/local-services-bridge';
import type {
  DeleteResult, ProbeResult, RunOpts, SiteRef, SiteTransport, TransportKind,
} from './types';
import {
  buildWpCliCommand, buildWpeSshArgs, buildWpeSshExitArgs, escapeShellArg, WPE_SSH_TIMEOUT_MS,
} from './ssh-args';
import { describeRemoteFailure } from '../mcp/utils/remoteFailure';

type RawSshResult = {
  code: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  elapsedMs: number;
  spawnError?: string;
};

function runSsh(installName: string, remoteCommand: string): Promise<RawSshResult> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    const startedAt = Date.now();
    const proc = spawn('ssh', buildWpeSshArgs(installName, remoteCommand), {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: WPE_SSH_TIMEOUT_MS,
    });
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    // `signal` and elapsed time are captured because a timeout is a SIGTERM kill with no exit
    // code — without them a call abandoned at the deadline is indistinguishable from WP-CLI
    // returning an error, which is half of what describeRemoteFailure exists to fix.
    proc.on('close', (code, signal) => resolve({
      code, signal, stdout, stderr, elapsedMs: Date.now() - startedAt,
    }));
    proc.on('error', (err: Error) => resolve({
      code: null, signal: null, stdout: '', stderr: '', elapsedMs: Date.now() - startedAt, spawnError: err.message,
    }));
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
    // Was `res.stderr || \`SSH exited with code ${res.code}\``, which reported whatever
    // happened to be on stderr as the cause — on a real WP Engine install that made a 35s
    // timeout surface as OpenSSH's post-quantum key-exchange advisory. Lead with the actual
    // failure, keep the output as context.
    return {
      stdout: describeRemoteFailure({
        code: res.code,
        signal: res.signal,
        stderr: res.stderr,
        elapsedMs: res.elapsedMs,
        timeoutMs: WPE_SSH_TIMEOUT_MS,
      }),
      success: false,
    };
  }

  /**
   * Hand the multiplexed connection back.
   *
   * WP Engine allows FIVE concurrent SSH connections PER USER, account-wide,
   * and `ControlPersist` keeps each install's master alive for ten minutes
   * after its last command. That is a good trade for an agent hitting one
   * install repeatedly, and a bad one for a sweep that visits each install
   * exactly once: the masters accumulate, cross the account limit, and every
   * further install is refused at authentication in under 100ms. Measured
   * 2026-08-23 — 82 live sockets against a limit of 5, with the server saying
   * so verbatim.
   *
   * Best-effort and never throws. A socket that has already aged out makes
   * `ssh -O exit` exit non-zero, which is not a failure of the caller's work;
   * and failing to release a connection must never turn a completed index
   * into a reported error.
   */
  async closeMaster(): Promise<void> {
    await new Promise<void>((resolve) => {
      try {
        const proc = spawn('ssh', buildWpeSshExitArgs(this.installName), {
          stdio: ['ignore', 'ignore', 'ignore'],
          timeout: 10_000,
        });
        proc.on('close', () => resolve());
        proc.on('error', () => resolve());
      } catch {
        resolve();
      }
    });
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
