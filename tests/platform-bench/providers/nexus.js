/**
 * Nexus provider — drives Claude with the local-nexus-ai MCP server.
 *
 * Prerequisites:
 *   - Local must be running with the addon loaded (run `nexus doctor`)
 *   - MCP config: tests/platform-bench/nexus-mcp.json
 */

const { execSync } = require('child_process');
const path = require('path');
const { benchCwd, MCP_ONLY_FLAGS, BENCH_MODEL, parseClaudeJson } = require('./isolation');
const TIMEOUT_MS = 300_000;
const MCP_CONFIG = path.join(__dirname, '..', 'nexus-mcp.json');

module.exports = class NexusProvider {
  id() { return 'nexus-mcp'; }

  async callApi(prompt) {
    const escaped = prompt.replace(/'/g, "'\\''");
    const cmd = [
      'claude',
      '--model', BENCH_MODEL,
      '--mcp-config', MCP_CONFIG,
      '--strict-mcp-config',
      ...MCP_ONLY_FLAGS,
      '--dangerously-skip-permissions',
      '--output-format', 'json',
      '-p', `'${escaped}'`,
    ].join(' ');

    try {
      const raw = execSync(cmd, {
        encoding: 'utf8',
        timeout: TIMEOUT_MS,
        cwd: benchCwd('nexus'),
        env: { ...process.env },
        stdio: ['pipe', 'pipe', 'pipe'],
        input: '',
      });
      return parseClaudeJson(raw, 'Nexus');
    } catch (err) {
      const msg = (err.stdout || err.stderr || err.message || '').toString().slice(0, 500);
      return {
        error: `Nexus provider error: ${msg}`,
        output: '',
      };
    }
  }
};
