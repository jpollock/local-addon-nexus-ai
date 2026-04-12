/**
 * nexus doctor
 *
 * System health check and first-run orientation.
 * Runs independently of bootstrap — each check is isolated and never crashes
 * the overall command. Shows actionable next steps for anything that is missing.
 *
 * Usage:
 *   nexus doctor          # human-readable report
 *   nexus doctor --json   # machine-readable output
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Command } from 'commander';
import { isLocalInstalled, isLocalRunning } from '../bootstrap/process';
import { isAddonInstalled, isAddonActivated, getInstalledAddonVersion, isDevAddon } from '../bootstrap/addon';
import { readConnectionInfo } from '../bootstrap/graphql';
import { getLocalPaths } from '../bootstrap/paths';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CheckStatus = 'ok' | 'warn' | 'error' | 'skip' | 'disabled';

interface CheckResult {
  label: string;
  status: CheckStatus;
  detail?: string;
  /** Actionable command shown in the next-steps footer. */
  action?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Known AI agent config files — used to detect which agents are configured.
const AGENT_CONFIG_PATHS: Record<string, () => string> = {
  'Claude Desktop': () =>
    process.platform === 'win32'
      ? path.join(os.homedir(), 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json')
      : process.platform === 'darwin'
        ? path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
        : path.join(os.homedir(), '.config', 'Claude', 'claude_desktop_config.json'),
  'Cursor': () => path.join(os.homedir(), '.cursor', 'mcp.json'),
  'Windsurf': () => path.join(os.homedir(), '.codeium', 'windsurf', 'mcp_config.json'),
};

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: 'Anthropic (Claude)',
  openai: 'OpenAI (GPT)',
  google: 'Google (Gemini)',
  ollama: 'Ollama (local)',
  'local-gateway': 'Local Gateway',
};

// ---------------------------------------------------------------------------
// Status icons
// ---------------------------------------------------------------------------

const ICON: Record<CheckStatus, string> = {
  ok:       '✅',
  warn:     '⚠️ ',
  error:    '❌',
  skip:     '⚪',
  disabled: '○ ',
};

// ---------------------------------------------------------------------------
// MCP helpers (duplicated from mcp.ts to keep doctor self-contained)
// ---------------------------------------------------------------------------

function getMcpConnectionInfoPath(): string {
  const dir = process.platform === 'win32'
    ? path.join(process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), 'Local')
    : process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Application Support', 'Local')
      : path.join(os.homedir(), '.config', 'Local');
  return path.join(dir, 'nexus-ai-mcp-connection-info.json');
}

function loadMcpInfo(): { url: string; authToken: string; port: number; version: string; tools: string[] } | null {
  try {
    const data = fs.readFileSync(getMcpConnectionInfoPath(), 'utf-8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

async function isMcpServerLive(url: string, token: string): Promise<boolean> {
  try {
    const https = await import('https');
    const http = await import('http');
    const lib = url.startsWith('https') ? https : http;
    return await new Promise<boolean>((resolve) => {
      const req = lib.get(
        `${url}/health`,
        { headers: { Authorization: `Bearer ${token}` }, timeout: 3000 } as any,
        (res) => resolve(res.statusCode === 200),
      );
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
    });
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Individual checks (each returns CheckResult, never throws)
// ---------------------------------------------------------------------------

async function checkLocalInstalled(): Promise<CheckResult> {
  try {
    const installed = isLocalInstalled();
    return installed
      ? { label: 'Local app', status: 'ok', detail: 'Installed' }
      : { label: 'Local app', status: 'error', detail: 'Not found', action: 'Download Local from https://localwp.com' };
  } catch {
    return { label: 'Local app', status: 'error', detail: 'Check failed' };
  }
}

async function checkLocalRunning(): Promise<CheckResult> {
  try {
    const running = await isLocalRunning();
    return running
      ? { label: 'Local running', status: 'ok', detail: 'Running' }
      : { label: 'Local running', status: 'warn', detail: 'Not running', action: 'Open the Local app' };
  } catch {
    return { label: 'Local running', status: 'error', detail: 'Check failed' };
  }
}

/**
 * Try to read addon version from the npm global install path.
 * The addon may be loaded by Local from the npm global dir (not Local's own addons/ folder)
 * when installed via `npm install -g`.
 */
function getGlobalNpmAddonVersion(): string | null {
  // Try npm global resolution first
  try {
    const pkgPath = require.resolve('@local-labs-jpollock/local-addon-nexus-ai/package.json');
    return (require(pkgPath) as { version?: string }).version ?? null;
  } catch { /* not on require path */ }

  // Fallback: CLI and addon are the same package — read our own package.json.
  // __dirname is lib/cli/commands, so ../../.. reaches the package root.
  try {
    const pkgPath = path.join(__dirname, '..', '..', '..', 'package.json');
    return (JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as { version?: string }).version ?? null;
  } catch {
    return null;
  }
}

async function checkAddon(): Promise<CheckResult> {
  try {
    // isAddonActivated() is the authoritative signal — if the addon is in enabled-addons.json,
    // Local has it available and it's active. isAddonInstalled() only checks one specific path
    // and misses npm-global installs (the common case for `npm install -g` users).
    const activated = isAddonActivated();
    const version = getInstalledAddonVersion() ?? getGlobalNpmAddonVersion() ?? 'unknown';
    const devMode = isDevAddon();

    if (activated) {
      const detail = `Active (v${version})${devMode ? ' · dev' : ''}`;
      return { label: 'Nexus AI addon', status: 'ok', detail };
    }

    // Activated flag not set — may be installed but not enabled
    const installed = isAddonInstalled();
    if (installed) {
      return { label: 'Nexus AI addon', status: 'warn', detail: `Installed (v${version}) but not activated`, action: 'Enable Nexus AI in Local → Preferences → Addons' };
    }

    return { label: 'Nexus AI addon', status: 'error', detail: 'Not installed', action: 'nexus update' };
  } catch {
    return { label: 'Nexus AI addon', status: 'error', detail: 'Check failed' };
  }
}

async function checkVersionMatch(): Promise<CheckResult | null> {
  try {
    const addonVersion = getInstalledAddonVersion();
    if (!addonVersion) return null;
    // package.json version is baked in at build time via __VERSION__ or require
    const cliPkg = require('../../../package.json') as { version: string };
    const cliVersion = cliPkg.version;
    if (addonVersion !== cliVersion) {
      return {
        label: 'Version match',
        status: 'warn',
        detail: `CLI v${cliVersion} ≠ addon v${addonVersion}`,
        action: 'nexus update',
      };
    }
    return { label: 'Version match', status: 'ok', detail: `v${cliVersion}` };
  } catch {
    return null; // Non-critical — skip silently
  }
}

async function checkGraphQL(): Promise<CheckResult> {
  try {
    const info = readConnectionInfo();
    if (!info) {
      return { label: 'GraphQL server', status: 'warn', detail: 'No connection info — Local may not be running' };
    }
    return { label: 'GraphQL server', status: 'ok', detail: `Connected (port ${info.port})` };
  } catch {
    return { label: 'GraphQL server', status: 'error', detail: 'Check failed' };
  }
}

async function checkMcpServer(): Promise<CheckResult> {
  try {
    const info = loadMcpInfo();
    if (!info) {
      return { label: 'MCP server', status: 'warn', detail: 'Not configured', action: 'Start Local with Nexus AI addon to activate MCP' };
    }
    const live = await isMcpServerLive(info.url, info.authToken);
    if (!live) {
      return { label: 'MCP server', status: 'warn', detail: `Configured (port ${info.port}) but not responding`, action: 'Restart Local' };
    }
    return { label: 'MCP server', status: 'ok', detail: `Running · ${info.tools.length} tools (v${info.version ?? '?'})` };
  } catch {
    return { label: 'MCP server', status: 'error', detail: 'Check failed' };
  }
}

/**
 * Check if Claude Code has nexus-ai registered via `claude mcp list`.
 * Claude Code is a CLI tool — registrations are managed by the `claude` binary,
 * not a config file we can inspect directly.
 */
async function isClaudeCodeConfigured(): Promise<boolean> {
  try {
    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    const exec = promisify(execFile);
    const { stdout } = await exec('claude', ['mcp', 'list'], { timeout: 4000 });
    return stdout.toLowerCase().includes('nexus-ai') || stdout.includes('mcp-stdio');
  } catch {
    // claude not installed, not in PATH, or command failed
    return false;
  }
}

async function checkAgentConfig(): Promise<CheckResult> {
  try {
    const info = loadMcpInfo();
    if (!info) {
      return { label: 'AI agent config', status: 'warn', detail: 'MCP server not running', action: 'nexus mcp setup' };
    }

    const configured: string[] = [];

    // Claude Code — CLI-based, detect via `claude mcp list`
    if (await isClaudeCodeConfigured()) {
      configured.push('Claude Code');
    }

    // File-based agents — check their config files for nexus references
    for (const [name, getPath] of Object.entries(AGENT_CONFIG_PATHS)) {
      try {
        const content = fs.readFileSync(getPath(), 'utf-8');
        if (content.includes(info.url) || content.includes('nexus-ai') || content.includes('mcp-stdio')) {
          configured.push(name);
        }
      } catch {
        // File doesn't exist — agent not configured
      }
    }

    if (configured.length === 0) {
      return { label: 'AI agent config', status: 'warn', detail: 'No agents configured', action: 'nexus mcp setup' };
    }
    return { label: 'AI agent config', status: 'ok', detail: configured.join(', ') };
  } catch {
    return { label: 'AI agent config', status: 'error', detail: 'Check failed' };
  }
}

async function checkAiProvider(graphqlAvailable: boolean): Promise<CheckResult> {
  if (!graphqlAvailable) {
    return { label: 'AI provider', status: 'skip', detail: 'Local not running' };
  }
  try {
    const { getClient } = await import('../utils/graphql');
    const client = getClient({ timeout: 5000 });
    const result = await client.mutate<{ nexusAiGetConfig: any }>(`
      mutation { nexusAiGetConfig { success config { provider model hasApiKey useLocalGateway } } }
    `, {});
    const { success, config } = result.nexusAiGetConfig;
    if (!success || !config?.provider) {
      return { label: 'AI provider', status: 'warn', detail: 'Not configured', action: 'nexus ai config' };
    }
    const label = PROVIDER_LABELS[config.provider] ?? config.provider;
    if (!config.hasApiKey && config.provider !== 'ollama') {
      return { label: 'AI provider', status: 'warn', detail: `${label} · no API key`, action: 'nexus ai config' };
    }
    return { label: 'AI provider', status: 'ok', detail: label };
  } catch {
    return { label: 'AI provider', status: 'skip', detail: 'Could not reach addon' };
  }
}

async function checkGateway(graphqlAvailable: boolean): Promise<CheckResult> {
  if (!graphqlAvailable) {
    return { label: 'Local Gateway', status: 'skip', detail: 'Local not running' };
  }
  try {
    const { getClient } = await import('../utils/graphql');
    const client = getClient({ timeout: 5000 });
    const result = await client.mutate<{ nexusAiGetConfig: any }>(`
      mutation { nexusAiGetConfig { success config { useLocalGateway } } }
    `, {});
    const enabled = result.nexusAiGetConfig?.config?.useLocalGateway;
    return enabled
      ? { label: 'Local Gateway', status: 'ok', detail: 'Enabled' }
      : { label: 'Local Gateway', status: 'disabled', detail: 'Disabled' };
  } catch {
    return { label: 'Local Gateway', status: 'skip', detail: 'Could not reach addon' };
  }
}

function readSiteAiConfigs(): Record<string, unknown> {
  try {
    const p = path.join(getLocalPaths().dataDir, 'nexus-ai_site_ai_config.json');
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function checkSitesWithAI(graphqlAvailable: boolean): Promise<CheckResult> {
  if (!graphqlAvailable) {
    return { label: 'Sites with AI', status: 'skip', detail: 'Local not running' };
  }
  try {
    const { getClient } = await import('../utils/graphql');
    const client = getClient({ timeout: 8000 });
    const result = await client.mutate<{ nexusSitesList: any }>(`
      mutation { nexusSitesList { local { name status } } }
    `, {});

    const sites: Array<{ name: string; status: string }> = result.nexusSitesList?.local ?? [];
    const total = sites.length;

    if (total === 0) {
      return { label: 'Sites with AI', status: 'skip', detail: 'No local sites found' };
    }

    // Read AI config from disk — no separate GraphQL mutation needed
    const siteAiConfigs = readSiteAiConfigs();
    const configuredCount = Object.keys(siteAiConfigs).length;
    const running = sites.filter((s) => s.status === 'running');

    const detail = `${configuredCount} / ${total} site${total !== 1 ? 's' : ''} configured · ${running.length} running`;

    if (configuredCount === 0) {
      const firstRunning = running[0];
      return {
        label: 'Sites with AI',
        status: 'warn',
        detail,
        action: firstRunning ? `nexus ai setup ${firstRunning.name}` : 'nexus ai setup <sitename>',
      };
    }

    return { label: 'Sites with AI', status: 'ok', detail };
  } catch {
    return { label: 'Sites with AI', status: 'skip', detail: 'Could not reach addon' };
  }
}

// ---------------------------------------------------------------------------
// Report rendering
// ---------------------------------------------------------------------------

const COL_LABEL = 18; // label column width

function formatRow(result: CheckResult): string {
  const icon = ICON[result.status];
  const label = result.label.padEnd(COL_LABEL);
  const detail = result.detail ? `  ${result.detail}` : '';
  return `  ${icon}  ${label}${detail}`;
}

function isFirstRun(checks: CheckResult[]): boolean {
  // "First run" = MCP not configured AND no AI provider set
  const mcp = checks.find((c) => c.label === 'MCP server');
  const ai = checks.find((c) => c.label === 'AI provider');
  return mcp?.status === 'warn' && ai?.status === 'warn';
}

function renderReport(checks: CheckResult[], version: string): void {
  const line = '─'.repeat(50);
  const localRunning = checks.find((c) => c.label === 'Local running')?.status === 'ok';

  console.log('');
  console.log(`Nexus AI v${version} — System Health`);
  console.log(line);
  for (const check of checks) {
    console.log(formatRow(check));
  }
  console.log(line);

  const nextSteps = checks
    .filter((c) => c.action && (c.status === 'warn' || c.status === 'error'))
    .map((c) => c.action!);

  if (nextSteps.length > 0) {
    console.log('');
    if (isFirstRun(checks) && !localRunning) {
      console.log('  Getting started:');
      console.log('');
      console.log('  1. Open the Local app and make sure Nexus AI addon is enabled.');
      console.log('  2. Connect your AI agent:   nexus mcp setup');
      console.log('  3. Configure AI provider:   nexus ai config');
      console.log('');
    } else if (isFirstRun(checks)) {
      console.log('  Getting started:');
      console.log('');
      console.log('  1. Connect your AI agent:    nexus mcp setup');
      console.log('  2. Configure AI provider:    nexus ai config');
      console.log('  3. Set up a WordPress site:  nexus ai setup <sitename>');
      console.log('');
    } else {
      console.log('  Next steps:');
      for (const step of [...new Set(nextSteps)]) {
        console.log(`  → ${step}`);
      }
      console.log('');
    }
  } else {
    console.log('');
    console.log('  Everything looks good. 🎉');
    console.log('');
  }
}

function renderJson(checks: CheckResult[], version: string): void {
  const output = {
    version,
    healthy: checks.every((c) => c.status === 'ok' || c.status === 'disabled' || c.status === 'skip'),
    checks: checks.map((c) => ({
      label: c.label,
      status: c.status,
      detail: c.detail ?? null,
      action: c.action ?? null,
    })),
  };
  console.log(JSON.stringify(output, null, 2));
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

export const doctorCommand = new Command('doctor')
  .description('Check system health and show setup status')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    const cliPkg = (() => {
      try { return require('../../../package.json') as { version: string }; } catch { return { version: '?' }; }
    })();
    const version = cliPkg.version;

    const checks: CheckResult[] = [];

    // ── Phase 1: checks that never need Local/GraphQL ────────────────────
    checks.push(await checkLocalInstalled());
    checks.push(await checkLocalRunning());
    checks.push(await checkAddon());
    const versionMatch = await checkVersionMatch();
    if (versionMatch) checks.push(versionMatch);
    checks.push(await checkGraphQL());
    checks.push(await checkMcpServer());
    checks.push(await checkAgentConfig());

    // ── Phase 2: checks that need GraphQL (only if GraphQL is reachable) ─
    const graphqlAvailable = checks.find((c) => c.label === 'GraphQL server')?.status === 'ok';
    checks.push(await checkAiProvider(graphqlAvailable));
    checks.push(await checkGateway(graphqlAvailable));
    checks.push(await checkSitesWithAI(graphqlAvailable));

    // ── Output ────────────────────────────────────────────────────────────
    if (options.json) {
      renderJson(checks, version);
    } else {
      renderReport(checks, version);
    }

    // Exit with non-zero if any check is 'error'
    const hasError = checks.some((c) => c.status === 'error');
    if (hasError) process.exit(1);
  });
