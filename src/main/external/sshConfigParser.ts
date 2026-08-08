/**
 * Enumerate every real, connectable Host alias across ~/.ssh/config and every
 * file it Includes — a genuinely new capability. resolveSshConfig (sshExec.ts)
 * resolves ONE already-known alias via `ssh -G`; it cannot enumerate.
 *
 * Uses the `ssh-config` npm package for parsing individual files (it correctly
 * handles quoting, multi-value directives, and comments) but NOT for
 * Include-following, which the library does not implement — that is the
 * recursive walk below.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import SSHConfig, { LineType } from 'ssh-config';
import type { Line, Section } from 'ssh-config';

export interface SshConfigHost {
  alias: string;
  hostname: string;
  user: string;
  port: string;
  identityFile?: string;
  proxyJump?: string;
  alreadyRegistered: boolean;
}

/** A Host pattern that names exactly one real alias — no wildcard, no negation. */
function isConcreteAlias(pattern: string): boolean {
  return !pattern.includes('*') && !pattern.includes('?') && !pattern.startsWith('!');
}

/**
 * Minimal glob matcher for Include path patterns (e.g. `config.d/*`,
 * `config.d/*.conf`). Deliberately narrow — OpenSSH's Include glob syntax in
 * practice is almost always a single trailing `*` or `*.ext`, and a full glob
 * library is unnecessary machinery for that. Matches only within a single
 * directory (no recursive `**`), which is also all OpenSSH's own Include
 * supports.
 */
function expandIncludeGlob(pattern: string): string[] {
  if (!pattern.includes('*') && !pattern.includes('?')) {
    return fs.existsSync(pattern) ? [pattern] : [];
  }
  const dir = path.dirname(pattern);
  const base = path.basename(pattern);
  if (!fs.existsSync(dir)) return [];
  const regex = new RegExp(
    `^${base.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '.')}$`,
  );
  return fs.readdirSync(dir)
    .filter((name) => regex.test(name))
    .map((name) => path.join(dir, name))
    .sort();
}

/** OpenSSH resolves a relative Include path against ~/.ssh/, not the including file's directory. */
function resolveIncludePath(raw: string, sshDir: string, homeDir?: string): string {
  const home = homeDir || os.homedir();
  if (raw.startsWith('~/')) return path.join(home, raw.slice(2));
  if (path.isAbsolute(raw)) return raw;
  return path.join(sshDir, raw);
}

/**
 * Parse one file and every file it (recursively) Includes, returning a flat
 * list of every Line across all of them. `visited` prevents infinite loops on
 * a cyclic Include — OpenSSH itself has no documented cycle protection, but
 * silently hanging is worse than silently stopping at a repeat.
 */
function parseRecursive(filePath: string, sshDir: string, visited: Set<string>, homeDir?: string): Line[] {
  const real = fs.existsSync(filePath) ? fs.realpathSync(filePath) : filePath;
  if (visited.has(real) || !fs.existsSync(filePath)) return [];
  visited.add(real);

  const text = fs.readFileSync(filePath, 'utf-8');
  const parsed = SSHConfig.parse(text);
  const lines: Line[] = [];

  for (const line of parsed) {
    lines.push(line);
    if (line.type === LineType.DIRECTIVE && line.param.toLowerCase() === 'include') {
      const patterns = Array.isArray(line.value)
        ? line.value.map((v) => v.val)
        : [line.value];
      for (const pattern of patterns) {
        const resolved = resolveIncludePath(pattern, sshDir, homeDir);
        for (const includedFile of expandIncludeGlob(resolved)) {
          lines.push(...parseRecursive(includedFile, sshDir, visited, homeDir));
        }
      }
    }
  }
  return lines;
}

/** Read a directive's value as a plain string, regardless of the library's quoted-value shape. */
function directiveValue(value: string | Array<{ val: string; separator?: string; quoted?: boolean }>): string {
  if (Array.isArray(value)) {
    return value.map((v) => v.val).join(' ');
  }
  return value;
}

export function listSshConfigHosts(
  graphDb: { prepare(sql: string): { all(...args: unknown[]): unknown[] } } | null,
  homeDir: string = os.homedir(),
): SshConfigHost[] {
  const sshDir = path.join(homeDir, '.ssh');
  const configPath = path.join(sshDir, 'config');
  if (!fs.existsSync(configPath)) return [];

  const lines = parseRecursive(configPath, sshDir, new Set(), homeDir);

  const registered = new Set<string>();
  if (graphDb) {
    try {
      const rows = graphDb.prepare(
        "SELECT DISTINCT account_id FROM sites WHERE source = 'external' AND is_active = 1",
      ).all() as Array<{ account_id: string }>;
      for (const row of rows) registered.add(row.account_id);
    } catch {
      // Non-fatal — an unready graph means every host reports unregistered,
      // which is the safe (re-offer-in-picker) direction to fail toward.
    }
  }

  const hosts: SshConfigHost[] = [];
  for (const line of lines) {
    if (line.type === LineType.DIRECTIVE && line.param.toLowerCase() === 'host') {
      const section = line as any; // Section type, which has a `config` field
      const patterns = directiveValue(line.value).split(/\s+/).filter(Boolean);

      // Collect this Host block's own directives from the section's config.
      const blockConfig = new Map<string, string>();
      if (section.config) {
        for (const configLine of section.config) {
          if (configLine.type === LineType.DIRECTIVE) {
            const key = configLine.param.toLowerCase();
            if (!blockConfig.has(key)) {
              blockConfig.set(key, directiveValue(configLine.value));
            }
          }
        }
      }

      for (const alias of patterns) {
        if (isConcreteAlias(alias)) {
          hosts.push({
            alias,
            hostname: blockConfig.get('hostname') || alias,
            user: blockConfig.get('user') || '',
            port: blockConfig.get('port') || '22',
            identityFile: blockConfig.has('identityfile')
              ? resolveIncludePath(blockConfig.get('identityfile')!, sshDir, homeDir)
              : undefined,
            proxyJump: blockConfig.get('proxyjump'),
            alreadyRegistered: registered.has(alias),
          });
        }
      }
    }
  }
  return hosts;
}
