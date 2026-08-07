/**
 * SSH argument builders for two opposing families: WP Engine and external hosts.
 *
 * WP Engine builders (buildWpeSshArgs, buildWpCliCommand) pass `-F /dev/null` to
 * enforce reproducibility and ignore user SSH config. External builders
 * (buildExternalSshArgs, buildExternalWpCliCommand) do NOT — they depend
 * entirely on the user's ~/.ssh/config for credentials and routing.
 *
 * The WPE argv is pinned by tests/unit/transport/ssh-argv-characterization.test.ts.
 * Changing it changes how Nexus reaches every production install — don't, casually.
 */
import * as path from 'path';
import * as os from 'os';

/** WPE SSH cold-start runs 13–30s; ControlMaster reuse brings later calls to 1–3s. */
export const WPE_SSH_TIMEOUT_MS = 35000;

export function wpeSshKeyPath(): string {
  const userDataPath = (process as any).electronPaths?.userDataPath
    ?? path.join(os.homedir(), 'Library', 'Application Support', 'Local');
  return path.join(userDataPath, 'ssh', 'wpe-connect');
}

export function escapeShellArg(arg: string): string {
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

/**
 * An SSH host alias that is safe to place in ssh's argv.
 *
 * Deliberately narrower than what ssh itself accepts. `Host` patterns may in
 * principle contain more, but everything a real alias needs is here and the
 * class of value this excludes is the dangerous one.
 */
const SAFE_SSH_ALIAS = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Reject an alias that ssh would not read as a hostname.
 *
 * CLOSES AN ARGV-INJECTION CLASS — do not delete this as redundant with a
 * caller-side check. ssh reads its first non-option argument as `[user@]host`,
 * so an alias beginning with `-` is parsed as an *option* instead:
 * `-oProxyCommand=<cmd>` in argv position makes ssh execute `<cmd>` on the
 * local machine. No amount of quoting downstream helps, because the value never
 * reaches a shell — it is argv.
 *
 * Not reachable through today's call sites: the remote command is the only
 * other positional and always contains a space, so ssh rejects the invocation
 * with `hostname contains invalid characters` before dialling. That is an
 * accident of the current command set, not a guarantee —
 * `buildExternalWpCliCommand([])` already returns a bare `wp`, and one
 * single-token remote command would make this live.
 *
 * Enforced HERE rather than in `nexus host add` / `nexus host test` / the
 * target parser because this module is the only place an SSH invocation is
 * constructed (see the module docblock). Every entry point — the host
 * commands, `ssh:<alias>@<env>` targets, and anything added later — therefore
 * passes through it by construction, with no per-command copy to forget.
 */
export function assertSafeSshAlias(alias: string): void {
  if (!SAFE_SSH_ALIAS.test(alias)) {
    throw new Error(
      `Invalid SSH host alias '${alias}'. An alias must start with a letter or digit `
      + 'and may contain only letters, digits, dots, hyphens and underscores.',
    );
  }
}

/**
 * Build a WP-CLI command string for SSH execution.
 *
 * `--skip-plugins` and `--skip-themes` are emitted INDEPENDENTLY, each
 * defaulting to on. A caller that wants neither must now say so explicitly:
 * `{ skipPlugins: false, skipThemes: false }`.
 *
 * This used to be one all-or-nothing ternary — `skipPlugins: false` zeroed the
 * whole flag string and silently discarded `skipThemes`. That was documented
 * here as an unreachable hazard, because ALLOWED_REMOTE_COMMANDS blocked
 * `theme activate` before it could dispatch. Unifying the surfaces deleted that
 * whitelist (transport/policy.ts), which made the hazard live:
 * `wp_theme_activate` passes `{ skipPlugins: false, skipThemes: true }` and was
 * emitting a bare `wp 'theme' 'activate' '<slug>'` on WP Engine. The dropped
 * flag was `--skip-themes`, and dropping it defeats the only reason that tool
 * exists: it could no longer activate a replacement theme on an install whose
 * current theme fatals on bootstrap, because WP-CLI loads that theme first.
 *
 * The absence of `--skip-plugins` in that command is NOT part of the bug.
 * `theme-activate.ts:51` asks for it deliberately, so plugins load and their
 * `switch_theme` hooks fire — presumably on purpose, since a theme switch that
 * skipped plugins would miss legitimate integrations. Only the flag the caller
 * asked for and did not get was a regression.
 *
 * The no-opts argv is byte-identical to before, and both it and the
 * both-flags-off form are pinned by
 * tests/unit/transport/ssh-argv-characterization.test.ts.
 */
export function buildWpCliCommand(
  args: string[],
  opts?: { skipPlugins?: boolean; skipThemes?: boolean },
): string {
  const skipFlags = [
    opts?.skipPlugins === false ? null : '--skip-plugins',
    opts?.skipThemes === false ? null : '--skip-themes',
  ].filter(Boolean).join(' ');
  return `wp ${skipFlags} ${args.map(escapeShellArg).join(' ')}`.trim();
}

/**
 * WP Engine SSH args. Passes `-F /dev/null` deliberately to enforce
 * reproducibility and ignore user SSH config — WPE credentials are managed
 * internally and routing is standard.
 *
 * INVERTED in buildExternalSshArgs: that function depends on the user's
 * ~/.ssh/config entirely and must NOT pass -F /dev/null. See that function's
 * comment before adding any new builder.
 */
export function buildWpeSshArgs(
  installName: string,
  remoteCommand: string,
  keyPath: string = wpeSshKeyPath(),
): string[] {
  return [
    '-F', '/dev/null',
    '-o', 'IdentitiesOnly=yes',
    '-o', 'PubkeyAcceptedKeyTypes=+ssh-rsa',
    '-o', 'ServerAliveInterval=60',
    '-o', 'ServerAliveCountMax=120',
    '-o', 'StrictHostKeyChecking=accept-new',
    '-o', 'ControlMaster=auto',
    '-o', 'ControlPath=/tmp/ssh-nexus-%C',
    '-o', 'ControlPersist=30s',
    '-i', keyPath,
    `local+ssh+${installName}@${installName}.ssh.wpengine.net`,
    remoteCommand,
  ];
}

/**
 * Shorter than WPE's 35s: there is no managed-hosting cold start to wait for,
 * and a hung SSH to an unreachable box should fail while the user is watching.
 */
export const EXTERNAL_SSH_TIMEOUT_MS = 20000;

/**
 * Batches run several WP-CLI invocations in ONE SSH session — Batch A alone is 18.
 * Measured against a real shared host: 22-23.5s across three runs, already over
 * EXTERNAL_SSH_TIMEOUT_MS's 20s single-command budget. When that fired, spawn
 * SIGTERMed the child and the parser read whatever partial stdout had arrived:
 * the trailing sections came back null, honest but silently incomplete, every time.
 *
 * 60s is that measured figure times a comfortable margin over the largest current
 * batch, not a guess. Grow the batch and re-measure before trusting it.
 */
export const EXTERNAL_SSH_BATCH_TIMEOUT_MS = 60000;

/**
 * WP-CLI command for an arbitrary host.
 *
 * No --skip-plugins/--skip-themes: those exist for WP Engine's mu-plugin
 * environment, and suppressing plugins on someone else's host would change what
 * `wp` reports without them asking.
 *
 * `wpPath` is optional. Omitted, WP-CLI searches upward from the SSH login
 * directory — which is the web root on many hosts, so the common case needs no
 * flag at all. `wpPath` must be absolute — `~` will not expand because the
 * argument is escaped (no shell expansion occurs on a single-quoted string).
 *
 * `wpCliBin` is the absolute path to WP-CLI when it is not on the remote's
 * non-interactive PATH — the common failure, since ~/.bashrc frequently
 * early-returns when there is no tty. Undefined means plain `wp`. It is third,
 * not second: swapping it with wpPath compiles (both are `string | undefined`)
 * and silently transposes the one existing call site.
 */
export function buildExternalWpCliCommand(args: string[], wpPath?: string, wpCliBin?: string): string {
  const bin = wpCliBin ? escapeShellArg(wpCliBin) : 'wp';
  const pathFlag = wpPath ? `--path=${escapeShellArg(wpPath)} ` : '';
  return `${bin} ${pathFlag}${args.map(escapeShellArg).join(' ')}`.trim();
}

/**
 * Delimiter prefix for batched WP-CLI output. The full marker is
 * `<<<NEXUS:N>>>` where N is the 1-based index of the command that just ran.
 *
 * Indexed, not bare, on purpose: a sub-command that fails prints nothing, and a
 * host that dies mid-stream stops emitting entirely. With bare delimiters both
 * cases would shift every later section onto the wrong field. With indices the
 * parser can leave the gap as null.
 */
export const WP_CLI_BATCH_DELIMITER = '<<<NEXUS:';

/**
 * Several WP-CLI commands as ONE remote command, so they cost one SSH
 * handshake instead of N.
 *
 * buildExternalSshArgs sets no ControlMaster (see its docblock — forcing
 * multiplexing onto an arbitrary host is not safe the way it is onto WP
 * Engine), so without batching a 16-command refresh would be 16 full
 * handshakes.
 *
 * Every argument goes through escapeShellArg via buildExternalWpCliCommand.
 * The command set is fixed and closed at the call site; no caller-supplied
 * string reaches the shell unescaped.
 */
export function buildExternalWpCliBatch(
  commands: string[][],
  wpPath?: string,
  wpCliBin?: string,
): string {
  if (commands.length === 0) return '';
  return commands
    .map((args, i) =>
      // `echo;` forces a newline before the delimiter regardless of whether the
      // command's own output ended in one — WP-CLI's --format=count and some
      // --format=json output do not. Without it, the delimiter glues onto the
      // previous line, the anchored regex in parseWpCliBatchOutput never matches,
      // and the parser silently folds that command's output (plus the literal,
      // now-unrecognised marker text) into whichever section closes next — a
      // WRONG value, not a missing one. The extra blank line this adds is
      // absorbed by parseWpCliBatchOutput's existing `.trim()`.
      `${buildExternalWpCliCommand(args, wpPath, wpCliBin)}; echo; echo '${WP_CLI_BATCH_DELIMITER}${i + 1}>>>'`)
    .join('; ');
}

/**
 * Split batched stdout back into one entry per command.
 *
 * Returns exactly `expectedCount` entries. An entry is null when its
 * sub-command produced no output, or when its delimiter never arrived because
 * the connection dropped. Never returns fewer entries and never shifts output
 * from one command onto another — a wrong-but-plausible value is worse than a
 * missing one.
 *
 * The batch's exit code is only the LAST sub-command's, so callers must not
 * gate on it. This parse is the source of truth.
 */
export function parseWpCliBatchOutput(
  stdout: string,
  expectedCount: number,
): (string | null)[] {
  const sections: (string | null)[] = new Array(expectedCount).fill(null);
  if (!stdout) return sections;

  // Capture the index from each marker so gaps stay gaps.
  const markerRe = new RegExp(`^${WP_CLI_BATCH_DELIMITER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\d+)>>>$`);
  let buffer: string[] = [];

  for (const line of stdout.split('\n')) {
    const m = line.trim().match(markerRe);
    if (m) {
      const idx = parseInt(m[1], 10) - 1;
      const text = buffer.join('\n').trim();
      if (idx >= 0 && idx < expectedCount) {
        sections[idx] = text === '' ? null : text;
      }
      buffer = [];
      continue;
    }
    buffer.push(line);
  }

  return sections;
}

/**
 * INVERTED RULE — read before changing.
 *
 * This must NOT pass `-F /dev/null`. buildWpeSshArgs passes it deliberately so
 * WP Engine connections ignore the user's SSH config and stay reproducible.
 * This function depends on that config entirely: the alias supplies host, user,
 * port, key, ProxyJump and agent settings, which is the whole reason
 * alias-based credentials were chosen and why no key material is stored.
 *
 * Adding -F /dev/null here would break every bastion and jump-host setup and
 * would present as a network fault rather than a code defect.
 *
 * BatchMode=yes prevents ssh prompting for a password on a non-tty, which would
 * hang the spawn until the timeout instead of failing immediately.
 *
 * connectTimeoutSec bounds the TCP connect only, not the session. The probe
 * sets it so an unreachable host fails while the user is watching instead of
 * waiting out the full spawn timeout.
 */
export function buildExternalSshArgs(
  alias: string,
  remoteCommand: string,
  opts?: { connectTimeoutSec?: number },
): string[] {
  assertSafeSshAlias(alias);
  const connectTimeout = opts?.connectTimeoutSec
    ? ['-o', `ConnectTimeout=${opts.connectTimeoutSec}`]
    : [];
  return [
    '-o', 'BatchMode=yes',
    ...connectTimeout,
    alias,
    remoteCommand,
  ];
}

/** Seconds, not ms — matches ssh's own `-o ConnectTimeout=N` unit. */
export const HOST_KEY_CAPTURE_CONNECT_TIMEOUT_SEC = 10;
/** The whole capture is one trivial `exit` — short, like the connect-only gate it mirrors. */
export const HOST_KEY_CAPTURE_TIMEOUT_MS = 15000;

/**
 * Connect through the alias just far enough to receive its offered host key,
 * writing it to an ISOLATED temp known_hosts file rather than the real one.
 *
 * `StrictHostKeyChecking=accept-new` here does not grant real trust — it only
 * lets ssh proceed past the handshake so the key can be inspected. Confirmed
 * live: the key is written to `tempKnownHostsFile` even when the subsequent
 * `exit` fails to authenticate, because host-key exchange happens before auth.
 * Nothing is written to the caller's REAL known_hosts by this call.
 *
 * Must NOT pass -F /dev/null, for the same reason as buildExternalSshArgs:
 * this has to traverse whatever ProxyJump/port/user/identity the alias
 * specifies, which is also why ssh-keyscan (no ProxyJump support) cannot be
 * used for this instead.
 */
export function buildHostKeyCaptureArgs(alias: string, tempKnownHostsFile: string): string[] {
  assertSafeSshAlias(alias);
  return [
    '-o', 'BatchMode=yes',
    '-o', `ConnectTimeout=${HOST_KEY_CAPTURE_CONNECT_TIMEOUT_SEC}`,
    '-o', 'StrictHostKeyChecking=accept-new',
    '-o', `UserKnownHostsFile=${tempKnownHostsFile}`,
    alias,
    'exit',
  ];
}

/**
 * Ask ssh to print the config it would use for an alias (hostname, user, port).
 *
 * Resolution, NOT validation: `ssh -G` exits 0 for an alias that appears in no
 * config file, returning the literal alias as hostname, the local username, and
 * port 22. It cannot distinguish a configured alias from a typo, so nothing may
 * gate on its exit code. Its output exists to build an accurate ssh-copy-id
 * remedy; connectivity is what actually validates the alias.
 *
 * No -F /dev/null, for the same reason as buildExternalSshArgs.
 */
export function buildSshConfigDumpArgs(alias: string): string[] {
  assertSafeSshAlias(alias);
  return ['-G', alias];
}
