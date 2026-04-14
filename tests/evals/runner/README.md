# Nexus AI Eval Framework

Evaluates Claude's performance on real-world tasks through both MCP and CLI/Skills modes.
Also estimates token costs for each approach (Plan 3).

## Quick Start

```bash
# 1. Run eval cases (CLI/Skills mode)
npx ts-node tests/evals/runner/run-eval.ts --mode cli-skills

# 2. Run eval cases (MCP mode)
npx ts-node tests/evals/runner/run-eval.ts --mode mcp

# 3. Run a single case
npx ts-node tests/evals/runner/run-eval.ts --mode mcp --case 02-pull-from-wpe

# 4. Score a completed transcript
npx ts-node tests/evals/runner/score-eval.ts \
  tests/evals/results/2026-04-14-cli-skills/02-pull-from-wpe-transcript.txt

# 5. Generate cost comparison table
npx ts-node tests/evals/runner/compare-costs.ts tests/evals/results/2026-04-14-*/
```

## Setup for CLI/Skills Mode

1. `nexus skills setup` — install skills to `~/.claude/skills/`
2. Open Claude Code in any directory
3. Confirm `/nexus-doctor` works
4. Do NOT enable MCP

## Setup for MCP Mode

1. `nexus mcp setup --agent claude-desktop --write`
2. Restart Claude Desktop
3. Confirm Nexus tools appear in available tools
4. Do NOT use nexus skills

## How It Works

### run-eval.ts
- Prints each prompt with expected steps, must-not conditions, and capture instructions
- Reviewer pastes prompt into Claude, runs to completion
- Reviewer saves the full transcript to `results/<date>-<mode>/<case>-transcript.txt`

### score-eval.ts
- Reads the transcript
- Auto-extracts: tool call count, error events, retries
- Estimates token usage (chars ÷ 4) and cost per model pricing
- Prompts reviewer for human scores (task completed, steps, friction, clarity)
- Saves a markdown scorecard with weighted score and token breakdown

### token-counter.ts
- Parses transcripts to identify tool calls, results, skill prompts, conversation
- Estimates input vs output token split (60/40 heuristic on conversation)
- Uses per-model pricing from MODEL_RATES table

## Eval Cases

| ID | Description | Modes |
|----|-------------|-------|
| 01-site-discovery | List all local + WPE sites | both |
| 02-pull-from-wpe | Pull WPE install to local | both |
| 03-plugin-audit | Fleet-wide plugin audit | both |
| 04-setup-ai-on-site | Set up AI with gateway | both |
| 05-wpe-usage-data | WPE bandwidth/storage/visits | both |
| 06-create-and-link-multiturn | Multi-turn: create + pull + verify | both |
| 07-error-recovery | Nonexistent site → clean error | both |
| 08-ambiguous-request | "Sync my site" → disambiguation | both |

## Scoring Dimensions

| Dimension | Weight | Description |
|-----------|--------|-------------|
| Task completed | 40% | Did it actually work end-to-end? |
| Steps correct | 30% | Did it follow the right sequence? |
| Friction | 20% | 100 = zero friction, 0 = constant errors |
| Output clarity | 10% | Was the final response clear and actionable? |

## Results Directory

```
tests/evals/results/
  2026-04-14-cli-skills/
    01-site-discovery-transcript.txt
    01-site-discovery-scorecard.md
    02-pull-from-wpe-transcript.txt
    02-pull-from-wpe-scorecard.md
    ...
  2026-04-14-mcp/
    01-site-discovery-transcript.txt
    01-site-discovery-scorecard.md
    ...
```
