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

module.exports = { MCP_ONLY_FLAGS, BENCH_ROOT, benchCwd };
