/**
 * Rubric grader for the platform benchmark.
 *
 * promptfoo's `llm-rubric` assertion renders a grading prompt (rubric + the
 * output under test, instructing the model to reply with JSON
 * {reason, pass, score}) and sends it to the provider configured at
 * `defaultTest.options.provider` — this file. We shell to `claude -p` because
 * this environment has no ANTHROPIC_API_KEY (verified 2026-08-25): the claude
 * CLI's own auth is the only model access the harness has, for columns and
 * grader alike.
 *
 * Grading is BLIND by construction: promptfoo's rubric prompt contains the
 * rubric and the output text, never the provider label. Keep it that way — the
 * rubrics in promptfooconfig.yaml must not name a column either.
 *
 * The grader is isolated exactly like a column: its own cwd under
 * ~/.nexus-bench/ (so run.sh's memory sweep covers it, and this repo's
 * CLAUDE.md is not loaded), an EMPTY --strict-mcp-config (no tools to call),
 * and --tools '' (no built-ins). A grader that can browse is not a grader.
 *
 * No temperature flag exists on the CLI; determinism is enforced by
 * verify-assertions.js's corpus instead (spec §3.1 deviation, accepted).
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { benchCwd, GRADER_MODEL } = require('./isolation');

const TIMEOUT_MS = 120_000;

module.exports = class GraderProvider {
  id() { return `grader-${GRADER_MODEL}`; }

  async callApi(prompt) {
    const cwd = benchCwd('grader');
    const emptyMcp = path.join(cwd, 'empty-mcp.json');
    fs.writeFileSync(emptyMcp, '{"mcpServers":{}}');

    try {
      const raw = execFileSync('claude', [
        '--model', GRADER_MODEL,
        '--mcp-config', emptyMcp,
        '--strict-mcp-config',
        // execFileSync passes a REAL empty argv element — do not reuse
        // MCP_ONLY_FLAGS here: its "''" is shell quoting for the string-joined
        // execSync commands in the column providers, and would arrive as two
        // literal apostrophes down this path.
        '--tools', '',
        '--output-format', 'json',
        '--dangerously-skip-permissions',
        '-p', prompt,
      ], { encoding: 'utf8', timeout: TIMEOUT_MS, cwd, input: '', stdio: ['pipe', 'pipe', 'pipe'] });

      const parsed = JSON.parse(raw);
      let text = String(parsed.result ?? '');
      // promptfoo parses the grader's reply as JSON. Models sometimes wrap it
      // in prose or a markdown fence; hand back just the outermost object.
      const a = text.indexOf('{');
      const b = text.lastIndexOf('}');
      if (a !== -1 && b > a) text = text.slice(a, b + 1);
      return { output: text, cost: parsed.total_cost_usd };
    } catch (err) {
      const msg = (err.stdout || err.stderr || err.message || '').toString().slice(0, 300);
      return { error: `grader error: ${msg}`, output: '' };
    }
  }
};
