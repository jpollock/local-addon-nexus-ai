/**
 * Promptfoo MCP provider — runs the eval prompt via `claude -p`
 * with all local-nexus-ai MCP tools allowed.
 */
const { spawnSync } = require('child_process');
const path = require('path');
const os = require('os');

const CLAUDE_BIN = path.join(os.homedir(), '.claude', 'local', 'claude');
const TIMEOUT_MS = 600_000; // 10 min

function extractFinalResult(streamJson) {
  try {
    const lines = streamJson.split('\n').filter(Boolean);
    let lastText = '';
    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        if (obj.type === 'result' && obj.result) return obj.result;
        if (obj.type === 'assistant' && obj.message?.content) {
          for (const block of obj.message.content) {
            if (block.type === 'text') lastText = block.text;
          }
        }
      } catch { /* skip malformed lines */ }
    }
    return lastText || '[no result]';
  } catch {
    return '[parse error]';
  }
}

function extractCost(streamJson) {
  try {
    const lines = streamJson.split('\n').filter(Boolean);
    for (const line of lines.reverse()) {
      try {
        const obj = JSON.parse(line);
        if (obj.usage?.total_cost_usd != null) return obj.usage.total_cost_usd;
        if (obj.cost_usd != null) return obj.cost_usd;
      } catch { /* skip */ }
    }
  } catch { /* skip */ }
  return null;
}

class MCPProvider {
  id() { return 'mcp'; }

  async callApi(prompt) {
    const args = [
      '-p', prompt,
      '--output-format', 'stream-json',
      '--verbose',
      '--no-session-persistence',
      '--dangerously-skip-permissions',
      '--allowedTools', 'mcp__local-nexus-ai__*',
    ];

    const result = spawnSync(CLAUDE_BIN, args, {
      encoding: 'utf-8',
      timeout: TIMEOUT_MS,
      maxBuffer: 20 * 1024 * 1024,
      env: { ...process.env, CI: '1' },
    });

    const output = extractFinalResult(result.stdout || '');
    const cost = extractCost(result.stdout || '');

    return {
      output,
      cost,
      tokenUsage: cost ? { cost } : undefined,
    };
  }
}

module.exports = MCPProvider;
