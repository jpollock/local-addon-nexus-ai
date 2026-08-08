/**
 * Writes a NEW host entry to ~/.ssh/config.d/nexus, and generates a new SSH
 * key when the user has none to select. This mutates a file every other SSH
 * tool the user owns also reads -- containment is the whole design:
 *
 *   - Nexus owns ~/.ssh/config.d/nexus and writes ONLY there, never the
 *     user's own ~/.ssh/config beyond a single idempotent Include line.
 *   - The Include line goes at the TOP of ~/.ssh/config. ssh_config is
 *     first-obtained-value-wins, so Include-at-top means Nexus's block wins
 *     the keywords it explicitly sets. The risk this does NOT eliminate: a
 *     wildcard block elsewhere in the user's config can still supply
 *     keywords Nexus's block is silent on (ProxyJump, ForwardAgent) -- that
 *     is exactly what detectCollision's 'pattern' result exists to surface
 *     as a warning, not silently allow.
 *   - Reachable ONLY via the TRUST_EXTERNAL_HOST_KEY-style IPC channels this
 *     same task adds (never GraphQL, never CLI) -- see Global Constraints.
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { assertSafeSshAlias } from '../transport/ssh-args';
import { listSshConfigHosts } from './sshConfigParser';
import SSHConfig, { LineType } from 'ssh-config';
import type { Line } from 'ssh-config';

export type CollisionResult =
  | { kind: 'none' }
  | { kind: 'exact'; file: string; line: number }
  | { kind: 'pattern'; pattern: string; file: string };

export interface WriteHostBlockInput {
  alias: string;
  hostname: string;
  user: string;
  port: string;
  /** Optional. A bare `IdentityFile` directive with no value makes ssh
   * terminate parsing entirely, so an empty/omitted value must produce NO
   * IdentityFile (or IdentitiesOnly) line at all -- see previewHostBlock. */
  identityFile?: string;
}

export interface GeneratedKey {
  privateKeyPath: string;
  publicKeyLine: string;
}

function sshDir(homeDir: string): string {
  return path.join(homeDir, '.ssh');
}
function configPath(homeDir: string): string {
  return path.join(sshDir(homeDir), 'config');
}
function nexusConfigPath(homeDir: string): string {
  return path.join(sshDir(homeDir), 'config.d', 'nexus');
}

function directiveValue(line: Line): string {
  if (line.type !== LineType.DIRECTIVE) return '';
  return Array.isArray(line.value) ? line.value.map((v) => v.val).join(' ') : line.value;
}

/**
 * Scans ~/.ssh/config directly, collecting BOTH the first exact match and the
 * first pattern (wildcard) match anywhere in the file, rather than returning
 * on whichever is seen first. A leading `Host *` block (common on macOS, e.g.
 * AddKeysToAgent/UseKeychain) must never shadow an exact match that appears
 * later in the same file -- exact always wins over pattern, regardless of
 * scan order.
 */
function scanFileForCollision(file: string, alias: string): { exact: { file: string; line: number } | null; pattern: { pattern: string; file: string } | null } {
  let exact: { file: string; line: number } | null = null;
  let pattern: { pattern: string; file: string } | null = null;
  if (!fs.existsSync(file)) return { exact, pattern };

  const text = fs.readFileSync(file, 'utf-8');
  const lines = SSHConfig.parse(text);

  let lineNumber = 0;
  for (const line of lines) {
    lineNumber++;
    if (line.type === LineType.DIRECTIVE && line.param.toLowerCase() === 'host') {
      const patterns = directiveValue(line).split(/\s+/).filter(Boolean);
      if (!exact && patterns.includes(alias)) {
        exact = { file, line: lineNumber };
      }
      if (!pattern) {
        const wildcardMatch = patterns.find((p) => (p.includes('*') || p.includes('?')) && !p.startsWith('!'));
        if (wildcardMatch) {
          pattern = { pattern: wildcardMatch, file };
        }
      }
    }
  }
  return { exact, pattern };
}

/**
 * Checks for an exact or pattern collision with a new alias, before anything
 * is written. This must NOT be a naive re-parse of ~/.ssh/config alone --
 * two things that used to be invisible to it:
 *
 *   - An alias defined only inside a file ~/.ssh/config Include's. Handled
 *     by sourcing from listSshConfigHosts, which is Include-aware.
 *   - config.d/nexus itself, i.e. Nexus's own prior writes. A collision
 *     against Nexus's own file is NOT impossible -- writeHostBlock's refusal
 *     is only as good as detectCollision's visibility into that file, and a
 *     fresh install may not yet have the `Include ~/.ssh/config.d/nexus` line
 *     in ~/.ssh/config that would otherwise make listSshConfigHosts see it.
 *     So config.d/nexus is always checked explicitly as a fallback, in
 *     addition to (not instead of) the Include-aware scan.
 *
 * An exact match anywhere wins over a pattern match found elsewhere, and line
 * numbers are only meaningful for matches found by directly parsing a single
 * file -- a match found via listSshConfigHosts (which does not report line
 * numbers) is reported with line 0.
 */
export function detectCollision(alias: string, homeDir: string = os.homedir()): CollisionResult {
  const file = configPath(homeDir);
  const top = scanFileForCollision(file, alias);
  if (top.exact) return { kind: 'exact', ...top.exact };

  // Include-aware scan: covers files ~/.ssh/config Includes, and covers
  // config.d/nexus itself once the Include line Nexus writes is present.
  const includeAwareHosts = listSshConfigHosts(null, homeDir);
  if (includeAwareHosts.some((h) => h.alias === alias)) {
    return { kind: 'exact', file: nexusConfigPath(homeDir), line: 0 };
  }

  // Explicit fallback: config.d/nexus even when ~/.ssh/config has no Include
  // line yet (first-ever write) or the user removed it while old Nexus
  // entries remain.
  const nexusFile = nexusConfigPath(homeDir);
  const nexusScan = scanFileForCollision(nexusFile, alias);
  if (nexusScan.exact) return { kind: 'exact', ...nexusScan.exact };

  if (top.pattern) return { kind: 'pattern', ...top.pattern };
  return { kind: 'none' };
}

/**
 * A bare directive (e.g. `IdentityFile` with no value) makes ssh terminate
 * parsing ENTIRELY -- verified against real ssh on this machine ("no argument
 * after keyword..."). Since Nexus's Include line sits at the top of
 * ~/.ssh/config, that one blank line breaks every subsequent ssh invocation
 * the user makes, not just Nexus's -- so alias/hostname/user/port (the fields
 * the UI treats as required) are validated here as a last line of defense,
 * and identityFile (genuinely optional) is omitted entirely rather than
 * emitted blank.
 */
function assertRequiredHostFields(input: WriteHostBlockInput): void {
  if (!input.hostname) throw new Error('hostname is required');
  if (!input.user) throw new Error('user is required');
  if (!input.port) throw new Error('port is required');
}

export function previewHostBlock(input: WriteHostBlockInput): string {
  assertSafeSshAlias(input.alias);
  assertRequiredHostFields(input);
  let block = `Host ${input.alias}\n`
    + `  HostName ${input.hostname}\n`
    + `  User ${input.user}\n`
    + `  Port ${input.port}\n`;
  if (input.identityFile) {
    block += `  IdentityFile ${input.identityFile}\n`
      + `  IdentitiesOnly yes\n`;
  }
  return block;
}

/**
 * Ensures ~/.ssh/config has exactly one `Include ~/.ssh/config.d/nexus` line,
 * at the top. Idempotent -- checks before writing.
 */
function ensureIncludeLine(homeDir: string): void {
  const file = configPath(homeDir);
  const includeLine = 'Include ~/.ssh/config.d/nexus';
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : '';
  if (existing.split('\n').some((l) => l.trim() === includeLine)) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${includeLine}\n${existing}`);
}

export function writeHostBlock(input: WriteHostBlockInput, homeDir: string = os.homedir()): void {
  const collision = detectCollision(input.alias, homeDir);
  if (collision.kind === 'exact') {
    throw new Error(`'${input.alias}' is already a Host in ${collision.file}:${collision.line}. Choose a different alias.`);
  }

  const block = previewHostBlock(input);
  const nexusFile = nexusConfigPath(homeDir);
  fs.mkdirSync(path.dirname(nexusFile), { recursive: true, mode: 0o700 });
  fs.chmodSync(path.dirname(nexusFile), 0o700);

  const existing = fs.existsSync(nexusFile) ? fs.readFileSync(nexusFile, 'utf-8') : '';
  const separator = existing && !existing.endsWith('\n') ? '\n' : '';
  fs.writeFileSync(nexusFile, `${existing}${separator}${block}`, { mode: 0o600 });
  fs.chmodSync(nexusFile, 0o600);

  ensureIncludeLine(homeDir);
}

/**
 * ed25519, no passphrase, mode 0600. No passphrase is forced by
 * buildExternalSshArgs's BatchMode=yes -- a passphrase-protected key with no
 * loaded agent fails immediately. Nexus never uploads the public half; it is
 * returned for the caller to display.
 */
export function generateHostKey(aliasSlug: string, homeDir: string = os.homedir()): GeneratedKey {
  assertSafeSshAlias(aliasSlug);
  const dir = sshDir(homeDir);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const privateKeyPath = path.join(dir, `nexus_${aliasSlug}`);

  const result = spawnSync('ssh-keygen', [
    '-t', 'ed25519',
    '-f', privateKeyPath,
    '-N', '',
    '-C', `nexus-${aliasSlug}`,
  ], { stdio: 'pipe' });

  if (result.status !== 0) {
    throw new Error(`ssh-keygen failed: ${result.stderr?.toString() || `exit code ${result.status}`}`);
  }
  fs.chmodSync(privateKeyPath, 0o600);
  const publicKeyLine = fs.readFileSync(`${privateKeyPath}.pub`, 'utf-8').trim();
  return { privateKeyPath, publicKeyLine };
}
