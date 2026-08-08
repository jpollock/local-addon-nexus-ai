/**
 * Multi-issue probe for the External Host Onboarding wizard. Unlike the
 * existing probeExternalHost (early-return on the first failure, used by
 * `nexus host test`/`nexus host add` -- left unmodified), this runs every
 * check it can and returns EVERY issue found in one pass, per BEHAVIOR.md §3:
 * "All four rows stay visible at all times. Diagnosis is parallel."
 */
import { buildExternalSshArgs, buildExternalWpCliCommand } from '../transport/ssh-args';
import { captureOfferedHostKey } from './hostKeyTrust';
import { defaultSshExec, resolveSshConfig } from './sshExec';
import type { RawSshResult, ResolvedSshConfig, SshExec } from './sshExec';

export type IssueKind =
  | 'unknownHostKey' | 'changedHostKey'
  | 'authKeyNotLoaded' | 'authPassphraseNoAgent'
  | 'connRefused' | 'connTimeout' | 'proxyJumpFailed' | 'aliasNotFound'
  | 'rootUser'
  | 'wpCliMissing' | 'wpCliInteractivePathOnly'
  | 'wordPressNotFound';

export interface Issue {
  kind: IssueKind;
  title: string;
  detail: string;
  remedy: string;
  fingerprint?: string;
  keyType?: string;
  previousFingerprint?: string;
}

export type CheckState =
  | { status: 'ok' | 'warn' | 'fail'; detail: string }
  | { status: 'idle'; detail: string };

export interface MultiIssueProbeResult {
  checks: { connection: CheckState; hostKey: CheckState; wpCli: CheckState; installs: CheckState };
  issues: Issue[];
  resolved: ResolvedSshConfig;
  wpCli?: { path?: string; version: string };
  installs?: string[];
}

export interface MultiIssueProbeOptions {
  wpPath?: string;
  exec?: SshExec;
}

const CONNECT_TIMEOUT_SEC = 10;
const STEP_TIMEOUT_MS = 20000;
const DISCOVERY_TIMEOUT_MS = 30000;
const SEARCH_ROOTS = ['"$HOME"', '/var/www/html', '/srv/www'];
const SEARCH_MAXDEPTH = 4;
const WP_CLI_FALLBACK_PATHS = ['/usr/local/bin/wp', '"$HOME/bin/wp"', '/opt/cpanel/composer/bin/wp', '/usr/bin/wp'];

function reason(res: RawSshResult): string {
  return (res.spawnError ?? res.stderr ?? '').trim();
}

function idle(detail: string): CheckState { return { status: 'idle', detail }; }
function ok(detail: string): CheckState { return { status: 'ok', detail }; }
function warn(detail: string): CheckState { return { status: 'warn', detail }; }
function fail(detail: string): CheckState { return { status: 'fail', detail }; }

export async function probeHostMultiIssue(
  alias: string,
  opts: MultiIssueProbeOptions = {},
): Promise<MultiIssueProbeResult> {
  const exec = opts.exec ?? defaultSshExec;
  const resolved = await resolveSshConfig(alias, exec);
  const issues: Issue[] = [];

  const run = (command: string, timeoutMs = STEP_TIMEOUT_MS) =>
    exec(buildExternalSshArgs(alias, command, { connectTimeoutSec: CONNECT_TIMEOUT_SEC }), timeoutMs);

  const account = resolved.user ? `${resolved.user}@${resolved.hostname}` : resolved.hostname;

  // ---- Check 1: connection -------------------------------------------------
  const connect = await run('echo nexus-ok');
  let connectionState: CheckState;
  let hostKeyState: CheckState = idle('not reached');
  const canProceed = connect.code === 0 && connect.stdout.includes('nexus-ok');

  if (!canProceed) {
    const detail = reason(connect) || `ssh exited with code ${connect.code}`;
    connectionState = fail(detail);

    if (/could not resolve hostname/i.test(detail)) {
      issues.push({
        kind: 'aliasNotFound', title: 'This alias is no longer in your SSH config', detail,
        remedy: `Pick another alias, or re-create the entry for '${alias}'.`,
      });
    } else if (/REMOTE HOST IDENTIFICATION HAS CHANGED/i.test(detail)) {
      hostKeyState = fail('changed');
      issues.push({
        kind: 'changedHostKey',
        title: `The key '${alias}' (${resolved.hostname}) now presents does not match what was trusted before`,
        detail,
        remedy: `Verify the new fingerprint against your hosting provider's control panel or SSH access `
          + `log before trusting it. If you're sure it's legitimate, remove the stale entry yourself:\n`
          + `  ssh-keygen -R ${resolved.hostname}`,
      });
    } else if (/host key verification failed/i.test(detail)) {
      hostKeyState = fail('unknown');
      const captured = await captureOfferedHostKey(alias, exec);
      issues.push({
        kind: 'unknownHostKey',
        title: 'First connection to this host — confirm its identity',
        detail,
        remedy: captured
          ? `Check this fingerprint against your provider's console, or run `
            + `ssh-keygen -lf /etc/ssh/ssh_host_${(captured.keyType || 'ed25519').toLowerCase()}_key.pub `
            + `on the server. Nexus records it only after you approve.`
          : `Could not fetch the host's key to display a fingerprint (the host may have become unreachable) — re-run the probe.`,
        fingerprint: captured?.fingerprint,
        keyType: captured?.keyType,
      });
    } else if (/permission denied/i.test(detail)) {
      hostKeyState = ok('n/a — reached authentication');
      if (/passphrase/i.test(detail)) {
        issues.push({
          kind: 'authPassphraseNoAgent',
          title: 'That key needs a passphrase and no agent is running', detail,
          remedy: `eval "$(ssh-agent -s)" && ssh-add ${resolved.identityFile ?? '<your key>'}`,
        });
      } else {
        issues.push({
          kind: 'authKeyNotLoaded',
          title: "Your SSH key isn't loaded", detail,
          remedy: `ssh-add ${resolved.identityFile ?? '<your key>'}`,
        });
      }
    } else if (/connection refused/i.test(detail)) {
      issues.push({
        kind: 'connRefused', title: `Connection refused on port ${resolved.port}`, detail,
        remedy: `Nothing is listening on port ${resolved.port} for '${alias}'. Fix the Port line in your SSH config, or confirm the service is running on the host.`,
      });
    } else if (/could not resolve hostname|network is unreachable|timed out/i.test(detail) && /proxycommand|proxyjump/i.test(detail)) {
      issues.push({
        kind: 'proxyJumpFailed', title: 'The jump host failed, not this server', detail,
        remedy: `ssh <jump-host> exit`,
      });
    } else if (/timed out|timeout/i.test(detail)) {
      issues.push({
        kind: 'connTimeout', title: 'No response after 20 seconds', detail,
        remedy: `ssh -v ${alias} exit`,
      });
    } else {
      issues.push({
        kind: 'connTimeout', title: 'Could not connect', detail,
        remedy: `ssh -v ${alias} exit`,
      });
    }
  } else {
    connectionState = ok(account);
    hostKeyState = ok('trusted');
  }

  // ---- Check: root user (only meaningful once connected) -------------------
  if (canProceed) {
    const whoami = await run('whoami');
    const remoteUser = whoami.stdout.trim();
    if (whoami.code === 0 && remoteUser === 'root') {
      issues.push({
        kind: 'rootUser',
        title: 'This host connects as root',
        detail: `whoami reported '${remoteUser}'`,
        remedy: `Either allow WP-CLI to run as root for this host, or use an alias that connects as the site's own user (preferred).`,
      });
    }
  }

  // ---- Check 2: WP-CLI -------------------------------------------------
  let wpCliState: CheckState = idle('needs a working connection');
  let wpCliPath: string | undefined;
  let wpCliVersion: string | undefined;

  if (canProceed) {
    const onPath = await run('command -v wp 2>/dev/null');
    if (onPath.code !== 0 || !onPath.stdout.trim()) {
      const search = `for p in ${WP_CLI_FALLBACK_PATHS.join(' ')}; do [ -x "$p" ] && printf '%s\\n' "$p" && break; done`;
      const found = await run(search);
      const hit = found.stdout.trim().split('\n')[0]?.trim();
      if (!hit) {
        wpCliState = warn('not found');
        issues.push({
          kind: 'wpCliMissing',
          title: 'WP-CLI not found',
          detail: reason(onPath) || 'wp: command not found',
          remedy: 'Install WP-CLI on the host, then re-run the probe:\n'
            + '  curl -O https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar\n'
            + '  chmod +x wp-cli.phar && sudo mv wp-cli.phar /usr/local/bin/wp\n'
            + 'Nexus does not install anything on your server.',
        });
      } else {
        wpCliPath = hit;
      }
    }

    if (wpCliState.status !== 'warn') {
      const cliVersion = await run(buildExternalWpCliCommand(['--version'], undefined, wpCliPath));
      const version = /WP-CLI\s+(\S+)/i.exec(cliVersion.stdout)?.[1];
      if (version) {
        wpCliVersion = version;
        wpCliState = ok(`WP-CLI ${version}`);
      } else {
        wpCliState = warn('found on interactive PATH only');
        issues.push({
          kind: 'wpCliInteractivePathOnly',
          title: 'WP-CLI only works over an interactive shell',
          detail: reason(cliVersion) || 'wp --version produced no output',
          remedy: 'Provide the absolute path to WP-CLI (your login shell finds it, but a non-interactive SSH command does not).',
        });
      }
    }
  }

  // ---- Check 3: WordPress installs -----------------------------------
  let installsState: CheckState = idle('needs WP-CLI');
  let installs: string[] | undefined;

  if (canProceed && wpCliState.status === 'ok') {
    if (opts.wpPath) {
      installs = [opts.wpPath];
      installsState = ok(opts.wpPath);
    } else {
      const find = `find -L ${SEARCH_ROOTS.join(' ')} -maxdepth ${SEARCH_MAXDEPTH} -name wp-config.php -type f 2>/dev/null | head -20`;
      const found = await run(find, DISCOVERY_TIMEOUT_MS);
      const roots = Array.from(new Set(
        found.stdout.split('\n').map((l) => l.trim()).filter(Boolean).map((f) => f.replace(/\/wp-config\.php$/, '')),
      ));
      if (roots.length === 0) {
        installsState = fail('none found');
        issues.push({
          kind: 'wordPressNotFound',
          title: 'No WordPress installation found',
          detail: `No wp-config.php found within ${SEARCH_MAXDEPTH} levels of ${SEARCH_ROOTS.join(', ')}.`,
          remedy: 'Point Nexus at the correct path directly, then re-search.',
        });
      } else {
        installs = roots;
        installsState = ok(`${roots.length} found`);
      }
    }
  }

  return {
    checks: { connection: connectionState, hostKey: hostKeyState, wpCli: wpCliState, installs: installsState },
    issues,
    resolved,
    wpCli: wpCliVersion ? { path: wpCliPath, version: wpCliVersion } : undefined,
    installs,
  };
}
