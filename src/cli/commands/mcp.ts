/**
 * MCP Commands
 *
 * Check MCP server status and generate agent setup configs.
 * These commands intentionally skip the bootstrap check — status reads the
 * connection-info file directly, and setup works without Local running.
 */

import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawnSync } from 'child_process';

// ---------------------------------------------------------------------------
// Agent registry
// ---------------------------------------------------------------------------

type AgentId = 'claude-code' | 'claude-desktop' | 'cursor' | 'windsurf' | 'cline' | 'gemini';

interface AgentDef {
  label: string;
  /** 'cli' agents use a shell command to register. 'file' agents use a JSON config file. */
  type: 'cli' | 'file';
  /** Only for 'file' agents — returns the absolute path to the config file. */
  configPath?: () => string;
  /** Notes printed after the config (e.g. restart instructions). */
  note?: string;
}

const AGENTS: Record<AgentId, AgentDef> = {
  'claude-code': {
    label: 'Claude Code',
    type: 'cli',
    note: 'No restart needed — takes effect immediately.',
  },
  'claude-desktop': {
    label: 'Claude Desktop',
    type: 'file',
    configPath: () => {
      if (process.platform === 'win32') {
        return path.join(os.homedir(), 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json');
      }
      if (process.platform === 'darwin') {
        return path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
      }
      return path.join(os.homedir(), '.config', 'Claude', 'claude_desktop_config.json');
    },
    note: 'Restart Claude Desktop to apply changes.',
  },
  'cursor': {
    label: 'Cursor',
    type: 'file',
    configPath: () => path.join(os.homedir(), '.cursor', 'mcp.json'),
    note: 'Restart Cursor or reload the MCP config (Cmd+Shift+P > "Reload MCP").',
  },
  'windsurf': {
    label: 'Windsurf',
    type: 'file',
    configPath: () => path.join(os.homedir(), '.codeium', 'windsurf', 'mcp_config.json'),
    note: 'Restart Windsurf to apply changes.',
  },
  'cline': {
    label: 'Cline (VS Code)',
    type: 'file',
    configPath: () => {
      const base = process.platform === 'win32'
        ? path.join(os.homedir(), 'AppData', 'Roaming')
        : process.platform === 'darwin'
          ? path.join(os.homedir(), 'Library', 'Application Support')
          : path.join(os.homedir(), '.config');
      return path.join(base, 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json');
    },
    note: 'Reload Cline\'s MCP config via the Cline panel in VS Code.',
  },
  'gemini': {
    label: 'Gemini CLI',
    type: 'file',
    configPath: () => path.join(os.homedir(), '.gemini', 'settings.json'),
    note: 'No restart needed — Gemini CLI reads settings on each invocation.',
  },
};

const AGENT_IDS = Object.keys(AGENTS) as AgentId[];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the absolute path to bin/mcp-stdio.js.
 * Works in both dev (ts-node) and production (lib/cli/commands → bin/).
 */
function resolveStdioPath(): string {
  // process.argv[1] is always bin/nexus.js — mcp-stdio.js is in the same dir.
  const binDir = path.dirname(path.resolve(process.argv[1]));
  const candidate = path.join(binDir, 'mcp-stdio.js');
  if (fs.existsSync(candidate)) return candidate;

  // Dev fallback: walk up from __dirname (lib/cli/commands/ → root/bin/)
  return path.resolve(__dirname, '..', '..', '..', 'bin', 'mcp-stdio.js');
}

function getConnectionInfoPath(): string {
  const dir = process.platform === 'win32'
    ? path.join(process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), 'Local')
    : process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Application Support', 'Local')
      : path.join(os.homedir(), '.config', 'Local');
  return path.join(dir, 'nexus-ai-mcp-connection-info.json');
}

function loadConnectionInfo(): { url: string; authToken: string; port: number; version: string; tools: string[] } | null {
  try {
    return JSON.parse(fs.readFileSync(getConnectionInfoPath(), 'utf-8'));
  } catch {
    return null;
  }
}

/** Returns true if the MCP HTTP server is reachable right now. */
async function checkServerLive(url: string, token: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/health`, {
      signal: AbortSignal.timeout(3000),
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Build the mcpServers entry we inject into any config file. */
function buildServerEntry(stdioPath: string) {
  return { command: 'node', args: [stdioPath] };
}

/** Read a JSON config file, merge our server in, write back. Creates the file if missing. */
function writeToConfigFile(configPath: string, stdioPath: string): void {
  let config: Record<string, any> = {};
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch {
    // File doesn't exist or is invalid — start fresh
  }

  if (!config.mcpServers) config.mcpServers = {};
  config.mcpServers['local-nexus-ai'] = buildServerEntry(stdioPath);

  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

const mcpCommand = new Command('mcp').description('MCP server management and agent setup');

/**
 * nexus mcp status
 */
mcpCommand
  .command('status')
  .description('Show MCP server status and connection info')
  .action(async () => {
    const info = loadConnectionInfo();
    if (!info) {
      console.log('\n⚫ MCP server is not running');
      console.log('  Start Local with the Nexus AI addon enabled.\n');
      return;
    }

    const live = await checkServerLive(info.url, info.authToken);
    const statusIcon = live ? '✅' : '⚠️ ';
    const statusText = live ? 'Running' : 'Configured but not responding';

    const line = '─'.repeat(48);
    console.log('\nNexus AI MCP Server');
    console.log(line);
    console.log(`  Status:  ${statusIcon} ${statusText}`);
    console.log(`  URL:     ${info.url}`);
    console.log(`  Port:    ${info.port}`);
    console.log(`  Tools:   ${info.tools.length}`);
    console.log(`  Version: ${info.version}`);
    console.log(line);
    console.log('');
    if (live) {
      console.log('  Run "nexus mcp setup" to configure your AI agent.');
    } else {
      console.log('  Is Local running with the Nexus AI addon enabled?');
    }
    console.log('');
  });

/**
 * nexus mcp setup
 */
mcpCommand
  .command('setup')
  .description('Generate or write MCP config for your AI agent')
  .option(
    '--agent <name>',
    `Agent to configure: ${AGENT_IDS.join(', ')}`,
  )
  .option('--write', 'Write config directly to the agent\'s config file')
  .action(async (options) => {
    const stdioPath = resolveStdioPath();

    // Interactive agent selection if not specified
    let agentId = options.agent as AgentId | undefined;
    if (!agentId) {
      console.log('\nSelect your AI agent:');
      AGENT_IDS.forEach((id, i) => console.log(`  ${i + 1}. ${AGENTS[id].label}`));

      const readline = await import('readline');
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const answer = await new Promise<string>((resolve) => rl.question('\nChoice [1]: ', resolve));
      rl.close();

      const idx = (parseInt(answer, 10) || 1) - 1;
      agentId = AGENT_IDS[Math.min(Math.max(idx, 0), AGENT_IDS.length - 1)];
    }

    if (!AGENTS[agentId]) {
      console.error(`\n❌ Unknown agent: ${agentId}`);
      console.error(`   Valid options: ${AGENT_IDS.join(', ')}`);
      process.exit(1);
    }

    const agent = AGENTS[agentId];

    // --- Claude Code: uses `claude mcp add` CLI ---
    if (agentId === 'claude-code') {
      const cmd = `claude mcp add local-nexus-ai -- node "${stdioPath}"`;
      if (options.write) {
        console.log(`\nRunning: ${cmd}\n`);
        // claude is often an alias — resolve to full path
        const claudeBin = [
          `${process.env.HOME}/.claude/local/claude`,
          '/usr/local/bin/claude',
        ].find((p) => { try { return require('fs').existsSync(p); } catch { return false; } }) ?? 'claude';
        const result = spawnSync(claudeBin, ['mcp', 'add', 'local-nexus-ai', '--', 'node', stdioPath], {
          stdio: ['pipe', 'pipe', 'pipe'],
          shell: false,
        });
        const stderr = result.stderr?.toString() ?? '';
        const stdout = result.stdout?.toString() ?? '';
        const alreadyExists = stderr.includes('already exists') || stdout.includes('already exists');
        if (result.status !== 0 && !alreadyExists) {
          console.error('\n❌ Failed to run `claude mcp add`. Is Claude Code installed?');
          console.error(`   Run manually: ${cmd}`);
          process.exit(1);
        }
        if (alreadyExists) {
          console.log('\n✅ local-nexus-ai already configured in Claude Code');
        } else {
          console.log('\n✅ local-nexus-ai added to Claude Code');
        }
        if (agent.note) console.log(`   ${agent.note}`);
      } else {
        console.log(`\n${agent.label} — run in your terminal:\n`);
        console.log(`  ${cmd}\n`);
      }
      console.log('');
      return;
    }

    // --- File-based agents ---
    const configPath = agent.configPath!();
    const entry = buildServerEntry(stdioPath);
    const snippet = JSON.stringify({ 'local-nexus-ai': entry }, null, 2);

    if (options.write) {
      writeToConfigFile(configPath, stdioPath);
      const shortPath = configPath.replace(os.homedir(), '~');
      console.log(`\n✅ local-nexus-ai added to ${shortPath}`);
      if (agent.note) console.log(`   ${agent.note}`);
    } else {
      const shortPath = configPath.replace(os.homedir(), '~');
      console.log(`\n${agent.label}`);
      console.log('─'.repeat(48));
      console.log(`Config file: ${shortPath}`);
      console.log('\nAdd this under "mcpServers":\n');
      console.log(snippet.split('\n').map((l) => `  ${l}`).join('\n'));
      console.log('');
      if (agent.note) console.log(`Note: ${agent.note}`);
      console.log('\nOr run with --write to add it automatically.');
    }
    console.log('');
  });

export { mcpCommand };
