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
