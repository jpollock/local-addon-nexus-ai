# Eval Framework — Developer Guide

Evaluates Claude's performance on real-world Nexus AI tasks. Runs each eval case through both **MCP mode** (Claude uses Nexus MCP tools directly) and **CLI/Skills mode** (Claude uses the `nexus` CLI via Bash, guided by skills), captures exact API costs, and produces side-by-side scorecards for human review.

---

## Quick Reference

```bash
./eval                          # Show status and next step
./eval mcp-on                   # Connect Nexus MCP before MCP runs
./eval mcp-off                  # Disconnect Nexus MCP before CLI runs
./eval run mcp                  # Run all 10 cases in MCP mode
./eval run cli                  # Run all 10 cases in CLI/Skills mode
./eval analyze                  # Auto-analyze latest run pair
./eval score 02-fleet-version-drift  # Human-score one case (side-by-side)
./eval score                    # List all scoreable cases
./eval open                     # Open results folder in Finder
```

---

## Directory Layout

```
tests/evals/
  cases/                        # Eval case definitions (YAML)
    01-single-field-lookup.yaml
    02-fleet-version-drift.yaml
    ...
  runner/                       # TypeScript scripts
    auto-eval.ts                # Automated runner (main entry point)
    analyze-runs.ts             # Auto-analysis without human input
    compare-eval.ts             # Interactive side-by-side scoring
    score-eval.ts               # Score one transcript
    token-counter.ts            # Char-based token estimation (legacy)
    run-eval.ts                 # Manual run printer (legacy, pre-automation)
    README.md                   # Quick-start reference
  results/                      # One directory per run
    2026-04-15-mcp/
      01-single-field-lookup-transcript.txt
      01-single-field-lookup-raw.jsonl
      01-single-field-lookup-scorecard.md
      ...
    2026-04-15-cli-skills/
      ...
    analysis-2026-04-15.md      # Auto-analysis report
    comparison-table.md         # Human scores across all runs
    improvements.md             # Auto-generated improvement ideas
  config.yaml                   # WPE accounts, installs, guardrails

eval                            # Top-level bash wrapper (root of repo)
```

---

## How a Run Works

### 1. Mode setup

Each mode requires a different MCP state. The runner enforces this before running any cases.

| Mode | Nexus MCP | Why |
|------|-----------|-----|
| `cli-skills` | **Disconnected** | When any nexus MCP is connected, Claude prefers MCP tools over the CLI. The CLI eval becomes meaningless. |
| `mcp` | **Connected** | Claude needs the MCP tools to be available. |

Use `./eval mcp-on` and `./eval mcp-off` to toggle. These call `nexus mcp setup --agent claude-code --write` and `claude mcp remove local-nexus-ai` respectively.

The runner (`auto-eval.ts`) re-checks MCP state at startup and either aborts or prompts to disconnect automatically.

### 2. Case execution (`auto-eval.ts`)

For each case, the runner calls `claude -p` with these flags:

```
claude -p "<prompt>" \
  --output-format stream-json \
  --verbose \
  --no-session-persistence \
  --allowedTools "<tool allowlist>"
```

**`stream-json` output** — gives one JSON object per event (tool calls, tool results, usage, final result). This is how we get exact API costs instead of estimates.

**`--allowedTools`** differs by mode:
- MCP mode: explicit list of nexus MCP tools for that case (e.g. `mcp__local-nexus-ai__wp_core_version,mcp__local-nexus-ai__local_list_sites,...`). Prevents Claude from reaching for unrelated tools.
- CLI/Skills mode: `Bash(<nexus-path> *)` — allows any Bash call whose command starts with the nexus binary. All other tools (Read, Write, MCP, etc.) are blocked.

**CLI prompt prefix** — every CLI/Skills mode prompt is prefixed with two things:

1. **Nexus skill content** — all `~/.claude/skills/nexus-*/SKILL.md` files are read and injected directly. This replicates what the Skill tool does in an interactive session. The `Skill` tool is blocked by `--allowedTools` in `-p` mode, so without this injection Claude has no skill guidance and discovers the CLI from scratch via `--help` calls (34 tool calls instead of 4).

2. **Execution constraints**:
```
IMPORTANT CONSTRAINTS:
- The nexus CLI is at: node /path/to/bin/nexus.js (use this exact path)
- You MUST use ONLY the Bash tool — do NOT use Read, Write, Edit, Glob, Grep, or any MCP tools
- If you need information, get it by running nexus CLI commands
```

Bare `nexus` commands in skill files are automatically rewritten to the absolute path during injection.

**Nexus binary path** — the runner resolves `bin/nexus.js` in the dev repo directly, not via `which nexus`. This avoids picking up a published npm version (`~/node_modules/.bin/nexus`) that may be behind the dev version.

### 3. Output files

After each case, three files are written to the dated results directory:

**`<case>-transcript.txt`** — human-readable. Contains:
- Header (case, mode, date, model, duration, tool calls, cost)
- Per-turn: the prompt, all tool calls with `⏺ ToolName(input)` format, results with `⎿` prefix, reasoning text
- `--- FINAL RESULT ---` section with Claude's last response

**`<case>-raw.jsonl`** — the full `stream-json` output from `claude -p`. One JSON event per line. Contains exact token counts, cache creation/read tokens, tool inputs and outputs, and the `result` object. Use this to re-analyze without re-running.

**`<case>-scorecard.md`** — partial scorecard, auto-filled:
- Exact API costs (input, output, cache creation, cache read tokens)
- Tool call count, error events, duration
- `task_completed` auto-scored (100 if got a result, 0 if no result)
- Steps correct / friction / clarity left as TBD for human review

### 4. Multi-turn cases

Cases with a `conversation:` key (instead of `prompt:`) run multiple turns. The runner uses `--resume <session-id>` on turns 2+ to continue the same Claude session. Token costs are summed across all turns.

---

## Eval Case Format

```yaml
id: 02-fleet-version-drift
description: Fleet-scale read — find local sites behind on WordPress
mode: [mcp, cli-skills]          # which modes this case applies to

# Single-turn: use prompt
prompt: "Which of my local WordPress sites are running an outdated version?"

# Multi-turn: use conversation instead
# conversation:
#   - turn: 1
#     prompt: "Create a new local site called eval-test-onboard"
#   - turn: 2
#     prompt: "Now pull jppblank from WP Engine into that site"

guardrails:
  reads_only: true               # informational — not enforced by runner
  installs: [jppblank]           # which WPE installs are safe to touch

expected:
  task_completed: true
  key_steps:
    - lists all local sites with WP version
    - identifies sites running below latest
    - suggests update command
  must_not:
    - require user to list sites manually
    - check only one site
    - modify any site

scoring_weights:
  task_completed: 40
  steps_correct: 30
  friction_count: 20
  output_clarity: 10

notes: |
  CLI skill should use nexus fleet health or nexus sites list --json.
  MCP should call fleet_health_summary or nexus_list_sites + wp_core_version.
  Watch for: does CLI make per-site calls (20 calls) instead of one fleet call?
```

### MCP tool allowlist

For MCP mode, each case has a corresponding entry in the `MCP_TOOLS` map in `auto-eval.ts`. This is the explicit list of tool names Claude is allowed to call. Update it when you add new MCP tools that a case should be able to use.

```typescript
'02-fleet-version-drift': [
  'mcp__local-nexus-ai__nexus_list_sites',
  'mcp__local-nexus-ai__wp_core_version',
  'mcp__local-nexus-ai__fleet_health_summary',
  // ...
],
```

---

## Scoring Pipeline

### Automated scores (auto-eval.ts)

Only `task_completed` is auto-scored: 100 if Claude returned any non-empty result, 0 otherwise. This counts for 40% of the weighted total.

### Auto-analysis (analyze-runs.ts)

Run `./eval analyze` after both modes have a complete run. This script:
- Finds the most recent `*-cli-skills` and `*-mcp` result directories
- For each case, keyword-matches the transcript against `expected.key_steps` and `expected.must_not`
- Computes auto-steps score (0–100) based on keyword hit rate
- Flags review priority: **HIGH** if call count diverges >10, cost diverges >50%, score gap >15pts, or must-not keyword match; **MED** for one flag; **LOW** for clean cases
- Writes `results/analysis-YYYY-MM-DD.md`

Keyword matching is heuristic — stop words are filtered, remaining words are checked against the transcript. It catches obvious misses but can false-positive on must-not violations. Human review resolves ambiguity.

### Human scoring (compare-eval.ts)

```bash
./eval score 02-fleet-version-drift
```

This shows both transcripts side-by-side, then prompts for:

| Dimension | Weight | Guidance |
|-----------|--------|----------|
| Task completed | 40% | y/n — did it actually accomplish the stated goal? |
| Steps correct | 30% | 0–100 — did it follow the right sequence? |
| Friction | 20% | 100 = zero friction, 0 = constant errors/retries. Deduct ~10pts per wrong tool call, ~20pts per retry loop, ~30pts for total confusion. |
| Output clarity | 10% | 0–100 — was the final response clear and actionable? |

After scoring, compare-eval.ts:
- Writes the completed scorecard files to both mode directories
- Appends a row to `results/comparison-table.md`
- Appends improvement ideas to `results/improvements.md` (auto-generated from score gaps, call count divergence, failures)

### Score a single transcript non-interactively

```bash
npx ts-node tests/evals/runner/score-eval.ts \
  tests/evals/results/2026-04-15-cli-skills/02-fleet-version-drift-transcript.txt \
  --scores "y,90,85,90" \
  --notes "CLI made 20 per-site calls instead of fleet aggregation"
```

---

## Re-analyzing Raw JSONL

The `*-raw.jsonl` files contain the full `claude -p --output-format stream-json` output. Each line is one JSON event. Key event types:

| Type | Contains |
|------|---------|
| `system` / `init` | Tool list, MCP server status at session start |
| `assistant` | Tool calls (`tool_use` blocks), reasoning text (`thinking` blocks) |
| `user` | Tool results (`tool_result` blocks) |
| `result` | Final result text, `total_cost_usd`, `usage` (input/output/cache tokens), `duration_ms` |

To re-extract costs without re-running:
```bash
cat tests/evals/results/2026-04-15-cli-skills/02-fleet-version-drift-raw.jsonl \
  | grep '"type":"result"' \
  | python3 -c "import sys,json; [print(json.loads(l).get('total_cost_usd')) for l in sys.stdin]"
```

---

## Adding a New Eval Case

1. Create `tests/evals/cases/NN-my-new-case.yaml` following the format above.
2. Add an MCP tool allowlist entry in `auto-eval.ts` under `MCP_TOOLS`:
   ```typescript
   'NN-my-new-case': [
     'mcp__local-nexus-ai__...',
   ],
   ```
3. If the case creates local sites, name them with the `eval-test-` prefix (see `config.yaml`). The runner auto-cleans `eval-test-*` sites for onboarding cases.
4. Run one mode first to validate the case resolves cleanly before running both:
   ```bash
   npx ts-node tests/evals/runner/auto-eval.ts --mode cli-skills --case NN-my-new-case
   ```

---

## Token Cost Details

Costs come directly from the API `result` event — no estimation involved. The `usage` object includes:

- `input_tokens` — non-cached input
- `output_tokens` — generated tokens
- `cache_creation_input_tokens` — tokens written to the 5-minute prompt cache
- `cache_read_input_tokens` — tokens served from cache (billed at ~10% of input rate)

The `total_cost_usd` field in the `result` event is the authoritative cost per turn.

`token-counter.ts` (char-based estimation) is used only by the older `score-eval.ts` path. `auto-eval.ts` uses exact API costs exclusively.

---

## Environment Config

`tests/evals/config.yaml` documents the WPE accounts and installs used in evals. Key values:

- `test_account: w7579` — all eval-created WPE resources go here
- `read_installs` — installs safe for pull/read operations
- `test_site` / `test_prod` / `test_staging` — dedicated installs for write/promotion scenarios
- `restricted_installs` — never touch these (high-traffic production)
- `test_local_prefix: eval-test` — all created local sites use this prefix for cleanup

The runner does not programmatically read this file — it's documentation for reviewers. The guardrails are enforced by the eval case `must_not` criteria and the MCP tool allowlist.

---

## Common Failure Patterns

**"Local isn't running"** — the most common failure in both modes. The nexus CLI and MCP server both require Local to be running. Run `nexus doctor` before starting an eval run and ensure at least one site is running.

**CLI version mismatch** — if the CLI (`nexus --version`) reports a different version than the addon, most commands time out. Run `npm run build && npm run rebuild` in the dev repo, then restart Local.

**MCP tool not in allowlist** — Claude asks for a tool that isn't in the `MCP_TOOLS` allowlist for that case. The tool call is blocked. Either add the tool to the allowlist (if it's appropriate for the case) or update the eval case's expected steps.

**Per-site vs fleet calls (CLI mode)** — a common inefficiency where the CLI skill makes N individual `nexus wp core version <site>` calls instead of one `nexus fleet health` call. Visible as tool call counts far above MCP (e.g. 20 vs 5). Flag this in reviewer notes.
