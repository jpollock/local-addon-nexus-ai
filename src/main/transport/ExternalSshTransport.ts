import { spawn } from 'child_process';
import type { WpCliResult } from '../mcp/local-services-bridge';
import type {
  DeleteResult, ProbeResult, RunOpts, SiteRef, SiteTransport, TransportKind,
} from './types';
import {
  buildExternalSshArgs, buildExternalWpCliCommand, buildExternalWpCliBatch,
  parseWpCliBatchOutput, EXTERNAL_SSH_TIMEOUT_MS, EXTERNAL_SSH_BATCH_TIMEOUT_MS,
} from './ssh-args';

type RawSshResult = { code: number | null; stdout: string; stderr: string; spawnError?: string };

/**
 * `timeoutMs` is a parameter, not the module constant, because a batch of 18
 * WP-CLI invocations in one session takes measurably longer than the single
 * command EXTERNAL_SSH_TIMEOUT_MS was sized for. See EXTERNAL_SSH_BATCH_TIMEOUT_MS.
 */
function runSsh(alias: string, remoteCommand: string, timeoutMs: number = EXTERNAL_SSH_TIMEOUT_MS): Promise<RawSshResult> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    const proc = spawn('ssh', buildExternalSshArgs(alias, remoteCommand), {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: timeoutMs,
    });
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    proc.on('close', (code) => resolve({ code, stdout, stderr }));
    proc.on('error', (err: Error) => resolve({ code: null, stdout: '', stderr: '', spawnError: err.message }));
  });
}

/**
 * Turn two common remote failures into actionable messages. Both are expected
 * in this milestone — WP-CLI provisioning and wp-config discovery are
 * deliberately deferred — so the user should be told it is a known gap rather
 * than left guessing at a bug.
 */
function annotateFailure(stderr: string): string {
  const text = stderr.trim();
  if (/command not found|wp: not found/i.test(text)) {
    return `${text}\n\nHint: WP-CLI ('wp') was not found on the remote host's non-interactive `
      + `PATH. Run 'nexus host test <alias>' — it searches the usual locations and will tell you `
      + `whether WP-CLI is missing or just off PATH.`;
  }
  if (/does not seem to be a WordPress installation/i.test(text)) {
    return `${text}\n\nHint: pass --path=/path/to/wordpress if WordPress is not in the `
      + `SSH login directory.`;
  }
  if (/REMOTE HOST IDENTIFICATION HAS CHANGED/i.test(text)) {
    return `${text}\n\nThis host's key no longer matches what was trusted before — this can mean `
      + `the server was reinstalled, or that something is intercepting your connection. Run `
      + `'nexus host test <alias>' for details before doing anything else.`;
  }
  if (/host key verification failed/i.test(text)) {
    return `${text}\n\nHint: this host's identity has never been verified. Run `
      + `'nexus host test <alias>' — it will show the key's fingerprint and where to approve it.`;
  }
  return text;
}

/**
 * WP-CLI over SSH to an arbitrary host, addressed by a ~/.ssh/config alias.
 *
 * Deliberately holds no credentials: the alias carries host, user, port, key,
 * ProxyJump and agent settings. See buildExternalSshArgs for why this transport
 * must not pass -F /dev/null.
 */
export class ExternalSshTransport implements SiteTransport {
  readonly kind: TransportKind = 'external-ssh';
  readonly siteRef: SiteRef;

  constructor(
    readonly alias: string,
    readonly wpPath?: string,
    /** Absolute WP-CLI path when it is off the remote's PATH; undefined means `wp`. */
    readonly wpCliBin?: string,
    /**
     * True when this connection's remote user is root — emits --allow-root on
     * every WP-CLI command, otherwise WP-CLI refuses to run at all. Sourced
     * from the connection profile's `allowRoot` field, not the site row: it is
     * a property of who you connect as, shared by every site under the
     * connection.
     */
    readonly allowRoot?: boolean,
  ) {
    this.siteRef = { kind: 'external', alias };
  }

  async runWpCli(args: string[], _opts?: RunOpts): Promise<WpCliResult> {
    const res = await runSsh(this.alias, buildExternalWpCliCommand(args, this.wpPath, this.wpCliBin, this.allowRoot));
    if (res.spawnError !== undefined) return { stdout: res.spawnError, success: false };
    if (res.code === 0) return { stdout: res.stdout, success: true };
    // Timeout: spawn kills the child with SIGTERM, yielding code=null and empty stderr
    if (res.code === null && !res.stderr.trim()) {
      return {
        stdout: `SSH to '${this.alias}' timed out after ${EXTERNAL_SSH_TIMEOUT_MS / 1000}s (no response). Check the host is reachable and the alias is correct.`,
        success: false,
      };
    }
    return {
      stdout: annotateFailure(res.stderr) || `SSH exited with code ${res.code}`,
      success: false,
    };
  }

  /**
   * Run several WP-CLI commands in ONE SSH round trip.
   *
   * Returns one entry per command, null where that command produced nothing.
   * Deliberately does not surface the exit code: a compound command's status is
   * only its last sub-command's, so it says nothing useful about the others.
   * A connection-level failure returns all nulls, which callers must treat as
   * "collected nothing" and NOT as "the site has nothing".
   */
  async runWpCliBatch(commands: string[][]): Promise<(string | null)[]> {
    if (commands.length === 0) return [];
    const remote = buildExternalWpCliBatch(commands, this.wpPath, this.wpCliBin, this.allowRoot);
    const res = await runSsh(this.alias, remote, EXTERNAL_SSH_BATCH_TIMEOUT_MS);
    if (res.spawnError !== undefined) return new Array(commands.length).fill(null);

    const parsed = parseWpCliBatchOutput(res.stdout, commands.length);

    // A timeout SIGTERMs the child, so partial stdout is parsed and the trailing
    // sections silently come back null. That is honest but invisible: without
    // this warning the only symptom is missing columns in the database hours
    // later. code === null with no stderr is the same timeout signature runWpCli
    // keys off.
    if (res.code === null && !res.stderr.trim()) {
      const missing = parsed.filter((v) => v === null).length;
      // eslint-disable-next-line no-console
      console.warn(
        `[NexusAI] Batched WP-CLI to '${this.alias}' timed out after `
        + `${EXTERNAL_SSH_BATCH_TIMEOUT_MS / 1000}s; ${missing} of ${commands.length} `
        + `commands produced no output and will be recorded as "not collected".`
      );
    }

    return parsed;
  }

  /**
   * Refused. Sentinel's raw-delete path targets WP Engine's /nas/content/live
   * layout and is WPE-only; nothing should be unlinking files on an arbitrary
   * host in this milestone.
   */
  async deleteRemoteFile(absolutePath: string): Promise<DeleteResult> {
    return {
      success: false,
      output: `deleteRemoteFile is not supported on external SSH hosts (path: ${absolutePath})`,
    };
  }

  async probe(): Promise<ProbeResult> {
    const res = await this.runWpCli(['cli', 'version']);
    return res.success
      ? { reachable: true, wpCliVersion: (res.stdout ?? '').trim() }
      : { reachable: false, detail: res.stdout ?? undefined };
  }
}
