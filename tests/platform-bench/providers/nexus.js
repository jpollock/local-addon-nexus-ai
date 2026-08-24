/**
 * Nexus provider — drives Claude with the local-nexus-ai MCP server.
 *
 * Prerequisites:
 *   - Local must be running with the addon loaded (run `nexus doctor`)
 *   - MCP config: tests/platform-bench/nexus-mcp.json
 */

const { execSync } = require('child_process');
const path = require('path');

const MODEL = process.env.BENCH_MODEL ?? 'claude-opus-5';
const TIMEOUT_MS = 300_000;
const MCP_CONFIG = path.join(__dirname, '..', 'nexus-mcp.json');

module.exports = class NexusProvider {
  id() { return 'nexus-mcp'; }

  async callApi(prompt) {
    const escaped = prompt.replace(/'/g, "'\\''");
    const cmd = [
      'claude',
      '--model', MODEL,
      '--mcp-config', MCP_CONFIG,
      '--dangerously-skip-permissions',
      '-p', `'${escaped}'`,
    ].join(' ');

    const startMs = Date.now();
    try {
      const output = execSync(cmd, {
        encoding: 'utf8',
        timeout: TIMEOUT_MS,
        env: { ...process.env },
        stdio: ['pipe', 'pipe', 'pipe'],
        input: '',
      });
      return {
        output: output.trim(),
        metadata: { durationMs: Date.now() - startMs },
      };
    } catch (err) {
      const msg = (err.stdout || err.stderr || err.message || '').toString().slice(0, 500);
      return {
        error: `Nexus provider error: ${msg}`,
        output: '',
      };
    }
  }
};
