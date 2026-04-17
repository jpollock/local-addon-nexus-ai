/**
 * Shared CLI test utilities
 */

import { spawn } from 'child_process';
import * as path from 'path';

export const CLI_BIN = path.resolve(__dirname, '..', '..', '..', 'bin', 'nexus.js');

export interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  output: string; // stdout + stderr combined
}

/**
 * Execute a CLI command and return stdout, stderr, and exit code.
 * Accepts args as a string (split on spaces) or array (for args with spaces).
 */
export async function runCli(
  commandOrArgs: string | string[],
  options: { stdin?: string; timeout?: number; env?: Record<string, string> } = {},
): Promise<CliResult> {
  const { stdin, timeout = 60000, env = {} } = options;
  const args = Array.isArray(commandOrArgs)
    ? commandOrArgs
    : commandOrArgs.split(' ').filter(Boolean);

  return new Promise((resolve, reject) => {
    const child = spawn(CLI_BIN, args, {
      env: { ...process.env, ...env },
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    if (stdin !== undefined) {
      child.stdin.write(stdin + '\n');
      child.stdin.end();
    }

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`CLI command timed out after ${timeout}ms: nexus ${args.join(' ')}`));
    }, timeout);

    // Kill child when parent receives Ctrl+C so tests stop immediately
    const sigintHandler = () => { child.kill(); };
    process.once('SIGINT', sigintHandler);

    child.on('close', (code) => {
      clearTimeout(timer);
      process.removeListener('SIGINT', sigintHandler);
      resolve({ stdout, stderr, exitCode: code || 0, output: stdout + stderr });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      process.removeListener('SIGINT', sigintHandler);
      reject(err);
    });
  });
}

/**
 * Get all local sites. Returns empty array if Local is not running.
 */
export async function getLocalSites(): Promise<Array<{ name: string; status: string; id: string }>> {
  try {
    const result = await runCli('sites list --json');
    if (result.exitCode !== 0) return [];
    const data = JSON.parse(result.stdout);
    return data.local || [];
  } catch {
    return [];
  }
}

/**
 * Get first running local site, or null.
 */
export async function getRunningSite(): Promise<{ name: string; status: string; id: string } | null> {
  const sites = await getLocalSites();
  return sites.find((s) => s.status === 'running') || null;
}

/**
 * Get WPE accounts. Returns empty array if not authenticated.
 */
export async function getWpeAccounts(): Promise<Array<{ id: string; name: string }>> {
  try {
    const result = await runCli('wpe accounts --json');
    if (result.exitCode !== 0) return [];
    return JSON.parse(result.stdout) || [];
  } catch {
    return [];
  }
}

/**
 * Assert output contains expected strings (case-insensitive option).
 */
export function expectOutput(result: CliResult, ...patterns: (string | RegExp)[]): void {
  for (const pattern of patterns) {
    if (typeof pattern === 'string') {
      if (!result.output.includes(pattern)) {
        throw new Error(`Expected output to contain "${pattern}"\n\nActual output:\n${result.output}`);
      }
    } else {
      if (!pattern.test(result.output)) {
        throw new Error(`Expected output to match ${pattern}\n\nActual output:\n${result.output}`);
      }
    }
  }
}

/**
 * Skip a test with a reason, logging it clearly.
 * Use when required preconditions (running site, WPE auth) are absent.
 */
export function skipTest(reason: string): void {
  console.log(`      [SKIP] ${reason}`);
}

/**
 * Markers for mocked destructive commands.
 * NOTE: Destructive WPE commands (delete-install, domain-remove, promote,
 * user-remove) are tested for argument validation ONLY — they are not
 * executed against real WPE infrastructure. Tests validate: correct required
 * args, --confirm flag behavior, and error messages for invalid inputs.
 */
export const DESTRUCTIVE_NOTE = '[ARGUMENT VALIDATION ONLY — not executed against WPE]';
