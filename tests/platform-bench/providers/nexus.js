/**
 * Nexus provider — drives Claude with the local-nexus-ai MCP server.
 *
 * Runs `claude -p "<prompt>" --mcp-server local-nexus-ai` via the same
 * CLI binary the rest of the project uses. This is the most faithful
 * representation of what a user gets from Nexus: the full tool surface,
 * the same model, no hand-holding in the system prompt.
 *
 * The nexus MCP server must be running (Local must be up with the addon loaded).
 * Run `nexus doctor` to verify before running the benchmark.
 */

const { execSync } = require('child_process');
const path = require('path');

const MODEL = process.env.BENCH_MODEL ?? 'claude-sonnet-5';
const TIMEOUT_MS = 300_000; // 5 min — some Nexus tool chains take time

module.exports = class NexusProvider {
  id() { return 'nexus-mcp'; }

  async callApi(prompt) {
    const escaped = prompt.replace(/'/g, "'\\''");
    const cmd = [
      'claude',
      '--model', MODEL,
      '--mcp-server', 'local-nexus-ai',
      '-p', `'${escaped}'`,
    ].join(' ');

    const startMs = Date.now();
    try {
      const output = execSync(cmd, {
        encoding: 'utf8',
        timeout: TIMEOUT_MS,
        // inherit PATH so the claude binary is found
        env: { ...process.env },
      });
      const durationMs = Date.now() - startMs;
      return {
        output: output.trim(),
        // Promptfoo uses cost and tokenUsage when available; claude CLI doesn't
        // expose them easily, so we omit rather than fabricate.
        metadata: { durationMs },
      };
    } catch (err) {
      return {
        error: `Nexus provider error: ${err.message?.slice(0, 300)}`,
        output: '',
      };
    }
  }
};
