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
  identityFile: string;
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
 * Checks the real ~/.ssh/config (NOT config.d/nexus — a collision against
 * Nexus's own prior writes is impossible, since writeHostBlock itself refuses
 * a repeat alias by construction) for an exact or pattern collision with a
 * new alias, before anything is written.
 */
export function detectCollision(alias: string, homeDir: string = os.homedir()): CollisionResult {
  const file = configPath(homeDir);
  if (!fs.existsSync(file)) return { kind: 'none' };

  const text = fs.readFileSync(file, 'utf-8');
  const lines = SSHConfig.parse(text);

  let lineNumber = 0;
  for (const line of lines) {
    lineNumber++;
    if (line.type === LineType.DIRECTIVE && line.param.toLowerCase() === 'host') {
      const patterns = directiveValue(line).split(/\s+/).filter(Boolean);
      if (patterns.includes(alias)) {
        return { kind: 'exact', file, line: lineNumber };
      }
      const wildcardMatch = patterns.find((p) => (p.includes('*') || p.includes('?')) && !p.startsWith('!'));
      if (wildcardMatch) {
        return { kind: 'pattern', pattern: wildcardMatch, file };
      }
    }
  }
  return { kind: 'none' };
}

export function previewHostBlock(input: WriteHostBlockInput): string {
  assertSafeSshAlias(input.alias);
  return `Host ${input.alias}\n`
    + `  HostName ${input.hostname}\n`
    + `  User ${input.user}\n`
    + `  Port ${input.port}\n`
    + `  IdentityFile ${input.identityFile}\n`
    + `  IdentitiesOnly yes\n`;
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
