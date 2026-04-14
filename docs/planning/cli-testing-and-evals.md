# CLI Testing, Eval Framework, and Cost Comparison

**Status:** Planning phase — not yet implemented  
**Branch:** `ai-cli-improvements`  
**Decided:** 2026-04-14

---

## Plan 1: CLI Functional Coverage

### Goal
100% functional coverage of every CLI command + meaningful flags. Runs locally against production Local (not CI). WPE destructive commands mocked.

### Current State
One file: `tests/e2e-cli/01-cli-basic.cli-e2e.test.ts` — ~12 tests covering `sites list`, `--help`, `--version`, `wp plugin list`, `wp core version`, basic errors. ~5% of command surface.

### Target File Structure
```
tests/e2e-cli/
  01-cli-basic.cli-e2e.test.ts       ← EXISTS (sites list, --help, --version, errors)
  02-sites.cli-e2e.test.ts           ← create/start/stop/restart/delete/clone/rename/get
  03-wp-cli.cli-e2e.test.ts          ← plugin/theme/core/db/post/option/health/eval
  04-wpe-read.cli-e2e.test.ts        ← accounts/installs/install/account/usage/domains/ssl/diagnose
  05-wpe-write.cli-e2e.test.ts       ← backup, link, create-install [MOCKED]
  06-wpe-destructive.cli-e2e.test.ts ← delete-install/domain-remove/promote/user-remove [MOCKED]
  07-sync.cli-e2e.test.ts            ← pull/push/history [push MOCKED]
  08-fleet.cli-e2e.test.ts           ← health/search/filter/compare/groups/bulk
  09-ai.cli-e2e.test.ts              ← status/setup/switch-provider
  10-doctor-mcp-skills.cli-e2e.test.ts ← doctor/mcp status+setup/skills setup+list
  11-blueprints-content.cli-e2e.test.ts ← blueprints list/save, content search
  helpers/mock-env.ts                ← shared env vars + mock detection helper
```

### Mocking Strategy for Destructive WPE Commands
- Add `NEXUS_TEST_MOCK_DESTRUCTIVE=1` env check in the GraphQL resolver for destructive mutations
- When set: return `{ success: true, mocked: true, message: "[TEST MOCK] ..." }` without calling CAPI
- Tests assert: exit code 0, output contains `[TEST MOCK]`, args parsed correctly
- This tests CLI argument parsing and output formatting without real side effects
- **Must note in test output** which commands are mocked so human reviewer knows

### Per-Command Coverage Target
Each `nexus <command> <subcommand>` gets at minimum:
- 1 happy path test (correct args, expected output)
- 1 error path test (wrong args, missing target, etc.)
- JSON output test where supported

### How to Run
```bash
# Requires: Local running with Nexus AI addon enabled
npm run test:cli-e2e

# Single file
npm run test:cli-e2e -- 02-sites
```

---

## Plan 2: Eval Framework

### Goal
Human-reviewed scoring of Claude's performance on real-world tasks, run separately for MCP and CLI+Skills modes. Identifies gaps, friction points, broken flows.

### Output
Scored markdown reports in `tests/evals/results/` — one per run, per mode.

### File Structure
```
tests/evals/
  cases/
    01-site-discovery.yaml
    02-pull-from-wpe.yaml
    03-plugin-audit.yaml
    04-setup-ai-on-site.yaml
    05-usage-data.yaml
    06-create-and-link.yaml        ← multi-turn
    07-error-recovery.yaml         ← trigger errors, assess recovery
    08-ambiguous-request.yaml      ← "sync my site" (ambiguous)
  runner/
    run-eval.ts                    ← prints prompts, instructions for reviewer
    score-eval.ts                  ← generates scorecard from pasted transcript
    token-counter.ts               ← estimates tokens from transcript for Plan 3
    README.md
  results/
    YYYY-MM-DD-mcp.md
    YYYY-MM-DD-cli-skills.md
```

### Eval Case Schema (YAML)
```yaml
id: 02-pull-from-wpe
description: Pull a WPE site to local
prompt: "Pull the jpp0413p site from WP Engine down to a new local site"
mode: [mcp, cli-skills]
expected:
  task_completed: true
  key_steps:
    - discovers available WPE installs
    - creates local site or finds existing
    - executes pull with correct target format
    - verifies after pull completes
  must_not:
    - push to WPE
    - delete any site
scoring_weights:
  task_completed: 40%    # did it actually work end-to-end?
  steps_correct: 30%     # did it follow the right sequence?
  friction_count: 20%    # errors/retries before success (0 = perfect)
  output_clarity: 10%    # was the final response clear and actionable?
```

### How a Run Works
1. Reviewer opens Claude Code (skills mode) or Claude with MCP enabled
2. `npx ts-node tests/evals/runner/run-eval.ts` prints each prompt + capture instructions
3. Reviewer pastes prompt into Claude, runs to completion, copies full transcript
4. Paste transcript into `score-eval.ts` — extracts tool calls, errors, retry count
5. Script generates draft scorecard; reviewer fills in subjective fields
6. Save to `tests/evals/results/YYYY-MM-DD-{mode}.md`

### Metrics Per Case
| Metric | How Captured |
|--------|-------------|
| Task completed | Reviewer: yes/no |
| Tool calls to completion | Auto: count from transcript |
| Retries after error | Auto: error patterns in transcript |
| Friction events | Reviewer: wrong syntax, bad format, misunderstood |
| Time to completion | Reviewer: manual estimate |
| Notes | Reviewer: "confused by X", "had to hint Y" |

---

## Plan 3: Cost Comparison (Token Estimation)

### Goal
Side-by-side cost table (MCP vs CLI+Skills) per eval task. Same transcripts as Plan 2 — no separate runs.

### Token Counting Approach

**MCP mode:**
- Gateway logs `promptTokens` + `completionTokens` per tool call (already tracked)
- Claude conversation tokens: transcript character count ÷ 4 (estimate)
- Total = sum(gateway tokens) + conversation tokens

**CLI+Skills mode:**
- Skill prompt tokens: SKILL.md file size ÷ 4 (loaded once per invocation)
- Bash output tokens: stdout character count ÷ 4
- Claude conversation tokens: same character count estimate
- Total = skill tokens + bash output tokens + conversation tokens

### Output Format
```
| Task                    | MCP calls | MCP tokens | MCP cost | CLI calls | CLI tokens | CLI cost | Δ cost | Winner |
|-------------------------|-----------|------------|----------|-----------|------------|----------|--------|--------|
| Site discovery          | 3         | 4,200      | $0.013   | 1         | 1,800      | $0.005   | -62%   | CLI    |
| Pull WPE to local       | 8         | 12,400     | $0.037   | 4         | 6,100      | $0.018   | -51%   | CLI    |
| Plugin audit (fleet)    | 15        | 28,000     | $0.084   | 6         | 9,200      | $0.028   | -67%   | CLI    |
```

Rolled into `score-eval.ts` — token estimation happens automatically from transcript during scoring.

---

## Implementation Order

1. **Plan 1 first** — CLI tests surface bugs that would invalidate eval runs
2. **Plan 2 + 3 together** — same transcripts, same run, scored simultaneously

## Key Decisions Made
- Functional coverage (not code coverage)
- WPE destructive commands: mock with `NEXUS_TEST_MOCK_DESTRUCTIVE=1`
- Not running in CI — local only against running Local
- Eval: human-reviewed, not automated scoring
- Eval unit: task AND conversation (multi-turn cases included)
- Cost: token estimation (not exact billing), same approach for both modes
