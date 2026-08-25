/**
 * Column isolation for the platform benchmark.
 *
 * Two leaks were found in eval-t7J-2026-08-24T22:22:15, and both are closed here.
 *
 * ── Leak 1: built-in tools ────────────────────────────────────────────────────
 * `--strict-mcp-config` isolates MCP *servers*. It does NOT disable Claude Code's
 * built-in tools, so the Nexus column was free to answer with WebFetch against a
 * site's REST API and Bash-scraped HTML — i.e. to score points its MCP surface
 * never earned. `--tools ""` disables every built-in (Bash, WebFetch, Read,
 * Write, Grep, Glob, Task, Skill) while leaving every MCP tool available.
 * Verified empirically 2026-08-24: the probe run listed the full
 * mcp__local-nexus-ai__* set and reported zero built-ins.
 *
 * The benchmark measures what each MCP surface can answer. A column that
 * scrapes is not that column — it is `claude` with a browser.
 *
 * ── Leak 2: shared per-cwd memory ─────────────────────────────────────────────
 * Claude Code keeps persistent memory per working directory, at
 * `~/.claude/projects/<slugified-cwd>/memory/`, injected into every session that
 * starts in that cwd. `run.sh` did `cd /tmp`, so all 24 subprocesses of that eval
 * — BOTH columns, every repeat — shared `~/.claude/projects/-private-tmp/memory/`.
 * One run wrote the complete CV-B-01 answer there (the 23-provider overlap, the
 * post-id collision trap, the NPI join key) at 22:42:10Z, mid-eval, and later runs
 * of both columns read it back as ambient context. A repeat count over a shared
 * memory measures memorisation, not capability.
 *
 * Each column now runs in its own dedicated cwd under `~/.nexus-bench/`, so the
 * columns can no longer see each other. `run.sh` clears the matching memory dirs
 * before every eval so runs cannot see each other either. `--tools ""` removes
 * the Write tool, which was the only way memory got written in the first place —
 * the separate cwds are the belt to that suspenders.
 *
 * The bench cwds are deliberately outside this repo: a cwd inside it would load
 * the project CLAUDE.md into every subprocess, which is contamination of the same
 * kind wearing a different hat.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

/** Flags that reduce a column to exactly its MCP surface. */
const MCP_ONLY_FLAGS = ['--tools', "''"];

/** Root for per-column working directories. Matched by run.sh's memory sweep. */
const BENCH_ROOT = path.join(os.homedir(), '.nexus-bench');

/**
 * Dedicated working directory for one column. Stable across runs (so the memory
 * dir it maps to is greppable and auditable) and distinct per column (so columns
 * cannot share one).
 */
function benchCwd(column) {
  const dir = path.join(BENCH_ROOT, column);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * ── Pins ──────────────────────────────────────────────────────────────────────
 * Every variable that changes what the benchmark measures is pinned here, in one
 * place, and recorded in each run's manifest. The /model incident (2026-08-25):
 * providers used to inherit the operator's saved default model, so a `/model`
 * switch in an unrelated Claude Code session silently changed the benchmark's
 * subject. BENCH_MODEL stays env-overridable for deliberate experiments; the
 * manifest records what actually ran.
 */
const PF_VERSION = '0.122.0';
const BENCH_MODEL = process.env.BENCH_MODEL ?? 'claude-opus-5';
const GRADER_MODEL = 'claude-haiku-4-5-20251001';

/**
 * ── Model backend ─────────────────────────────────────────────────────────────
 * The `claude` CLI serves the SAME pinned model ids from three different
 * backends and chooses by environment: Vertex, Bedrock, or Anthropic direct.
 * Verified 2026-08-25: both `claude-opus-5` and the grader's haiku pin resolve
 * cleanly under Vertex AND under a direct OAuth login. A run on the wrong
 * backend therefore does not fail — it silently succeeds and bills a different
 * account, which is worse, because nothing in the output says which one served.
 *
 * It matters twice. Cost is not comparable across backends (measured on one
 * trivial prompt: opus $0.136 via Vertex vs $0.168 direct; haiku $0.032 vs
 * $0.020 — differing in BOTH directions, largely cache state), and neither is
 * latency, since quotas differ. Column-vs-column fairness is untouched: both
 * columns inherit one process environment, so they always share a backend. The
 * damage is confined to comparing one archived run against another — which is
 * exactly what results/ exists for.
 *
 * On this machine ~/.zshrc exports CLAUDE_CODE_USE_VERTEX=1, so a fresh
 * terminal runs on WP Engine's Vertex project and a shell that unset it runs on
 * a personal account — a distinction invisible after the fact. Hence the gate
 * in run.sh and the record in the manifest.
 */
const envOn = (name) => {
  const v = process.env[name];
  return !!v && v !== '0' && v.toLowerCase() !== 'false';
};

function resolveModelBackend() {
  if (envOn('CLAUDE_CODE_USE_BEDROCK')) {
    return { backend: 'bedrock', region: process.env.AWS_REGION ?? null };
  }
  if (envOn('CLAUDE_CODE_USE_VERTEX')) {
    return {
      backend: 'vertex',
      project: process.env.ANTHROPIC_VERTEX_PROJECT_ID ?? null,
      region: process.env.CLOUD_ML_REGION ?? null,
    };
  }
  if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) {
    return { backend: 'anthropic-api' };
  }
  return { backend: 'anthropic-oauth' };
}

/**
 * The default is the PERSONAL Anthropic login, not WP Engine’s Vertex project.
 * Two reasons. The runs already in results/ were produced through a shell with
 * CLAUDE_CODE_USE_VERTEX unset, so personal is what the existing ledger most
 * likely measures, and matching it keeps new runs comparable with old ones.
 * (Likely, not certain — no run archived before 2026-08-25 recorded its backend,
 * which is the whole reason this field now exists. That inference is deliberately
 * NOT written back into those manifests: writing a guess into a record that says
 * it does not know is the fabrication the honest-manifest rule forbids.) Second,
 * benchmark spend is discretionary and endlessly repeatable; it should not land
 * on an employer’s cloud project merely because nobody chose.
 *
 * NOTE: ~/.zshrc on this machine exports CLAUDE_CODE_USE_VERTEX=1, so a FRESH
 * terminal trips this gate every time. That is intended, not a bug — the refusal
 * names the one-line fix — but expect it.
 *
 * Deviating is allowed and must be DECLARED, never stumbled into:
 *   BENCH_EXPECTED_BACKEND=vertex ./run.sh
 * There is deliberately no blanket skip flag — you name the backend you expect,
 * and the manifest records the one that actually served.
 */
const EXPECTED_BACKEND = process.env.BENCH_EXPECTED_BACKEND ?? 'anthropic-oauth';

/**
 * Parse `claude -p --output-format json` stdout into a promptfoo provider
 * response. Field names verified live 2026-08-25: result, total_cost_usd,
 * num_turns, duration_ms, is_error, session_id.
 * Never lose a run to a parse bug: unparseable stdout is returned as raw text.
 */
function parseClaudeJson(raw, columnName) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { output: String(raw).trim(), metadata: { parseFailed: true } };
  }
  const base = {
    cost: parsed.total_cost_usd,
    metadata: {
      durationMs: parsed.duration_ms,
      numTurns: parsed.num_turns,
      sessionId: parsed.session_id,
    },
  };
  if (parsed.is_error) {
    return { ...base, error: `${columnName} claude error: ${String(parsed.result ?? '').slice(0, 500)}`, output: '' };
  }
  return { ...base, output: String(parsed.result ?? '').trim() };
}

module.exports = {
  MCP_ONLY_FLAGS, BENCH_ROOT, benchCwd,
  PF_VERSION, BENCH_MODEL, GRADER_MODEL,
  resolveModelBackend, EXPECTED_BACKEND,
  parseClaudeJson,
};
