/**
 * nexus troubleshoot
 *
 * Diagnoses and recovers from common Nexus AI issues.
 * Re-runs doctor with verbose output, checks disk space, GraphQL connectivity
 * timing, and recent errors from Local's addon log.
 *
 * Usage:
 *   nexus troubleshoot
 *   nexus troubleshoot --last-error
 *   nexus troubleshoot --verbose
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as child_process from 'child_process';
import { Command } from 'commander';
import { getLocalPaths } from '../bootstrap/paths';
import { readConnectionInfo } from '../bootstrap/graphql';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DiagnosticResult {
  label: string;
  status: 'ok' | 'warn' | 'error' | 'info';
  detail: string;
  action?: string;
}

// ---------------------------------------------------------------------------
// Disk space check
// ---------------------------------------------------------------------------

async function checkDiskSpace(): Promise<DiagnosticResult> {
  try {
    // Use df to get disk space — works on macOS and Linux
    const output = child_process.execSync('df -k / 2>/dev/null || df -k $HOME 2>/dev/null', {
      encoding: 'utf-8',
      timeout: 5000,
    });

    const lines = output.trim().split('\n');
    // df output: Filesystem 1K-blocks Used Available Use% Mounted
    // macOS df: Filesystem 512-blocks Used Available Capacity Mounted
    for (const line of lines.slice(1)) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 4) {
        // Find the "Available" column — index 3 on Linux, 3 on macOS
        const availableRaw = parseInt(parts[3], 10);
        if (!isNaN(availableRaw)) {
          // df -k reports in 1K blocks on Linux; macOS uses 512-byte blocks
          // Use a heuristic: if available > 1e9, it's 512-byte blocks (macOS)
          let availableBytes: number;
          if (availableRaw > 1_000_000_000) {
            // macOS 512-byte blocks
            availableBytes = availableRaw * 512;
          } else {
            // Linux 1K blocks
            availableBytes = availableRaw * 1024;
          }

          const availableGB = availableBytes / (1024 * 1024 * 1024);
          const availableGBStr = availableGB.toFixed(1);

          if (availableGB < 0.5) {
            return {
              label: 'Disk space',
              status: 'error',
              detail: `${availableGBStr} GB available (critical — operations will fail)`,
              action: 'Free up disk space: rm -rf ~/Library/Caches/* or use Disk Utility',
            };
          } else if (availableGB < 2) {
            return {
              label: 'Disk space',
              status: 'warn',
              detail: `${availableGBStr} GB available (warning — indexing may fail)`,
              action: 'Free up disk space to ensure at least 2 GB available for indexing',
            };
          } else {
            return {
              label: 'Disk space',
              status: 'ok',
              detail: `${availableGBStr} GB available (healthy)`,
            };
          }
        }
      }
    }

    return { label: 'Disk space', status: 'warn', detail: 'Could not parse disk info' };
  } catch {
    return { label: 'Disk space', status: 'warn', detail: 'Could not check disk space' };
  }
}

// ---------------------------------------------------------------------------
// GraphQL connectivity check with timing
// ---------------------------------------------------------------------------

async function checkGraphQLTiming(): Promise<DiagnosticResult> {
  try {
    const info = readConnectionInfo();
    if (!info) {
      return {
        label: 'GraphQL timing',
        status: 'warn',
        detail: 'No connection info — Local may not be running',
        action: 'Open the Local app and ensure Nexus AI addon is enabled',
      };
    }

    const t0 = Date.now();
    const http = await import('http');
    const alive = await new Promise<boolean>((resolve) => {
      const req = http.get(
        `http://localhost:${info.port}/graphql`,
        { timeout: 5000 } as any,
        (res) => {
          res.resume();
          resolve(res.statusCode !== undefined);
        },
      );
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
    });

    const elapsed = Date.now() - t0;

    if (!alive) {
      return {
        label: 'GraphQL timing',
        status: 'error',
        detail: `Not responding (port ${info.port})`,
        action: 'Restart Local — the GraphQL server is not responding',
      };
    }

    if (elapsed > 2000) {
      return {
        label: 'GraphQL timing',
        status: 'warn',
        detail: `Slow response: ${elapsed}ms (port ${info.port})`,
        action: 'Restart Local if operations are timing out',
      };
    }

    return {
      label: 'GraphQL timing',
      status: 'ok',
      detail: `Responding in ${elapsed}ms (port ${info.port})`,
    };
  } catch {
    return { label: 'GraphQL timing', status: 'error', detail: 'Check failed' };
  }
}

// ---------------------------------------------------------------------------
// SSH key test
// ---------------------------------------------------------------------------

async function checkSshKey(): Promise<DiagnosticResult> {
  try {
    const sshDir = path.join(os.homedir(), '.ssh');
    if (!fs.existsSync(sshDir)) {
      return {
        label: 'SSH key',
        status: 'warn',
        detail: 'No ~/.ssh directory found',
        action: 'Run: nexus wpe diagnose <install-id> to test WP Engine SSH connectivity',
      };
    }

    const keyFiles = fs.readdirSync(sshDir).filter((f) => {
      // Common private key formats (no extension or .pem)
      return !f.endsWith('.pub') && !f.endsWith('.known_hosts') &&
             !f.includes('known_hosts') && !f.includes('config') &&
             !f.includes('authorized_keys');
    });

    if (keyFiles.length === 0) {
      return {
        label: 'SSH key',
        status: 'warn',
        detail: 'No SSH private keys found in ~/.ssh',
        action: 'Generate an SSH key: ssh-keygen -t ed25519 -C "your@email.com"',
      };
    }

    // Check if ssh-agent is running
    const agentSocket = process.env.SSH_AUTH_SOCK;
    const agentRunning = agentSocket && fs.existsSync(agentSocket);

    const detail = `${keyFiles.length} key${keyFiles.length !== 1 ? 's' : ''} found${agentRunning ? ' · ssh-agent running' : ' · ssh-agent not detected'}`;

    return {
      label: 'SSH key',
      status: 'ok',
      detail,
      ...(agentRunning ? {} : { action: 'Start ssh-agent: eval "$(ssh-agent -s)" && ssh-add ~/.ssh/id_ed25519' }),
    };
  } catch {
    return { label: 'SSH key', status: 'warn', detail: 'Could not check SSH keys' };
  }
}

// ---------------------------------------------------------------------------
// Recent errors from addon log
// ---------------------------------------------------------------------------

interface LogErrorEntry {
  line: string;
  lineNumber: number;
}

function getAddonLogPath(): string | null {
  try {
    const paths = getLocalPaths();
    // Local logs go to Library/Application Support/Local/logs/
    const logsDir = path.join(paths.dataDir, 'logs');
    if (!fs.existsSync(logsDir)) return null;

    // Find the most recent log file
    const logFiles = fs.readdirSync(logsDir)
      .filter((f) => f.endsWith('.log'))
      .map((f) => ({ name: f, mtime: fs.statSync(path.join(logsDir, f)).mtime.getTime() }))
      .sort((a, b) => b.mtime - a.mtime);

    if (logFiles.length === 0) return null;
    return path.join(logsDir, logFiles[0].name);
  } catch {
    return null;
  }
}

function readRecentErrors(logPath: string, maxLines = 50): LogErrorEntry[] {
  try {
    const content = fs.readFileSync(logPath, 'utf-8');
    const lines = content.split('\n');
    const errors: LogErrorEntry[] = [];

    // Look at the last maxLines lines
    const startIndex = Math.max(0, lines.length - maxLines);
    for (let i = startIndex; i < lines.length; i++) {
      const line = lines[i];
      if (/error|exception|failed|crash|fatal/i.test(line) && line.trim()) {
        errors.push({ line: line.trim().slice(0, 200), lineNumber: i + 1 });
      }
    }

    return errors;
  } catch {
    return [];
  }
}

async function checkRecentErrors(verbose: boolean): Promise<DiagnosticResult[]> {
  const results: DiagnosticResult[] = [];

  const logPath = getAddonLogPath();
  if (!logPath) {
    results.push({
      label: 'Addon log',
      status: 'info',
      detail: 'No log file found (Local may not have run recently)',
    });
    return results;
  }

  const errors = readRecentErrors(logPath);

  if (errors.length === 0) {
    results.push({
      label: 'Addon log',
      status: 'ok',
      detail: `No recent errors in ${path.basename(logPath)}`,
    });
  } else {
    results.push({
      label: 'Addon log',
      status: 'warn',
      detail: `${errors.length} recent error${errors.length !== 1 ? 's' : ''} in ${path.basename(logPath)}`,
      action: 'nexus troubleshoot --last-error for details',
    });

    if (verbose) {
      for (const err of errors.slice(0, 5)) {
        results.push({
          label: `  Line ${err.lineNumber}`,
          status: 'info',
          detail: err.line,
        });
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Run nexus doctor as a sub-check
// ---------------------------------------------------------------------------

async function runDoctorChecks(verbose: boolean): Promise<DiagnosticResult[]> {
  try {
    // Import and run the same checks as doctor, reusing the logic
    const { isLocalInstalled, isLocalRunning } = await import('../bootstrap/process');
    const { isAddonInstalled, isAddonActivated, getInstalledAddonVersion } = await import('../bootstrap/addon');

    const checks: DiagnosticResult[] = [];

    // Local installed
    try {
      const installed = isLocalInstalled();
      checks.push({
        label: 'Local app',
        status: installed ? 'ok' : 'error',
        detail: installed ? 'Installed' : 'Not found',
        action: installed ? undefined : 'Download Local from https://localwp.com',
      });
    } catch {
      checks.push({ label: 'Local app', status: 'error', detail: 'Check failed' });
    }

    // Local running
    try {
      const running = await isLocalRunning();
      checks.push({
        label: 'Local running',
        status: running ? 'ok' : 'warn',
        detail: running ? 'Running' : 'Not running',
        action: running ? undefined : 'Open the Local app',
      });
    } catch {
      checks.push({ label: 'Local running', status: 'error', detail: 'Check failed' });
    }

    // Addon activated
    try {
      const activated = isAddonActivated();
      const installed = isAddonInstalled();
      const version = getInstalledAddonVersion() ?? 'unknown';

      if (activated) {
        checks.push({ label: 'Nexus AI addon', status: 'ok', detail: `Active (v${version})` });
      } else if (installed) {
        checks.push({
          label: 'Nexus AI addon',
          status: 'warn',
          detail: `Installed but not activated`,
          action: 'Enable Nexus AI in Local → Preferences → Addons',
        });
      } else {
        checks.push({
          label: 'Nexus AI addon',
          status: 'error',
          detail: 'Not installed',
          action: 'nexus update',
        });
      }
    } catch {
      checks.push({ label: 'Nexus AI addon', status: 'error', detail: 'Check failed' });
    }

    if (verbose) {
      // GraphQL info
      try {
        const info = readConnectionInfo();
        if (info) {
          checks.push({
            label: 'GraphQL port',
            status: 'info',
            detail: `Port ${info.port}`,
          });
        }
      } catch {
        // Ignore
      }
    }

    return checks;
  } catch {
    return [{ label: 'Doctor checks', status: 'error', detail: 'Could not run doctor checks' }];
  }
}

// ---------------------------------------------------------------------------
// Report rendering
// ---------------------------------------------------------------------------

const STATUS_ICON: Record<string, string> = {
  ok: '✅',
  warn: '⚠️ ',
  error: '❌',
  info: 'ℹ️ ',
};

function renderDiagnostic(result: DiagnosticResult): void {
  const icon = STATUS_ICON[result.status] ?? '  ';
  const label = result.label.padEnd(20);
  console.log(`  ${icon}  ${label}${result.detail}`);
  if (result.action) {
    console.log(`         → ${result.action}`);
  }
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

export const troubleshootCommand = new Command('troubleshoot')
  .description('Diagnose and recover from common Nexus AI issues')
  .option('--last-error', 'Show diagnostics for the most recent error')
  .option('--verbose', 'Show all diagnostic output including passing checks')
  .action(async (options) => {
    const verbose = options.verbose || false;
    const lastError = options.lastError || false;

    console.log('');
    console.log('Nexus AI — Troubleshoot');
    console.log('─'.repeat(50));
    console.log('');

    const allResults: DiagnosticResult[] = [];

    // ── Section 1: Core checks (reuse doctor logic) ──────────────────────
    console.log('Core Checks:');
    const coreChecks = await runDoctorChecks(verbose);
    for (const check of coreChecks) {
      allResults.push(check);
      if (verbose || check.status !== 'ok') {
        renderDiagnostic(check);
      }
    }
    if (!verbose && coreChecks.every((c) => c.status === 'ok')) {
      console.log('  ✅  All core checks passed');
    }
    console.log('');

    // ── Section 2: Disk space ────────────────────────────────────────────
    console.log('Resources:');
    const diskResult = await checkDiskSpace();
    allResults.push(diskResult);
    renderDiagnostic(diskResult);
    console.log('');

    // ── Section 3: GraphQL with timing ───────────────────────────────────
    console.log('Connectivity:');
    const graphqlResult = await checkGraphQLTiming();
    allResults.push(graphqlResult);
    renderDiagnostic(graphqlResult);
    console.log('');

    // ── Section 4: SSH key ───────────────────────────────────────────────
    console.log('SSH:');
    const sshResult = await checkSshKey();
    allResults.push(sshResult);
    renderDiagnostic(sshResult);
    console.log('');

    // ── Section 5: Recent log errors ─────────────────────────────────────
    console.log('Log Analysis:');
    const logResults = await checkRecentErrors(lastError || verbose);
    for (const result of logResults) {
      allResults.push(result);
      renderDiagnostic(result);
    }
    console.log('');

    // ── Summary: actionable next steps ───────────────────────────────────
    const warnings = allResults.filter((r) => r.status === 'warn' || r.status === 'error');
    const actionItems = allResults.filter((r) => r.action && (r.status === 'warn' || r.status === 'error'));

    if (actionItems.length > 0) {
      console.log('─'.repeat(50));
      console.log('');
      console.log('Suggested fixes:');
      const seen = new Set<string>();
      for (const item of actionItems) {
        if (item.action && !seen.has(item.action)) {
          seen.add(item.action);
          console.log(`  → ${item.action}`);
        }
      }
      console.log('');
    } else if (warnings.length === 0) {
      console.log('─'.repeat(50));
      console.log('');
      console.log('  No issues detected. If you are still experiencing problems:');
      console.log('  → nexus doctor --json for a machine-readable health report');
      console.log('  → Check Local app logs via Help → Show Application Logs');
      console.log('');
    }

    // Exit non-zero if any errors found
    const hasErrors = allResults.some((r) => r.status === 'error');
    if (hasErrors) process.exit(1);
  });
