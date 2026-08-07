import { buildExternalSshArgs, buildExternalWpCliCommand } from '../transport/ssh-args';
import { captureOfferedHostKey } from './hostKeyTrust';
import { defaultSshExec, resolveSshConfig } from './sshExec';
import type { RawSshResult, ResolvedSshConfig, SshExec } from './sshExec';

export type ProbeFailureKind =
  | 'alias-not-found'
  | 'auth-failed'
  | 'unreachable'
  | 'wp-cli-missing'
  | 'wordpress-not-found'
  | 'multiple-wordpress'
  | 'host-key-unknown'
  | 'host-key-changed';

export interface ProbeFailure {
  kind: ProbeFailureKind;
  /** ssh's or WP-CLI's own words, verbatim — that is what a user can search for. */
  detail: string;
  /** A command or concrete action, never advice. */
  remedy: string;
  /** Populated only for kind === 'host-key-unknown', and only when captureOfferedHostKey succeeded. */
  fingerprint?: string;
  /** Populated only alongside fingerprint. */
  keyType?: string;
}

export interface ProbeReport {
  ok: boolean;
  alias: string;
  resolved: ResolvedSshConfig;
  /** Absolute path to WP-CLI when it is off PATH. Undefined means plain `wp`. */
  wpCliPath?: string;
  wpCliVersion?: string;
  wpPath?: string;
  wpVersion?: string;
  /** From `option get siteurl`. Absent when the DB is unreachable — not a failure. */
  siteUrl?: string;
  /**
   * The WordPress roots discovery found, set ONLY when there was more than one
   * and the probe therefore refused with `multiple-wordpress`. Undefined
   * everywhere else — a `--path` run, and a search that resolved to exactly one
   * root, are both "nothing to choose between", and a one-element array said
   * the opposite to anyone reading `candidates?.length`.
   */
  candidates?: string[];
  failure?: ProbeFailure;
}

export interface ProbeOptions {
  wpPath?: string;
  exec?: SshExec;
}

/**
 * TCP connect only, not the session. Short on purpose: an unreachable host
 * should fail while the user is watching rather than burn a whole step timeout
 * on a SYN that is never answered.
 */
const CONNECT_TIMEOUT_SEC = 10;
/**
 * Per-step ceiling for the commands that only print — `command -v wp`, the
 * fallback-path loop, `wp --version`, `wp core version`, `option get siteurl`.
 * Generous for a print, deliberately: WP-CLI boots WordPress, and on a cold,
 * oversubscribed shared host that genuinely takes seconds.
 */
const STEP_TIMEOUT_MS = 20000;
/** Discovery walks the filesystem; it gets longer than a command that just prints. */
const DISCOVERY_TIMEOUT_MS = 30000;

/**
 * THE SUM HAS A CONSEQUENCE. These timeouts are sequential, so a probe that
 * hits every ceiling legitimately runs for
 *
 *   SSH_CONFIG_DUMP_TIMEOUT_MS (5s, sshExec.ts)
 *   + 6 x STEP_TIMEOUT_MS (connect, `command -v wp`, fallback search,
 *       `--version`, `core version`, `option get siteurl`)
 *   + DISCOVERY_TIMEOUT_MS (30s)
 *   = 155s
 *
 * before it returns anything at all. A client that gives up sooner does not
 * cancel the probe — `nexus host add` would print a timeout and exit 1 while
 * this function goes on to succeed and register the host, reporting failure for
 * an operation that worked. HOST_PROBE_CLIENT_TIMEOUT_MS in
 * src/cli/commands/host.ts must therefore stay above this sum; raise any
 * timeout above and raise that one too.
 *
 * The host-key-capture step (HOST_KEY_CAPTURE_TIMEOUT_MS, 15s, in
 * hostKeyTrust.ts) is NOT part of this sum. It only runs on the
 * 'host key verification failed' branch of Gate 1 above, which returns
 * immediately afterward rather than continuing on to the other gates — it
 * can never stack with the other six steps or with discovery. The 155s
 * ceiling above still describes the full happy-path/other-failure sequence
 * accurately.
 */

/** Roots searched for wp-config.php, and the depth limit. Never an unbounded walk. */
const SEARCH_ROOTS = ['"$HOME"', '/var/www/html', '/srv/www'];
/**
 * 4, because Hostinger's layout is ~/domains/<site>/public_html/wp-config.php —
 * exactly four levels below $HOME. Three would miss the case that motivated
 * discovery in the first place.
 */
const SEARCH_MAXDEPTH = 4;

/**
 * Where WP-CLI hides when the login shell's PATH is not the non-interactive
 * PATH — the likelier failure by far, since ~/.bashrc commonly early-returns
 * when there is no tty.
 */
const WP_CLI_FALLBACK_PATHS = [
  '/usr/local/bin/wp',
  '"$HOME/bin/wp"',
  '/opt/cpanel/composer/bin/wp',
  '/usr/bin/wp',
];

const WP_CLI_INSTALL_REMEDY =
  'Install WP-CLI on the host, then re-run:\n'
  + '  curl -O https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar\n'
  + '  chmod +x wp-cli.phar && sudo mv wp-cli.phar /usr/local/bin/wp\n'
  + 'Nexus does not install anything on your server.';

function fail(
  alias: string,
  resolved: ResolvedSshConfig,
  kind: ProbeFailureKind,
  detail: string,
  remedy: string,
  extra: Partial<ProbeReport> = {},
  failureExtra: Partial<Pick<ProbeFailure, 'fingerprint' | 'keyType'>> = {},
): ProbeReport {
  return { ok: false, alias, resolved, ...extra, failure: { kind, detail: detail.trim(), remedy, ...failureExtra } };
}

/** Text a caller should treat as the reason, whether ssh failed locally or remotely. */
function reason(res: RawSshResult): string {
  return (res.spawnError ?? res.stderr ?? '').trim();
}

export async function probeExternalHost(alias: string, opts: ProbeOptions = {}): Promise<ProbeReport> {
  const exec = opts.exec ?? defaultSshExec;
  const resolved = await resolveSshConfig(alias, exec);

  const run = (command: string, timeoutMs = STEP_TIMEOUT_MS) =>
    exec(buildExternalSshArgs(alias, command, { connectTimeoutSec: CONNECT_TIMEOUT_SEC }), timeoutMs);

  // ---- Gate 1: can we connect at all? -------------------------------------
  const connect = await run('echo nexus-ok');
  if (connect.code !== 0 || !connect.stdout.includes('nexus-ok')) {
    const detail = reason(connect) || `ssh exited with code ${connect.code}`;

    if (/could not resolve hostname/i.test(detail)) {
      return fail(alias, resolved, 'alias-not-found', detail,
        `'${alias}' is not a host ssh can reach. If it is meant to be an SSH alias, add it to ~/.ssh/config:\n\n`
        + `  Host ${alias}\n`
        + `      HostName <server-ip-or-domain>\n`
        + `      User <ssh-username>\n`
        + `      Port 22\n\n`
        + `Then re-run: nexus host test ${alias}`);
    }

    if (/permission denied/i.test(detail)) {
      const account = resolved.user ? `${resolved.user}@${resolved.hostname}` : resolved.hostname;
      return fail(alias, resolved, 'auth-failed', detail,
        `Key-based login is not set up. Copy your public key to the host (it will ask for your password once):\n\n`
        + `  ssh-copy-id -i ~/.ssh/id_ed25519.pub -p ${resolved.port} ${account}\n\n`
        + `Then re-run: nexus host test ${alias}\n`
        + `Nexus does not run this for you — it will not handle your password.`);
    }

    if (/REMOTE HOST IDENTIFICATION HAS CHANGED/i.test(detail)) {
      return fail(alias, resolved, 'host-key-changed', detail,
        `The key that '${alias}' (${resolved.hostname}) now presents does not match what was trusted `
        + `before. This can mean the server was reinstalled or replaced, or that something is `
        + `intercepting your connection. Verify the new fingerprint against your hosting `
        + `provider's control panel or SSH access log before trusting it. If you're sure it's `
        + `legitimate, remove the stale entry yourself and re-run this command:\n\n`
        + `  ssh-keygen -R ${resolved.hostname}\n`);
    }

    if (/host key verification failed/i.test(detail)) {
      const captured = await captureOfferedHostKey(alias, exec);
      if (captured) {
        return fail(alias, resolved, 'host-key-unknown', detail,
          `New host key for '${alias}' (${resolved.hostname}):\n  ${captured.keyType} ${captured.fingerprint}\n\n`
          + `Approve it in Local → Settings → Nexus AI → External Hosts, then re-run this command.`,
          {}, { fingerprint: captured.fingerprint, keyType: captured.keyType });
      }
      return fail(alias, resolved, 'host-key-unknown', detail,
        `Could not fetch the host's key to display a fingerprint (the host may have become `
        + `unreachable) — re-run:\n  nexus host test ${alias}`);
    }

    return fail(alias, resolved, 'unreachable', detail,
      `Check the host is up and the alias is right:\n  ssh -v ${alias}`);
  }

  // ---- Gate 2: locate WP-CLI ----------------------------------------------
  let wpCliPath: string | undefined;
  const onPath = await run('command -v wp 2>/dev/null');
  if (onPath.code !== 0 || !onPath.stdout.trim()) {
    // Not on the non-interactive PATH. Look where it usually is before
    // concluding it is absent — Nexus never installs it either way.
    const search = `for p in ${WP_CLI_FALLBACK_PATHS.join(' ')}; do [ -x "$p" ] && printf '%s\\n' "$p" && break; done`;
    const found = await run(search);
    const hit = found.stdout.trim().split('\n')[0]?.trim();
    if (!hit) {
      return fail(alias, resolved, 'wp-cli-missing',
        reason(onPath) || 'wp: command not found', WP_CLI_INSTALL_REMEDY);
    }
    wpCliPath = hit;
  }

  const wpCli = (args: string[], wpPath?: string) =>
    buildExternalWpCliCommand(args, wpPath, wpCliPath);

  const cliVersion = await run(wpCli(['--version']));
  const wpCliVersion = /WP-CLI\s+(\S+)/i.exec(cliVersion.stdout)?.[1];

  // ---- Gate 3: find the WordPress root ------------------------------------
  let wpPath = opts.wpPath;

  if (!wpPath) {
    // Bounded: fixed roots, fixed depth. `2>/dev/null` swallows unreadable and
    // nonexistent roots, so the exit code is meaningless here — judge by output.
    // -L: follow symlinks, including a symlinked $HOME itself (confirmed live
    // on a real SiteGround connection, whose home directory is a symlink).
    // Without it `find` treats the symlink as an unreadable leaf and finds
    // nothing, even though the real WordPress root is a few levels through it.
    const find =
      `find -L ${SEARCH_ROOTS.join(' ')} -maxdepth ${SEARCH_MAXDEPTH} -name wp-config.php -type f 2>/dev/null | head -20`;
    const found = await run(find, DISCOVERY_TIMEOUT_MS);
    const roots = Array.from(new Set(
      found.stdout.split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .map((f) => f.replace(/\/wp-config\.php$/, '')),
    ));

    if (roots.length === 0) {
      return fail(alias, resolved, 'wordpress-not-found',
        `No wp-config.php found within ${SEARCH_MAXDEPTH} levels of ${SEARCH_ROOTS.join(', ')}.`,
        `Point Nexus at it directly:\n  nexus host add ${alias} --path /absolute/path/to/wordpress`,
        { wpCliPath, wpCliVersion });
    }
    if (roots.length > 1) {
      return fail(alias, resolved, 'multiple-wordpress',
        `Found ${roots.length} WordPress installations:\n${roots.map((r) => `  ${r}`).join('\n')}`,
        `Choose one:\n  nexus host add ${alias} --path ${roots[0]}`,
        { wpCliPath, wpCliVersion, candidates: roots });
    }
    // Exactly one root: no ambiguity, so no candidates. See the field's docblock.
    wpPath = roots[0];
  }

  // ---- Gate 4: is it really WordPress? ------------------------------------
  const core = await run(wpCli(['core', 'version'], wpPath));
  if (core.code !== 0) {
    return fail(alias, resolved, 'wordpress-not-found',
      reason(core) || `wp core version exited with code ${core.code}`,
      `Check the path, then re-run:\n  nexus host add ${alias} --path <correct-path>`,
      { wpCliPath, wpCliVersion, wpPath });
  }

  // Best-effort. `option get` needs a working DB connection, and a broken DB is
  // not a reason to refuse a host whose files and WP-CLI are fine.
  const site = await run(wpCli(['option', 'get', 'siteurl'], wpPath));
  const siteUrl = site.code === 0 ? site.stdout.trim() || undefined : undefined;

  return {
    ok: true,
    alias,
    resolved,
    wpCliPath,
    wpCliVersion,
    wpPath,
    wpVersion: core.stdout.trim(),
    siteUrl,
  };
}
