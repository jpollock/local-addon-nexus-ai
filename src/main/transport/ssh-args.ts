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
 * Build a WP-CLI command string for SSH execution.
 *
 * HAZARD: the ternary is all-or-nothing. RunOpts accepts skipThemes, but this
 * function does not honour it. skipPlugins: false zeroes the entire flag string,
 * stripping BOTH --skip-plugins and --skip-themes.
 *
 * Unreachable today: theme-activate.ts passes skipPlugins=false but the command
 * is blocked before dispatch. If ALLOWED_REMOTE_COMMANDS ever whitelists theme
 * activate, both flags must be honoured independently at that time.
 */
export function buildWpCliCommand(args: string[], opts?: { skipPlugins?: boolean }): string {
  const skipFlags = opts?.skipPlugins === false ? '' : '--skip-plugins --skip-themes';
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
  return ['-G', alias];
}
